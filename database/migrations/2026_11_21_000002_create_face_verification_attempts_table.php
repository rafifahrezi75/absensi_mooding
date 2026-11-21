<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('face_verification_attempts', function (Blueprint $table) {
            $table->id();
            $table->string('session_id', 64)->index();
            $table->foreignId('employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('top1_employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('top1_score', 5, 4)->nullable();
            $table->foreignId('top2_employee_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('top2_score', 5, 4)->nullable();
            $table->decimal('score_margin', 5, 4)->nullable();
            $table->decimal('quality_score', 5, 2)->nullable();
            $table->decimal('brightness_score', 5, 2)->nullable();
            $table->decimal('blur_score', 7, 2)->nullable();
            $table->decimal('pose_yaw', 5, 2)->nullable();
            $table->decimal('pose_pitch', 5, 2)->nullable();
            $table->decimal('pose_roll', 5, 2)->nullable();
            $table->decimal('passive_spoof_score', 5, 4)->nullable();
            $table->string('active_liveness_type', 50)->nullable();
            $table->boolean('active_liveness_passed')->default(false);
            $table->integer('captured_frames')->default(0);
            $table->integer('consistent_frames')->default(0);
            $table->enum('result', ['VERIFIED', 'RETRY', 'UNKNOWN', 'SPOOF_REJECTED', 'QUALITY_REJECTED'])->index();
            $table->string('reject_reason', 150)->nullable();
            $table->string('model_name', 50)->default('buffalo_s');
            $table->string('model_version', 50)->default('arcface_r50_v1');
            $table->foreignId('kiosk_device_id')->nullable()->constrained('kiosk_devices')->nullOnDelete();
            $table->foreignId('kiosk_location_id')->nullable()->constrained('kiosk_locations')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('face_verification_attempts');
    }
};
