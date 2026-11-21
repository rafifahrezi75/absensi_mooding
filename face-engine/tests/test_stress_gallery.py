import time
import numpy as np
from app.fusion import l2_normalize
from app.gallery import ExactIdentityGallery, Prototype
from app.collision import calculate_identity_risks

def test_gallery_stress_scale():
    sizes = [50, 100, 250, 500, 1000]
    dimension = 512

    for n in sizes:
        gallery = ExactIdentityGallery(dimension=dimension)
        prototypes = []
        vectors_map = {}

        for emp_id in range(1, n + 1):
            base_vec = l2_normalize(np.random.randn(dimension).astype(np.float32))
            vectors_map[emp_id] = base_vec
            prototypes.append(Prototype(
                employee_id=emp_id,
                vector=base_vec,
                quality=90.0,
                prototype_type="front"
            ))

        start_rebuild = time.time()
        gallery.rebuild(prototypes)
        rebuild_time = (time.time() - start_rebuild) * 1000

        target_id = n // 2
        probe = l2_normalize(vectors_map[target_id] + 0.05 * np.random.randn(dimension).astype(np.float32))

        start_search = time.time()
        results = gallery.search(probe, top_identity_k=5)
        search_time = (time.time() - start_search) * 1000

        assert len(results) == 5
        assert results[0].employee_id == target_id
        assert search_time < 50.0

    print("Stress test up to N=1000 passed cleanly!")
