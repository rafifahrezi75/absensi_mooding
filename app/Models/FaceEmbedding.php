<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FaceEmbedding extends Model
{
    protected $table = 'face_embeddings';

    protected $fillable = [
        'employee_id',
        'embedding_vector',
        'model_version',
        'model_name',
        'pose_label',
        'photo_path',
        'quality_score',
        'blur_score',
        'brightness_score',
        'pose_yaw',
        'pose_pitch',
        'pose_roll',
        'enrolled_by',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'quality_score' => 'float',
        'blur_score' => 'float',
        'brightness_score' => 'float',
        'pose_yaw' => 'float',
        'pose_pitch' => 'float',
        'pose_roll' => 'float',
    ];

    protected $appends = [
        'photo_url',
    ];

    public function getPhotoUrlAttribute(): ?string
    {
        return $this->photo_path ? '/storage/' . $this->photo_path : null;
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function enroller(): BelongsTo
    {
        return $this->belongsTo(HrdUser::class, 'enrolled_by');
    }
}
