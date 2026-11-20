<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AbsensiIntegrationReceipt extends Model
{
    protected $table = 'absensi_integration_receipts';

    protected $fillable = [
        'idempotency_key',
        'absensi_id',
        'payload_hash',
        'processed_at',
    ];

    protected $casts = [
        'processed_at' => 'datetime',
    ];
}
