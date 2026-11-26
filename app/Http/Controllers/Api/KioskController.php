<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceButtonConfig;
use App\Models\AttendanceEvent;
use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Models\FaceVerificationAttempt;
use App\Models\HrdUser;
use App\Models\KioskDevice;
use App\Models\KioskLocation;
use App\Models\ShiftSnapshot;
use App\Models\SystemSetting;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class KioskController extends Controller
{
    public function config(Request $request): JsonResponse
    {
        $device = $this->resolveKioskDevice($request);
        $device?->update(['last_seen_at' => now()]);

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
                'similarity_threshold' => (float) SystemSetting::get('similarity_threshold', (string) config('biometric.match_threshold', 0.65)),
                'ambiguity_margin' => (float) SystemSetting::get('ambiguity_margin', (string) config('biometric.margin_threshold', 0.08)),
                'capture_frame_count' => (int) config('biometric.capture_frame_count', 5),
                'min_consistent_frames' => (int) config('biometric.min_consistent_frames', 4),
                'allowed_challenges' => config('biometric.liveness.allowed_challenges', ['HEAD_TURN']),
                'challenge_timeout_seconds' => (int) config('biometric.liveness.challenge_timeout_seconds', 8),
                'passive_anti_spoof_enabled' => (bool) config('biometric.liveness.passive_anti_spoof_enabled', true),
                'active_liveness_enabled' => (bool) config('biometric.liveness.active_liveness_enabled', true),
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
                $request->session()->regenerate();
                $token = bin2hex(random_bytes(32));
                $request->session()->put([
                    'hrd_user_id' => $user->id,
                    'hrd_token' => $token,
                ]);
                Cache::put("hrd_token:{$token}", $user->id, now()->addHours(8));

                return response()->json([
                    'success' => true,
                    'token' => $token,
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
        $device = $this->resolveKioskDevice($request);
        $companyIds = collect($device?->allowed_company_ids ?? [])
            ->push($device?->location?->company_id)
            ->filter()
            ->unique()
            ->values();

        $employees = Employee::query()
            ->select([
                'id',
                'external_karyawan_id',
                'id_karyawan',
                'id_absensi',
                'nama_karyawan',
                'jabatan',
                'company_id',
                'cabang_id',
                'proyek_id',
                'shift_id',
            ])
            ->withCount(['faceEmbeddings as biometric_template_count' => function ($query) {
                $query->where('is_active', true)
                    ->where('model_name', config('biometric.model.name', 'buffalo_s'));
            }])
            ->where('status', 'aktif')
            ->when($companyIds->isNotEmpty(), function ($query) use ($companyIds) {
                $query->whereIn('company_id', $companyIds);
            })
            ->orderBy('id')
            ->get();

        $formatted = $employees->map(function ($emp) {
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
                'has_biometric' => $emp->biometric_template_count > 0,
                'biometric_template_count' => $emp->biometric_template_count,
            ];
        });

        $this->syncFaceEngineGalleryIfNeeded();

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
            'liveness_passed' => 'required_if:auth_method,face_liveness|boolean',
            'proof_photo_base64' => 'nullable|string',
            'proof_photo_left_base64' => 'nullable|string',
            'proof_photo_right_base64' => 'nullable|string',
            'session_id' => 'nullable|string',
            'decision' => 'required_if:auth_method,face_liveness|nullable|in:VERIFIED,RETRY,UNKNOWN,AMBIGUOUS,SPOOF_REJECTED,QUALITY_REJECTED',
            'reject_reason' => 'nullable|string',
            'top1_employee_id' => 'nullable|integer',
            'top1_score' => 'nullable|numeric',
            'top2_employee_id' => 'nullable|integer',
            'top2_score' => 'nullable|numeric',
            'score_margin' => 'nullable|numeric',
            'quality_score' => 'nullable|numeric',
            'brightness_score' => 'nullable|numeric',
            'blur_score' => 'nullable|numeric',
            'pose_yaw' => 'nullable|numeric',
            'pose_pitch' => 'nullable|numeric',
            'pose_roll' => 'nullable|numeric',
            'passive_spoof_score' => 'nullable|numeric',
            'active_liveness_type' => 'nullable|string',
            'captured_frames' => 'nullable|integer',
            'consistent_frames' => 'nullable|integer',
            'attestation_token' => 'nullable|string',
            'attestation_timestamp' => 'nullable|integer',
        ]);

        if ($validated['auth_method'] === 'face_liveness') {
            $decision = $validated['decision'] ?? null;
            if ($decision !== 'VERIFIED') {
                $failedDecision = $decision ?? 'UNKNOWN';
                FaceVerificationAttempt::create([
                    'session_id' => $validated['session_id'] ?? Str::uuid()->toString(),
                    'employee_id' => $validated['employee_id'],
                    'top1_employee_id' => $validated['top1_employee_id'] ?? null,
                    'top1_score' => $validated['top1_score'] ?? null,
                    'top2_employee_id' => $validated['top2_employee_id'] ?? null,
                    'top2_score' => $validated['top2_score'] ?? null,
                    'score_margin' => $validated['score_margin'] ?? null,
                    'quality_score' => $validated['quality_score'] ?? null,
                    'brightness_score' => $validated['brightness_score'] ?? null,
                    'blur_score' => $validated['blur_score'] ?? null,
                    'pose_yaw' => $validated['pose_yaw'] ?? null,
                    'pose_pitch' => $validated['pose_pitch'] ?? null,
                    'pose_roll' => $validated['pose_roll'] ?? null,
                    'passive_spoof_score' => $validated['passive_spoof_score'] ?? null,
                    'active_liveness_type' => $validated['active_liveness_type'] ?? null,
                    'active_liveness_passed' => (bool) ($validated['liveness_passed'] ?? false),
                    'captured_frames' => (int) ($validated['captured_frames'] ?? 1),
                    'consistent_frames' => (int) ($validated['consistent_frames'] ?? 1),
                    'result' => $failedDecision,
                    'reject_reason' => $validated['reject_reason'] ?? 'NOT_VERIFIED',
                    'model_name' => config('biometric.model.name', 'buffalo_s'),
                    'model_version' => config('biometric.model.version', 'arcface_r50_v1'),
                    'kiosk_device_id' => $validated['kiosk_device_id'] ?? null,
                    'kiosk_location_id' => $validated['kiosk_location_id'] ?? null,
                ]);

                return response()->json([
                    'status' => strtolower($failedDecision),
                    'decision' => $failedDecision,
                    'reject_reason' => $validated['reject_reason'] ?? 'NOT_VERIFIED',
                    'message' => 'Verifikasi biometrik belum memenuhi kriteria valid',
                ], 422);
            }

            if (($validated['top1_employee_id'] ?? null) !== $validated['employee_id']) {
                return response()->json([
                    'status' => 'identity_mismatch',
                    'decision' => 'RETRY',
                    'reject_reason' => 'TOP1_EMPLOYEE_MISMATCH',
                    'message' => 'Identitas hasil verifikasi tidak sesuai dengan data absensi',
                ], 422);
            }

            if (! ($validated['liveness_passed'] ?? false)) {
                return response()->json([
                    'status' => 'liveness_failed',
                    'decision' => 'RETRY',
                    'reject_reason' => 'ACTIVE_LIVENESS_REQUIRED',
                    'message' => 'Bukti liveness wajib lolos sebelum absensi dicatat',
                ], 422);
            }

            if (empty($validated['attestation_token']) || empty($validated['attestation_timestamp'])) {
                return response()->json([
                    'status' => 'invalid_attestation',
                    'decision' => 'RETRY',
                    'reject_reason' => 'ATTESTATION_REQUIRED',
                    'message' => 'Bukti otentikasi biometrik wajib disertakan',
                ], 422);
            }

            $sharedSecret = config('biometric.shared_secret', 'mooding_biometric_secure_secret_2026');
            $token = $validated['attestation_token'];
            $ts = (int) $validated['attestation_timestamp'];
            $now = time();

            if (abs($now - $ts) > 60) {
                return response()->json([
                    'status' => 'expired_attestation',
                    'decision' => 'RETRY',
                    'reject_reason' => 'ATTESTATION_EXPIRED',
                    'message' => 'Sesi verifikasi biometrik kedaluwarsa, silakan scan ulang',
                ], 422);
            }

            $expectedToken = hash_hmac('sha256', "{$validated['employee_id']}:{$ts}:VERIFIED", $sharedSecret);
            if (! hash_equals($expectedToken, $token)) {
                return response()->json([
                    'status' => 'invalid_attestation',
                    'decision' => 'RETRY',
                    'reject_reason' => 'ATTESTATION_SIGNATURE_INVALID',
                    'message' => 'Bukti otentikasi biometrik tidak sah',
                ], 422);
            }

            if (Cache::has("used_attestation_token:{$token}")) {
                return response()->json([
                    'status' => 'invalid_attestation',
                    'decision' => 'RETRY',
                    'reject_reason' => 'ATTESTATION_TOKEN_REPLAYED',
                    'message' => 'Token otentikasi biometrik sudah pernah digunakan',
                ], 422);
            }
            Cache::put("used_attestation_token:{$token}", true, 120);

            FaceVerificationAttempt::create([
                'session_id' => $validated['session_id'] ?? Str::uuid()->toString(),
                'employee_id' => $validated['employee_id'],
                'top1_employee_id' => $validated['top1_employee_id'] ?? $validated['employee_id'],
                'top1_score' => $validated['top1_score'] ?? $validated['confidence_score'] ?? null,
                'top2_employee_id' => $validated['top2_employee_id'] ?? null,
                'top2_score' => $validated['top2_score'] ?? null,
                'score_margin' => $validated['score_margin'] ?? null,
                'quality_score' => $validated['quality_score'] ?? null,
                'brightness_score' => $validated['brightness_score'] ?? null,
                'blur_score' => $validated['blur_score'] ?? null,
                'pose_yaw' => $validated['pose_yaw'] ?? null,
                'pose_pitch' => $validated['pose_pitch'] ?? null,
                'pose_roll' => $validated['pose_roll'] ?? null,
                'passive_spoof_score' => $validated['passive_spoof_score'] ?? null,
                'active_liveness_type' => $validated['active_liveness_type'] ?? null,
                'active_liveness_passed' => (bool) ($validated['liveness_passed'] ?? true),
                'captured_frames' => (int) ($validated['captured_frames'] ?? 1),
                'consistent_frames' => (int) ($validated['consistent_frames'] ?? 1),
                'result' => 'VERIFIED',
                'reject_reason' => null,
                'model_name' => config('biometric.model.name', 'buffalo_s'),
                'model_version' => config('biometric.model.version', 'arcface_r50_v1'),
                'kiosk_device_id' => $validated['kiosk_device_id'] ?? null,
                'kiosk_location_id' => $validated['kiosk_location_id'] ?? null,
            ]);
        }

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
                $alreadyTime = Carbon::parse($alreadyClockedIn->recorded_at)->setTimezone(config('app.timezone'));

                return response()->json([
                    'status' => 'already_clocked_in',
                    'message' => 'Sudah tercatat Masuk pukul '.$alreadyTime->format('H:i').' WIB',
                    'recorded_time' => $alreadyTime->format('H:i:s').' WIB',
                    'employee' => [
                        'nama_karyawan' => $employee->nama_karyawan,
                        'id_karyawan' => $employee->id_karyawan,
                    ],
                ]);
            }
        }

        $recordedTime = Carbon::parse($validated['recorded_at'])->setTimezone(config('app.timezone'));
        $statusLabel = 'Tercatat '.$recordedTime->format('H:i').' WIB';

        if ($validated['attendance_type'] === 'clock_in') {
            if ($shift) {
                $shiftStart = Carbon::parse($workDate.' '.$shift->start_time);
                if ($recordedTime->greaterThan($shiftStart)) {
                    $diff = $shiftStart->diffInMinutes($recordedTime);
                    $statusLabel = 'Masuk Berhasil — Terlambat '.$diff.' menit';
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

        $slugKey = Str::slug($validated['idempotency_key']);
        $photoPath = $this->storeBase64ProofImage($validated['proof_photo_base64'] ?? null, 'proof_'.$slugKey);
        $photoLeftPath = $this->storeBase64ProofImage($validated['proof_photo_left_base64'] ?? null, 'proof_'.$slugKey.'_left');
        $photoRightPath = $this->storeBase64ProofImage($validated['proof_photo_right_base64'] ?? null, 'proof_'.$slugKey.'_right');

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
            'proof_photo_path' => $photoPath,
            'proof_photo_left_path' => $photoLeftPath,
            'proof_photo_right_path' => $photoRightPath,
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
            'recorded_time' => $recordedTime->format('H:i:s').' WIB',
            'proof_photo_url' => $photoPath ? '/storage/'.$photoPath : null,
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
            'proof_photo_base64' => 'nullable|string',
        ]);

        $employee = Employee::where('id_karyawan', $validated['id_karyawan'])->first();
        if (! $employee) {
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

        if (! $employee->pin_hash || ! Hash::check($validated['pin'], $employee->pin_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'PIN salah',
            ], 401);
        }

        $photoData = $validated['proof_photo_base64'] ?? null;
        $fileName = null;
        if (! empty($photoData)) {
            if (preg_match('/^data:image\/(\w+);base64,/', $photoData, $type)) {
                $photoData = substr($photoData, strpos($photoData, ',') + 1);
                $type = strtolower($type[1]);
            } else {
                $type = 'jpg';
            }
            $photoDecoded = base64_decode($photoData);
            if ($photoDecoded !== false) {
                $fileName = 'proofs/proof_'.Str::slug($validated['idempotency_key']).'.'.$type;
                Storage::disk('public')->put($fileName, $photoDecoded);
            }
        }

        $recordedTime = Carbon::parse($validated['recorded_at'])->setTimezone(config('app.timezone'));
        $statusLabel = 'Jalur Darurat (PIN) — '.ucfirst(str_replace('_', ' ', $validated['attendance_type'])).' '.$recordedTime->format('H:i').' WIB';

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
            'recorded_time' => $recordedTime->format('H:i:s').' WIB',
            'employee' => [
                'id' => $employee->id,
                'id_karyawan' => $employee->id_karyawan,
                'nama_karyawan' => $employee->nama_karyawan,
                'jabatan' => $employee->jabatan,
            ],
            'event' => $event,
        ]);
    }

    private function storeBase64ProofImage(?string $base64Data, string $baseName): ?string
    {
        if (empty($base64Data)) {
            return null;
        }

        $photoData = $base64Data;
        if (preg_match('/^data:image\/(\w+);base64,/', $photoData, $type)) {
            $photoData = substr($photoData, strpos($photoData, ',') + 1);
            $type = strtolower($type[1]);
            if (! in_array($type, ['jpg', 'jpeg', 'png', 'webp'], true)) {
                $type = 'jpg';
            }
        } else {
            $type = 'jpg';
        }

        $decoded = base64_decode($photoData);
        if ($decoded === false) {
            return null;
        }

        $fileName = 'proofs/'.$baseName.'.'.$type;
        Storage::disk('public')->put($fileName, $decoded);

        return $fileName;
    }

    private function resolveKioskDevice(Request $request): ?KioskDevice
    {
        $deviceToken = $request->header('X-Kiosk-Device-Token') ?? $request->query('device_token');

        if ($deviceToken) {
            $device = KioskDevice::with('location')
                ->where('device_token', $deviceToken)
                ->where('is_active', true)
                ->first();

            if ($device) {
                return $device;
            }
        }

        return KioskDevice::with('location')->where('is_active', true)->first();
    }

    private function syncFaceEngineGalleryIfNeeded(): void
    {
        $sourceVersion = $this->faceGallerySourceVersion();
        $engineUrl = rtrim((string) config('biometric.engine_url'), '/');

        try {
            $health = Http::withHeaders([
                'X-Biometric-Secret' => (string) config('biometric.shared_secret'),
            ])->connectTimeout(1)->timeout(2)->get($engineUrl.'/health');
            if (! $health->successful() || $health->json('gallery_version') === $sourceVersion) {
                return;
            }
        } catch (\Throwable) {
            return;
        }

        Cache::lock('face-engine-gallery-sync', 120)->get(function () use ($engineUrl, $sourceVersion): void {
            try {
                $engineRequest = Http::withHeaders([
                    'X-Biometric-Secret' => (string) config('biometric.shared_secret'),
                ]);
                $health = $engineRequest->connectTimeout(1)->timeout(2)->get($engineUrl.'/health');
                if ($health->successful() && $health->json('gallery_version') === $sourceVersion) {
                    return;
                }

                $employees = Employee::query()
                    ->select([
                        'id',
                        'external_karyawan_id',
                        'company_id',
                        'entitasshelter_id',
                        'cabang_id',
                        'proyek_id',
                        'id_karyawan',
                        'id_absensi',
                        'nama_karyawan',
                    ])
                    ->with(['faceEmbeddings' => function ($query) {
                        $query->select([
                            'id',
                            'employee_id',
                            'embedding_vector',
                            'model_name',
                            'model_version',
                            'pose_label',
                            'quality_score',
                        ])->where('is_active', true);
                    }])
                    ->where('status', 'aktif')
                    ->whereHas('faceEmbeddings', function ($query) {
                        $query->where('is_active', true);
                    })
                    ->orderBy('id')
                    ->get();

                $payloadEmployees = $employees->map(function (Employee $employee): array {
                    $embeddings = $employee->faceEmbeddings
                        ->map(function (FaceEmbedding $embedding): ?array {
                            $vector = json_decode($embedding->embedding_vector, true);
                            $modelName = strtolower($embedding->model_name ?: config('biometric.model.name', 'buffalo_s'));
                            $expectedDimension = $modelName === 'sface' ? 128 : 512;

                            if (! is_array($vector) || count($vector) !== $expectedDimension) {
                                return null;
                            }

                            return [
                                'vector' => $vector,
                                'model_name' => $modelName,
                                'model_version' => $embedding->model_version,
                                'pose_label' => $embedding->pose_label,
                                'quality_score' => $embedding->quality_score ?? 100.0,
                            ];
                        })
                        ->filter()
                        ->values()
                        ->all();

                    return [
                        'employee_id' => $employee->id,
                        'external_karyawan_id' => $employee->id,
                        'company_id' => $employee->company_id,
                        'entitasshelter_id' => $employee->entitasshelter_id,
                        'cabang_id' => $employee->cabang_id,
                        'proyek_id' => $employee->proyek_id,
                        'id_karyawan' => $employee->id_karyawan,
                        'id_absensi' => $employee->id_absensi,
                        'nama_karyawan' => $employee->nama_karyawan,
                        'embeddings' => $embeddings,
                    ];
                })->filter(fn (array $employee): bool => $employee['embeddings'] !== [])->values()->all();

                $engineRequest->connectTimeout(2)
                    ->timeout(60)
                    ->post($engineUrl.'/api/v1/cache/sync', [
                        'replace_all' => true,
                        'source_version' => $sourceVersion,
                        'similarity_threshold' => (float) SystemSetting::get(
                            'similarity_threshold',
                            (string) config('biometric.match_threshold', 0.65)
                        ),
                        'ambiguity_margin' => (float) SystemSetting::get(
                            'ambiguity_margin',
                            (string) config('biometric.margin_threshold', 0.08)
                        ),
                        'employees' => $payloadEmployees,
                    ])
                    ->throw();
            } catch (\Throwable $exception) {
                report($exception);
            }
        });
    }

    private function faceGallerySourceVersion(): string
    {
        $activeEmbeddingQuery = FaceEmbedding::query()
            ->where('is_active', true)
            ->whereHas('employee', fn ($query) => $query->where('status', 'aktif'));

        $versionParts = [
            Employee::where('status', 'aktif')->count(),
            (clone $activeEmbeddingQuery)->count(),
            (string) (clone $activeEmbeddingQuery)->max('face_embeddings.updated_at'),
            (string) Employee::where('status', 'aktif')->max('updated_at'),
            SystemSetting::get('similarity_threshold', (string) config('biometric.match_threshold', 0.65)),
            SystemSetting::get('ambiguity_margin', (string) config('biometric.margin_threshold', 0.08)),
        ];

        return 'gallery_'.substr(hash('sha256', implode('|', $versionParts)), 0, 16);
    }
}
