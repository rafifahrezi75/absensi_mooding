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
        $workDate = date('Y-m-d');

        $response = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => $idempotencyKey,
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
            'confidence_score' => 0.92,
            'liveness_passed' => true,
        ]);

        $response->assertStatus(200);

        $duplicateResponse = $this->postJson('/api/kiosk/attendance-tap', [
            'idempotency_key' => 'test-idemp-' . uniqid(),
            'employee_id' => $emp->id,
            'work_date' => $workDate,
            'attendance_type' => 'clock_in',
            'auth_method' => 'face_liveness',
            'recorded_at' => date('c'),
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
}
