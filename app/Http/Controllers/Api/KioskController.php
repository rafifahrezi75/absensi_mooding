<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceButtonConfig;
use App\Models\AttendanceEvent;
use App\Models\Employee;
use App\Models\HrdUser;
use App\Models\KioskDevice;
use App\Models\KioskLocation;
use App\Models\ShiftSnapshot;
use App\Models\SystemSetting;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class KioskController extends Controller
{
    public function config(Request $request): JsonResponse
    {
        $deviceToken = $request->header('X-Kiosk-Device-Token') ?? $request->query('device_token');

        $device = null;
        if ($deviceToken) {
            $device = KioskDevice::with('location')->where('device_token', $deviceToken)->first();
            if ($device) {
                $device->update(['last_seen_at' => now()]);
            }
        }

        if (!$device) {
            $device = KioskDevice::with('location')->where('is_active', true)->first();
        }

        $location = $device ? $device->location : KioskLocation::first();

        $buttonConfigs = AttendanceButtonConfig::where(function ($query) use ($location) {
            $query->whereNull('kiosk_location_id');
            if ($location) {
                $query->orWhere('kiosk_location_id', $location->id);
            }
        })
        ->where('is_enabled', true)
        ->orderBy('sort_order', 'asc')
        ->get();

        $allLocations = KioskLocation::where('is_active', true)->get();
        $allDevices = KioskDevice::where('is_active', true)->get();

        return response()->json([
            'server_time' => Carbon::now()->toIso8601String(),
            'device' => $device,
            'location' => $location,
            'all_locations' => $allLocations,
            'all_devices' => $allDevices,
            'buttons' => $buttonConfigs,
            'settings' => [
                'similarity_threshold' => (float) SystemSetting::get('similarity_threshold', '0.75'),
                'ambiguity_margin' => (float) SystemSetting::get('ambiguity_margin', '0.08'),
                'max_failed_scans' => (int) SystemSetting::get('max_failed_scans', '3'),
                'auto_lock_seconds' => (int) SystemSetting::get('auto_lock_seconds', '120'),
            ],
        ]);
    }

    public function verifyHrdPin(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pin' => 'required|string',
        ]);

        $hrdUsers = HrdUser::where('is_active', true)->get();

        foreach ($hrdUsers as $user) {
            if (Hash::check($validated['pin'], $user->kiosk_pin_hash)) {
                return response()->json([
                    'success' => true,
                    'user' => [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'company_id' => $user->company_id,
                    ],
                ]);
            }
        }

        return response()->json([
            'success' => false,
            'message' => 'PIN HRD tidak valid',
        ], 401);
    }

    public function employeesCache(Request $request): JsonResponse
    {
        $employees = Employee::with(['faceEmbeddings' => function ($query) {
            $query->where('is_active', true);
        }])
        ->where('status', 'aktif')
        ->get();

        $formatted = $employees->map(function ($emp) {
            $embeddings = $emp->faceEmbeddings->map(function ($fb) {
                $vector = json_decode($fb->embedding_vector, true);
                if (!is_array($vector)) {
                    $vector = array_map('floatval', explode(',', $fb->embedding_vector));
                }
                return [
                    'id' => $fb->id,
                    'pose_label' => $fb->pose_label,
                    'vector' => $vector,
                ];
            });

            return [
                'id' => $emp->id,
                'external_karyawan_id' => $emp->external_karyawan_id,
                'id_karyawan' => $emp->id_karyawan,
                'id_absensi' => $emp->id_absensi,
                'nama_karyawan' => $emp->nama_karyawan,
                'jabatan' => $emp->jabatan,
                'company_id' => $emp->company_id,
                'cabang_id' => $emp->cabang_id,
                'proyek_id' => $emp->proyek_id,
                'gudang_id' => $emp->gudang_id ?? null,
                'shift_id' => $emp->shift_id,
                'has_biometric' => $emp->faceEmbeddings->count() > 0,
                'embeddings' => $embeddings,
            ];
        });

        return response()->json([
            'server_time' => Carbon::now()->toIso8601String(),
            'employees' => $formatted,
        ]);
    }

    public function recordTap(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'idempotency_key' => 'required|string',
            'employee_id' => 'required|integer|exists:employees,id',
            'kiosk_device_id' => 'nullable|integer',
            'kiosk_location_id' => 'nullable|integer',
            'work_date' => 'required|date_format:Y-m-d',
            'attendance_type' => 'required|in:clock_in,clock_out,break_start,break_end,overtime_start,overtime_end',
            'auth_method' => 'required|in:face_liveness,fallback_pin',
            'recorded_at' => 'required|string',
            'is_time_suspect' => 'nullable|boolean',
            'is_cross_location' => 'nullable|boolean',
            'confidence_score' => 'nullable|numeric',
            'liveness_passed' => 'nullable|boolean',
        ]);

        $employee = Employee::findOrFail($validated['employee_id']);

        $existingKey = AttendanceEvent::where('idempotency_key', $validated['idempotency_key'])->first();
        if ($existingKey) {
            return response()->json([
                'status' => 'duplicate_ignored',
                'message' => 'Event sudah tercatat sebelumnya',
                'event' => $existingKey,
                'status_label' => $existingKey->main_app_status_label,
            ]);
        }

        $workDate = $validated['work_date'];
        $shift = ShiftSnapshot::where('company_id', $employee->company_id)
            ->where('external_shift_id', $employee->shift_id)
            ->first();

        if (in_array($validated['attendance_type'], ['clock_out', 'overtime_end']) && $shift && $shift->is_overnight) {
            $recentClockIn = AttendanceEvent::where('employee_id', $employee->id)
                ->where('attendance_type', 'clock_in')
                ->where('recorded_at', '>=', Carbon::parse($validated['recorded_at'])->subHours(18))
                ->orderBy('recorded_at', 'desc')
                ->first();

            if ($recentClockIn) {
                $workDate = $recentClockIn->work_date->format('Y-m-d');
            }
        }

        if ($validated['attendance_type'] === 'clock_in') {
            $alreadyClockedIn = AttendanceEvent::where('employee_id', $employee->id)
                ->where('work_date', $workDate)
                ->where('attendance_type', 'clock_in')
                ->first();

            if ($alreadyClockedIn) {
                return response()->json([
                    'status' => 'already_clocked_in',
                    'message' => 'Sudah tercatat Masuk pukul ' . Carbon::parse($alreadyClockedIn->recorded_at)->format('H:i'),
                    'recorded_time' => Carbon::parse($alreadyClockedIn->recorded_at)->format('H:i:s'),
                    'employee' => [
                        'nama_karyawan' => $employee->nama_karyawan,
                        'id_karyawan' => $employee->id_karyawan,
                    ],
                ]);
            }
        }

        $recordedTime = Carbon::parse($validated['recorded_at']);
        $statusLabel = 'Tercatat ' . $recordedTime->format('H:i');

        if ($validated['attendance_type'] === 'clock_in') {
            if ($shift) {
                $shiftStart = Carbon::parse($workDate . ' ' . $shift->start_time);
                if ($recordedTime->greaterThan($shiftStart)) {
                    $diff = $shiftStart->diffInMinutes($recordedTime);
                    $statusLabel = 'Masuk Berhasil — Terlambat ' . $diff . ' menit';
                } else {
                    $statusLabel = 'Masuk Berhasil — Tepat Waktu';
                }
            } else {
                $statusLabel = 'Masuk Berhasil';
            }
        } elseif ($validated['attendance_type'] === 'clock_out') {
            $statusLabel = 'Pulang Berhasil';
        } elseif ($validated['attendance_type'] === 'break_start') {
            $statusLabel = 'Istirahat Mulai Tercatat';
        } elseif ($validated['attendance_type'] === 'break_end') {
            $statusLabel = 'Istirahat Selesai Tercatat';
        } elseif ($validated['attendance_type'] === 'overtime_start') {
            $statusLabel = 'Lembur Mulai Tercatat';
        } elseif ($validated['attendance_type'] === 'overtime_end') {
            $statusLabel = 'Lembur Selesai Tercatat';
        }

        $event = AttendanceEvent::create([
            'idempotency_key' => $validated['idempotency_key'],
            'employee_id' => $employee->id,
            'kiosk_device_id' => $validated['kiosk_device_id'] ?? null,
            'kiosk_location_id' => $validated['kiosk_location_id'] ?? null,
            'device_mode' => 'kiosk',
            'company_id' => $employee->company_id,
            'entitasshelter_id' => $employee->entitasshelter_id,
            'proyek_id' => $employee->proyek_id,
            'shift_id' => $employee->shift_id,
            'work_date' => $workDate,
            'attendance_type' => $validated['attendance_type'],
            'auth_method' => $validated['auth_method'],
            'recorded_at' => $recordedTime,
            'is_time_suspect' => $validated['is_time_suspect'] ?? false,
            'is_cross_location' => $validated['is_cross_location'] ?? false,
            'confidence_score' => $validated['confidence_score'] ?? null,
            'liveness_passed' => $validated['liveness_passed'] ?? true,
            'sync_status' => 'synced',
            'main_app_status_label' => $statusLabel,
            'synced_at' => now(),
            'sync_attempts' => 1,
        ]);

        return response()->json([
            'status' => 'synced',
            'message' => $statusLabel,
            'status_label' => $statusLabel,
            'recorded_time' => $recordedTime->format('H:i:s'),
            'employee' => [
                'id' => $employee->id,
                'id_karyawan' => $employee->id_karyawan,
                'nama_karyawan' => $employee->nama_karyawan,
                'jabatan' => $employee->jabatan,
            ],
            'event' => $event,
        ]);
    }

    public function recordFallbackTap(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'idempotency_key' => 'required|string',
            'id_karyawan' => 'required|string',
            'pin' => 'required|string',
            'kiosk_device_id' => 'nullable|integer',
            'kiosk_location_id' => 'nullable|integer',
            'work_date' => 'required|date_format:Y-m-d',
            'attendance_type' => 'required|in:clock_in,clock_out,break_start,break_end,overtime_start,overtime_end',
            'recorded_at' => 'required|string',
            'proof_photo_base64' => 'required|string',
        ]);

        $employee = Employee::where('id_karyawan', $validated['id_karyawan'])->first();
        if (!$employee) {
            return response()->json([
                'success' => false,
                'message' => 'ID Karyawan tidak ditemukan',
            ], 404);
        }

        if (strtolower($employee->status) !== 'aktif') {
            return response()->json([
                'success' => false,
                'message' => 'Status karyawan tidak aktif',
            ], 403);
        }

        if (!$employee->pin_hash || !Hash::check($validated['pin'], $employee->pin_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'PIN salah',
            ], 401);
        }

        $photoData = $validated['proof_photo_base64'];
        if (preg_match('/^data:image\/(\w+);base64,/', $photoData, $type)) {
            $photoData = substr($photoData, strpos($photoData, ',') + 1);
            $type = strtolower($type[1]);
        } else {
            $type = 'jpg';
        }
        $photoDecoded = base64_decode($photoData);
        $fileName = 'proofs/proof_' . Str::slug($validated['idempotency_key']) . '.' . $type;
        Storage::disk('public')->put($fileName, $photoDecoded);

        $recordedTime = Carbon::parse($validated['recorded_at']);
        $statusLabel = 'Jalur Darurat (PIN) — ' . ucfirst(str_replace('_', ' ', $validated['attendance_type']));

        $event = AttendanceEvent::create([
            'idempotency_key' => $validated['idempotency_key'],
            'employee_id' => $employee->id,
            'kiosk_device_id' => $validated['kiosk_device_id'] ?? null,
            'kiosk_location_id' => $validated['kiosk_location_id'] ?? null,
            'device_mode' => 'kiosk',
            'company_id' => $employee->company_id,
            'entitasshelter_id' => $employee->entitasshelter_id,
            'proyek_id' => $employee->proyek_id,
            'shift_id' => $employee->shift_id,
            'work_date' => $validated['work_date'],
            'attendance_type' => $validated['attendance_type'],
            'auth_method' => 'fallback_pin',
            'recorded_at' => $recordedTime,
            'proof_photo_path' => $fileName,
            'sync_status' => 'synced',
            'main_app_status_label' => $statusLabel,
            'synced_at' => now(),
            'sync_attempts' => 1,
        ]);

        return response()->json([
            'success' => true,
            'status' => 'synced',
            'message' => 'Absensi darurat berhasil dicatat',
            'status_label' => $statusLabel,
            'recorded_time' => $recordedTime->format('H:i:s'),
            'employee' => [
                'id' => $employee->id,
                'id_karyawan' => $employee->id_karyawan,
                'nama_karyawan' => $employee->nama_karyawan,
                'jabatan' => $employee->jabatan,
            ],
            'event' => $event,
        ]);
    }
}
