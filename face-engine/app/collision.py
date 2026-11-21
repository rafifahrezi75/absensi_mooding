from typing import Dict, List, Tuple, Optional, Any
import numpy as np
from app.fusion import l2_normalize

def build_collision_map(
    employee_vectors: Dict[int, np.ndarray],
    top_k: int = 5,
    batch_size: int = 250
) -> Dict[int, List[Dict[str, float]]]:
    ids = list(employee_vectors.keys())
    n = len(ids)
    if n < 2:
        return {emp_id: [] for emp_id in ids}

    matrix = np.stack([l2_normalize(employee_vectors[i]) for i in ids]).astype(np.float32)
    output: Dict[int, List[Dict[str, float]]] = {}
    actual_k = min(top_k, n - 1)

    for start_idx in range(0, n, batch_size):
        end_idx = min(start_idx + batch_size, n)
        batch_vecs = matrix[start_idx:end_idx]
        batch_sims = batch_vecs @ matrix.T

        for row_rel in range(end_idx - start_idx):
            global_row = start_idx + row_rel
            batch_sims[row_rel, global_row] = -1.0
            order = np.argsort(-batch_sims[row_rel])[:actual_k]
            neighbors = [
                {
                    "employee_id": ids[index],
                    "score": round(float(batch_sims[row_rel, index]), 4)
                }
                for index in order
                if batch_sims[row_rel, index] > -0.9
            ]
            output[ids[global_row]] = neighbors

    return output

def find_confusable_groups(
    collision_map: Dict[int, List[Dict[str, float]]],
    confusable_threshold: float = 0.65
) -> Dict[int, int]:
    parent = {}

    def find(i):
        if parent[i] == i:
            return i
        parent[i] = find(parent[i])
        return parent[i]

    def union(i, j):
        root_i = find(i)
        root_j = find(j)
        if root_i != root_j:
            parent[root_j] = root_i

    for emp_id in collision_map:
        parent[emp_id] = emp_id

    for emp_id, neighbors in collision_map.items():
        for n in neighbors:
            if n["score"] >= confusable_threshold:
                union(emp_id, n["employee_id"])

    groups = {}
    for emp_id in collision_map:
        groups[emp_id] = find(emp_id)
    return groups

def calculate_identity_risks(
    employee_vectors: Dict[int, np.ndarray],
    base_threshold: float = 0.65,
    margin_buffer: float = 0.05
) -> Dict[int, Dict[str, Any]]:
    collision_map = build_collision_map(employee_vectors, top_k=5)
    confusable_groups = find_confusable_groups(collision_map, confusable_threshold=0.65)

    risks = {}
    for emp_id, neighbors in collision_map.items():
        nearest_impostor_id = None
        nearest_score = 0.0
        if neighbors:
            nearest_impostor_id = neighbors[0]["employee_id"]
            nearest_score = neighbors[0]["score"]

        if nearest_score >= 0.75:
            risk_level = "CRITICAL"
        elif nearest_score >= 0.65:
            risk_level = "HIGH"
        elif nearest_score >= 0.55:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        req_sec = nearest_score >= 0.70
        identity_threshold = base_threshold

        risks[emp_id] = {
            "employee_id": emp_id,
            "nearest_impostor_id": nearest_impostor_id,
            "nearest_impostor_score": nearest_score,
            "identity_threshold": identity_threshold,
            "requires_secondary_verification": req_sec,
            "risk_level": risk_level,
            "confusable_group_id": confusable_groups.get(emp_id),
            "top_impostors": neighbors
        }
    return risks

def check_enrollment_cross_contamination(
    candidate_vector: np.ndarray,
    current_emp_id: int,
    other_employee_vectors: Dict[int, np.ndarray],
    contamination_threshold: float = 0.70
) -> Tuple[bool, Optional[int], float]:
    if not other_employee_vectors:
        return False, None, 0.0

    cand_norm = l2_normalize(candidate_vector)
    max_sim = -1.0
    conflicting_id = None

    for other_id, vec in other_employee_vectors.items():
        if other_id == current_emp_id:
            continue
        sim = float(np.dot(cand_norm, l2_normalize(vec)))
        if sim > max_sim:
            max_sim = sim
            conflicting_id = other_id

    if max_sim >= contamination_threshold:
        return True, conflicting_id, round(max_sim, 4)
    return False, conflicting_id, round(max_sim, 4)
