<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->string('batch_id', 36)->nullable()->after('employee_id')->index();
        });

        Schema::table('attendance_events', function (Blueprint $table) {
            $table->string('proof_photo_left_path', 255)->nullable()->after('proof_photo_path');
            $table->string('proof_photo_right_path', 255)->nullable()->after('proof_photo_left_path');
        });
    }

    public function down(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->dropIndex(['batch_id']);
            $table->dropColumn('batch_id');
        });

        Schema::table('attendance_events', function (Blueprint $table) {
            $table->dropColumn(['proof_photo_left_path', 'proof_photo_right_path']);
        });
    }
};
