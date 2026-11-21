import numpy as np
from .base import FaceRecognizer

class ArcFaceRecognizer(FaceRecognizer):
    def __init__(self, face_analysis_app=None):
        self.app = face_analysis_app

    def embedding(self, face_obj) -> np.ndarray:
        if hasattr(face_obj, "normed_embedding"):
            return self.normalize(face_obj.normed_embedding)
        if hasattr(face_obj, "embedding"):
            return self.normalize(face_obj.embedding)
        raise ValueError("unsupported_face_object")
