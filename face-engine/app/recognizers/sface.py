import os
import cv2
import numpy as np
from .base import FaceRecognizer

class SFaceRecognizer(FaceRecognizer):
    def __init__(self, model_path: str = "models/face_recognition_sface_2021dec.onnx"):
        if not os.path.exists(model_path):
            alt_path = os.path.join(os.path.dirname(__file__), "..", "..", model_path)
            if os.path.exists(alt_path):
                model_path = alt_path
        self.model = cv2.FaceRecognizerSF.create(model_path, "")

    def align_crop(self, img_bgr: np.ndarray, face_info: np.ndarray) -> np.ndarray:
        return self.model.alignCrop(img_bgr, face_info)

    def embedding(self, aligned_face: np.ndarray) -> np.ndarray:
        if aligned_face.shape[:2] != (112, 112):
            aligned_face = cv2.resize(aligned_face, (112, 112))
        feature = self.model.feature(aligned_face)
        return self.normalize(feature)
