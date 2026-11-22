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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class HrdController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = HrdUser::where('email', $validated['email'])->first();

        if (! $user || ! Hash::check($validated['password'], $user->password_hash)) {
            return response()->json([
                'success' => false,
                'message' => 'Email atau kata sandi salah',
            ], 401);
        }

        if (! $user->is_active) {
            return response()->json([
                'success' => false,
                'message' => 'Akun HRD tidak aktif',
            ], 403);
        }

        $token = bin2hex(random_bytes(32));
        session(['hrd_user_id' => $user->id, 'hrd_token' => $token]);
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

    public function logout(Request $request): JsonResponse
    {
        $token = session('hrd_token') ?: $request->bearerToken() ?: $request->header('X-HRD-Token');
        if ($token) {
            Cache::forget("hrd_token:{$token}");
        }
        session()->forget(['hrd_user_id', 'hrd_token']);

        return response()->json([
            'success' => true,
            'message' => 'Berhasil logout',
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        $userId = session('hrd_user_id');
        if (! $userId) {
            $token = $request->bearerToken() ?: $request->header('X-HRD-Token');
            if ($token) {
                $userId = Cache::get("hrd_token:{$token}");
            }
        }
        $user = $userId ? HrdUser::find($userId) : null;

        if (! $user || ! $user->is_active) {
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
            ->filter(fn ($e) => str_contains(strtolower($e->main_app_status_label ?? ''), 'terlambat'))
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

        $perPage = (int) $request->query('per_page', 10);
        $employees = $query->orderBy('nama_karyawan', 'asc')->paginate($perPage);

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
                'profile_photo_url' => $emp->profile_photo_url,
                'photo_url' => $emp->profile_photo_url,
                'biometric_consent_at' => $emp->biometric_consent_at ? $emp->biometric_consent_at->toIso8601String() : null,
                'has_pin' => ! empty($emp->pin_hash),
            ];
        });

        if ($hasBiometric === 'yes') {
            $items = $items->filter(fn ($i) => $i['has_biometric'])->values();
        } elseif ($hasBiometric === 'no') {
            $items = $items->filter(fn ($i) => ! $i['has_biometric'])->values();
        }

        return response()->json([
            'data' => $items,
            'current_page' => $employees->currentPage(),
            'last_page' => $employees->lastPage(),
            'total' => $employees->total(),
        ]);
    }

    public function showEmployee(Request $request, $id): JsonResponse
    {
        $employee = Employee::with([
            'faceEmbeddings' => function ($q) {
                $q->with('enroller')->orderBy('id', 'desc');
            },
            'attendanceEvents' => function ($q) {
                $q->with(['location', 'device'])
                    ->orderBy('recorded_at', 'desc')
                    ->take(10);
            },
        ])->findOrFail($id);

        $shift = null;
        if ($employee->shift_id) {
            $shift = ShiftSnapshot::where('company_id', $employee->company_id)
                ->where('external_shift_id', $employee->shift_id)
                ->first();
        }

        $location = null;
        if ($employee->cabang_id) {
            $location = KioskLocation::where('cabang_id', $employee->cabang_id)->first();
        }

        $embeddings = $employee->faceEmbeddings->map(function ($fb) {
            $vectorArray = json_decode($fb->embedding_vector, true);
            $preview = is_array($vectorArray) ? array_slice($vectorArray, 0, 5) : [];
            $dimensions = is_array($vectorArray) ? count($vectorArray) : 0;

            return [
                'id' => $fb->id,
                'model_version' => $fb->model_version,
                'pose_label' => $fb->pose_label,
                'photo_path' => $fb->photo_path,
                'photo_url' => $fb->photo_url,
                'is_active' => $fb->is_active,
                'dimensions' => $dimensions,
                'vector_preview' => $preview,
                'enrolled_by_name' => $fb->enroller ? $fb->enroller->name : 'HRD',
                'created_at' => $fb->created_at ? $fb->created_at->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s') : null,
            ];
        });

        $attendances = $employee->attendanceEvents->map(function ($ev) {
            return [
                'id' => $ev->id,
                'recorded_at' => Carbon::parse($ev->recorded_at)->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s'),
                'work_date' => $ev->work_date ? $ev->work_date->format('Y-m-d') : null,
                'attendance_type' => $ev->attendance_type,
                'auth_method' => $ev->auth_method,
                'confidence_score' => $ev->confidence_score !== null ? round((float) $ev->confidence_score * 100, 1) : null,
                'liveness_passed' => (bool) $ev->liveness_passed,
                'proof_photo_url' => $ev->proof_photo_path ? '/storage/'.$ev->proof_photo_path : null,
                'location_name' => $ev->location ? $ev->location->location_name : '-',
                'device_name' => $ev->device ? $ev->device->device_name : '-',
                'status_label' => $ev->main_app_status_label,
            ];
        });

        return response()->json([
            'employee' => [
                'id' => $employee->id,
                'external_karyawan_id' => $employee->external_karyawan_id,
                'id_karyawan' => $employee->id_karyawan,
                'id_absensi' => $employee->id_absensi,
                'nomor_induk' => $employee->nomor_induk,
                'nama_karyawan' => $employee->nama_karyawan,
                'jabatan' => $employee->jabatan,
                'company_id' => $employee->company_id,
                'cabang_id' => $employee->cabang_id,
                'proyek_id' => $employee->proyek_id,
                'status' => $employee->status,
                'profile_photo_path' => $employee->profile_photo_path,
                'profile_photo_url' => $employee->profile_photo_url,
                'has_biometric' => $employee->faceEmbeddings->where('is_active', true)->count() > 0,
                'biometric_consent_at' => $employee->biometric_consent_at ? $employee->biometric_consent_at->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s') : null,
                'has_pin' => ! empty($employee->pin_hash),
                'synced_at' => $employee->synced_at ? $employee->synced_at->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s') : null,
            ],
            'shift' => $shift ? [
                'id' => $shift->id,
                'shift_name' => $shift->shift_name,
                'start_time' => substr($shift->start_time, 0, 5),
                'end_time' => substr($shift->end_time, 0, 5),
                'break_start_time' => $shift->break_start_time ? substr($shift->break_start_time, 0, 5) : null,
                'break_end_time' => $shift->break_end_time ? substr($shift->break_end_time, 0, 5) : null,
                'is_overnight' => (bool) $shift->is_overnight,
            ] : null,
            'location' => $location ? [
                'id' => $location->id,
                'location_name' => $location->location_name,
            ] : null,
            'face_embeddings' => $embeddings,
            'recent_attendances' => $attendances,
        ]);
    }

    public function uploadProfilePhoto(Request $request, $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        $validated = $request->validate([
            'photo' => 'nullable|image|mimes:jpeg,png,jpg,webp|max:5120',
            'photo_base64' => 'nullable|string',
        ]);

        if (! $request->hasFile('photo') && empty($validated['photo_base64'])) {
            return response()->json([
                'success' => false,
                'message' => 'File foto atau data gambar tidak ditemukan',
            ], 422);
        }

        if ($employee->profile_photo_path && Storage::disk('public')->exists($employee->profile_photo_path)) {
            $isUsedByBiometric = FaceEmbedding::where('photo_path', $employee->profile_photo_path)->exists();
            if (! $isUsedByBiometric) {
                Storage::disk('public')->delete($employee->profile_photo_path);
            }
        }

        $fileName = null;
        if ($request->hasFile('photo')) {
            $file = $request->file('photo');
            $ext = $file->getClientOriginalExtension() ?: 'jpg';
            $fileName = 'profiles/profile_'.$employee->id.'_'.time().'_'.Str::random(6).'.'.$ext;
            Storage::disk('public')->put($fileName, file_get_contents($file->getRealPath()));
        } elseif (! empty($validated['photo_base64'])) {
            $imageData = $validated['photo_base64'];
            if (preg_match('/^data:image\/(\w+);base64,/', $imageData, $type)) {
                $imageData = substr($imageData, strpos($imageData, ',') + 1);
                $type = strtolower($type[1]);
                if (! in_array($type, ['jpg', 'jpeg', 'png', 'webp'])) {
                    $type = 'jpg';
                }
            } else {
                $type = 'jpg';
            }
            $decoded = base64_decode($imageData);
            if ($decoded !== false) {
                $fileName = 'profiles/profile_'.$employee->id.'_'.time().'_'.Str::random(6).'.'.$type;
                Storage::disk('public')->put($fileName, $decoded);
            }
        }

        if ($fileName) {
            $employee->update([
                'profile_photo_path' => $fileName,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Foto profil karyawan berhasil diperbarui',
                'profile_photo_url' => $employee->fresh()->profile_photo_url,
            ]);
        }

        return response()->json([
            'success' => false,
            'message' => 'Gagal memproses gambar foto profil',
        ], 400);
    }

    public function deleteProfilePhoto(Request $request, $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        if ($employee->profile_photo_path && Storage::disk('public')->exists($employee->profile_photo_path)) {
            $isUsedByBiometric = FaceEmbedding::where('photo_path', $employee->profile_photo_path)->exists();
            if (! $isUsedByBiometric) {
                Storage::disk('public')->delete($employee->profile_photo_path);
            }
        }

        $employee->update([
            'profile_photo_path' => null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Foto profil karyawan berhasil dihapus',
            'profile_photo_url' => null,
        ]);
    }

    public function enrollFace(Request $request, $id): JsonResponse
    {
        $employee = Employee::findOrFail($id);

        $validated = $request->validate([
            'embedding_vector' => 'required_without:templates|array|size:512',
            'embedding_vector.*' => 'numeric',
            'pose_label' => 'nullable|in:front,slight_left,slight_right',
            'model_name' => 'nullable|in:buffalo_s',
            'model_version' => 'nullable|string|max:100',
            'quality_score' => 'nullable|numeric',
            'blur_score' => 'nullable|numeric',
            'brightness_score' => 'nullable|numeric',
            'pose_yaw' => 'nullable|numeric',
            'pose_pitch' => 'nullable|numeric',
            'pose_roll' => 'nullable|numeric',
            'consent_given' => 'required|boolean|accepted',
            'photo_base64' => 'nullable|string',
            'templates' => 'required_without:embedding_vector|array|min:1|max:10',
            'templates.*.embedding_vector' => 'required_with:templates|array|min:128|max:512',
            'templates.*.embedding_vector.*' => 'numeric',
            'templates.*.model_name' => 'required_with:templates|in:buffalo_s,sface',
            'templates.*.model_version' => 'required_with:templates|string|max:100',
            'templates.*.pose_label' => 'nullable|in:front,slight_left,slight_right',
            'templates.*.photo_base64' => 'nullable|string',
            'templates.*.quality_score' => 'nullable|numeric',
            'templates.*.blur_score' => 'nullable|numeric',
            'templates.*.brightness_score' => 'nullable|numeric',
            'templates.*.pose_yaw' => 'nullable|numeric',
            'templates.*.pose_pitch' => 'nullable|numeric',
            'templates.*.pose_roll' => 'nullable|numeric',
        ]);

        $userId = session('hrd_user_id');
        $modelName = $validated['model_name'] ?? config('biometric.model.name', 'buffalo_s');
        $modelVersion = $validated['model_version'] ?? config('biometric.model.version', 'arcface_r50_v1');

        $createdEmbeddings = [];
        $vectorsToSync = [];

        $templateItems = [];
        if (! empty($validated['templates']) && is_array($validated['templates'])) {
            $templateItems = $validated['templates'];
        } elseif (! empty($validated['embedding_vector'])) {
            $templateItems[] = [
                'embedding_vector' => $validated['embedding_vector'],
                'pose_label' => $validated['pose_label'] ?? 'front',
                'photo_base64' => $validated['photo_base64'] ?? null,
                'quality_score' => $validated['quality_score'] ?? null,
                'blur_score' => $validated['blur_score'] ?? null,
                'brightness_score' => $validated['brightness_score'] ?? null,
                'pose_yaw' => $validated['pose_yaw'] ?? null,
                'pose_pitch' => $validated['pose_pitch'] ?? null,
                'pose_roll' => $validated['pose_roll'] ?? null,
            ];
        }

        foreach ($templateItems as $index => $templateItem) {
            $templateModelName = strtolower($templateItem['model_name'] ?? $modelName);
            $expectedDimension = $templateModelName === 'sface' ? 128 : 512;
            if (count($templateItem['embedding_vector']) !== $expectedDimension) {
                return response()->json([
                    'message' => 'Dimensi embedding tidak sesuai dengan model biometrik',
                    'errors' => [
                        "templates.{$index}.embedding_vector" => [
                            "Model {$templateModelName} wajib memiliki {$expectedDimension} elemen.",
                        ],
                    ],
                ], 422);
            }
        }

        foreach ($templateItems as $tmpl) {
            $templateModelName = strtolower($tmpl['model_name'] ?? $modelName);
            $templateModelVersion = $tmpl['model_version'] ?? $modelVersion;
            $photoPath = null;
            if (! empty($tmpl['photo_base64'])) {
                $imageData = $tmpl['photo_base64'];
                if (preg_match('/^data:image\/(\w+);base64,/', $imageData, $type)) {
                    $imageData = substr($imageData, strpos($imageData, ',') + 1);
                    $type = strtolower($type[1]);
                    if (! in_array($type, ['jpg', 'jpeg', 'png', 'webp'])) {
                        $type = 'jpg';
                    }
                } else {
                    $type = 'jpg';
                }
                $decoded = base64_decode($imageData);
                if ($decoded !== false) {
                    $fileName = 'faces/face_'.$employee->id.'_'.time().'_'.Str::random(6).'.'.$type;
                    Storage::disk('public')->put($fileName, $decoded);
                    $photoPath = $fileName;
                }
            }

            $embedding = FaceEmbedding::create([
                'employee_id' => $employee->id,
                'embedding_vector' => json_encode($tmpl['embedding_vector']),
                'model_name' => $templateModelName,
                'model_version' => $templateModelVersion,
                'pose_label' => $tmpl['pose_label'] ?? 'front',
                'quality_score' => $tmpl['quality_score'] ?? null,
                'blur_score' => $tmpl['blur_score'] ?? null,
                'brightness_score' => $tmpl['brightness_score'] ?? null,
                'pose_yaw' => $tmpl['pose_yaw'] ?? null,
                'pose_pitch' => $tmpl['pose_pitch'] ?? null,
                'pose_roll' => $tmpl['pose_roll'] ?? null,
                'photo_path' => $photoPath,
                'enrolled_by' => $userId,
                'is_active' => true,
            ]);

            $createdEmbeddings[] = $embedding;
        }

        $updateData = [
            'biometric_consent_at' => now(),
        ];
        if (! $employee->profile_photo_path) {
            $latestWithPhoto = collect($createdEmbeddings)->first(fn ($e) => ! empty($e->photo_path));
            if ($latestWithPhoto && $latestWithPhoto->photo_path && Storage::disk('public')->exists($latestWithPhoto->photo_path)) {
                $content = Storage::disk('public')->get($latestWithPhoto->photo_path);
                $ext = pathinfo($latestWithPhoto->photo_path, PATHINFO_EXTENSION) ?: 'jpg';
                $profileName = 'profiles/profile_'.$employee->id.'_'.time().'_'.Str::random(6).'.'.$ext;
                Storage::disk('public')->put($profileName, $content);
                $updateData['profile_photo_path'] = $profileName;
            }
        }
        $employee->update($updateData);

        $vectorsToSync = $employee->faceEmbeddings()
            ->where('is_active', true)
            ->get()
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

        if (! empty($vectorsToSync)) {
            try {
                Http::withHeaders([
                    'X-Biometric-Secret' => (string) config('biometric.shared_secret'),
                ])->connectTimeout(1)->timeout(10)->post(
                    rtrim((string) config('biometric.engine_url'), '/').'/api/v1/cache/sync',
                    [
                        'replace_all' => false,
                        'employees' => [
                            [
                                'employee_id' => $employee->id,
                                'external_karyawan_id' => $employee->id,
                                'company_id' => $employee->company_id,
                                'entitasshelter_id' => $employee->entitasshelter_id,
                                'cabang_id' => $employee->cabang_id,
                                'proyek_id' => $employee->proyek_id,
                                'id_karyawan' => $employee->id_karyawan,
                                'id_absensi' => $employee->id_absensi,
                                'nama_karyawan' => $employee->nama_karyawan,
                                'embeddings' => $vectorsToSync,
                            ],
                        ],
                    ])->throw();
            } catch (\Throwable $exception) {
                report($exception);
            }
        }

        $firstEmbedding = $createdEmbeddings[0] ?? null;

        return response()->json([
            'success' => true,
            'message' => 'Pendaftaran wajah biometrik berhasil disimpan',
            'enrolled_count' => count($createdEmbeddings),
            'embedding_id' => $firstEmbedding ? $firstEmbedding->id : null,
            'employee_id' => $employee->id,
            'photo_url' => $firstEmbedding ? $firstEmbedding->photo_url : null,
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

        $perPage = (int) $request->query('per_page', 10);
        $events = $query->orderBy('recorded_at', 'desc')->paginate($perPage);

        $data = collect($events->items())->map(function ($ev) {
            $proofUrl = null;
            if ($ev->proof_photo_path) {
                $proofUrl = '/storage/'.$ev->proof_photo_path;
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

    public function showLog(Request $request, $id): JsonResponse
    {
        $event = AttendanceEvent::with(['employee', 'location', 'device'])->findOrFail($id);

        $shift = null;
        if ($event->shift_id) {
            $shift = ShiftSnapshot::where('company_id', $event->company_id)
                ->where('external_shift_id', $event->shift_id)
                ->first();
        }

        return response()->json([
            'event' => [
                'id' => $event->id,
                'idempotency_key' => $event->idempotency_key,
                'employee_id' => $event->employee_id,
                'id_karyawan' => $event->employee ? $event->employee->id_karyawan : '-',
                'nama_karyawan' => $event->employee ? $event->employee->nama_karyawan : '-',
                'nomor_induk' => $event->employee ? $event->employee->nomor_induk : '-',
                'jabatan' => $event->employee ? $event->employee->jabatan : '-',
                'profile_photo_url' => $event->employee ? $event->employee->profile_photo_url : null,
                'location_name' => $event->location ? $event->location->location_name : '-',
                'location_type' => $event->location ? $event->location->location_type : '-',
                'device_name' => $event->device ? $event->device->device_name : '-',
                'device_token' => $event->device ? $event->device->device_token : '-',
                'device_mode' => $event->device_mode ?? 'kiosk',
                'work_date' => $event->work_date ? $event->work_date->format('Y-m-d') : null,
                'attendance_type' => $event->attendance_type,
                'auth_method' => $event->auth_method,
                'recorded_at' => Carbon::parse($event->recorded_at)->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s'),
                'recorded_at_human' => Carbon::parse($event->recorded_at)->setTimezone(config('app.timezone'))->locale('id')->isoFormat('dddd, D MMMM YYYY • HH:mm:ss').' WIB',
                'confidence_score' => $event->confidence_score !== null ? round((float) $event->confidence_score * 100, 1) : null,
                'liveness_passed' => (bool) $event->liveness_passed,
                'is_time_suspect' => (bool) $event->is_time_suspect,
                'is_cross_location' => (bool) $event->is_cross_location,
                'sync_status' => $event->sync_status,
                'main_app_status_label' => $event->main_app_status_label,
                'external_absensi_id' => $event->external_absensi_id,
                'sync_attempts' => (int) $event->sync_attempts,
                'last_sync_error' => $event->last_sync_error,
                'synced_at' => $event->synced_at ? Carbon::parse($event->synced_at)->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s') : null,
                'proof_photo_url' => $event->proof_photo_path ? '/storage/'.$event->proof_photo_path : null,
                'proof_photo_path' => $event->proof_photo_path,
                'shift_name' => $shift ? $shift->shift_name : ($event->shift_id ? 'Shift #'.$event->shift_id : '-'),
            ],
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
                'main_app_integration_key' => 'nullable|string',
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
            if (isset($validated['main_app_integration_key'])) {
                SystemSetting::set('main_app_integration_key', $validated['main_app_integration_key']);
            }

            if (! empty($validated['buttons'])) {
                foreach ($validated['buttons'] as $btn) {
                    if (isset($btn['id'])) {
                        AttendanceButtonConfig::where('id', $btn['id'])->update([
                            'label' => $btn['label'] ?? '',
                            'is_enabled' => $btn['is_enabled'] ?? true,
                            'auto_highlight_start' => ! empty($btn['auto_highlight_start']) ? $btn['auto_highlight_start'] : null,
                            'auto_highlight_end' => ! empty($btn['auto_highlight_end']) ? $btn['auto_highlight_end'] : null,
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
        $devices = KioskDevice::with('location')->get();

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
