import numpy as np
from app.fusion import l2_normalize
from app.collision import (
    build_collision_map,
    find_confusable_groups,
    calculate_identity_risks,
    check_enrollment_cross_contamination
)

def test_collision_detection():
    v1 = l2_normalize(np.random.randn(512).astype(np.float32))
    v2 = l2_normalize(v1 + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.2)
    v3 = l2_normalize(np.random.randn(512).astype(np.float32))

    vectors = {1: v1, 2: v2, 3: v3}
    cmap = build_collision_map(vectors, top_k=2)

    assert len(cmap[1]) > 0
    assert cmap[1][0]["employee_id"] == 2
    assert cmap[1][0]["score"] > 0.70

    risks = calculate_identity_risks(vectors, base_threshold=0.65)
    assert risks[1]["nearest_impostor_id"] == 2
    assert risks[1]["risk_level"] in ["HIGH", "CRITICAL"]
    assert risks[1]["requires_secondary_verification"] is True
    assert risks[1]["identity_threshold"] == 0.65

def test_cross_employee_contamination():
    v_existing = l2_normalize(np.random.randn(512).astype(np.float32))
    existing_map = {101: v_existing}

    v_impostor = l2_normalize(v_existing + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.1)
    contaminated, conflict_id, sim = check_enrollment_cross_contamination(
        candidate_vector=v_impostor,
        current_emp_id=102,
        other_employee_vectors=existing_map,
        contamination_threshold=0.72
    )
    assert contaminated is True
    assert conflict_id == 101
    assert sim > 0.85

    v_different = l2_normalize(np.random.randn(512).astype(np.float32))
    contaminated2, _, sim2 = check_enrollment_cross_contamination(
        candidate_vector=v_different,
        current_emp_id=103,
        other_employee_vectors=existing_map,
        contamination_threshold=0.72
    )
    assert contaminated2 is False
    assert sim2 < 0.50
