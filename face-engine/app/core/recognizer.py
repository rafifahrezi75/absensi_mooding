import os
import cv2
import numpy as np
from typing import Tuple, Optional, Any
from app.config import settings
from app.recognizers.sface import SFaceRecognizer

class FaceRecognizer:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FaceRecognizer, cls).__new__(cls)
            cls._instance.initialized = False
            cls._instance.app = None
            cls._instance.sface = None
        return cls._instance

    def initialize(self):
        if self.initialized:
            return
        os.makedirs(settings.models_dir, exist_ok=True)
        from insightface.app import FaceAnalysis
        self.app = FaceAnalysis(
            name=settings.model_name,
            root=settings.models_dir,
            providers=["CPUExecutionProvider"]
        )
        self.app.prepare(ctx_id=-1, det_size=(640, 640))
        try:
            self.sface = SFaceRecognizer(settings.sface_model_path)
        except Exception:
            self.sface = None
        self.initialized = True

    def extract_face(self, img_bgr: np.ndarray) -> Tuple[str, Optional[Any]]:
        if not self.initialized:
            self.initialize()

        if img_bgr is None or img_bgr.size == 0:
            return "no_face", None

        faces = self.app.get(img_bgr)
        if len(faces) == 0:
            return "no_face", None

        valid_faces = []
        for face in faces:
            width = face.bbox[2] - face.bbox[0]
            height = face.bbox[3] - face.bbox[1]
            if face.det_score >= 0.60 and width >= 70:
                valid_faces.append((face, width * height))

        if len(valid_faces) == 0:
            return "no_face", None

        valid_faces.sort(key=lambda x: x[1], reverse=True)
        if len(valid_faces) > 1:
            largest_area = valid_faces[0][1]
            second_area = valid_faces[1][1]
            if second_area >= 0.35 * largest_area:
                return "multiple_faces", None

        return "ok", valid_faces[0][0]

    def get_embedding(self, face: Any) -> np.ndarray:
        emb = face.normed_embedding.astype(np.float32)
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb = emb / norm
        return emb

    def get_sface_embedding(self, img_bgr: np.ndarray, face: Any) -> Optional[np.ndarray]:
        if self.sface is None or face is None:
            return None
        try:
            bbox = face.bbox
            x1, y1 = float(bbox[0]), float(bbox[1])
            w = float(bbox[2] - bbox[0])
            h = float(bbox[3] - bbox[1])
            kps = face.kps
            det_score = float(getattr(face, "det_score", 0.9))

            face_info = np.array([
                x1, y1, w, h,
                float(kps[0][0]), float(kps[0][1]),
                float(kps[1][0]), float(kps[1][1]),
                float(kps[2][0]), float(kps[2][1]),
                float(kps[3][0]), float(kps[3][1]),
                float(kps[4][0]), float(kps[4][1]),
                det_score
            ], dtype=np.float32)

            aligned = self.sface.align_crop(img_bgr, face_info)
            return self.sface.embedding(aligned)
        except Exception:
            return None

recognizer = FaceRecognizer()
