<?php

namespace Tests\Feature;

use App\Models\Employee;
use Tests\TestCase;

class FaceKioskTest extends TestCase
{
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
                ],
            ]);
    }

    public function test_kiosk_auth_verify_pin(): void
    {
        $validResponse = $this->postJson('/api/kiosk/auth-verify', [
            'pin' => '123456',
        ]);
        $validResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

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
        $response = $this->getJson('/api/kiosk/employees-cache');
        $response->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'employees',
            ]);
    }

    public function test_kiosk_attendance_tap_and_deduplication(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-idemp-' . uniqid();
        $workDate = date('Y-m-d', strtotime('+10 days'));
        \App\Models\AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.92,
            'decision' => 'VERIFIED',
            'liveness_passed' => true,
            'proof_photo_base64' => 'data:image/jpeg;base64,' . base64_encode('fake_tap_photo'),
        ]);

        $response->assertStatus(200)
            ->assertJsonStructure([
                'status',
                'proof_photo_url',
            ]);

        $duplicateResponse = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => 'test-idemp-' . uniqid(),
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
            'confidence_score' => 0.94,
            'liveness_passed' => true,
        ]);

        $duplicateResponse->assertStatus(200)
            ->assertJson([
                'status' => 'already_clocked_in',
            ]);
    }

    public function test_kiosk_fallback_pin_tap(): void
    {
        $idempotencyKey = 'test-fallback-' . uniqid();
        $workDate = date('Y-m-d');

        $response = $this->postJson('/api/kiosk/fallback-tap', [
            'idempotency_key' => $idempotencyKey,
            'id_karyawan' => 'EMP001',
            'pin' => '1234',
            'work_date' => $workDate,
            'attendance_type' => 'clock_out',
            'recorded_at' => date('c'),
            'proof_photo_base64' => 'data:image/jpeg;base64,' . base64_encode('dummy_image_content'),
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'status' => 'synced',
            ]);
    }

    public function test_hrd_login_and_dashboard(): void
    {
        $loginRes = $this->postJson('/api/hrd/login', [
            'email' => 'admin@facekiosk.local',
            'password' => 'password123',
        ]);

        $loginRes->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $dashboardRes = $this->getJson('/api/hrd/dashboard');
        $dashboardRes->assertStatus(200)
            ->assertJsonStructure([
                'summary',
                'devices',
                'alerts',
            ]);
    }

    public function test_integration_heartbeat_and_master_sync(): void
    {
        $hbRes = $this->getJson('/api/integrations/face-attendance/heartbeat');
        $hbRes->assertStatus(200)
            ->assertJsonStructure([
                'server_time',
                'locked_periods',
                'status',
            ]);

        $syncRes = $this->getJson('/api/integrations/face-attendance/master-sync');
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

        $idempotencyKey = 'test-batch-' . uniqid();

        $response = $this->postJson('/api/integrations/face-attendance/events', [
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
        ]);

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

        $response = $this->getJson('/api/hrd/employees/' . $emp->id);
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
        $emp = Employee::first();
        $this->assertNotNull($emp);

        $fakePhotoBase64 = 'data:image/jpeg;base64,' . base64_encode('fake-jpg-content');
        $fakeVector = array_fill(0, 128, 0.05);

        $response = $this->postJson('/api/hrd/employees/' . $emp->id . '/enroll-face', [
            'embedding_vector' => $fakeVector,
            'pose_label' => 'front',
            'model_version' => 'buffalo_s',
            'consent_given' => true,
            'photo_base64' => $fakePhotoBase64,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $this->assertNotNull($response->json('photo_url'));

        $embeddingId = $response->json('embedding_id');
        if ($embeddingId) {
            \App\Models\FaceEmbedding::find($embeddingId)?->delete();
        }
    }

    public function test_kiosk_biometric_decision_verified_records_attendance_and_audit(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-audit-' . uniqid();
        $workDate = date('Y-m-d', strtotime('+20 days'));
        \App\Models\AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.88,
            'decision' => 'VERIFIED',
            'top1_score' => 0.88,
            'top2_score' => 0.32,
            'score_margin' => 0.56,
            'passive_spoof_score' => 0.05,
            'captured_frames' => 5,
            'consistent_frames' => 5,
            'liveness_passed' => true,
            'proof_photo_base64' => 'data:image/jpeg;base64,' . base64_encode('fake_verified_tap_photo'),
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

        $idempotencyKey = 'test-rejected-' . uniqid();
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

        $initialEmbeddingIds = \App\Models\FaceEmbedding::where('employee_id', $emp->id)->pluck('id')->toArray();

        $fakeVector1 = array_fill(0, 128, 0.10);
        $fakeVector2 = array_fill(0, 128, 0.12);

        $response = $this->postJson('/api/hrd/employees/' . $emp->id . '/enroll-face', [
            'consent_given' => true,
            'templates' => [
                [
                    'embedding_vector' => $fakeVector1,
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
                    'pose_label' => 'slight_left',
                    'quality_score' => 91.0,
                    'blur_score' => 120.0,
                    'brightness_score' => 118.0,
                    'pose_yaw' => 8.5,
                    'pose_pitch' => 1.0,
                    'pose_roll' => 0.2,
                ],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'enrolled_count' => 2,
            ]);

        \App\Models\FaceEmbedding::where('employee_id', $emp->id)
            ->whereNotIn('id', $initialEmbeddingIds)
            ->delete();
    }

    public function test_hrd_upload_and_delete_profile_photo(): void
    {
        $emp = Employee::first();
        $this->assertNotNull($emp);
        $originalPhoto = $emp->profile_photo_path;

        $fakePhotoBase64 = 'data:image/jpeg;base64,' . base64_encode('fake-profile-photo-content');

        $uploadResponse = $this->postJson('/api/hrd/employees/' . $emp->id . '/upload-profile-photo', [
            'photo_base64' => $fakePhotoBase64,
        ]);

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

        $deleteResponse = $this->deleteJson('/api/hrd/employees/' . $emp->id . '/profile-photo');
        $deleteResponse->assertStatus(200)
            ->assertJson([
                'success' => true,
                'profile_photo_url' => null,
            ]);

        $emp->refresh();
        $this->assertNull($emp->profile_photo_path);

        $emp->update(['profile_photo_path' => $originalPhoto]);
    }

    public function test_kiosk_face_engine_proxy_collision_scan(): void
    {
        $response = $this->getJson('/api/face-engine/api/v1/gallery/collision-scan');
        $response->assertStatus(200)
            ->assertJsonStructure([
                'status',
                'total_identities',
                'high_risk_count',
                'pairs',
            ]);
    }

    public function test_kiosk_attendance_tap_ambiguous_decision(): void
    {
        $emp1 = Employee::where('id_karyawan', 'EMP001')->first();
        $emp2 = Employee::where('id_karyawan', 'EMP002')->first();
        $this->assertNotNull($emp1);
        $this->assertNotNull($emp2);

        $idempotencyKey = 'test-ambig-' . uniqid();
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

        $idempotencyKey = 'test-nodec-' . uniqid();
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
            ->assertJson([
                'status' => 'unknown',
                'decision' => 'UNKNOWN',
            ]);

        $this->assertDatabaseMissing('attendance_events', [
            'idempotency_key' => $idempotencyKey,
        ]);
    }

    public function test_kiosk_attendance_tap_fails_closed_with_forged_attestation_token(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-forged-' . uniqid();
        $workDate = date('Y-m-d', strtotime('+36 days'));

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'decision' => 'VERIFIED',
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

    public function test_kiosk_attendance_tap_succeeds_with_valid_hmac_attestation_token(): void
    {
        $emp = Employee::where('id_karyawan', 'EMP001')->first();
        $this->assertNotNull($emp);

        $idempotencyKey = 'test-valid-hmac-' . uniqid();
        $workDate = date('Y-m-d', strtotime('+37 days'));
        \App\Models\AttendanceEvent::where('employee_id', $emp->id)->where('work_date', $workDate)->delete();
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
            'liveness_passed' => true,
            'proof_photo_base64' => 'data:image/jpeg;base64,' . base64_encode('fake_photo_hmac'),
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
}
