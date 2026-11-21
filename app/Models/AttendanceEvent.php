<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceEvent extends Model
{
    protected $table = 'attendance_events';

    protected $fillable = [
        'idempotency_key',
        'employee_id',
        'kiosk_device_id',
        'kiosk_location_id',
        'device_mode',
        'company_id',
        'entitasshelter_id',
        'proyek_id',
        'shift_id',
        'work_date',
        'attendance_type',
        'auth_method',
        'recorded_at',
        'is_time_suspect',
        'is_cross_location',
        'confidence_score',
        'liveness_passed',
        'proof_photo_path',
        'latitude',
        'longitude',
        'external_absensi_id',
        'sync_status',
        'main_app_status_label',
        'sync_attempts',
        'last_sync_error',
        'synced_at',
    ];

    protected $casts = [
        'work_date' => 'date',
        'recorded_at' => 'datetime',
        'synced_at' => 'datetime',
        'is_time_suspect' => 'boolean',
        'is_cross_location' => 'boolean',
        'liveness_passed' => 'boolean',
        'confidence_score' => 'float',
        'latitude' => 'float',
        'longitude' => 'float',
        'sync_attempts' => 'integer',
    ];

    protected $appends = [
        'proof_photo_url',
    ];

    public function getProofPhotoUrlAttribute(): ?string
    {
        return $this->proof_photo_path ? '/storage/' . $this->proof_photo_path : null;
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(KioskLocation::class, 'kiosk_location_id');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(KioskDevice::class, 'kiosk_device_id');
    }
}
