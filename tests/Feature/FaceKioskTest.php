<?php

namespace Tests\Feature;

use App\Models\AttendanceEvent;
use App\Models\Employee;
use App\Models\FaceEmbedding;
use App\Models\HrdUser;
use App\Models\SystemSetting;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class FaceKioskTest extends TestCase
{
    private function authenticateHrd(): array
    {
        $user = HrdUser::where('is_active', true)->first();
        $token = bin2hex(random_bytes(32));
        Cache::put("hrd_token:{$token}", $user->id, now()->addHours(1));

        return [
            'Authorization' => "Bearer {$token}",
        ];
    }

    private function hmacHeaders(string $method, string $path, string $body = ''): array
    {
        $key = env('INTEGRATION_KEY', SystemSetting::get('main_app_integration_key', 'absensi-kiosk-secret-key-2026'));
        $secret = env('INTEGRATION_SECRET', SystemSetting::get('main_app_shared_secret', 'kiosk-attendance-hmac-secret-signature-key-2026'));
        $ts = time();
        $payload = strtoupper($method)."\n".'/'.ltrim($path, '/')."\n".$ts."\n".$body;
        $sig = hash_hmac('sha256', $payload, $secret);

        return [
            'X-Integration-Key' => $key,
            'X-Timestamp' => (string) $ts,
            'X-Signature' => $sig,
        ];
    }

    public function test_kiosk_page_loads_successfully(): void
    {
        $response = $this->get('/kiosk');
        $response->assertStatus(200);
    }

    public function test_kiosk_config_endpoint_returns_json(): void
    {
        $response = $this->getJson('/api/kiosk/config');
        $response->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'device',
                'location',
                'buttons',
                'settings' => [
                    'similarity_threshold',
                    'ambiguity_margin',
                    'max_failed_scans',
                    'auto_lock_seconds',
                    'capture_frame_count',
                    'min_consistent_frames',
                ],
            ])
            ->assertJsonPath('settings.capture_frame_count', 5)
            ->assertJsonPath('settings.min_consistent_frames', 3)
            ->assertJsonPath('settings.allowed_challenges', [
                'HEAD_TURN',
            ]);
    }

    public function test_kiosk_auth_verify_pin(): void
    {
        $validResponse = $this->postJson('/api/kiosk/auth-verify', [
            'pin' => '123456',
        ]);
        $validResponse->assertStatus(200)
            ->assertJson(['success' => true])
            ->assertJsonStructure(['token', 'user']);

        $this->withToken($validResponse->json('token'))
            ->getJson('/api/hrd/me')
            ->assertOk()
            ->assertJsonPath('user.id', $validResponse->json('user.id'));

        $invalidResponse = $this->postJson('/api/kiosk/auth-verify', [
            'pin' => '000000',
        ]);
        $invalidResponse->assertStatus(401)
            ->assertJson([
                'success' => false,
            ]);
    }

    public function test_kiosk_employees_cache(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/health' => Http::response([
                'status' => 'ok',
                'gallery_version' => 'current-test-version',
            ]),
            config('biometric.engine_url').'/api/v1/cache/sync' => Http::response([
                'status' => 'ok',
            ]),
        ]);

        $response = $this->getJson('/api/kiosk/employees-cache');
        $response->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'employees',
            ]);

        foreach ($response->json('employees') as $employee) {
            $this->assertArrayNotHasKey('embeddings', $employee);
            $this->assertArrayNotHasKey('embedding_vector', $employee);
        }
    }

    public function test_kiosk_attendance_tap_and_deduplication(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-idemp-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+10 days'));
        AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
        $ts = time();
        $token = hash_hmac('sha256', "{$emp->id}:{$ts}:VERIFIED", config('biometric.shared_secret'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.92,
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'liveness_passed' => true,
            'attestation_token' => $token,
            'attestation_timestamp' => $ts,
            'proof_photo_base64' => 'data:image/jpeg;base64,'.base64_encode('fake_tap_photo'),
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'status',
                'proof_photo_url',
            ]);

        $ts2 = $ts + 1;
        $token2 = hash_hmac('sha256', "{$emp->id}:{$ts2}:VERIFIED", config('biometric.shared_secret'));
        $duplicateResponse = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => 'test-idemp-'.uniqid(),
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'confidence_score' => 0.94,
            'liveness_passed' => true,
            'attestation_token' => $token2,
            'attestation_timestamp' => $ts2,
        ]);

        $duplicateResponse->assertStatus(200)
            ->assertJson([
                'status' => 'already_clocked_in',
            ]);
    }

    public function test_kiosk_fallback_pin_tap(): void
    {
        $idempotencyKey = 'test-fallback-'.uniqid();
        $workDate = date('Y-m-d');

        $response = $this->postJson('/api/kiosk/fallback-tap', [
            'idempotency_key' => $idempotencyKey,
            'id_karyawan' => 'EMP001',
            'pin' => '1234',
            'work_date' => $workDate,
            'attendance_type' => 'clock_out',
            'recorded_at' => date('c'),
            'proof_photo_base64' => 'data:image/jpeg;base64,'.base64_encode('dummy_image_content'),
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'synced',
            ]);
    }

    public function test_kiosk_fallback_pin_tap_without_photo(): void
    {
        $idempotencyKey = 'test-fallback-nophoto-'.uniqid();
        $workDate = date('Y-m-d');

        $response = $this->postJson('/api/kiosk/fallback-tap', [
            'idempotency_key' => $idempotencyKey,
            'id_karyawan' => 'EMP001',
            'pin' => '1234',
            'work_date' => $workDate,
            'attendance_type' => 'break_start',
            'recorded_at' => date('c'),
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'synced',
            ]);
    }

    public function test_hrd_login_and_dashboard(): void
    {
        $unauthRes = $this->getJson('/api/hrd/dashboard');
        $unauthRes->assertStatus(401);

        $loginRes = $this->postJson('/api/hrd/login', [
            'email' => 'admin@facekiosk.local',
            'password' => 'password123',
        ]);

        $loginRes->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $token = $loginRes->json('token');
        $dashboardRes = $this->getJson('/api/hrd/dashboard', [
            'Authorization' => "Bearer {$token}",
        ]);
        $dashboardRes->assertStatus(200)
            ->assertJsonStructure([
                'summary',
                'devices',
                'alerts',
            ]);
    }

    public function test_integration_heartbeat_and_master_sync(): void
    {
        $unauthRes = $this->getJson('/api/integrations/face-attendance/heartbeat');
        $unauthRes->assertStatus(401);

        $hbHeaders = $this->hmacHeaders('GET', '/api/integrations/face-attendance/heartbeat');
        $hbRes = $this->getJson('/api/integrations/face-attendance/heartbeat', $hbHeaders);
        $hbRes->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'locked_periods',
                'status',
            ]);

        $syncHeaders = $this->hmacHeaders('GET', '/api/integrations/face-attendance/master-sync');
        $syncRes = $this->getJson('/api/integrations/face-attendance/master-sync', $syncHeaders);
        $syncRes->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'locations',
                'shifts',
                'karyawans',
            ]);
    }

    public function test_integration_batch_events(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP002')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-batch-'.uniqid();
        $payload = [
            'events' => [
                [
                    'idempotency_key' => $idempotencyKey,
                    'company_id' => $emp->company_id,
                    'external_karyawan_id' => $emp->external_karyawan_id,
                    'work_date' => date('Y-m-d'),
                    'attendance_type' => 'clock_in',
                    'auth_method' => 'face_liveness',
                    'recorded_at' => date('c'),
                    'is_time_suspect' => false,
                    'is_cross_location' => false,
                    'location_name' => 'Kantor Pusat Jakarta',
                ],
            ],
        ];

        $unauthRes = $this->postJson('/api/integrations/face-attendance/events', $payload);
        $unauthRes->assertStatus(401);

        $headers = $this->hmacHeaders('POST', '/api/integrations/face-attendance/events', json_encode($payload));
        $response = $this->postJson('/api/integrations/face-attendance/events', $payload, $headers);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'results' => [
                    [
                        'idempotency_key',
                        'status',
                        'status_label',
                    ],
                ],
            ]);
    }

    public function test_hrd_employee_detail_endpoint(): void
    {
        $emp = Employee::first();
        $this->assertNotNull($emp);

        $response = $this->getJson('/api/hrd/employees/'.$emp->id, $this->authenticateHrd());
        $response->assertStatus(200)
            ->assertJsonStructure([
                'employee' => [
                    'id',
                    'id_karyawan',
                    'nama_karyawan',
                    'has_biometric',
                ],
                'face_embeddings',
                'recent_attendances',
            ]);
    }

    public function test_hrd_enroll_face_with_photo_base64(): void
    {
        Storage::fake('public');
        $emp = Employee::first();
        $this->assertNotNull($emp);
        $originalPhoto = $emp->profile_photo_path;

        $fakePhotoBase64 = 'data:image/jpeg;base64,'.base64_encode('fake-jpg-content');
        Http::fake();
        $fakeVector = array_fill(0, 512, 0.05);

        $response = $this->postJson('/api/hrd/employees/'.$emp->id.'/enroll-face', [
            'embedding_vector' => $fakeVector,
            'pose_label' => 'front',
            'model_name' => 'buffalo_s',
            'model_version' => 'arcface_r50_v1',
            'consent_given' => true,
            'photo_base64' => $fakePhotoBase64,
        ], $this->authenticateHrd());

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $this->assertNotNull($response->json('photo_url'));

        $embeddingId = $response->json('embedding_id');
        if ($embeddingId) {
            FaceEmbedding::find($embeddingId)?->delete();
        }
        $emp->update(['profile_photo_path' => $originalPhoto]);
    }

    public function test_kiosk_biometric_decision_verified_records_attendance_and_audit(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-audit-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+20 days'));
        AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
        $ts = time();
        $token = hash_hmac('sha256', "{$emp->id}:{$ts}:VERIFIED", config('biometric.shared_secret'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.88,
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'top1_score' => 0.88,
            'top2_score' => 0.32,
            'score_margin' => 0.56,
            'passive_spoof_score' => 0.05,
            'captured_frames' => 5,
            'consistent_frames' => 5,
            'liveness_passed' => true,
            'attestation_token' => $token,
            'attestation_timestamp' => $ts,
            'proof_photo_base64' => 'data:image/jpeg;base64,'.base64_encode('fake_verified_tap_photo'),
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('attendance_events', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
        ]);
        $this->assertDatabaseHas('face_verification_attempts', [
            'employee_id' => $emp->id,
            'result' => 'VERIFIED',
        ]);
    }

    public function test_kiosk_biometric_decision_rejected_does_not_create_attendance(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-rejected-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+25 days'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'SPOOF_REJECTED',
            'reject_reason' => 'PASSIVE_ANTI_SPOOF_FAILED',
            'passive_spoof_score' => 0.82,
            'liveness_passed' => false,
        ]);

        $response->assertStatus(422)
            ->assertJson([
                'status' => 'spoof_rejected',
                'decision' => 'SPOOF_REJECTED',
            ]);

        $this->assertDatabaseMissing('attendance_events', [
            'idempotency_key' => $idempotencyKey,
        ]);

        $this->assertDatabaseHas('face_verification_attempts', [
            'employee_id' => $emp->id,
            'result' => 'SPOOF_REJECTED',
            'reject_reason' => 'PASSIVE_ANTI_SPOOF_FAILED',
        ]);
    }

    public function test_hrd_enroll_multi_template(): void
    {
        $emp = Employee::first();
        $this->assertNotNull($emp);

        $initialEmbeddingIds = FaceEmbedding::where('employee_id', $emp->id)->pluck('id')->toArray();

        Http::fake();
        $fakeVector1 = array_fill(0, 512, 0.10);
        $fakeVector2 = array_fill(0, 512, 0.12);

        $response = $this->postJson('/api/hrd/employees/'.$emp->id.'/enroll-face', [
            'consent_given' => true,
            'templates' => [
                [
                    'embedding_vector' => $fakeVector1,
                    'model_name' => 'buffalo_s',
                    'model_version' => 'arcface_r50_v1',
                    'pose_label' => 'front',
                    'quality_score' => 96.5,
                    'blur_score' => 140.2,
                    'brightness_score' => 125.0,
                    'pose_yaw' => 1.2,
                    'pose_pitch' => -0.5,
                    'pose_roll' => 0.1,
                ],
                [
                    'embedding_vector' => $fakeVector2,
                    'model_name' => 'buffalo_s',
                    'model_version' => 'arcface_r50_v1',
                    'pose_label' => 'slight_left',
                    'quality_score' => 91.0,
                    'blur_score' => 120.0,
                    'brightness_score' => 118.0,
                    'pose_yaw' => 8.5,
                    'pose_pitch' => 1.0,
                    'pose_roll' => 0.2,
                ],
            ],
        ], $this->authenticateHrd());

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'enrolled_count' => 2,
            ]);

        FaceEmbedding::where('employee_id', $emp->id)
            ->whereNotIn('id', $initialEmbeddingIds)
            ->delete();
    }

    public function test_hrd_rejects_embedding_dimension_that_does_not_match_model(): void
    {
        $emp = Employee::first();
        $this->assertNotNull($emp);

        $response = $this->postJson('/api/hrd/employees/'.$emp->id.'/enroll-face', [
            'consent_given' => true,
            'templates' => [[
                'embedding_vector' => array_fill(0, 512, 0.1),
                'model_name' => 'sface',
                'model_version' => 'opencv_sface_2021dec',
                'pose_label' => 'front',
            ]],
        ], $this->authenticateHrd());

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['templates.0.embedding_vector']);
    }

    public function test_hrd_upload_and_delete_profile_photo(): void
    {
        Storage::fake('public');
        $emp = Employee::first();
        $this->assertNotNull($emp);
        $originalPhoto = $emp->profile_photo_path;

        $fakePhotoBase64 = 'data:image/jpeg;base64,'.base64_encode('fake-profile-photo-content');

        $uploadResponse = $this->postJson('/api/hrd/employees/'.$emp->id.'/upload-profile-photo', [
            'photo_base64' => $fakePhotoBase64,
        ], $this->authenticateHrd());

        $uploadResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $this->assertNotNull($uploadResponse->json('profile_photo_url'));

        $this->assertDatabaseHas('employees', [
            'id' => $emp->id,
        ]);
        $emp->refresh();
        $this->assertNotNull($emp->profile_photo_path);

        $deleteResponse = $this->deleteJson('/api/hrd/employees/'.$emp->id.'/profile-photo', [], $this->authenticateHrd());
        $deleteResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
                'profile_photo_url' => null,
            ]);

        $emp->refresh();
        $this->assertNull($emp->profile_photo_path);

        $emp->update(['profile_photo_path' => $originalPhoto]);
    }

    public function test_face_engine_proxy_blocks_gallery_admin_endpoints(): void
    {
        Http::preventStrayRequests();
        Http::fake();

        $response = $this->getJson('/api/face-engine/api/v1/gallery/collision-scan');
        $response->assertNotFound();

        $adminResponse = $this->postJson('/api/face-engine/api/v1/admin/purge', []);
        $adminResponse->assertNotFound();

        Http::assertNothingSent();
    }

    public function test_face_engine_proxy_allows_enroll_endpoint(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/api/v1/enroll' => Http::response([
                'mean_embedding' => array_fill(0, 512, 0.1),
                'model_name' => 'buffalo_s',
                'model_version' => 'arcface_r50_v1',
            ]),
        ]);

        $response = $this->postJson('/api/face-engine/api/v1/enroll', []);
        $response->assertOk();

        Http::assertSent(fn ($request) => $request->hasHeader(
            'X-Biometric-Secret',
            config('biometric.shared_secret')
        ));
    }

    public function test_face_engine_proxy_adds_internal_secret_header(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/health' => Http::response([
                'status' => 'ok',
                'model_loaded' => true,
            ]),
        ]);

        $this->getJson('/api/face-engine/health')->assertOk();

        Http::assertSent(fn ($request) => $request->hasHeader(
            'X-Biometric-Secret',
            config('biometric.shared_secret')
        ));
    }

    public function test_face_engine_proxy_forwards_multiple_frames(): void
    {
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/api/v1/recognize' => Http::response([
                'status' => 'matched',
                'decision' => 'VERIFIED',
                'captured_frames' => 7,
            ]),
        ]);

        $frames = [];
        for ($i = 0; $i < 7; $i++) {
            $frames[] = UploadedFile::fake()->image("frame_{$i}.jpg", 120, 120);
        }

        $response = $this->post('/api/face-engine/api/v1/recognize', [
            'frames' => $frames,
            'company_id' => 1,
            'challenge_type' => 'HEAD_TURN',
        ]);

        $response->assertOk()->assertJson([
            'status' => 'matched',
            'captured_frames' => 7,
        ]);

        Http::assertSent(function ($request) {
            if (! $request->isMultipart()) {
                return false;
            }
            $frameParts = collect($request->data())->filter(
                fn ($part) => ($part['name'] ?? null) === 'frames'
            );

            return $frameParts->count() === 7;
        });
    }

    public function test_kiosk_attendance_tap_ambiguous_decision(): void
    {
        $emp1 = Employee::where('id_karyawan', 'EMP001')->first();
        $emp2 = Employee::where('id_karyawan', 'EMP002')->first();
        $this->assertNotNull($emp1);
        $this->assertNotNull($emp2);

        $idempotencyKey = 'test-ambig-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+30 days'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp1->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'RETRY',
            'reject_reason' => 'MARGIN_TOO_CLOSE',
            'top1_employee_id' => $emp1->id,
            'top1_score' => 0.76,
            'top2_employee_id' => $emp2->id,
            'top2_score' => 0.74,
            'score_margin' => 0.02,
            'captured_frames' => 5,
            'consistent_frames' => 4,
            'liveness_passed' => true,
        ]);

        $response->assertStatus(422)
            ->assertJson([
                'status' => 'retry',
                'decision' => 'RETRY',
                'reject_reason' => 'MARGIN_TOO_CLOSE',
            ]);

        $this->assertDatabaseMissing('attendance_events', [
            'idempotency_key' => $idempotencyKey,
        ]);

        $this->assertDatabaseHas('face_verification_attempts', [
            'employee_id' => $emp1->id,
            'result' => 'RETRY',
            'reject_reason' => 'MARGIN_TOO_CLOSE',
        ]);
    }

    public function test_kiosk_attendance_tap_fails_closed_when_decision_is_missing(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-nodec-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+35 days'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'liveness_passed' => true,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['decision']);

        $this->assertDatabaseMissing('attendance_events', [
            'idempotency_key' => $idempotencyKey,
        ]);
    }

    public function test_kiosk_attendance_tap_fails_closed_with_forged_attestation_token(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-forged-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+36 days'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'attestation_token' => 'forged_fake_token_1234567890',
            'attestation_timestamp' => time(),
            'liveness_passed' => true,
        ]);

        $response->assertStatus(422)
            ->assertJson([
                'status' => 'invalid_attestation',
                'reject_reason' => 'ATTESTATION_SIGNATURE_INVALID',
            ]);

        $this->assertDatabaseMissing('attendance_events', [
            'idempotency_key' => $idempotencyKey,
        ]);
    }

    public function test_kiosk_attendance_tap_requires_server_attestation(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => 'test-no-attest-'.uniqid(),
            'employee_id' => $emp->id,
            'work_date' => date('Y-m-d', strtotime('+38 days')),
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'liveness_passed' => true,
        ]);

        $response->assertStatus(422)->assertJson([
            'status' => 'invalid_attestation',
            'reject_reason' => 'ATTESTATION_REQUIRED',
        ]);
    }

    public function test_kiosk_attendance_tap_rejects_top_candidate_mismatch(): void
    {
        $emp1 = Employee::where('id_karyawan', 'EMP001')->first();
        $emp2 = Employee::where('id_karyawan', 'EMP002')->first();
        $this->assertNotNull($emp1);
        $this->assertNotNull($emp2);

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => 'test-top1-mismatch-'.uniqid(),
            'employee_id' => $emp1->id,
            'work_date' => date('Y-m-d', strtotime('+39 days')),
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp2->id,
            'liveness_passed' => true,
        ]);

        $response->assertStatus(422)->assertJson([
            'status' => 'identity_mismatch',
            'reject_reason' => 'TOP1_EMPLOYEE_MISMATCH',
        ]);
    }

    public function test_kiosk_attendance_tap_succeeds_with_valid_hmac_attestation_token(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-valid-hmac-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+37 days'));
        AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
        $ts = time();
        $secret = config('biometric.shared_secret', 'mooding_biometric_secure_secret_2026');
        $validToken = hash_hmac('sha256', "{$emp->id}:{$ts}:VERIFIED", $secret);

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'attestation_token' => $validToken,
            'attestation_timestamp' => $ts,
            'confidence_score' => 0.91,
            'top1_employee_id' => $emp->id,
            'liveness_passed' => true,
            'proof_photo_base64' => 'data:image/jpeg;base64,'.base64_encode('fake_photo_hmac'),
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'status',
                'proof_photo_url',
            ]);

        $this->assertDatabaseHas('attendance_events', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
        ]);
    }

    public function test_kiosk_attendance_tap_prevents_attestation_replay(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey1 = 'test-replay-1-'.uniqid();
        $idempotencyKey2 = 'test-replay-2-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+40 days'));
        AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
        $ts = time();
        $secret = config('biometric.shared_secret', 'mooding_biometric_secure_secret_2026');
        $validToken = hash_hmac('sha256', "{$emp->id}:{$ts}:VERIFIED", $secret);

        $firstTap = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey1,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'attestation_token' => $validToken,
            'attestation_timestamp' => $ts,
            'top1_employee_id' => $emp->id,
            'liveness_passed' => true,
        ]);
        $firstTap->assertStatus(200);

        $replayTap = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey2,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_out',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'attestation_token' => $validToken,
            'attestation_timestamp' => $ts,
            'top1_employee_id' => $emp->id,
            'liveness_passed' => true,
        ]);

        $replayTap->assertStatus(422)->assertJson([
            'status' => 'invalid_attestation',
            'reject_reason' => 'ATTESTATION_TOKEN_REPLAYED',
        ]);
    }

    public function test_hrd_enroll_three_poses_with_replace_existing_deactivates_previous_templates(): void
    {
        Storage::fake('public');
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/api/v1/cache/sync' => Http::response([
                'status' => 'ok',
                'synced_employees' => 1,
            ]),
        ]);

        $uniqueExtId = random_int(900000, 999999);
        $employee = Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => $uniqueExtId,
            'id_karyawan' => 'EMPTEST'.$uniqueExtId,
            'nama_karyawan' => 'Karyawan Uji Tiga Foto',
            'status' => 'aktif',
        ]);

        try {
            $oldEmbedding = FaceEmbedding::create([
                'employee_id' => $employee->id,
                'embedding_vector' => json_encode(array_fill(0, 512, 0.02)),
                'model_name' => 'buffalo_s',
                'model_version' => 'arcface_r50_v1',
                'pose_label' => 'front',
                'is_active' => true,
            ]);

            $fakePhotoBase64 = 'data:image/jpeg;base64,'.base64_encode('fake-jpg-content');
            $poses = ['front', 'slight_left', 'slight_right'];
            $templates = [];

            foreach ($poses as $pose) {
                $templates[] = [
                    'embedding_vector' => array_fill(0, 512, 0.09),
                    'model_name' => 'buffalo_s',
                    'model_version' => 'arcface_r50_v1',
                    'pose_label' => $pose,
                    'photo_base64' => $fakePhotoBase64,
                    'quality_score' => 95.0,
                    'blur_score' => 130.0,
                    'brightness_score' => 110.0,
                    'pose_yaw' => $pose === 'slight_left' ? 18.0 : ($pose === 'slight_right' ? -18.0 : 0.5),
                    'pose_pitch' => 0.0,
                    'pose_roll' => 0.0,
                ];
                $templates[] = [
                    'embedding_vector' => array_fill(0, 128, 0.08),
                    'model_name' => 'sface',
                    'model_version' => 'opencv_sface_2021dec',
                    'pose_label' => $pose,
                    'photo_base64' => null,
                    'quality_score' => 95.0,
                    'blur_score' => 130.0,
                    'brightness_score' => 110.0,
                    'pose_yaw' => $pose === 'slight_left' ? 18.0 : ($pose === 'slight_right' ? -18.0 : 0.5),
                    'pose_pitch' => 0.0,
                    'pose_roll' => 0.0,
                ];
            }

            $headers = $this->authenticateHrd();
            $response = $this->postJson('/api/hrd/employees/'.$employee->id.'/enroll-face', [
                'consent_given' => true,
                'replace_existing' => true,
                'templates' => $templates,
            ], $headers);

            $response->assertStatus(200)
                ->assertJson([
                    'success' => true,
                    'enrolled_count' => 6,
                ]);

            $this->assertFalse((bool) $oldEmbedding->fresh()->is_active);
            $this->assertSame(
                6,
                FaceEmbedding::where('employee_id', $employee->id)->where('is_active', true)->count()
            );

            $detailResponse = $this->getJson('/api/hrd/employees/'.$employee->id, $headers);
            $detailResponse->assertStatus(200);
            $this->assertCount(6, $detailResponse->json('face_embeddings'));

            Http::assertSent(function ($request) use ($employee) {
                $body = $request->data();

                return str_ends_with($request->url(), '/api/v1/cache/sync')
                    && ($body['employees'][0]['employee_id'] ?? null) === $employee->id
                    && count($body['employees'][0]['embeddings'] ?? []) === 6;
            });
        } finally {
            FaceEmbedding::where('employee_id', $employee->id)->delete();
            $employee->delete();
        }
    }

    public function test_hrd_can_delete_single_face_embedding_and_packet(): void
    {
        Storage::fake('public');
        Http::preventStrayRequests();
        Http::fake([
            config('biometric.engine_url').'/api/v1/cache/sync' => Http::response([
                'status' => 'ok',
                'synced_employees' => 1,
            ]),
        ]);

        $uniqueExtId = random_int(900000, 999999);
        $employee = Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => $uniqueExtId,
            'id_karyawan' => 'EMPDEL'.$uniqueExtId,
            'nama_karyawan' => 'Karyawan Uji Hapus Paket',
            'status' => 'aktif',
        ]);

        try {
            $fakePhotoBase64 = 'data:image/jpeg;base64,'.base64_encode('fake-jpg-content');
            $templates = [];
            foreach (['front', 'slight_left', 'slight_right'] as $pose) {
                $templates[] = [
                    'embedding_vector' => array_fill(0, 512, 0.07),
                    'model_name' => 'buffalo_s',
                    'model_version' => 'arcface_r50_v1',
                    'pose_label' => $pose,
                    'photo_base64' => $fakePhotoBase64,
                ];
                $templates[] = [
                    'embedding_vector' => array_fill(0, 128, 0.06),
                    'model_name' => 'sface',
                    'model_version' => 'opencv_sface_2021dec',
                    'pose_label' => $pose,
                    'photo_base64' => null,
                ];
            }

            $headers = $this->authenticateHrd();
            $enrollRes = $this->postJson('/api/hrd/employees/'.$employee->id.'/enroll-face', [
                'consent_given' => true,
                'templates' => $templates,
            ], $headers);
            $enrollRes->assertOk();
            $batchId = $enrollRes->json('batch_id');
            $this->assertNotEmpty($batchId);

            $detailRes = $this->getJson('/api/hrd/employees/'.$employee->id, $headers);
            $detailRes->assertOk();
            $packets = $detailRes->json('face_packets');
            $this->assertCount(1, $packets);
            $this->assertSame(3, $packets[0]['completed_count']);

            $leftId = $packets[0]['poses']['slight_left']['id'];
            $rightId = $packets[0]['poses']['slight_right']['id'];

            $deleteSingleRes = $this->deleteJson(
                "/api/hrd/employees/{$employee->id}/face-embeddings/{$leftId}",
                [],
                $headers
            );
            $deleteSingleRes->assertOk()->assertJson([
                'success' => true,
                'remaining_active_count' => 4,
            ]);

            $detailAfterSingle = $this->getJson('/api/hrd/employees/'.$employee->id, $headers);
            $detailAfterSingle->assertOk();
            $packetsAfterSingle = $detailAfterSingle->json('face_packets');
            $this->assertCount(1, $packetsAfterSingle);
            $this->assertSame(2, $packetsAfterSingle[0]['completed_count']);
            $this->assertNull($packetsAfterSingle[0]['poses']['slight_left']);

            $replacePoseRes = $this->postJson('/api/hrd/employees/'.$employee->id.'/enroll-face', [
                'consent_given' => true,
                'replace_embedding_id' => $rightId,
                'batch_id' => $batchId,
                'templates' => [
                    [
                        'embedding_vector' => array_fill(0, 512, 0.11),
                        'model_name' => 'buffalo_s',
                        'model_version' => 'arcface_r50_v1',
                        'pose_label' => 'slight_right',
                        'photo_base64' => $fakePhotoBase64,
                    ],
                ],
            ], $headers);
            $replacePoseRes->assertOk()->assertJson(['batch_id' => $batchId]);

            $detailAfterReplace = $this->getJson('/api/hrd/employees/'.$employee->id, $headers);
            $detailAfterReplace->assertOk();
            $packetsAfterReplace = $detailAfterReplace->json('face_packets');
            $this->assertCount(1, $packetsAfterReplace);
            $this->assertNotSame($rightId, $packetsAfterReplace[0]['poses']['slight_right']['id']);

            $deletePacketRes = $this->deleteJson('/api/hrd/employees/'.$employee->id.'/face-packets', [
                'batch_id' => $batchId,
            ], $headers);
            $deletePacketRes->assertOk()->assertJson([
                'success' => true,
                'remaining_active_count' => 0,
            ]);

            $this->assertSame(
                0,
                FaceEmbedding::where('employee_id', $employee->id)->where('is_active', true)->count()
            );

            Http::assertSent(function ($request) use ($employee) {
                $body = $request->data();

                return str_ends_with($request->url(), '/api/v1/cache/sync')
                    && ($body['employees'][0]['employee_id'] ?? null) === $employee->id
                    && ($body['employees'][0]['embeddings'] ?? null) === [];
            });
        } finally {
            FaceEmbedding::where('employee_id', $employee->id)->delete();
            $employee->delete();
        }
    }

    public function test_kiosk_attendance_tap_stores_three_proof_photos_and_log_detail_returns_all_three(): void
    {
        Storage::fake('public');
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-three-proofs-'.uniqid();
        $workDate = date('Y-m-d', strtotime('+30 days'));
        AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
        $ts = time();
        $token = hash_hmac('sha256', "{$emp->id}:{$ts}:VERIFIED", config('biometric.shared_secret'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.91,
            'decision' => 'VERIFIED',
            'top1_employee_id' => $emp->id,
            'top1_score' => 0.91,
            'liveness_passed' => true,
            'attestation_token' => $token,
            'attestation_timestamp' => $ts,
            'proof_photo_base64' => 'data:image/jpeg;base64,'.base64_encode('front-proof'),
            'proof_photo_left_base64' => 'data:image/jpeg;base64,'.base64_encode('left-proof'),
            'proof_photo_right_base64' => 'data:image/jpeg;base64,'.base64_encode('right-proof'),
        ]);

        $response->assertStatus(200);
        $eventId = $response->json('event.id');
        $this->assertNotNull($eventId);

        $headers = $this->authenticateHrd();
        $logsRes = $this->getJson('/api/hrd/logs?per_page=10', $headers);
        $logsRes->assertOk();
        $logRow = collect($logsRes->json('data'))->firstWhere('id', $eventId);
        $this->assertNotNull($logRow);
        $this->assertNotNull($logRow['proof_photo_url']);
        $this->assertArrayNotHasKey('proof_photo_left_url', $logRow);
        $this->assertArrayNotHasKey('proof_photo_right_url', $logRow);

        $logDetailRes = $this->getJson("/api/hrd/logs/{$eventId}", $headers);
        $logDetailRes->assertOk();
        $this->assertNotNull($logDetailRes->json('event.proof_photo_url'));
        $this->assertNotNull($logDetailRes->json('event.proof_photo_left_url'));
        $this->assertNotNull($logDetailRes->json('event.proof_photo_right_url'));

        AttendanceEvent::where('id', $eventId)->delete();
    }

    public function test_hrd_employees_biometric_filtering_and_pagination(): void
    {
        $headers = $this->authenticateHrd();

        $allRes = $this->getJson('/api/hrd/employees?per_page=10', $headers);
        $allRes->assertOk();
        $this->assertArrayHasKey('data', $allRes->json());
        $this->assertArrayHasKey('total', $allRes->json());

        $yesRes = $this->getJson('/api/hrd/employees?has_biometric=yes&per_page=10', $headers);
        $yesRes->assertOk();
        foreach ($yesRes->json('data') as $item) {
            $this->assertTrue($item['has_biometric']);
        }

        $noRes = $this->getJson('/api/hrd/employees?has_biometric=no&per_page=10', $headers);
        $noRes->assertOk();
        foreach ($noRes->json('data') as $item) {
            $this->assertFalse($item['has_biometric']);
        }
    }

    public function test_late_duration_formatting_in_hours_minutes_seconds(): void
    {
        $this->assertSame('20 detik', AttendanceEvent::formatLateDuration(20));
        $this->assertSame('12 menit 20 detik', AttendanceEvent::formatLateDuration(740));
        $this->assertSame('12 menit', AttendanceEvent::formatLateDuration(720));
        $this->assertSame('1 jam', AttendanceEvent::formatLateDuration(3600));
        $this->assertSame('1 jam 15 menit 30 detik', AttendanceEvent::formatLateDuration(4530));

        $raw = 'Masuk Berhasil — Terlambat 12.333333333333 menit';
        $sanitized = AttendanceEvent::sanitizeStatusLabel($raw);
        $this->assertSame('Masuk Berhasil — Terlambat 12 menit 20 detik', $sanitized);
    }
}
