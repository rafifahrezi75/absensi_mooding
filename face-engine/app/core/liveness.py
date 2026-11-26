import cv2
import numpy as np
from typing import List, Tuple
import mediapipe as mp
from app.config import settings

mp_face_mesh = mp.solutions.face_mesh

def calculate_ear(landmarks, eye_indices, img_w, img_h) -> float:
    p1 = np.array([landmarks[eye_indices[0]].x * img_w, landmarks[eye_indices[0]].y * img_h])
    p2 = np.array([landmarks[eye_indices[1]].x * img_w, landmarks[eye_indices[1]].y * img_h])
    p3 = np.array([landmarks[eye_indices[2]].x * img_w, landmarks[eye_indices[2]].y * img_h])
    p4 = np.array([landmarks[eye_indices[3]].x * img_w, landmarks[eye_indices[3]].y * img_h])
    p5 = np.array([landmarks[eye_indices[4]].x * img_w, landmarks[eye_indices[4]].y * img_h])
    p6 = np.array([landmarks[eye_indices[5]].x * img_w, landmarks[eye_indices[5]].y * img_h])

    v1 = np.linalg.norm(p2 - p6)
    v2 = np.linalg.norm(p3 - p5)
    h = np.linalg.norm(p1 - p4)
    if h == 0:
        return 0.0
    return float((v1 + v2) / (2.0 * h))

def calculate_mar(landmarks, img_w, img_h) -> float:
    p_top = np.array([landmarks[13].x * img_w, landmarks[13].y * img_h])
    p_bot = np.array([landmarks[14].x * img_w, landmarks[14].y * img_h])
    p_left = np.array([landmarks[78].x * img_w, landmarks[78].y * img_h])
    p_right = np.array([landmarks[308].x * img_w, landmarks[308].y * img_h])

    v = np.linalg.norm(p_top - p_bot)
    h = np.linalg.norm(p_left - p_right)
    if h == 0:
        return 0.0
    return float(v / h)

def calculate_passive_spoof_score(face_crop: np.ndarray) -> float:
    if face_crop is None or face_crop.size == 0 or face_crop.shape[0] < 20 or face_crop.shape[1] < 20:
        return 0.0

    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    f = np.fft.fft2(gray)
    fshift = np.fft.fftshift(f)
    magnitude = 20 * np.log(np.abs(fshift) + 1e-6)

    cy, cx = h // 2, w // 2
    r_inner = min(h, w) // 6
    r_outer = min(h, w) // 3

    y, x = np.ogrid[:h, :w]
    dist_from_center = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)

    mask_high = dist_from_center > r_outer
    mask_low = dist_from_center <= r_inner

    high_freq_power = float(np.mean(magnitude[mask_high])) if np.any(mask_high) else 0.0
    low_freq_power = float(np.mean(magnitude[mask_low])) if np.any(mask_low) else 1.0

    freq_ratio = high_freq_power / (low_freq_power + 1e-6)

    ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)
    cr = ycrcb[:, :, 1]
    cb = ycrcb[:, :, 2]
    cr_std = float(np.std(cr))
    cb_std = float(np.std(cb))
    chroma_var = cr_std * cb_std

    spoof_points = 0.0

    if freq_ratio > 1.15 or freq_ratio < 0.15:
        spoof_points += 0.30

    if chroma_var < 8.0 or chroma_var > 800.0:
        spoof_points += 0.30

    hsv = cv2.cvtColor(face_crop, cv2.COLOR_BGR2HSV)
    val_channel = hsv[:, :, 2]
    specular_pixels = np.sum(val_channel > 248) / float(h * w)
    if specular_pixels > 0.20:
        spoof_points += 0.25

    return round(min(1.0, max(0.0, spoof_points)), 4)

def verify_active_challenge(
    frames_bgr: List[np.ndarray],
    challenge_type: str = "BLINK"
) -> Tuple[bool, str]:
    if not settings.enable_liveness:
        return True, "liveness_disabled"

    if len(frames_bgr) < 2:
        return False, "insufficient_frames"

    left_eye_indices = [362, 385, 387, 263, 373, 380]
    right_eye_indices = [33, 160, 158, 133, 153, 144]

    ears = []
    mars = []
    nose_x_positions = []

    with mp_face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as face_mesh:
        for frame in frames_bgr:
            h, w, _ = frame.shape
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(frame_rgb)

            if not results.multi_face_landmarks:
                continue

            landmarks = results.multi_face_landmarks[0].landmark
            l_ear = calculate_ear(landmarks, left_eye_indices, w, h)
            r_ear = calculate_ear(landmarks, right_eye_indices, w, h)
            ears.append((l_ear + r_ear) / 2.0)
            mars.append(calculate_mar(landmarks, w, h))
            nose_x_positions.append(landmarks[1].x)

    if len(ears) < 2:
        return False, "face_not_tracked_in_frames"

    c_type = challenge_type.upper()

    if c_type == "BLINK":
        min_ear = min(ears)
        max_ear = max(ears)
        if min_ear < 0.21 and max_ear > 0.25:
            return True, "blink_verified"
        if (max_ear - min_ear) > 0.04:
            return True, "eye_movement_verified"
        return False, "blink_failed"

    elif c_type == "OPEN_MOUTH":
        max_mar = max(mars) if mars else 0.0
        min_mar = min(mars) if mars else 0.0
        if max_mar > 0.42 and (max_mar - min_mar) > 0.15:
            return True, "open_mouth_verified"
        return False, "open_mouth_failed"

    elif c_type in ["HEAD_TURN", "TURN_LEFT_OR_RIGHT"]:
        if len(nose_x_positions) >= 2:
            delta_x = max(nose_x_positions) - min(nose_x_positions)
            if delta_x > 0.02:
                return True, "head_turn_verified"
        return False, "head_turn_failed"

    elif c_type == "TURN_LEFT":
        if len(nose_x_positions) >= 2:
            delta_x = nose_x_positions[-1] - nose_x_positions[0]
            if delta_x < -0.025:
                return True, "turn_left_verified"
        return False, "turn_left_failed"

    elif c_type == "TURN_RIGHT":
        if len(nose_x_positions) >= 2:
            delta_x = nose_x_positions[-1] - nose_x_positions[0]
            if delta_x > 0.025:
                return True, "turn_right_verified"
        return False, "turn_right_failed"

    min_ear = min(ears)
    max_ear = max(ears)
    if min_ear < 0.21 and max_ear > 0.25:
        return True, "blink_verified"

    return False, "challenge_not_met"

def verify_liveness(frames_bgr: List[np.ndarray]) -> Tuple[bool, str]:
    return verify_active_challenge(frames_bgr, "BLINK")
