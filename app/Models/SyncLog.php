<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SyncLog extends Model
{
    protected $table = 'sync_logs';

    protected $fillable = [
        'sync_type',
        'company_id',
        'triggered_by',
        'total_records',
        'success_count',
        'failed_count',
        'error_summary',
    ];

    protected $casts = [
        'total_records' => 'integer',
        'success_count' => 'integer',
        'failed_count' => 'integer',
    ];

    public function triggerUser(): BelongsTo
    {
        return $this->belongsTo(HrdUser::class, 'triggered_by');
    }
}
