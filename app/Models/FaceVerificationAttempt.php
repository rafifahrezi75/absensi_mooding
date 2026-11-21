<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FaceVerificationAttempt extends Model
{
    protected $table = 'face_verification_attempts';

    protected $fillable = [
        'session_id',
        'employee_id',
        'top1_employee_id',
        'top1_score',
        'top2_employee_id',
        'top2_score',
        'score_margin',
        'quality_score',
        'brightness_score',
        'blur_score',
        'pose_yaw',
        'pose_pitch',
        'pose_roll',
        'passive_spoof_score',
        'active_liveness_type',
        'active_liveness_passed',
        'captured_frames',
        'consistent_frames',
        'result',
        'reject_reason',
        'model_name',
        'model_version',
        'kiosk_device_id',
        'kiosk_location_id',
    ];

    protected $casts = [
        'top1_score' => 'float',
        'top2_score' => 'float',
        'score_margin' => 'float',
        'quality_score' => 'float',
        'brightness_score' => 'float',
        'blur_score' => 'float',
        'pose_yaw' => 'float',
        'pose_pitch' => 'float',
        'pose_roll' => 'float',
        'passive_spoof_score' => 'float',
        'active_liveness_passed' => 'boolean',
        'captured_frames' => 'integer',
        'consistent_frames' => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function top1Employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'top1_employee_id');
    }

    public function top2Employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'top2_employee_id');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(KioskDevice::class, 'kiosk_device_id');
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(KioskLocation::class, 'kiosk_location_id');
    }
}
