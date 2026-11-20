<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceButtonConfig extends Model
{
    protected $table = 'attendance_button_configs';

    protected $fillable = [
        'kiosk_location_id',
        'attendance_type',
        'label',
        'is_enabled',
        'auto_highlight_start',
        'auto_highlight_end',
        'sort_order',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function location(): BelongsTo
    {
        return $this->belongsTo(KioskLocation::class, 'kiosk_location_id');
    }
}
