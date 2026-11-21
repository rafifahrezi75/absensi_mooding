import numpy as np
import pytest
from fastapi import HTTPException
from app.config import settings
from app.api.routes import cache_sync, gallery_collision_scan, health_check
from app.core.recognizer import recognizer
from app.fusion import l2_normalize
from app.schemas import SyncRequest

def test_health_endpoint():
    recognizer.initialized = True
    recognizer.sface = object()
    data = health_check().model_dump()
    assert data["status"] == "ok"
    assert data["model_name"] == "buffalo_s"
    assert data["model_loaded"] is True
    assert data["second_model_loaded"] is True

def test_sync_and_collision_scan_endpoint():
    v1 = l2_normalize(np.random.randn(512).astype(np.float32)).tolist()
    v2 = l2_normalize(np.random.randn(512).astype(np.float32)).tolist()
    sface_v1 = l2_normalize(np.random.randn(128).astype(np.float32)).tolist()

    payload = {
            "replace_all": True,
            "source_version": "test-gallery-v1",
            "similarity_threshold": 0.67,
            "ambiguity_margin": 0.09,
            "employees": [
                {
                    "employee_id": 1,
                    "external_karyawan_id": 1,
                    "company_id": 1,
                    "id_karyawan": "EMP001",
                    "nama_karyawan": "Employee One",
                    "embeddings": [
                        {"vector": v1, "pose_label": "front", "quality_score": 95.0},
                        {
                            "vector": sface_v1,
                            "model_name": "sface",
                            "model_version": "opencv_sface_2021dec",
                            "pose_label": "front",
                            "quality_score": 95.0,
                        },
                    ]
                },
                {
                    "employee_id": 2,
                    "external_karyawan_id": 2,
                    "company_id": 1,
                    "id_karyawan": "EMP002",
                    "nama_karyawan": "Employee Two",
                    "embeddings": [{"vector": v2, "pose_label": "front", "quality_score": 90.0}]
                }
            ]
    }
    sync_data = cache_sync(
        SyncRequest(**payload),
        settings.biometric_shared_secret,
    ).model_dump()
    assert sync_data["synced_employees"] == 2
    assert sync_data["total_vectors"] == 3
    assert sync_data["total_prototypes"] == 2
    assert sync_data["gallery_version"] == "test-gallery-v1"

    scan_data = gallery_collision_scan(settings.biometric_shared_secret)
    assert scan_data["total_identities"] == 2
    assert len(scan_data["pairs"]) == 2


def test_internal_endpoints_require_shared_secret():
    with pytest.raises(HTTPException) as sync_error:
        cache_sync(SyncRequest(replace_all=True, employees=[]), None)
    with pytest.raises(HTTPException) as scan_error:
        gallery_collision_scan(None)

    assert sync_error.value.status_code == 401
    assert scan_error.value.status_code == 401
