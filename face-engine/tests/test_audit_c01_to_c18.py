import numpy as np
from app.fusion import (
    l2_normalize,
    remove_embedding_outliers,
    weighted_fusion
)
from app.core.matcher import matcher
from app.decision import decide, DecisionInput

def test_c01_multi_pose_outlier_not_used():
    base = l2_normalize(np.random.randn(512).astype(np.float32))
    valid_front = l2_normalize(base + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.05)
    valid_left = l2_normalize(base + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.06)
    outlier_right = l2_normalize(np.random.randn(512).astype(np.float32) * -1.0)

    templates = [
        {"vector": valid_front.tolist(), "pose_label": "front", "quality_score": 95.0, "is_active": 1, "is_outlier": 0},
        {"vector": valid_left.tolist(), "pose_label": "left", "quality_score": 90.0, "is_active": 1, "is_outlier": 0},
        {"vector": outlier_right.tolist(), "pose_label": "right", "quality_score": 30.0, "is_active": 1, "is_outlier": 0},
    ]

    prototypes = matcher.build_prototypes_for_employee(1, templates)
    assert len(prototypes) > 0
    for p in prototypes:
        sim_to_outlier = float(np.dot(l2_normalize(p.vector), outlier_right))
        assert sim_to_outlier < 0.20
        assert p.prototype_type != "right"

def test_c02_all_templates_inactive_is_not_enrolled():
    v1 = l2_normalize(np.random.randn(512).astype(np.float32))
    v2 = l2_normalize(np.random.randn(512).astype(np.float32))

    inactive_templates = [
        {"vector": v1.tolist(), "pose_label": "front", "quality_score": 90.0, "is_active": 0, "is_outlier": 0},
        {"vector": v2.tolist(), "pose_label": "front", "quality_score": 85.0, "is_active": 1, "is_outlier": 1},
    ]

    prototypes = matcher.build_prototypes_for_employee(2, inactive_templates)
    assert len(prototypes) == 0

def test_c03_outlier_removal_fails_closed_when_all_fail():
    v1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    v2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    v3 = np.array([0.0, 0.0, 1.0], dtype=np.float32)

    kept_v, kept_q = remove_embedding_outliers([v1, v2, v3], [90.0, 90.0, 90.0], min_similarity=0.90)
    assert len(kept_v) == 0
    assert len(kept_q) == 0

def test_c07_second_model_required_fails_closed():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.88,
        top2_employee_id=2,
        top2_score=0.50,
        stage_b_score=0.88,
        second_model_accept=None,
        second_model_employee_id=None,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={"identity_threshold": 0.65},
        global_threshold=0.65,
        margin_threshold=0.08,
        second_model_required=True
    )
    decision, reason = decide(data)
    assert decision == "AMBIGUOUS"
    assert reason == "SECOND_MODEL_UNAVAILABLE"

def test_c10_c11_verify_claimed_no_double_counting_and_stability_check():
    probe = l2_normalize(np.random.randn(512).astype(np.float32))

    unstable_res = matcher.verify_claimed(
        probe_vector=probe,
        claimed_employee_id=1,
        probe_stability=0.50
    )
    assert unstable_res["decision"] == "RETRY"
    assert unstable_res["reject_reason"] == "UNSTABLE_PROBE"

def test_c18_quality_normalization_and_nan_check():
    vec_with_nan = np.array([np.nan, 1.0, 0.0], dtype=np.float32)
    try:
        l2_normalize(vec_with_nan)
        assert False
    except ValueError:
        assert True

    v1 = np.array([1.0, 0.0, 0.0], dtype=np.float32)
    v2 = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    fused = weighted_fusion([v1, v2], [100.0, 50.0])
    assert abs(float(np.linalg.norm(fused)) - 1.0) < 1e-6
    assert fused[0] > fused[1]
