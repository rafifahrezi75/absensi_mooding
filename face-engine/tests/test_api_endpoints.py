import io
from collections.abc import Coroutine
from types import SimpleNamespace
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi import HTTPException

from app.api import routes as routes_module
from app.config import settings
from app.api.routes import cache_sync, gallery_collision_scan, health_check, recognize_face
from app.core.liveness import verify_active_challenge
from app.core.recognizer import recognizer
from app.fusion import l2_normalize
from app.schemas import SyncRequest


class UploadedFrame:
    def __init__(self, content: bytes) -> None:
        self.content = content

    async def read(self) -> bytes:
        return self.content


def make_uploaded_frames(count: int) -> list[UploadedFrame]:
    image = np.zeros((120, 120, 3), dtype=np.uint8)
    encoded, buffer = cv2.imencode(".jpg", image)
    assert encoded is True

    return [
        UploadedFrame(io.BytesIO(buffer.tobytes()).getvalue())
        for _ in range(count)
    ]


def resolve_immediate_coroutine(coroutine: Coroutine[Any, Any, Any]) -> Any:
    try:
        coroutine.send(None)
    except StopIteration as result:
        return result.value

    raise AssertionError("Expected endpoint coroutine to complete without an event loop")


def configure_successful_recognition_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    face = SimpleNamespace(bbox=np.asarray([10, 10, 110, 110]))
    embedding = l2_normalize(np.ones(512, dtype=np.float32))

    monkeypatch.setattr(
        routes_module,
        "verify_active_challenge",
        lambda frames, challenge: (True, "challenge_verified"),
    )
    monkeypatch.setattr(recognizer, "extract_face", lambda frame: ("ok", face))
    monkeypatch.setattr(recognizer, "get_embedding", lambda face_data: embedding)
    monkeypatch.setattr(recognizer, "get_sface_embedding", lambda frame, face_data: None)
    monkeypatch.setattr(routes_module, "calculate_passive_spoof_score", lambda crop: 0.0)

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


def test_recognition_requires_minimum_consistent_frames():
    response = resolve_immediate_coroutine(
        recognize_face(
            frames=make_uploaded_frames(1),
            company_id=1,
            allowed_company_ids=None,
            proyek_id=None,
            cabang_id=None,
            challenge_type="HEAD_TURN",
            x_biometric_secret=settings.biometric_shared_secret,
        )
    ).model_dump()

    assert response["decision"] == "RETRY"
    assert response["reject_reason"] == "INSUFFICIENT_CONSISTENT_FRAMES"
    assert response["captured_frames"] == 1


def test_recognition_rejects_untrusted_client_liveness_marker():
    response = resolve_immediate_coroutine(
        recognize_face(
            frames=make_uploaded_frames(settings.min_consistent_frames),
            company_id=1,
            allowed_company_ids=None,
            proyek_id=None,
            cabang_id=None,
            challenge_type="CLIENT_VERIFIED",
            x_biometric_secret=settings.biometric_shared_secret,
        )
    ).model_dump()

    assert response["decision"] == "RETRY"
    assert response["reject_reason"] == "SERVER_LIVENESS_REQUIRED"
    assert response["liveness_passed"] is False


def test_active_liveness_rejects_single_frame():
    passed, reason = verify_active_challenge(
        [np.zeros((120, 120, 3), dtype=np.uint8)],
        "HEAD_TURN",
    )

    assert passed is False
    assert reason == "insufficient_frames"


def test_recognition_requires_minimum_quality_approved_frames(monkeypatch):
    configure_successful_recognition_pipeline(monkeypatch)
    quality_checks = 0

    def check_quality(frame, face):
        nonlocal quality_checks
        quality_checks += 1
        is_valid = quality_checks <= settings.min_recognition_frames - 1
        return is_valid, "FACE_QUALITY_FAILED", "quality", {
            "quality_score": 95.0,
            "yaw": 0.0,
        }

    monkeypatch.setattr(routes_module, "check_frame_quality", check_quality)

    response = resolve_immediate_coroutine(
        recognize_face(
            frames=make_uploaded_frames(settings.capture_frame_count),
            company_id=1,
            allowed_company_ids=None,
            proyek_id=None,
            cabang_id=None,
            challenge_type="HEAD_TURN",
            x_biometric_secret=settings.biometric_shared_secret,
        )
    ).model_dump()

    assert response["decision"] == "RETRY"
    assert response["reject_reason"] == "INSUFFICIENT_FRONTAL_FRAMES"
    assert response["consistent_frames"] == settings.min_recognition_frames - 1


def test_recognition_requires_minimum_embedding_inliers(monkeypatch):
    configure_successful_recognition_pipeline(monkeypatch)
    monkeypatch.setattr(
        routes_module,
        "check_frame_quality",
        lambda frame, face: (
            True,
            "OK",
            "quality",
            {"quality_score": 95.0, "yaw": 0.0},
        ),
    )

    def keep_too_few_inliers(vectors, qualities, min_similarity):
        required_count = settings.min_recognition_frames - 1
        return vectors[:required_count], qualities[:required_count]

    monkeypatch.setattr(routes_module, "remove_embedding_outliers", keep_too_few_inliers)

    response = resolve_immediate_coroutine(
        recognize_face(
            frames=make_uploaded_frames(settings.capture_frame_count),
            company_id=1,
            allowed_company_ids=None,
            proyek_id=None,
            cabang_id=None,
            challenge_type="HEAD_TURN",
            x_biometric_secret=settings.biometric_shared_secret,
        )
    ).model_dump()

    assert response["decision"] == "RETRY"
    assert response["reject_reason"] == "INSUFFICIENT_CONSISTENT_FRAMES"
    assert response["consistent_frames"] == settings.min_recognition_frames - 1


def test_recognition_uses_frontal_frames_for_identity_matching(monkeypatch):
    configure_successful_recognition_pipeline(monkeypatch)
    frame_yaws = iter([0.0, 2.0, -1.0, 3.0, 0.0, 20.0, -20.0])
    front_embedding = l2_normalize(np.ones(512, dtype=np.float32))
    captured_query = None

    def check_quality(frame, face):
        return True, "OK", "quality", {
            "quality_score": 95.0,
            "yaw": next(frame_yaws),
        }

    def get_embedding(face):
        return front_embedding

    def match(**kwargs):
        nonlocal captured_query
        captured_query = kwargs["query_vector"]
        return {
            "status": "verified",
            "decision": "VERIFIED",
            "employee": {
                "employee_id": 1,
                "external_karyawan_id": 1,
                "company_id": 1,
                "id_karyawan": "EMP001",
                "nama_karyawan": "Employee One",
            },
        }

    monkeypatch.setattr(routes_module, "check_frame_quality", check_quality)
    monkeypatch.setattr(recognizer, "get_embedding", get_embedding)
    monkeypatch.setattr(routes_module.matcher, "match", match)

    response = resolve_immediate_coroutine(
        recognize_face(
            frames=make_uploaded_frames(settings.capture_frame_count + 2),
            company_id=1,
            allowed_company_ids=None,
            proyek_id=None,
            cabang_id=None,
            challenge_type="HEAD_TURN",
            x_biometric_secret=settings.biometric_shared_secret,
        )
    ).model_dump()

    assert response["decision"] == "VERIFIED"
    assert response["consistent_frames"] == settings.capture_frame_count
    assert captured_query is not None
    assert float(np.dot(captured_query, front_embedding)) > 0.999
