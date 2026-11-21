<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Employee extends Model
{
    protected $table = 'employees';

    protected $fillable = [
        'company_id',
        'external_karyawan_id',
        'id_absensi',
        'id_karyawan',
        'nomor_induk',
        'nama_karyawan',
        'profile_photo_path',
        'jabatan',
        'entitasshelter_id',
        'cabang_id',
        'proyek_id',
        'kebutuhan_proyek_id',
        'shift_id',
        'status',
        'pin_hash',
        'biometric_consent_at',
        'synced_at',
    ];

    protected $hidden = [
        'pin_hash',
    ];

    protected $casts = [
        'biometric_consent_at' => 'datetime',
        'synced_at' => 'datetime',
    ];

    protected $appends = [
        'profile_photo_url',
    ];

    public function getProfilePhotoUrlAttribute(): ?string
    {
        return $this->profile_photo_path ? asset('storage/' . $this->profile_photo_path) : null;
    }

    public function faceEmbeddings(): HasMany
    {
        return $this->hasMany(FaceEmbedding::class, 'employee_id');
    }

    public function attendanceEvents(): HasMany
    {
        return $this->hasMany(AttendanceEvent::class, 'employee_id');
    }
}
