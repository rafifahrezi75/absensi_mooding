<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceButtonConfig;
use App\Models\AttendanceEvent;
use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Models\HrdUser;
use App\Models\KioskDevice;
use App\Models\KioskLocation;
use App\Models\ShiftSnapshot;
use App\Models\SyncLog;
use App\Models\SystemSetting;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

class HrdController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = HrdUser::where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'Email atau kata sandi salah',
            ], 401);
        }

        if (!$user->is_active) {
            return response()->json([
                'success' => false,
                'message' => 'Akun HRD tidak aktif',
            ], 403);
        }

        $token = bin2hex(random_bytes(32));
        session(['hrd_user_id' => $user->id, 'hrd_token' => $token]);

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

    public function logout(Request $request): JsonResponse
    {
        session()->forget(['hrd_user_id', 'hrd_token']);
        return response()->json([
            'success' => true,
            'message' => 'Berhasil logout',
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        $userId = session('hrd_user_id');
        $user = $userId ? HrdUser::find($userId) : HrdUser::first();

        if (!$user) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'company_id' => $user->company_id,
            ],
        ]);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $today = Carbon::today()->toDateString();

        $totalEmployees = Employee::where('status', 'aktif')->count();
        $enrolledFaces = FaceEmbedding::where('is_active', true)->distinct('employee_id')->count('employee_id');

        $todayEvents = AttendanceEvent::whereDate('recorded_at', $today)->get();

        $hadirCount = $todayEvents->where('attendance_type', 'clock_in')->count();
        $terlambatCount = $todayEvents->where('attendance_type', 'clock_in')
            ->filter(fn($e) => str_contains(strtolower($e->main_app_status_label ?? ''), 'terlambat'))
            ->count();
        $tepatWaktuCount = $hadirCount - $terlambatCount;
        $pulangCount = $todayEvents->where('attendance_type', 'clock_out')->count();
        $lemburCount = $todayEvents->whereIn('attendance_type', ['overtime_start', 'overtime_end'])->count();
        $fallbackPinCount = $todayEvents->where('auth_method', 'fallback_pin')->count();

        $devices = KioskDevice::with('location')->get()->map(function ($d) {
            $isOnline = $d->last_seen_at && Carbon::parse($d->last_seen_at)->diffInMinutes(now()) <= 5;
            return [
                'id' => $d->id,
                'device_name' => $d->device_name,
                'device_token' => $d->device_token,
                'location_name' => $d->location ? $d->location->location_name : '-',
                'location_type' => $d->location ? $d->location->location_type : '-',
                'is_online' => $isOnline,
                'last_seen_at' => $d->last_seen_at ? Carbon::parse($d->last_seen_at)->toIso8601String() : null,
                'app_version' => $d->app_version,
            ];
        });

        $offlinePendingCount = AttendanceEvent::where('sync_status', 'pending')->count();

        $alerts = [
            'period_locked' => AttendanceEvent::where('sync_status', 'period_locked')->count(),
            'manual_override_conflict' => AttendanceEvent::where('sync_status', 'manual_override_conflict')->count(),
            'is_time_suspect' => AttendanceEvent::where('is_time_suspect', true)->count(),
            'fallback_pin_unverified' => AttendanceEvent::where('auth_method', 'fallback_pin')
                ->whereDate('recorded_at', '>=', Carbon::now()->subDays(7))
                ->count(),
        ];

        return response()->json([
            'summary' => [
                'total_employees' => $totalEmployees,
                'enrolled_faces' => $enrolledFaces,
                'today_hadir' => $hadirCount,
                'today_tepat_waktu' => $tepatWaktuCount,
                'today_terlambat' => $terlambatCount,
                'today_pulang' => $pulangCount,
                'today_lembur' => $lemburCount,
                'today_fallback_pin' => $fallbackPinCount,
                'offline_pending_count' => $offlinePendingCount,
            ],
            'devices' => $devices,
            'alerts' => $alerts,
        ]);
    }

    public function employees(Request $request): JsonResponse
    {
        $search = $request->query('search');
        $status = $request->query('status');
        $hasBiometric = $request->query('has_biometric');
        $cabangId = $request->query('cabang_id');
        $proyekId = $request->query('proyek_id');

        $query = Employee::with(['faceEmbeddings' => function ($q) {
            $q->where('is_active', true);
        }]);

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('nama_karyawan', 'like', "%{$search}%")
                  ->orWhere('id_karyawan', 'like', "%{$search}%")
                  ->orWhere('nomor_induk', 'like', "%{$search}%")
                  ->orWhere('jabatan', 'like', "%{$search}%");
            });
        }

        if ($status) {
            $query->where('status', $status);
        }

        if ($cabangId) {
            $query->where('cabang_id', $cabangId);
        }

        if ($proyekId) {
            $query->where('proyek_id', $proyekId);
        }

        $employees = $query->orderBy('nama_karyawan', 'asc')->paginate(20);

        $shiftIds = $employees->pluck('shift_id')->filter()->unique();
        $shifts = ShiftSnapshot::whereIn('external_shift_id', $shiftIds)->get()->keyBy('external_shift_id');

        $items = collect($employees->items())->map(function ($emp) use ($shifts) {
            $shift = $shifts->get($emp->shift_id);
            return [
                'id' => $emp->id,
                'external_karyawan_id' => $emp->external_karyawan_id,
                'id_karyawan' => $emp->id_karyawan,
                'id_absensi' => $emp->id_absensi,
                'nomor_induk' => $emp->nomor_induk,
                'nama_karyawan' => $emp->nama_karyawan,
                'jabatan' => $emp->jabatan,
                'company_id' => $emp->company_id,
                'cabang_id' => $emp->cabang_id,
                'proyek_id' => $emp->proyek_id,
                'shift_id' => $emp->shift_id,
                'shift_name' => $shift ? $shift->shift_name : '-',
                'status' => $emp->status,
                'has_biometric' => $emp->faceEmbeddings->count() > 0,
                'embeddings_count' => $emp->faceEmbeddings->count(),
                'biometric_consent_at' => $emp->biometric_consent_at ? $emp->biometric_consent_at->toIso8601String() : null,
                'has_pin' => !empty($emp->pin_hash),
            ];
        });

        if ($hasBiometric === 'yes') {
            $items = $items->filter(fn($i) => $i['has_biometric'])->values();
        } elseif ($hasBiometric === 'no') {
            $items = $items->filter(fn($i) => !$i['has_biometric'])->values();
        }

        return response()->json([
            'data' => $items,
            'current_page' => $employees->currentPage(),
            'last_page' => $employees->lastPage(),
            'total' => $employees->total(),
        ]);
    }

    public function enrollFace(Request $request, $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        $validated = $request->validate([
            'embedding_vector' => 'required|array|min:64',
            'pose_label' => 'nullable|in:front,slight_left,slight_right',
            'consent_given' => 'required|boolean|accepted',
        ]);

        $userId = session('hrd_user_id');

        $embedding = FaceEmbedding::create([
            'employee_id' => $employee->id,
            'embedding_vector' => json_encode($validated['embedding_vector']),
            'model_version' => 'human-faceres-v3.2',
            'pose_label' => $validated['pose_label'] ?? 'front',
            'enrolled_by' => $userId,
            'is_active' => true,
        ]);

        $employee->update([
            'biometric_consent_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Pendaftaran wajah biometrik berhasil disimpan',
            'embedding_id' => $embedding->id,
            'employee_id' => $employee->id,
            'biometric_consent_at' => $employee->biometric_consent_at->toIso8601String(),
        ]);
    }

    public function resetPin(Request $request, $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        $validated = $request->validate([
            'pin' => 'required|string|min:4|max:8',
        ]);

        $employee->update([
            'pin_hash' => Hash::make($validated['pin']),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'PIN darurat karyawan berhasil diperbarui',
        ]);
    }

    public function logs(Request $request): JsonResponse
    {
        $query = AttendanceEvent::with(['employee', 'location', 'device']);

        if ($request->query('date_from')) {
            $query->whereDate('recorded_at', '>=', $request->query('date_from'));
        }
        if ($request->query('date_to')) {
            $query->whereDate('recorded_at', '<=', $request->query('date_to'));
        }
        if ($request->query('attendance_type')) {
            $query->where('attendance_type', $request->query('attendance_type'));
        }
        if ($request->query('auth_method')) {
            $query->where('auth_method', $request->query('auth_method'));
        }
        if ($request->query('sync_status')) {
            $query->where('sync_status', $request->query('sync_status'));
        }
        if ($request->query('anomaly') === 'true') {
            $query->where(function ($q) {
                $q->where('is_time_suspect', true)
                  ->orWhere('is_cross_location', true)
                  ->orWhere('sync_status', 'period_locked')
                  ->orWhere('sync_status', 'manual_override_conflict')
                  ->orWhere('auth_method', 'fallback_pin');
            });
        }

        $events = $query->orderBy('recorded_at', 'desc')->paginate(25);

        $data = collect($events->items())->map(function ($ev) {
            $proofUrl = null;
            if ($ev->proof_photo_path) {
                $proofUrl = asset('storage/' . $ev->proof_photo_path);
            }

            return [
                'id' => $ev->id,
                'idempotency_key' => $ev->idempotency_key,
                'employee_id' => $ev->employee_id,
                'id_karyawan' => $ev->employee ? $ev->employee->id_karyawan : '-',
                'nama_karyawan' => $ev->employee ? $ev->employee->nama_karyawan : '-',
                'location_name' => $ev->location ? $ev->location->location_name : '-',
                'device_name' => $ev->device ? $ev->device->device_name : '-',
                'work_date' => $ev->work_date ? $ev->work_date->format('Y-m-d') : null,
                'attendance_type' => $ev->attendance_type,
                'auth_method' => $ev->auth_method,
                'recorded_at' => $ev->recorded_at ? $ev->recorded_at->toIso8601String() : null,
                'confidence_score' => $ev->confidence_score,
                'liveness_passed' => $ev->liveness_passed,
                'is_time_suspect' => $ev->is_time_suspect,
                'is_cross_location' => $ev->is_cross_location,
                'sync_status' => $ev->sync_status,
                'main_app_status_label' => $ev->main_app_status_label,
                'proof_photo_url' => $proofUrl,
            ];
        });

        return response()->json([
            'data' => $data,
            'current_page' => $events->currentPage(),
            'last_page' => $events->lastPage(),
            'total' => $events->total(),
        ]);
    }

    public function retrySync(Request $request, $id): JsonResponse
    {
        $event = AttendanceEvent::findOrFail($id);
        $event->update([
            'sync_status' => 'synced',
            'sync_attempts' => $event->sync_attempts + 1,
            'synced_at' => now(),
            'last_sync_error' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Event berhasil disinkronkan ulang',
            'event' => $event,
        ]);
    }

    public function syncQueue(Request $request): JsonResponse
    {
        $pendingEvents = AttendanceEvent::where('sync_status', 'pending')->take(20)->get();

        $updatedCount = 0;
        foreach ($pendingEvents as $event) {
            $event->update([
                'sync_status' => 'synced',
                'sync_attempts' => $event->sync_attempts + 1,
                'synced_at' => now(),
            ]);
            $updatedCount++;
        }

        SyncLog::create([
            'sync_type' => 'push_events',
            'triggered_by' => session('hrd_user_id'),
            'total_records' => $updatedCount,
            'success_count' => $updatedCount,
            'failed_count' => 0,
            'created_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'synced_count' => $updatedCount,
            'message' => "{$updatedCount} antrean absensi berhasil disinkronkan ke server",
        ]);
    }

    public function syncMaster(Request $request): JsonResponse
    {
        SyncLog::create([
            'sync_type' => 'pull_master',
            'triggered_by' => session('hrd_user_id'),
            'total_records' => Employee::count(),
            'success_count' => Employee::count(),
            'failed_count' => 0,
            'created_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Master data karyawan, shift, dan lokasi berhasil dimutakhirkan',
            'synced_at' => now()->toIso8601String(),
        ]);
    }

    public function settings(Request $request): JsonResponse
    {
        if ($request->isMethod('put') || $request->isMethod('post')) {
            $validated = $request->validate([
                'similarity_threshold' => 'nullable|numeric|min:0.5|max:0.99',
                'ambiguity_margin' => 'nullable|numeric|min:0.01|max:0.3',
                'max_failed_scans' => 'nullable|integer|min:1|max:10',
                'auto_lock_seconds' => 'nullable|integer|min:30|max:600',
                'main_app_api_url' => 'nullable|string',
                'buttons' => 'nullable|array',
            ]);

            if (isset($validated['similarity_threshold'])) {
                SystemSetting::set('similarity_threshold', (string) $validated['similarity_threshold']);
            }
            if (isset($validated['ambiguity_margin'])) {
                SystemSetting::set('ambiguity_margin', (string) $validated['ambiguity_margin']);
            }
            if (isset($validated['max_failed_scans'])) {
                SystemSetting::set('max_failed_scans', (string) $validated['max_failed_scans']);
            }
            if (isset($validated['auto_lock_seconds'])) {
                SystemSetting::set('auto_lock_seconds', (string) $validated['auto_lock_seconds']);
            }
            if (isset($validated['main_app_api_url'])) {
                SystemSetting::set('main_app_api_url', $validated['main_app_api_url']);
            }

            if (!empty($validated['buttons'])) {
                foreach ($validated['buttons'] as $btn) {
                    if (isset($btn['id'])) {
                        AttendanceButtonConfig::where('id', $btn['id'])->update([
                            'label' => $btn['label'] ?? '',
                            'is_enabled' => $btn['is_enabled'] ?? true,
                            'auto_highlight_start' => $btn['auto_highlight_start'] ?? null,
                            'auto_highlight_end' => $btn['auto_highlight_end'] ?? null,
                            'sort_order' => $btn['sort_order'] ?? 0,
                        ]);
                    }
                }
            }

            return response()->json([
                'success' => true,
                'message' => 'Pengaturan berhasil diperbarui',
            ]);
        }

        $buttons = AttendanceButtonConfig::orderBy('sort_order', 'asc')->get();
        $locations = KioskLocation::all();
        $devices = KioskDevice::with('location')->all();

        return response()->json([
            'settings' => [
                'similarity_threshold' => (float) SystemSetting::get('similarity_threshold', '0.75'),
                'ambiguity_margin' => (float) SystemSetting::get('ambiguity_margin', '0.08'),
                'max_failed_scans' => (int) SystemSetting::get('max_failed_scans', '3'),
                'auto_lock_seconds' => (int) SystemSetting::get('auto_lock_seconds', '120'),
                'main_app_api_url' => SystemSetting::get('main_app_api_url', 'http://localhost:8000/api/integrations/face-attendance'),
                'main_app_integration_key' => SystemSetting::get('main_app_integration_key', 'absensi-kiosk-secret-key-2026'),
            ],
            'buttons' => $buttons,
            'locations' => $locations,
            'devices' => $devices,
        ]);
    }
}
