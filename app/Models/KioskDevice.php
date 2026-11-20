<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class KioskDevice extends Model
{
    protected $table = 'kiosk_devices';

    protected $fillable = [
        'kiosk_location_id',
        'device_name',
        'device_token',
        'allowed_company_ids',
        'is_active',
        'last_seen_at',
        'app_version',
    ];

    protected $casts = [
        'allowed_company_ids' => 'array',
        'is_active' => 'boolean',
        'last_seen_at' => 'datetime',
    ];

    public function location(): BelongsTo
    {
        return $this->belongsTo(KioskLocation::class, 'kiosk_location_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(AttendanceEvent::class, 'kiosk_device_id');
    }
}
