import numpy as np

def l2_normalize(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    if not np.all(np.isfinite(vector)):
        raise ValueError("non_finite_vector")
    norm = np.linalg.norm(vector)
    if norm <= 1e-12:
        raise ValueError("invalid_vector")
    return vector / norm

def cosine_matrix(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float32)
    vectors = np.stack([l2_normalize(v) for v in vectors])
    return vectors @ vectors.T

def stability_score(vectors: np.ndarray) -> float:
    n = len(vectors)
    if n < 2:
        return 1.0 if n == 1 else 0.0
    matrix = cosine_matrix(vectors)
    values = matrix[np.triu_indices(n, 1)]
    return float(np.median(values))

def remove_embedding_outliers(
    vectors: list,
    qualities: list,
    min_similarity: float = 0.65
) -> tuple:
    if len(vectors) < 3:
        return vectors, qualities
    array = np.stack([l2_normalize(v) for v in vectors])
    center = l2_normalize(np.mean(array, axis=0))
    sims = array @ center
    keep = sims >= min_similarity
    if not np.any(keep):
        return [], []
    kept_vectors = [vectors[i] for i in range(len(vectors)) if keep[i]]
    kept_qualities = [qualities[i] for i in range(len(qualities)) if keep[i]]
    return kept_vectors, kept_qualities

def weighted_fusion(vectors: list, qualities: list) -> np.ndarray:
    if not vectors:
        raise ValueError("no_vectors")
    array = np.stack([l2_normalize(v) for v in vectors])
    weights = np.asarray(qualities, dtype=np.float32)
    weights = np.where(weights > 1.0, weights / 100.0, weights)
    weights = np.clip(weights, 1e-6, None)
    weights_sum = weights.sum()
    if weights_sum <= 0:
        weights = np.ones_like(weights) / len(weights)
    else:
        weights = weights / weights_sum
    fused = np.sum(array * weights[:, None], axis=0)
    return l2_normalize(fused)
