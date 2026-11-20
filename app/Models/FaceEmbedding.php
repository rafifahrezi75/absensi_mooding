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
        'pose_label',
        'enrolled_by',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function enroller(): BelongsTo
    {
        return $this->belongsTo(HrdUser::class, 'enrolled_by');
    }
}
