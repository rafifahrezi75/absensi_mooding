from app.decision import decide, DecisionInput

def test_decision_engine_verified():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.85,
        top2_employee_id=2,
        top2_score=0.50,
        stage_b_score=0.85,
        second_model_accept=True,
        second_model_employee_id=1,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={"identity_threshold": 0.65, "nearest_impostor_score": 0.40},
        global_threshold=0.65,
        margin_threshold=0.08
    )
    decision, reason = decide(data)
    assert decision == "VERIFIED"
    assert reason == "STRONG_MATCH"

def test_decision_engine_unstable_probe():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.85,
        top2_employee_id=2,
        top2_score=0.50,
        stage_b_score=0.85,
        second_model_accept=True,
        second_model_employee_id=1,
        probe_quality=92.0,
        probe_stability=0.55,
        risk={"identity_threshold": 0.65},
        global_threshold=0.65,
        margin_threshold=0.08,
        min_stability=0.70
    )
    decision, reason = decide(data)
    assert decision == "RETRY"
    assert reason == "UNSTABLE_PROBE"

def test_decision_engine_unknown():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.55,
        top2_employee_id=2,
        top2_score=0.45,
        stage_b_score=0.55,
        second_model_accept=True,
        second_model_employee_id=1,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={"identity_threshold": 0.65},
        global_threshold=0.65,
        margin_threshold=0.08
    )
    decision, reason = decide(data)
    assert decision == "UNKNOWN"
    assert reason == "TOP1_BELOW_THRESHOLD"

def test_decision_engine_ambiguous_margin():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.78,
        top2_employee_id=2,
        top2_score=0.75,
        stage_b_score=0.78,
        second_model_accept=True,
        second_model_employee_id=1,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={"identity_threshold": 0.65},
        global_threshold=0.65,
        margin_threshold=0.08
    )
    decision, reason = decide(data)
    assert decision == "AMBIGUOUS"
    assert reason == "TOP1_TOP2_TOO_CLOSE"

def test_decision_engine_confusable_group():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.82,
        top2_employee_id=2,
        top2_score=0.72,
        stage_b_score=0.82,
        second_model_accept=True,
        second_model_employee_id=1,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={
            "identity_threshold": 0.65,
            "confusable_group_id": 99,
            "top2_confusable_group_id": 99
        },
        global_threshold=0.65,
        margin_threshold=0.08
    )
    decision, reason = decide(data)
    assert decision == "AMBIGUOUS"
    assert reason == "CONFUSABLE_GROUP_COLLISION"

def test_decision_engine_model_disagreement():
    data = DecisionInput(
        top1_employee_id=1,
        top1_score=0.85,
        top2_employee_id=2,
        top2_score=0.50,
        stage_b_score=0.85,
        second_model_accept=True,
        second_model_employee_id=2,
        probe_quality=92.0,
        probe_stability=0.95,
        risk={"identity_threshold": 0.65},
        global_threshold=0.65,
        margin_threshold=0.08,
        second_model_required=True
    )
    decision, reason = decide(data)
    assert decision == "AMBIGUOUS"
    assert reason == "MODEL_DISAGREEMENT"
