<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AbsensiIntegrationReceipt;
use App\Models\Employee;
use App\Models\KioskLocation;
use App\Models\ShiftSnapshot;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IntegrationController extends Controller
{
    public function heartbeat(): JsonResponse
    {
        return response()->json([
            'server_time' => Carbon::now()->toIso8601String(),
            'locked_periods' => [
                '2026-10',
            ],
            'status' => 'operational',
        ]);
    }

    public function masterSync(Request $request): JsonResponse
    {
        $companyId = $request->query('company_id');
        $updatedSince = $request->query('updated_since');

        $empQuery = Employee::query();
        $shiftQuery = ShiftSnapshot::query();
        $locQuery = KioskLocation::query();

        if ($companyId) {
            $empQuery->where('company_id', $companyId);
            $shiftQuery->where('company_id', $companyId);
            $locQuery->where('company_id', $companyId);
        }

        if ($updatedSince) {
            $since = Carbon::parse($updatedSince);
            $empQuery->where('updated_at', '>=', $since);
            $shiftQuery->where('updated_at', '>=', $since);
            $locQuery->where('updated_at', '>=', $since);
        }

        $employees = $empQuery->select([
            'id',
            'company_id',
            'external_karyawan_id',
            'id_absensi',
            'id_karyawan',
            'nomor_induk',
            'nama_karyawan',
            'jabatan',
            'entitasshelter_id',
            'cabang_id',
            'proyek_id',
            'kebutuhan_proyek_id',
            'shift_id',
            'status',
            'biometric_consent_at',
            'updated_at',
        ])->get();

        $shifts = $shiftQuery->get();
        $locations = $locQuery->get();

        return response()->json([
            'server_time' => Carbon::now()->toIso8601String(),
            'locations' => $locations,
            'shifts' => $shifts,
            'karyawans' => $employees,
        ]);
    }

    public function events(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'events' => 'required|array|min:1|max:20',
            'events.*.idempotency_key' => 'required|string',
            'events.*.company_id' => 'required|integer',
            'events.*.external_karyawan_id' => 'required|integer',
            'events.*.work_date' => 'required|date_format:Y-m-d',
            'events.*.attendance_type' => 'required|in:clock_in,clock_out,break_start,break_end,overtime_start,overtime_end',
            'events.*.auth_method' => 'required|in:face_liveness,fallback_pin',
            'events.*.recorded_at' => 'required|string',
            'events.*.is_time_suspect' => 'nullable|boolean',
            'events.*.is_cross_location' => 'nullable|boolean',
            'events.*.location_name' => 'nullable|string',
            'events.*.proof_photo_url' => 'nullable|string',
        ]);

        $results = [];
        $lockedPeriods = ['2026-10'];

        foreach ($validated['events'] as $event) {
            $idempotencyKey = $event['idempotency_key'];
            $existingReceipt = AbsensiIntegrationReceipt::where('idempotency_key', $idempotencyKey)->first();

            if ($existingReceipt) {
                $results[] = [
                    'idempotency_key' => $idempotencyKey,
                    'status' => 'duplicate_ignored',
                    'absensi_id' => $existingReceipt->absensi_id,
                    'status_label' => 'Sudah tercatat sebelumnya',
                ];

                continue;
            }

            $monthPeriod = Carbon::parse($event['work_date'])->format('Y-m');
            if (in_array($monthPeriod, $lockedPeriods)) {
                $results[] = [
                    'idempotency_key' => $idempotencyKey,
                    'status' => 'period_locked',
                    'absensi_id' => null,
                    'status_label' => 'Periode payroll telah dikunci ('.$monthPeriod.')',
                ];

                continue;
            }

            $employee = Employee::where('company_id', $event['company_id'])
                ->where('external_karyawan_id', $event['external_karyawan_id'])
                ->first();

            if (! $employee || strtolower($employee->status) !== 'aktif') {
                $results[] = [
                    'idempotency_key' => $idempotencyKey,
                    'status' => 'employee_inactive',
                    'absensi_id' => null,
                    'status_label' => 'Karyawan tidak aktif atau tidak ditemukan',
                ];

                continue;
            }

            $recordedTime = Carbon::parse($event['recorded_at']);
            $statusLabel = 'Tercatat '.$recordedTime->format('H:i');

            if ($event['attendance_type'] === 'clock_in') {
                $shift = ShiftSnapshot::where('company_id', $event['company_id'])
                    ->where('external_shift_id', $employee->shift_id)
                    ->first();

                if ($shift) {
                    $shiftStart = Carbon::parse($event['work_date'].' '.$shift->start_time);
                    if ($recordedTime->greaterThan($shiftStart)) {
                        $diffSeconds = $shiftStart->diffInSeconds($recordedTime);
                        $lateStr = AttendanceEvent::formatLateDuration($diffSeconds);
                        $statusLabel = 'Masuk Berhasil — Terlambat '.$lateStr;
                    } else {
                        $statusLabel = 'Masuk Berhasil — Tepat Waktu';
                    }
                } else {
                    $statusLabel = 'Masuk Berhasil';
                }
            } elseif ($event['attendance_type'] === 'clock_out') {
                $statusLabel = 'Pulang Berhasil';
            } elseif ($event['attendance_type'] === 'overtime_end') {
                $statusLabel = 'Lembur Selesai Berhasil';
            }

            $absensiId = mt_rand(100000, 999999);

            AbsensiIntegrationReceipt::create([
                'idempotency_key' => $idempotencyKey,
                'absensi_id' => $absensiId,
                'payload_hash' => hash('sha256', json_encode($event)),
                'processed_at' => now(),
            ]);

            $results[] = [
                'idempotency_key' => $idempotencyKey,
                'status' => 'synced',
                'absensi_id' => $absensiId,
                'status_label' => $statusLabel,
                'resolved_proyek_id' => $employee->proyek_id,
            ];
        }

        return response()->json([
            'server_time' => Carbon::now()->toIso8601String(),
            'results' => $results,
        ]);
    }
}
