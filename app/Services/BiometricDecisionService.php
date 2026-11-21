<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\FaceVerificationAttempt;
use App\Models\SystemSetting;
use Illuminate\Support\Str;

class BiometricDecisionService
{
    public function getBiometricConfig(): array
    {
        $matchThreshold = (float) SystemSetting::get(
            'similarity_threshold',
            (string) config('biometric.match_threshold', 0.65)
        );

        $marginThreshold = (float) SystemSetting::get(
            'ambiguity_margin',
            (string) config('biometric.margin_threshold', 0.08)
        );

        return [
            'match_threshold' => $matchThreshold,
            'margin_threshold' => $marginThreshold,
            'capture_frame_count' => (int) config('biometric.capture_frame_count', 5),
            'min_consistent_frames' => (int) config('biometric.min_consistent_frames', 4),
            'quality' => config('biometric.quality'),
            'liveness' => config('biometric.liveness'),
            'model' => config('biometric.model'),
        ];
    }

    public function evaluateVerification(array $payload): array
    {
        $config = $this->getBiometricConfig();

        $qualityValid = $payload['quality_valid'] ?? true;
        $qualityReason = $payload['quality_reason'] ?? null;
        if (!$qualityValid) {
            return $this->finalizeDecision('QUALITY_REJECTED', $qualityReason ?: 'FACE_QUALITY_FAILED', $payload, $config);
        }

        $passiveSpoofScore = isset($payload['passive_spoof_score']) ? (float) $payload['passive_spoof_score'] : 0.0;
        $spoofThreshold = (float) ($config['liveness']['passive_spoof_threshold'] ?? 0.45);
        if ($passiveSpoofScore > $spoofThreshold) {
            return $this->finalizeDecision('SPOOF_REJECTED', 'PASSIVE_ANTI_SPOOF_DETECTED_REPLAY', $payload, $config);
        }

        $activePassed = $payload['active_liveness_passed'] ?? true;
        if (!$activePassed) {
            return $this->finalizeDecision('RETRY', 'ACTIVE_LIVENESS_CHALLENGE_FAILED', $payload, $config);
        }

        $capturedFrames = (int) ($payload['captured_frames'] ?? 1);
        $consistentFrames = (int) ($payload['consistent_frames'] ?? $capturedFrames);
        $minConsistent = (int) ($config['min_consistent_frames'] ?? 4);

        if ($capturedFrames > 1 && $consistentFrames < $minConsistent) {
            return $this->finalizeDecision('RETRY', 'INCONSISTENT_FRAMES_BETWEEN_CAPTURES', $payload, $config);
        }

        $top1Score = isset($payload['top1_score']) ? (float) $payload['top1_score'] : 0.0;
        $top2Score = isset($payload['top2_score']) ? (float) $payload['top2_score'] : 0.0;
        $margin = $top1Score - $top2Score;

        if ($top1Score < $config['match_threshold']) {
            return $this->finalizeDecision('UNKNOWN', 'SCORE_BELOW_THRESHOLD', $payload, $config);
        }

        if (isset($payload['top2_employee_id']) && $payload['top2_employee_id'] && $margin < $config['margin_threshold']) {
            return $this->finalizeDecision('RETRY', 'MARGIN_TOO_CLOSE_AMBIGUOUS_CANDIDATE', $payload, $config);
        }

        return $this->finalizeDecision('VERIFIED', null, $payload, $config);
    }

    protected function finalizeDecision(
        string $result,
        ?string $rejectReason,
        array $payload,
        array $config
    ): array {
        $sessionId = $payload['session_id'] ?? Str::uuid()->toString();
        $top1Id = $payload['top1_employee_id'] ?? null;
        $top2Id = $payload['top2_employee_id'] ?? null;
        $top1Score = isset($payload['top1_score']) ? (float) $payload['top1_score'] : null;
        $top2Score = isset($payload['top2_score']) ? (float) $payload['top2_score'] : null;
        $margin = ($top1Score !== null && $top2Score !== null) ? round($top1Score - $top2Score, 4) : null;

        $targetEmployeeId = ($result === 'VERIFIED') ? $top1Id : ($payload['employee_id'] ?? null);

        $attempt = FaceVerificationAttempt::create([
            'session_id' => $sessionId,
            'employee_id' => $targetEmployeeId,
            'top1_employee_id' => $top1Id,
            'top1_score' => $top1Score,
            'top2_employee_id' => $top2Id,
            'top2_score' => $top2Score,
            'score_margin' => $margin,
            'quality_score' => $payload['quality_score'] ?? null,
            'brightness_score' => $payload['brightness_score'] ?? null,
            'blur_score' => $payload['blur_score'] ?? null,
            'pose_yaw' => $payload['pose_yaw'] ?? null,
            'pose_pitch' => $payload['pose_pitch'] ?? null,
            'pose_roll' => $payload['pose_roll'] ?? null,
            'passive_spoof_score' => $payload['passive_spoof_score'] ?? null,
            'active_liveness_type' => $payload['active_liveness_type'] ?? null,
            'active_liveness_passed' => (bool) ($payload['active_liveness_passed'] ?? false),
            'captured_frames' => (int) ($payload['captured_frames'] ?? 1),
            'consistent_frames' => (int) ($payload['consistent_frames'] ?? 1),
            'result' => $result,
            'reject_reason' => $rejectReason,
            'model_name' => $payload['model_name'] ?? $config['model']['name'],
            'model_version' => $payload['model_version'] ?? $config['model']['version'],
            'kiosk_device_id' => $payload['kiosk_device_id'] ?? null,
            'kiosk_location_id' => $payload['kiosk_location_id'] ?? null,
        ]);

        $employeeData = null;
        if ($result === 'VERIFIED' && $targetEmployeeId) {
            $emp = Employee::find($targetEmployeeId);
            if ($emp) {
                $employeeData = [
                    'id' => $emp->id,
                    'external_karyawan_id' => $emp->external_karyawan_id,
                    'id_karyawan' => $emp->id_karyawan,
                    'id_absensi' => $emp->id_absensi,
                    'nama_karyawan' => $emp->nama_karyawan,
                    'company_id' => $emp->company_id,
                    'proyek_id' => $emp->proyek_id,
                    'cabang_id' => $emp->cabang_id,
                ];
            }
        }

        return [
            'result' => $result,
            'reject_reason' => $rejectReason,
            'session_id' => $sessionId,
            'attempt_id' => $attempt->id,
            'top1_score' => $top1Score,
            'top2_score' => $top2Score,
            'score_margin' => $margin,
            'employee' => $employeeData,
        ];
    }
}
