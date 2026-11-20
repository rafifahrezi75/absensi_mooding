<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class KioskLocation extends Model
{
    protected $table = 'kiosk_locations';

    protected $fillable = [
        'company_id',
        'entitasshelter_id',
        'cabang_id',
        'gudang_id',
        'proyek_id',
        'location_type',
        'location_name',
        'nomor_proyek',
        'kota',
        'is_active',
        'synced_at',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'synced_at' => 'datetime',
    ];

    public function devices(): HasMany
    {
        return $this->hasMany(KioskDevice::class, 'kiosk_location_id');
    }

    public function buttonConfigs(): HasMany
    {
        return $this->hasMany(AttendanceButtonConfig::class, 'kiosk_location_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(AttendanceEvent::class, 'kiosk_location_id');
    }
}
