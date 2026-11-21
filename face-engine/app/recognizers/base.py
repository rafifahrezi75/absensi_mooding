from abc import ABC, abstractmethod
import numpy as np

class FaceRecognizer(ABC):
    @abstractmethod
    def embedding(self, face_data) -> np.ndarray:
        raise NotImplementedError

    def normalize(self, vector: np.ndarray) -> np.ndarray:
        vector = np.asarray(vector, dtype=np.float32).reshape(-1)
        norm = np.linalg.norm(vector)
        if norm <= 1e-12:
            raise ValueError("invalid_embedding")
        return vector / norm
