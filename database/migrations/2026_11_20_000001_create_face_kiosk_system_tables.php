<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kiosk_locations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('company_id')->index();
            $table->unsignedBigInteger('entitasshelter_id')->nullable()->index();
            $table->unsignedBigInteger('cabang_id')->nullable()->index();
            $table->unsignedBigInteger('gudang_id')->nullable()->index();
            $table->unsignedBigInteger('proyek_id')->nullable()->index();
            $table->enum('location_type', ['cabang', 'gudang', 'proyek']);
            $table->string('location_name', 150);
            $table->string('nomor_proyek', 100)->nullable();
            $table->string('kota', 100)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();
        });

        Schema::create('kiosk_devices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('kiosk_location_id')->constrained('kiosk_locations')->cascadeOnDelete();
            $table->string('device_name', 100);
            $table->string('device_token', 128)->unique();
            $table->json('allowed_company_ids')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_seen_at')->nullable();
            $table->string('app_version', 30)->nullable();
            $table->timestamps();
        });

        Schema::create('hrd_users', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('external_user_id')->nullable();
            $table->unsignedBigInteger('company_id')->nullable()->index();
            $table->string('name', 150);
            $table->string('email', 150)->unique();
            $table->string('password_hash');
            $table->string('kiosk_pin_hash');
            $table->enum('role', ['super_admin', 'hrd_company', 'hrd_location'])->default('hrd_company');
            $table->foreignId('kiosk_location_id')->nullable()->constrained('kiosk_locations')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('shift_snapshots', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('company_id')->index();
            $table->unsignedBigInteger('external_shift_id')->index();
            $table->string('shift_name', 100);
            $table->time('start_time');
            $table->time('end_time');
            $table->time('break_start_time')->nullable();
            $table->time('break_end_time')->nullable();
            $table->boolean('is_overnight')->default(false);
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['company_id', 'external_shift_id']);
        });

        Schema::create('employees', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('company_id')->index();
            $table->unsignedBigInteger('external_karyawan_id')->index();
            $table->string('id_absensi', 50)->nullable()->index();
            $table->string('id_karyawan', 50)->index();
            $table->string('nomor_induk', 50)->nullable();
            $table->string('nama_karyawan', 150);
            $table->string('jabatan', 100)->nullable();
            $table->unsignedBigInteger('entitasshelter_id')->nullable()->index();
            $table->unsignedBigInteger('cabang_id')->nullable()->index();
            $table->unsignedBigInteger('proyek_id')->nullable()->index();
            $table->unsignedBigInteger('kebutuhan_proyek_id')->nullable();
            $table->unsignedBigInteger('shift_id')->nullable()->index();
            $table->string('status', 50)->default('aktif');
            $table->string('pin_hash', 255)->nullable();
            $table->timestamp('biometric_consent_at')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['company_id', 'external_karyawan_id']);
            $table->index(['company_id', 'id_karyawan']);
            $table->index(['company_id', 'proyek_id', 'status']);
        });

        Schema::create('face_embeddings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->longText('embedding_vector');
            $table->string('model_version', 50)->default('human-faceres-v3.2');
            $table->enum('pose_label', ['front', 'slight_left', 'slight_right'])->default('front');
            $table->foreignId('enrolled_by')->nullable()->constrained('hrd_users')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('attendance_button_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('kiosk_location_id')->nullable()->constrained('kiosk_locations')->nullOnDelete();
            $table->enum('attendance_type', ['clock_in', 'clock_out', 'break_start', 'break_end', 'overtime_start', 'overtime_end']);
            $table->string('label', 50);
            $table->boolean('is_enabled')->default(true);
            $table->time('auto_highlight_start')->nullable();
            $table->time('auto_highlight_end')->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('attendance_events', function (Blueprint $table) {
            $table->id();
            $table->char('idempotency_key', 36)->unique();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('kiosk_device_id')->nullable()->constrained('kiosk_devices')->nullOnDelete();
            $table->foreignId('kiosk_location_id')->nullable()->constrained('kiosk_locations')->nullOnDelete();
            $table->enum('device_mode', ['kiosk', 'personal_mobile'])->default('kiosk');
            $table->unsignedBigInteger('company_id')->index();
            $table->unsignedBigInteger('entitasshelter_id')->nullable();
            $table->unsignedBigInteger('proyek_id')->nullable();
            $table->unsignedBigInteger('shift_id')->nullable();
            $table->date('work_date');
            $table->enum('attendance_type', ['clock_in', 'clock_out', 'break_start', 'break_end', 'overtime_start', 'overtime_end']);
            $table->enum('auth_method', ['face_liveness', 'fallback_pin']);
            $table->timestamp('recorded_at');
            $table->boolean('is_time_suspect')->default(false);
            $table->boolean('is_cross_location')->default(false);
            $table->decimal('confidence_score', 5, 4)->nullable();
            $table->boolean('liveness_passed')->default(false);
            $table->string('proof_photo_path', 255)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->unsignedBigInteger('external_absensi_id')->nullable();
            $table->enum('sync_status', [
                'pending',
                'synced',
                'failed',
                'duplicate_ignored',
                'period_locked',
                'employee_inactive',
                'manual_override_conflict'
            ])->default('pending')->index();
            $table->string('main_app_status_label', 150)->nullable();
            $table->integer('sync_attempts')->default(0);
            $table->text('last_sync_error')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->index(['employee_id', 'work_date', 'attendance_type']);
            $table->index(['sync_status', 'created_at']);
        });

        Schema::create('sync_logs', function (Blueprint $table) {
            $table->id();
            $table->enum('sync_type', ['pull_master', 'push_events']);
            $table->unsignedBigInteger('company_id')->nullable();
            $table->foreignId('triggered_by')->nullable()->constrained('hrd_users')->nullOnDelete();
            $table->integer('total_records')->default(0);
            $table->integer('success_count')->default(0);
            $table->integer('failed_count')->default(0);
            $table->text('error_summary')->nullable();
            $table->timestamps();
        });

        Schema::create('absensi_integration_receipts', function (Blueprint $table) {
            $table->id();
            $table->char('idempotency_key', 36)->unique();
            $table->unsignedBigInteger('absensi_id')->nullable();
            $table->string('payload_hash', 64)->nullable();
            $table->timestamp('processed_at');
            $table->timestamps();
        });

        Schema::create('system_settings', function (Blueprint $table) {
            $table->id();
            $table->string('key', 100)->unique();
            $table->text('value')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_settings');
        Schema::dropIfExists('absensi_integration_receipts');
        Schema::dropIfExists('sync_logs');
        Schema::dropIfExists('attendance_events');
        Schema::dropIfExists('attendance_button_configs');
        Schema::dropIfExists('face_embeddings');
        Schema::dropIfExists('employees');
        Schema::dropIfExists('shift_snapshots');
        Schema::dropIfExists('hrd_users');
        Schema::dropIfExists('kiosk_devices');
        Schema::dropIfExists('kiosk_locations');
    }
};
