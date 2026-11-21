<?php

return [
    'match_threshold' => (float) env('FACE_MATCH_THRESHOLD', 0.65),
    'margin_threshold' => (float) env('FACE_MARGIN_THRESHOLD', 0.08),
    'capture_frame_count' => (int) env('FACE_CAPTURE_FRAME_COUNT', 5),
    'min_consistent_frames' => (int) env('FACE_MIN_CONSISTENT_FRAMES', 4),

    'quality' => [
        'min_face_size' => (int) env('FACE_MIN_SIZE_PX', 85),
        'min_brightness' => (float) env('FACE_MIN_BRIGHTNESS', 40.0),
        'max_brightness' => (float) env('FACE_MAX_BRIGHTNESS', 230.0),
        'min_blur_score' => (float) env('FACE_MIN_LAPLACIAN_VAR', 50.0),
        'max_yaw' => (float) env('FACE_MAX_YAW_DEG', 20.0),
        'max_pitch' => (float) env('FACE_MAX_PITCH_DEG', 20.0),
        'max_roll' => (float) env('FACE_MAX_ROLL_DEG', 20.0),
    ],

    'liveness' => [
        'passive_anti_spoof_enabled' => (bool) env('FACE_PASSIVE_ANTI_SPOOF', true),
        'passive_spoof_threshold' => (float) env('FACE_PASSIVE_SPOOF_THRESHOLD', 0.45),
        'active_liveness_enabled' => (bool) env('FACE_ACTIVE_LIVENESS', true),
        'allowed_challenges' => ['BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'OPEN_MOUTH'],
        'challenge_timeout_seconds' => (int) env('FACE_CHALLENGE_TIMEOUT_SECONDS', 8),
    ],

    'model' => [
        'name' => env('FACE_MODEL_NAME', 'buffalo_s'),
        'version' => env('FACE_MODEL_VERSION', 'arcface_r50_v1'),
    ],

    'shared_secret' => env('BIOMETRIC_SHARED_SECRET', 'mooding_biometric_secure_secret_2026'),
];
