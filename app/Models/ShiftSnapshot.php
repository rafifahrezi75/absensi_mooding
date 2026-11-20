<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ShiftSnapshot extends Model
{
    protected $table = 'shift_snapshots';

    protected $fillable = [
        'company_id',
        'external_shift_id',
        'shift_name',
        'start_time',
        'end_time',
        'break_start_time',
        'break_end_time',
        'is_overnight',
        'synced_at',
    ];

    protected $casts = [
        'is_overnight' => 'boolean',
        'synced_at' => 'datetime',
    ];
}
