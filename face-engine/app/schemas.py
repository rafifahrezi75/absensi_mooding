from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class HealthResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    status: str
    model_name: str
    model_version: str
    model_loaded: bool
    second_model_loaded: bool
    liveness_enabled: bool
    passive_anti_spoof_enabled: bool
    cached_employees: int
    cached_vectors: int
    cached_prototypes: int
    collision_risks_calculated: int
    server_time: str

class SyncEmployee(BaseModel):
    employee_id: int
    external_karyawan_id: int
    company_id: int
    entitasshelter_id: Optional[int] = None
    cabang_id: Optional[int] = None
    proyek_id: Optional[int] = None
    id_karyawan: str
    id_absensi: Optional[str] = None
    nama_karyawan: str
    embeddings: List[Any]

class SyncRequest(BaseModel):
    replace_all: bool = True
    employees: List[SyncEmployee]

class SyncResponse(BaseModel):
    status: str
    synced_employees: int
    total_vectors: int
    total_prototypes: int
    high_risk_count: int

class EnrollSampleMeta(BaseModel):
    quality_score: float
    blur_score: float
    brightness: float
    yaw: float
    pitch: float
    roll: float
    is_outlier: Optional[bool] = False

class EnrollResponse(BaseModel):
    model_config = {"protected_namespaces": ()}

    status: str
    model_name: str
    model_version: str
    external_karyawan_id: int
    samples_count: int
    kept_count: int
    outliers_count: int
    prototypes_count: int
    embeddings: List[List[float]]
    prototypes: List[List[float]]
    mean_embedding: List[float]
    samples_metadata: Optional[List[EnrollSampleMeta]] = None
    collision_risk: Optional[Dict[str, Any]] = None

class EmployeeSummary(BaseModel):
    employee_id: int
    external_karyawan_id: int
    company_id: int
    proyek_id: Optional[int] = None
    cabang_id: Optional[int] = None
    id_karyawan: str
    nama_karyawan: str

class RecognizeCandidate(BaseModel):
    employee: EmployeeSummary
    score: float
    stage_a_score: Optional[float] = None
    stage_b_score: Optional[float] = None
    identity_threshold: Optional[float] = None
    collision_risk_level: Optional[str] = None

class RecognizeResponse(BaseModel):
    status: str
    decision: str
    reject_reason: Optional[str] = None
    liveness_passed: Optional[bool] = None
    liveness_reason: Optional[str] = None
    challenge_type: Optional[str] = None
    passive_spoof_score: Optional[float] = None
    probe_quality: Optional[float] = None
    probe_stability: Optional[float] = None
    is_cross_location: Optional[bool] = False
    confidence_score: Optional[float] = None
    best_score: Optional[float] = None
    top1_score: Optional[float] = None
    top2_score: Optional[float] = None
    stage_b_score: Optional[float] = None
    second_model_score: Optional[float] = None
    second_model_accept: Optional[bool] = None
    margin_to_second: Optional[float] = None
    score_margin: Optional[float] = None
    captured_frames: Optional[int] = 0
    consistent_frames: Optional[int] = 0
    processing_ms: Optional[float] = None
    quality_metrics: Optional[Dict[str, float]] = None
    employee: Optional[EmployeeSummary] = None
    candidates: Optional[List[RecognizeCandidate]] = None
    requires_secondary_verification: Optional[bool] = False
    collision_risk_level: Optional[str] = None
    gallery_version: Optional[str] = None
    attestation_token: Optional[str] = None
    attestation_timestamp: Optional[int] = None
    message: Optional[str] = None

class ClaimedVerifyResponse(BaseModel):
    status: str
    decision: str
    reject_reason: Optional[str] = None
    claimed_employee_id: int
    score: float
    threshold: float
    probe_quality: Optional[float] = None
    probe_stability: Optional[float] = None
    processing_ms: Optional[float] = None
    message: Optional[str] = None
