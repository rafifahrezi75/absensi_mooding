<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->decimal('quality_score', 5, 2)->nullable()->after('photo_path');
            $table->decimal('blur_score', 7, 2)->nullable()->after('quality_score');
            $table->decimal('brightness_score', 5, 2)->nullable()->after('blur_score');
            $table->decimal('pose_yaw', 5, 2)->nullable()->after('brightness_score');
            $table->decimal('pose_pitch', 5, 2)->nullable()->after('pose_yaw');
            $table->decimal('pose_roll', 5, 2)->nullable()->after('pose_pitch');
            $table->string('model_name', 50)->default('buffalo_s')->after('pose_roll');
        });
    }

    public function down(): void
    {
        Schema::table('face_embeddings', function (Blueprint $table) {
            $table->dropColumn([
                'quality_score',
                'blur_score',
                'brightness_score',
                'pose_yaw',
                'pose_pitch',
                'pose_roll',
                'model_name',
            ]);
        });
    }
};
