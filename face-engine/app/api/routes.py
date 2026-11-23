import time
import json
import hmac
import hashlib
from datetime import datetime
from typing import List, Optional
import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, Header, HTTPException
from app.config import settings
from app.schemas import (
    HealthResponse,
    SyncRequest,
    SyncResponse,
    EnrollResponse,
    EnrollSampleMeta,
    RecognizeResponse,
    ClaimedVerifyResponse
)
from app.core.quality import check_frame_quality
from app.core.liveness import verify_active_challenge, calculate_passive_spoof_score
from app.core.recognizer import recognizer
from app.core.matcher import matcher
from app.fusion import (
    stability_score,
    remove_embedding_outliers,
    weighted_fusion,
    l2_normalize
)
from app.collision import check_enrollment_cross_contamination

router = APIRouter()


def require_biometric_secret(x_biometric_secret: Optional[str]) -> None:
    expected = settings.biometric_shared_secret
    if not x_biometric_secret or not hmac.compare_digest(
        x_biometric_secret.encode(), expected.encode()
    ):
        raise HTTPException(status_code=401, detail="Kunci akses biometrik tidak valid")

@router.get("/health", response_model=HealthResponse)
def health_check():
    high_risks = sum(
        1 for r in matcher.identity_risks.values()
        if r.get("risk_level") in ["HIGH", "CRITICAL"]
    )
    return HealthResponse(
        status="ok",
        model_name=settings.model_name,
        model_version=settings.model_version,
        model_loaded=recognizer.initialized,
        second_model_loaded=recognizer.sface is not None,
        liveness_enabled=settings.enable_liveness,
        passive_anti_spoof_enabled=settings.enable_passive_anti_spoof,
        cached_employees=len(matcher.employees),
        cached_vectors=sum(len(v) for v in matcher.employee_templates.values()),
        cached_secondary_vectors=sum(
            len(v) for v in matcher.employee_secondary_templates.values()
        ),
        cached_prototypes=len(matcher.gallery.prototypes),
        collision_risks_calculated=len(matcher.identity_risks),
        vector_backend=matcher.gallery.backend,
        gallery_version=matcher.gallery_version,
        server_time=datetime.now().isoformat()
    )

@router.post("/api/v1/cache/sync", response_model=SyncResponse)
def cache_sync(
    req: SyncRequest,
    x_biometric_secret: Optional[str] = Header(None, alias="X-Biometric-Secret"),
):
    require_biometric_secret(x_biometric_secret)
    data = [emp.model_dump() for emp in req.employees]
    result = matcher.sync(
        data,
        replace_all=req.replace_all,
        source_version=req.source_version,
        similarity_threshold=req.similarity_threshold,
        ambiguity_margin=req.ambiguity_margin,
    )
    return SyncResponse(
        status="ok",
        synced_employees=result["synced_employees"],
        total_vectors=result["total_vectors"],
        total_prototypes=result["total_prototypes"],
        high_risk_count=result["high_risk_count"],
        gallery_version=result["gallery_version"],
    )

@router.get("/api/v1/gallery/collision-scan")
def gallery_collision_scan(
    x_biometric_secret: Optional[str] = Header(None, alias="X-Biometric-Secret"),
):
    require_biometric_secret(x_biometric_secret)
    confusable_pairs = []
    for emp_id, risk in matcher.identity_risks.items():
        if risk.get("nearest_impostor_id"):
            confusable_pairs.append({
                "employee_id": emp_id,
                "nearest_impostor_id": risk.get("nearest_impostor_id"),
                "similarity": risk.get("nearest_impostor_score"),
                "risk_level": risk.get("risk_level"),
                "requires_secondary": risk.get("requires_secondary_verification"),
                "confusable_group": risk.get("confusable_group_id")
            })
    confusable_pairs.sort(key=lambda x: x["similarity"], reverse=True)
    return {
        "status": "ok",
        "total_identities": len(matcher.identity_risks),
        "high_risk_count": sum(1 for p in confusable_pairs if p["risk_level"] in ["HIGH", "CRITICAL"]),
        "pairs": confusable_pairs
    }

