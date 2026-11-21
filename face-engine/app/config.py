import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    model_config = {
        "protected_namespaces": (),
        "extra": "ignore",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }

    app_name: str = "FaceEngine"
    app_env: str = "local"
    app_port: int = 8005
    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:8000,http://127.0.0.1:5173,http://localhost:8000"
    model_name: str = "buffalo_s"
    model_version: str = "arcface_r50_v1"
    models_dir: str = "./models"
    database_path: str = "./data/local_cache.sqlite3"

    sface_model_path: str = "models/face_recognition_sface_2021dec.onnx"
    yunet_model_path: str = "models/face_detection_yunet_2023mar.onnx"

    similarity_threshold: float = 0.65
    ambiguity_margin: float = 0.08
    top_k: int = 5

    capture_frame_count: int = 5
    min_consistent_frames: int = 4
    min_probe_stability: float = 0.70
    min_probe_quality: float = 60.0

    min_face_size: int = 70
    min_brightness: float = 25.0
    max_brightness: float = 230.0
    min_blur_score: float = 20.0
    max_yaw: float = 25.0
    max_pitch: float = 25.0
    max_roll: float = 25.0

    enable_liveness: bool = True
    enable_passive_anti_spoof: bool = True
    passive_spoof_threshold: float = 0.55
    second_model_required: bool = False
    sface_similarity_threshold: float = 0.363
    stage_b_top_n: int = 3
    confusable_threshold: float = 0.65
    biometric_shared_secret: str = "mooding_biometric_secure_secret_2026"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

settings = Settings()
