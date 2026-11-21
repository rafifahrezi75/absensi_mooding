from dataclasses import dataclass
from typing import Optional, Tuple, Dict, Any

@dataclass
class DecisionInput:
    top1_employee_id: Optional[int]
    top1_score: float
    top2_employee_id: Optional[int]
    top2_score: float
    stage_b_score: float
    second_model_accept: bool
    second_model_employee_id: Optional[int]
    probe_quality: float
    probe_stability: float
    risk: Dict[str, Any]
    global_threshold: float = 0.65
    margin_threshold: float = 0.08
    min_quality: float = 60.0
    min_stability: float = 0.70
    second_model_required: bool = False

def decide(data: DecisionInput) -> Tuple[str, str]:
    if data.probe_quality < data.min_quality:
        return "QUALITY_REJECTED", "LOW_PROBE_QUALITY"

    if data.probe_stability < data.min_stability:
        return "RETRY", "UNSTABLE_PROBE"

    if data.top1_employee_id is None:
        return "UNKNOWN", "NO_CANDIDATE_FOUND"

    effective_threshold = max(
        data.global_threshold,
        float(data.risk.get("identity_threshold", data.global_threshold))
    )

    if data.top1_score < effective_threshold:
        return "UNKNOWN", "TOP1_BELOW_THRESHOLD"

    if data.stage_b_score < effective_threshold:
        return "UNKNOWN", "STAGE_B_BELOW_THRESHOLD"

    margin = data.top1_score - data.top2_score
    if data.top2_employee_id is not None:
        if margin < data.margin_threshold:
            return "AMBIGUOUS", "TOP1_TOP2_TOO_CLOSE"

        top1_grp = data.risk.get("confusable_group_id")
        top2_grp = data.risk.get("top2_confusable_group_id")
        if top1_grp is not None and top2_grp is not None and top1_grp == top2_grp:
            if margin < (data.margin_threshold * 1.5):
                return "AMBIGUOUS", "CONFUSABLE_GROUP_COLLISION"

    if data.risk.get("requires_secondary_verification", False):
        return "AMBIGUOUS", "SECONDARY_VERIFICATION_REQUIRED"

    nearest_score = float(data.risk.get("nearest_impostor_score", 0.0))
    if nearest_score >= 0.70 and margin < (data.margin_threshold * 1.5):
        return "AMBIGUOUS", "HIGH_COLLISION_RISK"

    if data.second_model_required:
        if data.second_model_accept is None:
            return "AMBIGUOUS", "SECOND_MODEL_UNAVAILABLE"
        if not data.second_model_accept:
            return "AMBIGUOUS", "SECOND_MODEL_REJECTED"
        if data.second_model_employee_id != data.top1_employee_id:
            return "AMBIGUOUS", "MODEL_DISAGREEMENT"

    return "VERIFIED", "STRONG_MATCH"
