import cv2
import numpy as np
from typing import Tuple, Dict, Any, Optional
from app.config import settings

def check_frame_quality(
    img_bgr: np.ndarray,
    face: Optional[Any] = None
) -> Tuple[bool, str, str, Dict[str, float]]:
    metrics = {
        "brightness": 0.0,
        "blur_score": 0.0,
        "face_width": 0.0,
        "face_height": 0.0,
        "yaw": 0.0,
        "pitch": 0.0,
        "roll": 0.0,
        "quality_score": 0.0
    }

    if img_bgr is None or img_bgr.size == 0:
        return False, "FACE_QUALITY_FAILED", "Gambar frame kosong", metrics

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    mean_val = float(np.mean(gray))
    metrics["brightness"] = round(mean_val, 2)

    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    metrics["blur_score"] = round(laplacian_var, 2)

    if mean_val < settings.min_brightness:
        return False, "FACE_TOO_DARK", "Pencahayaan kurang, dekatkan wajah ke sumber cahaya", metrics

    if mean_val > settings.max_brightness:
        return False, "FACE_TOO_BRIGHT", "Pencahayaan terlalu terang atau silau", metrics

    if laplacian_var < settings.min_blur_score:
        return False, "FACE_BLURRY", "Gambar kabur, tahan posisi wajah sebentar", metrics

    if face is not None:
        bbox = face.bbox
        w = float(bbox[2] - bbox[0])
        h = float(bbox[3] - bbox[1])
        metrics["face_width"] = round(w, 1)
        metrics["face_height"] = round(h, 1)

        img_h, img_w = img_bgr.shape[:2]

        if w < settings.min_face_size or h < settings.min_face_size:
            return False, "FACE_TOO_FAR", "Dekatkan wajah ke kamera", metrics

        if w > 0.85 * img_w or h > 0.85 * img_h:
            return False, "FACE_TOO_CLOSE", "Mundurkan sedikit wajah dari kamera", metrics

        if hasattr(face, "pose") and face.pose is not None and len(face.pose) >= 3:
            pitch = float(face.pose[0])
            yaw = float(face.pose[1])
            roll = float(face.pose[2])
            metrics["pitch"] = round(pitch, 2)
            metrics["yaw"] = round(yaw, 2)
            metrics["roll"] = round(roll, 2)

            if abs(yaw) > settings.max_yaw or abs(pitch) > settings.max_pitch or abs(roll) > settings.max_roll:
                return False, "POSE_INVALID", "Hadapkan wajah tegak lurus ke kamera", metrics

    score = 100.0
    if metrics["blur_score"] < 100.0:
        score -= (100.0 - metrics["blur_score"]) * 0.3
    if metrics["brightness"] < 80.0:
        score -= (80.0 - metrics["brightness"]) * 0.3
    elif metrics["brightness"] > 180.0:
        score -= (metrics["brightness"] - 180.0) * 0.3
    if abs(metrics["yaw"]) > 10.0:
        score -= (abs(metrics["yaw"]) - 10.0) * 1.5

    metrics["quality_score"] = round(max(10.0, min(100.0, score)), 2)
    return True, "OK", "", metrics

def check_image_quality(img_bgr: np.ndarray) -> Tuple[bool, str, str]:
    is_valid, code, msg, _ = check_frame_quality(img_bgr, None)
    return is_valid, code, msg