@router.post("/api/v1/enroll", response_model=EnrollResponse)
async def enroll_face(
    external_karyawan_id: int = Form(...),
    pose_label: str = Form("front"),
    images: List[UploadFile] = File(...),
    x_biometric_secret: Optional[str] = Header(None, alias="X-Biometric-Secret"),
):
    require_biometric_secret(x_biometric_secret)
    if not images or len(images) == 0:
        raise HTTPException(status_code=400, detail="Tidak ada gambar yang dikirim")

    normalized_pose = pose_label.strip().lower()
    allowed_poses = {"front", "slight_left", "slight_right"}
    if normalized_pose not in allowed_poses:
        raise HTTPException(status_code=422, detail="Pose wajah tidak valid")

    embeddings = []
    secondary_embeddings = []
    qualities = []
    secondary_qualities = []
    samples_meta: List[EnrollSampleMeta] = []

    for img_file in images:
        content = await img_file.read()
        nparr = np.frombuffer(content, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Format gambar tidak valid")

        status_str, face = recognizer.extract_face(img_bgr)
        if status_str != "ok" or face is None:
            if status_str == "no_face":
                raise HTTPException(status_code=400, detail="Tidak ada wajah terdeteksi pada gambar")
            elif status_str == "multiple_faces":
                raise HTTPException(status_code=400, detail="Terdeteksi lebih dari satu wajah pada gambar")
            else:
                raise HTTPException(status_code=400, detail="Gagal mendeteksi wajah")

        is_valid, q_code, q_msg, q_metrics = check_frame_quality(
            img_bgr,
            face,
            expected_pose=normalized_pose,
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"{q_code}: {q_msg}")

        emb = recognizer.get_embedding(face)
        embeddings.append(emb)
        qualities.append(float(q_metrics["quality_score"]))

        secondary_embedding = recognizer.get_sface_embedding(img_bgr, face)
        if secondary_embedding is not None:
            secondary_embeddings.append(secondary_embedding)
            secondary_qualities.append(float(q_metrics["quality_score"]))

        samples_meta.append(EnrollSampleMeta(
            quality_score=q_metrics["quality_score"],
            blur_score=q_metrics["blur_score"],
            brightness=q_metrics["brightness"],
            yaw=q_metrics["yaw"],
            pitch=q_metrics["pitch"],
            roll=q_metrics["roll"],
            is_outlier=False
        ))

    inlier_vectors, inlier_qualities = remove_embedding_outliers(
        embeddings, qualities, min_similarity=0.55
    )
    outliers_count = len(embeddings) - len(inlier_vectors)

    if len(inlier_vectors) == 0:
        raise HTTPException(
            status_code=400,
            detail="Foto pose tidak konsisten atau kualitas terlalu bervariasi"
        )

    fused_mean = weighted_fusion(inlier_vectors, inlier_qualities)
    secondary_mean = None
    if secondary_embeddings:
        secondary_inliers, secondary_inlier_qualities = remove_embedding_outliers(
            secondary_embeddings,
            secondary_qualities,
            min_similarity=0.30,
        )
        if secondary_inliers:
            secondary_mean = weighted_fusion(
                secondary_inliers,
                secondary_inlier_qualities,
            )

    other_vectors = {}
    for other_id, protos in matcher.employee_prototypes.items():
        if other_id != external_karyawan_id and protos:
            other_vectors[other_id] = protos[0].vector

    contaminated, conflict_id, sim = check_enrollment_cross_contamination(
        fused_mean,
        external_karyawan_id,
        other_vectors,
        contamination_threshold=0.72
    )
    if contaminated:
        conflict_emp = matcher.employees.get(conflict_id, {})
        conflict_name = conflict_emp.get("nama_karyawan", f"ID {conflict_id}")
        raise HTTPException(
            status_code=400,
            detail=f"Wajah terdeteksi terlalu mirip dengan karyawan lain ({conflict_name}, kemiripan {sim}). Pendaftaran dibatalkan untuk mencegah salah orang."
        )

    return EnrollResponse(
        status="enrolled",
        model_name=settings.model_name,
        model_version=settings.model_version,
        external_karyawan_id=external_karyawan_id,
        samples_count=len(embeddings),
        kept_count=len(inlier_vectors),
        outliers_count=outliers_count,
        prototypes_count=1,
        embeddings=[e.tolist() for e in embeddings],
        prototypes=[fused_mean.tolist()],
        mean_embedding=fused_mean.tolist(),
        secondary_model_name="sface" if secondary_mean is not None else None,
        secondary_model_version="opencv_sface_2021dec" if secondary_mean is not None else None,
        secondary_embeddings=(
            [embedding.tolist() for embedding in secondary_embeddings]
            if secondary_embeddings
            else None
        ),
        secondary_mean_embedding=(
            secondary_mean.tolist() if secondary_mean is not None else None
        ),
        samples_metadata=samples_meta
    )

@router.post("/api/v1/verify/claimed", response_model=ClaimedVerifyResponse)
async def verify_claimed_identity(
    frames: List[UploadFile] = File(...),
    claimed_employee_id: int = Form(...),
    x_biometric_secret: Optional[str] = Header(None, alias="X-Biometric-Secret"),
):
    require_biometric_secret(x_biometric_secret)
    start_time = time.time()
    frames_bgr = []
    for f in frames:
        content = await f.read()
        if not content:
            continue
        nparr = np.frombuffer(content, np.uint8)
        if nparr.size == 0:
            continue
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:
            frames_bgr.append(img)

    if not frames_bgr:
        return ClaimedVerifyResponse(
            status="error",
            decision="QUALITY_REJECTED",
            reject_reason="NO_VALID_FRAMES",
            claimed_employee_id=claimed_employee_id,
            score=0.0,
            threshold=settings.similarity_threshold,
            message="Tidak ada gambar yang valid"
        )

    valid_embs = []
    valid_quals = []
    for frame in frames_bgr:
        face_status, face = recognizer.extract_face(frame)
        if face_status != "ok" or face is None:
            continue
        is_valid, q_code, q_msg, q_metrics = check_frame_quality(frame, face)
        if not is_valid:
            continue
        emb = recognizer.get_embedding(face)
        valid_embs.append(emb)
        valid_quals.append(float(q_metrics["quality_score"]))

    if not valid_embs:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return ClaimedVerifyResponse(
            status="poor_quality",
            decision="QUALITY_REJECTED",
            reject_reason="FACE_QUALITY_FAILED",
            claimed_employee_id=claimed_employee_id,
            score=0.0,
            threshold=settings.similarity_threshold,
            processing_ms=elapsed,
            message="Kualitas wajah belum mencukupi untuk verifikasi 1:1"
        )

    stab = stability_score(valid_embs)
    inliers, in_quals = remove_embedding_outliers(valid_embs, valid_quals, min_similarity=0.55)
    fused_probe = weighted_fusion(inliers, in_quals)
    avg_qual = float(np.mean(in_quals))

    result = matcher.verify_claimed(
        probe_vector=fused_probe,
        claimed_employee_id=claimed_employee_id,
        probe_quality=avg_qual,
        probe_stability=stab
    )

    elapsed = round((time.time() - start_time) * 1000, 2)

    return ClaimedVerifyResponse(
        status=result["status"],
        decision=result["decision"],
        reject_reason=result.get("reject_reason"),
        claimed_employee_id=claimed_employee_id,
        score=result["score"],
        threshold=result["threshold"],
        probe_quality=round(avg_qual, 2),
        probe_stability=round(stab, 4),
        processing_ms=elapsed,
        message=result["message"],
    )

@router.post("/api/v1/recognize", response_model=RecognizeResponse)
async def recognize_face(
    frames: List[UploadFile] = File(...),
    company_id: int = Form(...),
    allowed_company_ids: Optional[str] = Form(None),
    proyek_id: Optional[int] = Form(None),
    cabang_id: Optional[int] = Form(None),
    challenge_type: Optional[str] = Form("BLINK"),
    x_biometric_secret: Optional[str] = Header(None, alias="X-Biometric-Secret"),
):
    require_biometric_secret(x_biometric_secret)
    start_time = time.time()

    if not frames:
        return RecognizeResponse(
            status="no_face",
            decision="QUALITY_REJECTED",
            reject_reason="NO_FRAMES_SUBMITTED",
            message="Tidak ada frame yang dikirim"
        )

    parsed_allowed_ids = []
    if allowed_company_ids:
        try:
            val = json.loads(allowed_company_ids)
            if isinstance(val, list):
                parsed_allowed_ids = [int(x) for x in val]
            else:
                parsed_allowed_ids = [int(val)]
        except Exception:
            parsed_allowed_ids = [
                int(x.strip()) for x in allowed_company_ids.split(",") if x.strip().isdigit()
            ]

    frames_bgr = []
    for f in frames:
        content = await f.read()
        if not content:
            continue
        nparr = np.frombuffer(content, np.uint8)
        if nparr.size == 0:
            continue
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:
            frames_bgr.append(img)

    if not frames_bgr:
        return RecognizeResponse(
            status="no_face",
            decision="QUALITY_REJECTED",
            reject_reason="INVALID_IMAGE_FORMAT",
            message="Format gambar tidak valid"
        )

    if len(frames_bgr) < settings.min_consistent_frames:
        return RecognizeResponse(
            status="insufficient_frames",
            decision="RETRY",
            reject_reason="INSUFFICIENT_CONSISTENT_FRAMES",
            captured_frames=len(frames_bgr),
            consistent_frames=0,
            message="Jumlah frame wajah belum mencukupi, silakan ulangi gerakan"
        )

    liveness_passed = True
    liveness_reason = "disabled"
    normalized_challenge = (challenge_type or "BLINK").upper()
    if settings.enable_liveness:
        if normalized_challenge in ["CLIENT_VERIFIED", "AUTO_STEADY", "VERIFIED", "NONE", "DISABLED"]:
            return RecognizeResponse(
                status="liveness_failed",
                decision="RETRY",
                reject_reason="SERVER_LIVENESS_REQUIRED",
                liveness_passed=False,
                liveness_reason="untrusted_client_liveness_marker",
                challenge_type=challenge_type,
                captured_frames=len(frames_bgr),
                message="Verifikasi gerakan harus dibuktikan oleh server"
            )
        liveness_passed, liveness_reason = verify_active_challenge(frames_bgr, normalized_challenge)
        if not liveness_passed:
            elapsed = round((time.time() - start_time) * 1000, 2)
            return RecognizeResponse(
                status="liveness_failed",
                decision="RETRY",
                reject_reason="ACTIVE_LIVENESS_FAILED",
                liveness_passed=False,
                liveness_reason=liveness_reason,
                challenge_type=challenge_type,
                captured_frames=len(frames_bgr),
                processing_ms=elapsed,
                message="Gerakan tantangan aktif belum terverifikasi"
            )
    valid_frame_embeddings = []
    valid_secondary_embeddings = []
    valid_secondary_qualities = []
    valid_frame_qualities = []
    spoof_scores = []
    last_quality_metrics = None
    best_recognition_quality_metrics = None
    quality_errors = []
    quality_approved_frame_count = 0

    for frame in frames_bgr:
        face_status, face = recognizer.extract_face(frame)
        if face_status == "multiple_faces":
            elapsed = round((time.time() - start_time) * 1000, 2)
            return RecognizeResponse(
                status="multiple_faces",
                decision="QUALITY_REJECTED",
                reject_reason="MULTIPLE_FACES",
                liveness_passed=liveness_passed,
                liveness_reason=liveness_reason,
                captured_frames=len(frames_bgr),
                processing_ms=elapsed,
                message="Terdeteksi lebih dari satu wajah pada kamera"
            )

        if face_status != "ok" or face is None:
            quality_errors.append("FACE_NOT_DETECTED")
            continue

        is_valid, q_code, q_msg, q_metrics = check_frame_quality(frame, face)
        last_quality_metrics = q_metrics

        if not is_valid:
            quality_errors.append(q_code)
            continue

        quality_approved_frame_count += 1
        bbox = [max(0, int(v)) for v in face.bbox]
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = bbox[0], bbox[1], min(w, bbox[2]), min(h, bbox[3])
        if (x2 - x1) > 20 and (y2 - y1) > 20:
            face_crop = frame[y1:y2, x1:x2]
            sp_score = calculate_passive_spoof_score(face_crop)
            spoof_scores.append(sp_score)

        frame_quality = float(q_metrics["quality_score"])
        frame_yaw = abs(float(q_metrics.get("yaw", 0.0)))
        if frame_yaw > settings.max_recognition_yaw:
            continue

        emb = recognizer.get_embedding(face)
        valid_frame_embeddings.append(emb)
        valid_frame_qualities.append(frame_quality)
        if (
            best_recognition_quality_metrics is None
            or frame_quality > float(best_recognition_quality_metrics["quality_score"])
        ):
            best_recognition_quality_metrics = q_metrics

        secondary_embedding = recognizer.get_sface_embedding(frame, face)
        if secondary_embedding is not None:
            valid_secondary_embeddings.append(secondary_embedding)
            valid_secondary_qualities.append(frame_quality)

    if not valid_frame_embeddings:
        elapsed = round((time.time() - start_time) * 1000, 2)
        if quality_approved_frame_count > 0:
            return RecognizeResponse(
                status="insufficient_frontal_frames",
                decision="RETRY",
                reject_reason="INSUFFICIENT_FRONTAL_FRAMES",
                liveness_passed=liveness_passed,
                liveness_reason=liveness_reason,
                quality_metrics=last_quality_metrics,
                captured_frames=len(frames_bgr),
                consistent_frames=0,
                processing_ms=elapsed,
                message="Hadapkan wajah lurus ke kamera dan tahan sebentar"
            )

        primary_reason = quality_errors[0] if quality_errors else "FACE_QUALITY_FAILED"
        return RecognizeResponse(
            status="poor_quality",
            decision="QUALITY_REJECTED",
            reject_reason=primary_reason,
            liveness_passed=liveness_passed,
            liveness_reason=liveness_reason,
            quality_metrics=last_quality_metrics,
            captured_frames=len(frames_bgr),
            processing_ms=elapsed,
            message="Kualitas wajah belum memenuhi standar"
        )

    if len(valid_frame_embeddings) < settings.min_recognition_frames:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return RecognizeResponse(
            status="insufficient_frontal_frames",
            decision="RETRY",
            reject_reason="INSUFFICIENT_FRONTAL_FRAMES",
            liveness_passed=liveness_passed,
            liveness_reason=liveness_reason,
            quality_metrics=best_recognition_quality_metrics or last_quality_metrics,
            captured_frames=len(frames_bgr),
            consistent_frames=len(valid_frame_embeddings),
            processing_ms=elapsed,
            message="Hadapkan wajah lurus ke kamera dan tahan sebentar"
        )

    avg_spoof = float(np.mean(spoof_scores)) if spoof_scores else 0.0
    if settings.enable_passive_anti_spoof and avg_spoof > settings.passive_spoof_threshold:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return RecognizeResponse(
            status="spoof_detected",
            decision="SPOOF_REJECTED",
            reject_reason="PASSIVE_ANTI_SPOOF_FAILED",
            passive_spoof_score=round(avg_spoof, 4),
            liveness_passed=liveness_passed,
            liveness_reason=liveness_reason,
            captured_frames=len(frames_bgr),
            processing_ms=elapsed,
            message="Terdeteksi foto atau rekaman layar (Anti-Spoof Reject)"
        )

    stability = stability_score(valid_frame_embeddings)
    if len(valid_frame_embeddings) >= 3 and stability < settings.min_probe_stability:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return RecognizeResponse(
            status="ambiguous",
            decision="RETRY",
            reject_reason="UNSTABLE_PROBE",
            probe_stability=round(stability, 4),
            captured_frames=len(frames_bgr),
            consistent_frames=len(valid_frame_embeddings),
            processing_ms=elapsed,
            message="Wajah bergerak terlalu cepat antar frame, coba posisikan lebih tenang"
        )

    inlier_vectors, inlier_qualities = remove_embedding_outliers(
        valid_frame_embeddings,
        valid_frame_qualities,
        min_similarity=0.55
    )

    if len(inlier_vectors) < settings.min_recognition_frames:
        elapsed = round((time.time() - start_time) * 1000, 2)
        return RecognizeResponse(
            status="inconsistent_frames",
            decision="RETRY",
            reject_reason="INSUFFICIENT_CONSISTENT_FRAMES",
            liveness_passed=liveness_passed,
            liveness_reason=liveness_reason,
            probe_stability=round(stability, 4),
            captured_frames=len(frames_bgr),
            consistent_frames=len(inlier_vectors),
            processing_ms=elapsed,
            message="Wajah belum konsisten pada cukup frame, silakan ulangi pemindaian"
        )

    fused_probe = weighted_fusion(inlier_vectors, inlier_qualities)
    avg_probe_qual = float(np.mean(inlier_qualities))
    secondary_probe = None
    if valid_secondary_embeddings:
        secondary_inliers, secondary_inlier_qualities = remove_embedding_outliers(
            valid_secondary_embeddings,
            valid_secondary_qualities,
            min_similarity=0.30,
        )
        if len(secondary_inliers) >= settings.min_recognition_frames:
            secondary_probe = weighted_fusion(
                secondary_inliers,
                secondary_inlier_qualities,
            )

    final_match = matcher.match(
        query_vector=fused_probe,
        company_id=company_id,
        allowed_company_ids=parsed_allowed_ids,
        proyek_id=proyek_id,
        cabang_id=cabang_id,
        probe_quality=avg_probe_qual,
        probe_stability=stability,
        secondary_probe_vector=secondary_probe,
    )

    elapsed = round((time.time() - start_time) * 1000, 2)

    attestation_token = None
    attestation_ts = None
    if final_match["decision"] == "VERIFIED" and final_match.get("employee"):
        emp_id = final_match["employee"]["employee_id"]
        attestation_ts = int(time.time())
        token_payload = f"{emp_id}:{attestation_ts}:VERIFIED"
        attestation_token = hmac.new(
            settings.biometric_shared_secret.encode(),
            token_payload.encode(),
            hashlib.sha256
        ).hexdigest()

    return RecognizeResponse(
        status=final_match["status"],
        decision=final_match["decision"],
        reject_reason=final_match.get("reject_reason"),
        liveness_passed=liveness_passed,
        liveness_reason=liveness_reason,
        challenge_type=challenge_type,
        passive_spoof_score=round(avg_spoof, 4),
        probe_quality=round(avg_probe_qual, 2),
        probe_stability=round(stability, 4),
        is_cross_location=final_match.get("is_cross_location", False),
        confidence_score=final_match.get("confidence_score"),
        best_score=final_match.get("best_score"),
        top1_employee_id=final_match.get("top1_employee_id"),
        top1_score=final_match.get("top1_score"),
        top2_employee_id=final_match.get("top2_employee_id"),
        top2_score=final_match.get("top2_score"),
        stage_b_score=final_match.get("stage_b_score"),
        second_model_score=final_match.get("second_model_score"),
        second_model_accept=final_match.get("second_model_accept"),
        margin_to_second=final_match.get("margin_to_second"),
        score_margin=final_match.get("score_margin"),
        captured_frames=len(frames_bgr),
        consistent_frames=len(inlier_vectors),
        processing_ms=elapsed,
        quality_metrics=best_recognition_quality_metrics or last_quality_metrics,
        employee=final_match.get("employee"),
        candidates=final_match.get("candidates"),
        requires_secondary_verification=final_match.get("requires_secondary_verification", False),
        collision_risk_level=final_match.get("collision_risk_level", "LOW"),
        gallery_version=final_match.get("gallery_version"),
        attestation_token=attestation_token,
        attestation_timestamp=attestation_ts
    )
