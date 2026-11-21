import numpy as np
from app.fusion import l2_normalize
from app.gallery import ExactIdentityGallery, Prototype

def test_exact_identity_gallery():
    gallery = ExactIdentityGallery(dimension=512)

    emp1_vec = l2_normalize(np.random.randn(512).astype(np.float32))
    emp2_vec = l2_normalize(np.random.randn(512).astype(np.float32))
    emp3_vec = l2_normalize(np.random.randn(512).astype(np.float32))

    prototypes = [
        Prototype(employee_id=1, vector=emp1_vec, quality=95.0, prototype_type="front"),
        Prototype(employee_id=1, vector=l2_normalize(emp1_vec + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.1), quality=90.0, prototype_type="left"),
        Prototype(employee_id=2, vector=emp2_vec, quality=92.0, prototype_type="front"),
        Prototype(employee_id=3, vector=emp3_vec, quality=88.0, prototype_type="front"),
    ]

    employee_templates = {
        1: [
            {"vector": emp1_vec, "quality_score": 95.0},
            {"vector": l2_normalize(emp1_vec + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.1), "quality_score": 90.0}
        ],
        2: [{"vector": emp2_vec, "quality_score": 92.0}],
        3: [{"vector": emp3_vec, "quality_score": 88.0}],
    }

    gallery.rebuild(prototypes, employee_templates)
    assert gallery.index.ntotal == 4

    probe = l2_normalize(emp1_vec + l2_normalize(np.random.randn(512).astype(np.float32)) * 0.05)
    results = gallery.search(probe, top_identity_k=3)
    assert len(results) == 3
    assert results[0].employee_id == 1
    assert results[0].score > 0.90

    reranked = gallery.stage_b_rerank(probe, [r.employee_id for r in results])
    assert reranked[1] > 0.90
    assert reranked[1] > reranked[2]

    filtered_results = gallery.search(probe, top_identity_k=3, allowed_employee_ids=[2, 3])
    assert 1 not in [r.employee_id for r in filtered_results]
