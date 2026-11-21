import numpy as np
from app.fusion import (
    l2_normalize,
    stability_score,
    remove_embedding_outliers,
    weighted_fusion,
    cosine_matrix
)

def test_l2_normalize():
    vec = np.array([3.0, 4.0, 0.0], dtype=np.float32)
    normed = l2_normalize(vec)
    assert abs(float(np.linalg.norm(normed)) - 1.0) < 1e-6
    assert abs(normed[0] - 0.6) < 1e-6
    assert abs(normed[1] - 0.8) < 1e-6

def test_stability_score():
    base = l2_normalize(np.random.randn(512).astype(np.float32))
    similar_frames = [
        l2_normalize(base + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.05)
        for _ in range(5)
    ]
    stab = stability_score(similar_frames)
    assert stab > 0.95

    unstable_frames = [
        l2_normalize(np.random.randn(512).astype(np.float32))
        for _ in range(5)
    ]
    unstab = stability_score(unstable_frames)
    assert unstab < 0.40

def test_remove_embedding_outliers():
    base = l2_normalize(np.random.randn(512).astype(np.float32))
    inliers = [
        l2_normalize(base + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.05)
        for _ in range(4)
    ]
    outlier = l2_normalize(np.random.randn(512).astype(np.float32) * -1.0)
    all_vectors = inliers + [outlier]
    all_qualities = [90.0, 92.0, 89.0, 95.0, 40.0]

    kept_vecs, kept_quals = remove_embedding_outliers(
        all_vectors,
        all_qualities,
        min_similarity=0.60
    )
    assert len(kept_vecs) == 4
    assert len(kept_quals) == 4
    assert 40.0 not in kept_quals

def test_weighted_fusion():
    v1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    v2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    vectors = [v1, v2]
    qualities = [90.0, 10.0]

    fused = weighted_fusion(vectors, qualities)
    assert abs(float(np.linalg.norm(fused)) - 1.0) < 1e-6
    assert fused[0] > fused[1]
