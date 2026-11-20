<?php

namespace Database\Seeders;

use App\Models\AttendanceButtonConfig;
use App\Models\Employee;
use App\Models\HrdUser;
use App\Models\KioskDevice;
use App\Models\KioskLocation;
use App\Models\ShiftSnapshot;
use App\Models\SystemSetting;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $locJakarta = KioskLocation::create([
            'company_id' => 1,
            'cabang_id' => 1,
            'location_type' => 'cabang',
            'location_name' => 'Kantor Pusat Jakarta',
            'nomor_proyek' => null,
            'kota' => 'Jakarta Pusat',
            'is_active' => true,
            'synced_at' => now(),
        ]);

        $locSidoarjo = KioskLocation::create([
            'company_id' => 1,
            'gudang_id' => 10,
            'location_type' => 'gudang',
            'location_name' => 'Gudang Logistik Sidoarjo',
            'nomor_proyek' => null,
            'kota' => 'Sidoarjo',
            'is_active' => true,
            'synced_at' => now(),
        ]);

        $locLrt = KioskLocation::create([
            'company_id' => 1,
            'proyek_id' => 42,
            'location_type' => 'proyek',
            'location_name' => 'Proyek LRT Fase 2',
            'nomor_proyek' => 'PRJ-2026-LRT-002',
            'kota' => 'Jakarta Timur',
            'is_active' => true,
            'synced_at' => now(),
        ]);

        KioskDevice::create([
            'kiosk_location_id' => $locSidoarjo->id,
            'device_name' => 'Tablet Kiosk Pintu Masuk Gudang',
            'device_token' => 'kiosk-dev-sidoarjo-01',
            'allowed_company_ids' => [1, 2],
            'is_active' => true,
            'last_seen_at' => now(),
            'app_version' => '1.0.0',
        ]);

        KioskDevice::create([
            'kiosk_location_id' => $locJakarta->id,
            'device_name' => 'Terminal Kiosk Lobby Utama',
            'device_token' => 'kiosk-dev-jakarta-01',
            'allowed_company_ids' => [1],
            'is_active' => true,
            'last_seen_at' => now(),
            'app_version' => '1.0.0',
        ]);

        KioskDevice::create([
            'kiosk_location_id' => $locLrt->id,
            'device_name' => 'Tablet Kiosk Site Office LRT',
            'device_token' => 'kiosk-dev-lrt-01',
            'allowed_company_ids' => [1],
            'is_active' => true,
            'last_seen_at' => now(),
            'app_version' => '1.0.0',
        ]);

        HrdUser::create([
            'external_user_id' => 1,
            'company_id' => 1,
            'name' => 'Administrator HRD',
            'email' => 'admin@facekiosk.local',
            'password_hash' => Hash::make('password123'),
            'kiosk_pin_hash' => Hash::make('123456'),
            'role' => 'super_admin',
            'kiosk_location_id' => null,
            'is_active' => true,
        ]);

        HrdUser::create([
            'external_user_id' => 2,
            'company_id' => 1,
            'name' => 'HRD Operasional Sidoarjo',
            'email' => 'hrd.gudang@facekiosk.local',
            'password_hash' => Hash::make('password123'),
            'kiosk_pin_hash' => Hash::make('654321'),
            'role' => 'hrd_location',
            'kiosk_location_id' => $locSidoarjo->id,
            'is_active' => true,
        ]);

        $shiftPagi = ShiftSnapshot::create([
            'company_id' => 1,
            'external_shift_id' => 1,
            'shift_name' => 'Shift Reguler Pagi',
            'start_time' => '08:00:00',
            'end_time' => '17:00:00',
            'break_start_time' => '12:00:00',
            'break_end_time' => '13:00:00',
            'is_overnight' => false,
            'synced_at' => now(),
        ]);

        $shiftSiang = ShiftSnapshot::create([
            'company_id' => 1,
            'external_shift_id' => 2,
            'shift_name' => 'Shift Siang Operasional',
            'start_time' => '14:00:00',
            'end_time' => '22:00:00',
            'break_start_time' => '18:00:00',
            'break_end_time' => '19:00:00',
            'is_overnight' => false,
            'synced_at' => now(),
        ]);

        $shiftMalam = ShiftSnapshot::create([
            'company_id' => 1,
            'external_shift_id' => 3,
            'shift_name' => 'Shift Malam Gudang (Lintas Hari)',
            'start_time' => '22:00:00',
            'end_time' => '06:00:00',
            'break_start_time' => '02:00:00',
            'break_end_time' => '03:00:00',
            'is_overnight' => true,
            'synced_at' => now(),
        ]);

        Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => 101,
            'id_absensi' => '101',
            'id_karyawan' => 'EMP001',
            'nomor_induk' => '3171010190001',
            'nama_karyawan' => 'Ahmad Rizky Pratama',
            'jabatan' => 'Supervisor Gudang',
            'entitasshelter_id' => 1,
            'cabang_id' => null,
            'proyek_id' => null,
            'kebutuhan_proyek_id' => null,
            'shift_id' => $shiftPagi->external_shift_id,
            'status' => 'aktif',
            'pin_hash' => Hash::make('1234'),
            'biometric_consent_at' => now(),
            'synced_at' => now(),
        ]);

        Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => 102,
            'id_absensi' => '102',
            'id_karyawan' => 'EMP002',
            'nomor_induk' => '3171010190002',
            'nama_karyawan' => 'Budi Santoso',
            'jabatan' => 'Operator Forklift',
            'entitasshelter_id' => 1,
            'cabang_id' => null,
            'proyek_id' => null,
            'kebutuhan_proyek_id' => null,
            'shift_id' => $shiftMalam->external_shift_id,
            'status' => 'aktif',
            'pin_hash' => Hash::make('2345'),
            'biometric_consent_at' => now(),
            'synced_at' => now(),
        ]);

        Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => 103,
            'id_absensi' => '103',
            'id_karyawan' => 'EMP003',
            'nomor_induk' => '3171010190003',
            'nama_karyawan' => 'Citra Dewi Anggraini',
            'jabatan' => 'Staf Administrasi',
            'entitasshelter_id' => 1,
            'cabang_id' => 1,
            'proyek_id' => null,
            'kebutuhan_proyek_id' => null,
            'shift_id' => $shiftPagi->external_shift_id,
            'status' => 'aktif',
            'pin_hash' => Hash::make('3456'),
            'biometric_consent_at' => now(),
            'synced_at' => now(),
        ]);

        Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => 104,
            'id_absensi' => '104',
            'id_karyawan' => 'EMP004',
            'nomor_induk' => '3171010190004',
            'nama_karyawan' => 'Dedi Kurniawan',
            'jabatan' => 'Teknisi Lapangan',
            'entitasshelter_id' => 1,
            'cabang_id' => null,
            'proyek_id' => 42,
            'kebutuhan_proyek_id' => null,
            'shift_id' => $shiftSiang->external_shift_id,
            'status' => 'aktif',
            'pin_hash' => Hash::make('4567'),
            'biometric_consent_at' => now(),
            'synced_at' => now(),
        ]);

        Employee::create([
            'company_id' => 1,
            'external_karyawan_id' => 105,
            'id_absensi' => '105',
            'id_karyawan' => 'EMP005',
            'nomor_induk' => '3171010190005',
            'nama_karyawan' => 'Eko Prasetyo',
            'jabatan' => 'Staff Gudang Logistik',
            'entitasshelter_id' => 1,
            'cabang_id' => null,
            'proyek_id' => null,
            'kebutuhan_proyek_id' => null,
            'shift_id' => $shiftPagi->external_shift_id,
            'status' => 'aktif',
            'pin_hash' => Hash::make('5678'),
            'biometric_consent_at' => now(),
            'synced_at' => now(),
        ]);

        $buttons = [
            [
                'attendance_type' => 'clock_in',
                'label' => 'Masuk',
                'is_enabled' => true,
                'auto_highlight_start' => '06:00:00',
                'auto_highlight_end' => '09:30:00',
                'sort_order' => 1,
            ],
            [
                'attendance_type' => 'break_start',
                'label' => 'Istirahat Mulai',
                'is_enabled' => true,
                'auto_highlight_start' => '11:30:00',
                'auto_highlight_end' => '13:00:00',
                'sort_order' => 2,
            ],
            [
                'attendance_type' => 'break_end',
                'label' => 'Istirahat Selesai',
                'is_enabled' => true,
                'auto_highlight_start' => '12:30:00',
                'auto_highlight_end' => '14:00:00',
                'sort_order' => 3,
            ],
            [
                'attendance_type' => 'clock_out',
                'label' => 'Pulang',
                'is_enabled' => true,
                'auto_highlight_start' => '16:30:00',
                'auto_highlight_end' => '20:00:00',
                'sort_order' => 4,
            ],
            [
                'attendance_type' => 'overtime_start',
                'label' => 'Lembur Mulai',
                'is_enabled' => true,
                'auto_highlight_start' => '17:30:00',
                'auto_highlight_end' => '21:00:00',
                'sort_order' => 5,
            ],
            [
                'attendance_type' => 'overtime_end',
                'label' => 'Lembur Selesai',
                'is_enabled' => true,
                'auto_highlight_start' => '20:00:00',
                'auto_highlight_end' => '23:59:00',
                'sort_order' => 6,
            ],
        ];

        foreach ($buttons as $btn) {
            AttendanceButtonConfig::create(array_merge($btn, ['kiosk_location_id' => null]));
        }

        SystemSetting::set('similarity_threshold', '0.75');
        SystemSetting::set('ambiguity_margin', '0.08');
        SystemSetting::set('max_failed_scans', '3');
        SystemSetting::set('auto_lock_seconds', '120');
        SystemSetting::set('main_app_api_url', 'http://localhost:8000/api/integrations/face-attendance');
        SystemSetting::set('main_app_integration_key', 'absensi-kiosk-secret-key-2026');
        SystemSetting::set('main_app_shared_secret', 'kiosk-attendance-hmac-secret-signature-key-2026');
    }
}
