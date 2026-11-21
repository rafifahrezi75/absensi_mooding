import json
import numpy as np
from fastapi.testclient import TestClient
from app.main import app
from app.fusion import l2_normalize

def test_health_endpoint():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["model_name"] == "buffalo_s"
        assert data["model_loaded"] is True
        assert data["second_model_loaded"] is True

def test_sync_and_collision_scan_endpoint():
    with TestClient(app) as client:
        v1 = l2_normalize(np.random.randn(512).astype(np.float32)).tolist()
        v2 = l2_normalize(np.random.randn(512).astype(np.float32)).tolist()

        payload = {
            "replace_all": True,
            "employees": [
                {
                    "employee_id": 1,
                    "external_karyawan_id": 1,
                    "company_id": 1,
                    "id_karyawan": "EMP001",
                    "nama_karyawan": "Employee One",
                    "embeddings": [{"vector": v1, "pose_label": "front", "quality_score": 95.0}]
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
        res = client.post("/api/v1/cache/sync", json=payload)
        assert res.status_code == 200
        sync_data = res.json()
        assert sync_data["synced_employees"] == 2
        assert sync_data["total_prototypes"] == 2

        scan_res = client.get("/api/v1/gallery/collision-scan")
        assert scan_res.status_code == 200
        scan_data = scan_res.json()
        assert scan_data["total_identities"] == 2
        assert len(scan_data["pairs"]) == 2
