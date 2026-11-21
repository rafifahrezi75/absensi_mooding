from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from app.fusion import l2_normalize

try:
    import faiss
except (ImportError, OSError):
    faiss = None


class NumpyFlatIP:
    def __init__(self, dimension: int):
        self.dimension = dimension
        self.matrix = np.empty((0, dimension), dtype=np.float32)

    @property
    def ntotal(self) -> int:
        return int(self.matrix.shape[0])

    def add(self, matrix: np.ndarray) -> None:
        normalized = np.asarray(matrix, dtype=np.float32)
        if normalized.ndim != 2 or normalized.shape[1] != self.dimension:
            raise ValueError("invalid_gallery_matrix")
        self.matrix = normalized.copy()

    def search(self, query: np.ndarray, limit: int):
        if self.ntotal == 0 or limit <= 0:
            return (
                np.empty((1, 0), dtype=np.float32),
                np.empty((1, 0), dtype=np.int64),
            )

        scores = self.matrix @ query.reshape(-1)
        actual_limit = min(limit, self.ntotal)
        if actual_limit == self.ntotal:
            indices = np.argsort(-scores)
        else:
            partition = np.argpartition(-scores, actual_limit - 1)[:actual_limit]
            indices = partition[np.argsort(-scores[partition])]
        return scores[indices].reshape(1, -1), indices.astype(np.int64).reshape(1, -1)

@dataclass
class Prototype:
    employee_id: int
    vector: np.ndarray
    quality: float = 1.0
    prototype_type: str = "default"

@dataclass
class IdentityResult:
    employee_id: int
    score: float
    prototype_scores: List[float] = field(default_factory=list)

class ExactIdentityGallery:
    def __init__(self, dimension: int = 512):
        self.dimension = dimension
        self.index = self._new_index()
        self.backend = "faiss" if faiss is not None else "numpy"
        self.prototypes: List[Prototype] = []
        self.employee_templates: Dict[int, List[Dict[str, Any]]] = {}
        self.allowed_indexes: Dict[tuple, tuple[Any, List[int]]] = {}

    def _new_index(self):
        if faiss is not None:
            return faiss.IndexFlatIP(self.dimension)
        return NumpyFlatIP(self.dimension)

    def rebuild(
        self,
        prototypes: List[Prototype],
        employee_templates: Optional[Dict[int, List[Dict[str, Any]]]] = None
    ):
        self.prototypes = prototypes
        self.employee_templates = employee_templates or {}
        self.allowed_indexes = {}
        self.index = self._new_index()
        if not prototypes:
            return
        matrix = np.stack([l2_normalize(p.vector) for p in prototypes]).astype(np.float32)
        self.index.add(matrix)

    def search(
        self,
        probe: np.ndarray,
        top_identity_k: int = 5,
        allowed_employee_ids: Optional[List[int]] = None
    ) -> List[IdentityResult]:
        if not self.prototypes or self.index.ntotal == 0:
            return []

        query = l2_normalize(probe).reshape(1, -1).astype(np.float32)
        allowed_set = set(allowed_employee_ids) if allowed_employee_ids is not None else None

        if allowed_set is not None:
            cache_key = tuple(sorted(allowed_set))
            cached_index = self.allowed_indexes.get(cache_key)
            if cached_index is None:
                allowed_indices = [
                    index
                    for index, prototype in enumerate(self.prototypes)
                    if prototype.employee_id in allowed_set
                ]
                if not allowed_indices:
                    return []

                allowed_matrix = np.stack([
                    l2_normalize(self.prototypes[index].vector)
                    for index in allowed_indices
                ]).astype(np.float32)
                allowed_index = self._new_index()
                allowed_index.add(allowed_matrix)
                if len(self.allowed_indexes) >= 64:
                    self.allowed_indexes.clear()
                self.allowed_indexes[cache_key] = (allowed_index, allowed_indices)
            else:
                allowed_index, allowed_indices = cached_index

            if not allowed_indices:
                return []
            prototype_k = min(len(allowed_indices), max(top_identity_k * 8, 32))
            scores, local_indices = allowed_index.search(query, prototype_k)
            indices = np.asarray([
                [allowed_indices[int(index)] for index in local_indices[0]]
            ], dtype=np.int64)
        else:
            prototype_k = min(len(self.prototypes), max(top_identity_k * 8, 32))
            scores, indices = self.index.search(query, prototype_k)

        grouped: Dict[int, List[float]] = {}

        for score, index in zip(scores[0], indices[0]):
            if index < 0 or index >= len(self.prototypes):
                continue
            p = self.prototypes[index]
            emp_id = p.employee_id
            grouped.setdefault(emp_id, []).append(float(score))

        results = []
        for emp_id, s_list in grouped.items():
            ordered = sorted(s_list, reverse=True)
            candidate_score = float(ordered[0])
            results.append(IdentityResult(emp_id, candidate_score, ordered))

        results.sort(key=lambda item: item.score, reverse=True)
        return results[:top_identity_k]

    def stage_b_rerank(
        self,
        probe: np.ndarray,
        candidate_ids: List[int],
        top_n: int = 3
    ) -> Dict[int, float]:
        norm_probe = l2_normalize(probe)
        reranked: Dict[int, float] = {}

        for emp_id in candidate_ids:
            templates = [
                t for t in self.employee_templates.get(emp_id, [])
                if t.get("is_active", 1) and not t.get("is_outlier", 0)
            ]

            if not templates:
                emp_protos = [p for p in self.prototypes if p.employee_id == emp_id]
                if not emp_protos:
                    reranked[emp_id] = 0.0
                    continue
                proto_sims = [float(np.dot(norm_probe, l2_normalize(p.vector))) for p in emp_protos]
                reranked[emp_id] = float(np.mean(proto_sims))
                continue

            values = []
            for t in templates:
                vec = np.asarray(t["vector"], dtype=np.float32)
                raw_qual = float(t.get("quality_score", 1.0))
                qual = raw_qual / 100.0 if raw_qual > 1.0 else raw_qual
                norm_vec = l2_normalize(vec)
                sim = float(np.dot(norm_probe, norm_vec))
                values.append((sim, qual))

            values.sort(key=lambda x: x[0], reverse=True)
            selected = values[:min(top_n, len(values))]
            scores = np.asarray([x[0] for x in selected], dtype=np.float32)
            weights = np.asarray([max(x[1], 1e-4) for x in selected], dtype=np.float32)
            weights = weights / weights.sum()
            reranked[emp_id] = float(np.sum(scores * weights))

        return reranked
