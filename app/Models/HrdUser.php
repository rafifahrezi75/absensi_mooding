<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HrdUser extends Authenticatable
{
    protected $table = 'hrd_users';

    protected $fillable = [
        'external_user_id',
        'company_id',
        'name',
        'email',
        'password_hash',
        'kiosk_pin_hash',
        'role',
        'kiosk_location_id',
        'is_active',
    ];

    protected $hidden = [
        'password_hash',
        'kiosk_pin_hash',
        'remember_token',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function getAuthPassword()
    {
        return $this->password_hash;
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(KioskLocation::class, 'kiosk_location_id');
    }

    public function enrolledEmbeddings(): HasMany
    {
        return $this->hasMany(FaceEmbedding::class, 'enrolled_by');
    }
}
