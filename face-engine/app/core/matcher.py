import sqlite3
import json
import os
import hashlib
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from app.config import settings
from app.fusion import l2_normalize, remove_embedding_outliers, weighted_fusion
from app.gallery import ExactIdentityGallery, Prototype, IdentityResult
from app.collision import calculate_identity_risks, check_enrollment_cross_contamination
from app.decision import decide, DecisionInput

class FaceMatcher:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(FaceMatcher, cls).__new__(cls)
            cls._instance.employees = {}
            cls._instance.employee_templates = {}
            cls._instance.employee_prototypes = {}
            cls._instance.identity_risks = {}
            cls._instance.gallery = ExactIdentityGallery(dimension=512)
            cls._instance.matrix = np.empty((0, 512), dtype=np.float32)
            cls._instance.matrix_ids = []
            cls._instance.gallery_version = "v3_init"
            cls._instance.db_path = settings.database_path
            cls._instance.init_db()
            cls._instance.load_from_db()
        return cls._instance

    def init_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS employees (
                    employee_id INTEGER PRIMARY KEY,
                    external_karyawan_id INTEGER UNIQUE,
                    company_id INTEGER,
                    entitasshelter_id INTEGER,
                    cabang_id INTEGER,
                    proyek_id INTEGER,
                    id_karyawan TEXT,
                    id_absensi TEXT,
                    nama_karyawan TEXT
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS face_embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    external_karyawan_id INTEGER,
                    embedding TEXT,
                    pose_label TEXT,
                    quality_score REAL,
                    model_version TEXT,
                    is_outlier INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS identity_risks (
                    employee_id INTEGER PRIMARY KEY,
                    nearest_impostor_id INTEGER,
                    nearest_impostor_score REAL,
                    identity_threshold REAL,
                    requires_secondary_verification INTEGER,
                    risk_level TEXT,
                    confusable_group_id INTEGER
                )
            """)

            cursor.execute("PRAGMA table_info(face_embeddings)")
            columns = [row[1] for row in cursor.fetchall()]
            if "pose_label" not in columns:
                cursor.execute("ALTER TABLE face_embeddings ADD COLUMN pose_label TEXT DEFAULT 'front'")
            if "quality_score" not in columns:
                cursor.execute("ALTER TABLE face_embeddings ADD COLUMN quality_score REAL DEFAULT 100.0")
            if "model_version" not in columns:
                cursor.execute("ALTER TABLE face_embeddings ADD COLUMN model_version TEXT DEFAULT 'buffalo_s'")
            if "is_outlier" not in columns:
                cursor.execute("ALTER TABLE face_embeddings ADD COLUMN is_outlier INTEGER DEFAULT 0")
            if "is_active" not in columns:
                cursor.execute("ALTER TABLE face_embeddings ADD COLUMN is_active INTEGER DEFAULT 1")
            conn.commit()

    def build_prototypes_for_employee(
        self,
        emp_id: int,
        templates: List[Dict[str, Any]]
    ) -> List[Prototype]:
        if not templates:
            return []

        active_templates = [
            t for t in templates
            if t.get("is_active", 1) and not t.get("is_outlier", 0)
        ]
        if not active_templates:
            return []

        vectors = [np.asarray(t["vector"], dtype=np.float32) for t in active_templates]
        qualities = [float(t.get("quality_score", 1.0)) for t in active_templates]

        if len(vectors) < 3:
            inlier_templates = active_templates
        else:
            array = np.stack([l2_normalize(v) for v in vectors])
            center = l2_normalize(np.mean(array, axis=0))
            sims = array @ center
            inlier_indices = [i for i, s in enumerate(sims) if s >= 0.55]
            if not inlier_indices:
                return []
            inlier_templates = [active_templates[i] for i in inlier_indices]

        by_pose: Dict[str, List[Dict[str, Any]]] = {}
        for t in inlier_templates:
            pose = t.get("pose_label", "front") or "front"
            by_pose.setdefault(pose, []).append(t)

        prototypes: List[Prototype] = []
        if len(by_pose) > 1:
            for pose, items in by_pose.items():
                p_vecs = [np.asarray(it["vector"], dtype=np.float32) for it in items]
                p_quals = [float(it.get("quality_score", 1.0)) for it in items]
                fused = weighted_fusion(p_vecs, p_quals)
                avg_q = float(np.mean(p_quals))
                prototypes.append(Prototype(
                    employee_id=emp_id,
                    vector=fused,
                    quality=avg_q / 100.0 if avg_q > 1.0 else avg_q,
                    prototype_type=pose
                ))
        else:
            p_vecs = [np.asarray(it["vector"], dtype=np.float32) for it in inlier_templates]
            p_quals = [float(it.get("quality_score", 1.0)) for it in inlier_templates]
            fused = weighted_fusion(p_vecs, p_quals)
            avg_q = float(np.mean(p_quals)) if p_quals else 1.0
            prototypes.append(Prototype(
                employee_id=emp_id,
                vector=fused,
                quality=avg_q / 100.0 if avg_q > 1.0 else avg_q,
                prototype_type="default"
            ))

        return prototypes

    def compute_gallery_version(self) -> str:
        h = hashlib.sha256()
        h.update(str(len(self.employees)).encode())
        for emp_id in sorted(self.employees.keys()):
            h.update(f"{emp_id}:{len(self.employee_templates.get(emp_id, []))}".encode())
        return "v3_" + h.hexdigest()[:12]

    def load_from_db(self):
        self.employees = {}
        self.employee_templates = {}
        self.employee_prototypes = {}
        all_prototypes: List[Prototype] = []
        mean_vectors: Dict[int, np.ndarray] = {}

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT employee_id, external_karyawan_id, company_id, entitasshelter_id, cabang_id, proyek_id, id_karyawan, id_absensi, nama_karyawan FROM employees")
            for row in cursor.fetchall():
                emp = {
                    "employee_id": row[0],
                    "external_karyawan_id": row[1],
                    "company_id": row[2],
                    "entitasshelter_id": row[3],
                    "cabang_id": row[4],
                    "proyek_id": row[5],
                    "id_karyawan": row[6],
                    "id_absensi": row[7],
                    "nama_karyawan": row[8]
                }
                self.employees[row[0]] = emp

            cursor.execute("SELECT external_karyawan_id, embedding, pose_label, quality_score, model_version, is_outlier, is_active FROM face_embeddings WHERE is_active = 1 AND is_outlier = 0")
            for row in cursor.fetchall():
                ext_id = row[0]
                emp_id = None
                if ext_id in self.employees:
                    emp_id = ext_id
                else:
                    for k, v in self.employees.items():
                        if v.get("external_karyawan_id") == ext_id:
                            emp_id = k
                            break
                if emp_id is None:
                    continue
                vec = json.loads(row[1])
                if len(vec) == 512 and np.all(np.isfinite(vec)):
                    t_obj = {
                        "vector": vec,
                        "pose_label": row[2],
                        "quality_score": row[3],
                        "model_version": row[4],
                        "is_outlier": row[5],
                        "is_active": row[6]
                    }
                    self.employee_templates.setdefault(emp_id, []).append(t_obj)

        matrix_rows = []
        matrix_ids = []

        for emp_id, t_list in self.employee_templates.items():
            protos = self.build_prototypes_for_employee(emp_id, t_list)
            self.employee_prototypes[emp_id] = protos
            all_prototypes.extend(protos)
            if protos:
                mean_vectors[emp_id] = protos[0].vector
                for p in protos:
                    matrix_rows.append(l2_normalize(p.vector))
                    matrix_ids.append(emp_id)

        if matrix_rows:
            self.matrix = np.vstack(matrix_rows)
            self.matrix_ids = matrix_ids
        else:
            self.matrix = np.empty((0, 512), dtype=np.float32)
            self.matrix_ids = []

        self.gallery.rebuild(all_prototypes, self.employee_templates)
        self.identity_risks = calculate_identity_risks(
            mean_vectors,
            base_threshold=settings.similarity_threshold,
            margin_buffer=0.05
        )
        self.gallery_version = self.compute_gallery_version()

    def sync(self, employees_data: List[Dict[str, Any]], replace_all: bool = True) -> Dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            if replace_all:
                cursor.execute("DELETE FROM face_embeddings")
                cursor.execute("DELETE FROM employees")
                cursor.execute("DELETE FROM identity_risks")

            for item in employees_data:
                canonical_emp_id = item.get("employee_id") or item.get("external_karyawan_id")
                ext_karyawan_id = item.get("external_karyawan_id") or canonical_emp_id

                cursor.execute("""
                    INSERT OR REPLACE INTO employees 
                    (employee_id, external_karyawan_id, company_id, entitasshelter_id, cabang_id, proyek_id, id_karyawan, id_absensi, nama_karyawan)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    canonical_emp_id,
                    ext_karyawan_id,
                    item.get("company_id"),
                    item.get("entitasshelter_id"),
                    item.get("cabang_id"),
                    item.get("proyek_id"),
                    item.get("id_karyawan"),
                    item.get("id_absensi"),
                    item.get("nama_karyawan")
                ))

                if not replace_all:
                    cursor.execute("DELETE FROM face_embeddings WHERE external_karyawan_id = ?", (canonical_emp_id,))

                raw_embeddings = item.get("embeddings", [])
                if isinstance(raw_embeddings, (list, tuple)) and len(raw_embeddings) == 512 and (len(raw_embeddings) == 0 or isinstance(raw_embeddings[0], (int, float))):
                    raw_embeddings = [raw_embeddings]

                for emb in raw_embeddings:
                    if isinstance(emb, dict):
                        vec = emb.get("vector", [])
                        pose = emb.get("pose_label", "front")
                        q_score = emb.get("quality_score", 100.0)
                        model_v = emb.get("model_version", settings.model_name)
                    elif isinstance(emb, (list, tuple, np.ndarray)):
                        vec = emb
                        pose = "front"
                        q_score = 100.0
                        model_v = settings.model_name
                    else:
                        continue

                    if isinstance(vec, (list, tuple, np.ndarray)) and len(vec) == 512 and np.all(np.isfinite(vec)):
                        norm_arr = l2_normalize(np.array(vec, dtype=np.float32)).tolist()
                        cursor.execute("""
                            INSERT INTO face_embeddings 
                            (external_karyawan_id, embedding, pose_label, quality_score, model_version, is_outlier, is_active)
                            VALUES (?, ?, ?, ?, ?, 0, 1)
                        """, (canonical_emp_id, json.dumps(norm_arr), pose, q_score, model_v))

            conn.commit()

        self.load_from_db()
        high_risk_count = sum(
            1 for r in self.identity_risks.values()
            if r.get("risk_level") in ["HIGH", "CRITICAL"]
        )

        return {
            "synced_employees": len(self.employees),
            "total_vectors": sum(len(v) for v in self.employee_templates.values()),
            "total_prototypes": len(self.gallery.prototypes),
            "high_risk_count": high_risk_count,
            "gallery_version": self.gallery_version
        }

    def verify_claimed(
        self,
        probe_vector: np.ndarray,
        claimed_employee_id: int,
        company_id: Optional[int] = None,
        probe_quality: float = 85.0,
        probe_stability: float = 0.90
    ) -> Dict[str, Any]:
        if probe_stability < settings.min_probe_stability:
            return {
                "status": "unstable",
                "decision": "RETRY",
                "reject_reason": "UNSTABLE_PROBE",
                "claimed_employee_id": claimed_employee_id,
                "score": 0.0,
                "threshold": settings.similarity_threshold,
                "message": "Gerakan wajah tidak stabil antar frame"
            }

        if probe_quality < settings.min_probe_quality:
            return {
                "status": "poor_quality",
                "decision": "QUALITY_REJECTED",
                "reject_reason": "LOW_PROBE_QUALITY",
                "claimed_employee_id": claimed_employee_id,
                "score": 0.0,
                "threshold": settings.similarity_threshold,
                "message": "Kualitas scan wajah rendah"
            }

        emp = self.employees.get(claimed_employee_id)
        if not emp:
            for k, val in self.employees.items():
                if val.get("external_karyawan_id") == claimed_employee_id:
                    emp = val
                    claimed_employee_id = k
                    break

        if not emp:
            return {
                "status": "not_found",
                "decision": "UNKNOWN",
                "reject_reason": "EMPLOYEE_NOT_ENROLLED",
                "claimed_employee_id": claimed_employee_id,
                "score": 0.0,
                "threshold": settings.similarity_threshold,
                "message": "Karyawan tidak terdaftar pada galeri biometrik"
            }

        if company_id is not None and emp.get("company_id") != company_id:
            return {
                "status": "unauthorized_tenant",
                "decision": "UNKNOWN",
                "reject_reason": "COMPANY_MISMATCH",
                "claimed_employee_id": claimed_employee_id,
                "score": 0.0,
                "threshold": settings.similarity_threshold,
                "message": "Karyawan tidak terdaftar pada perusahaan ini"
            }

        risk = self.identity_risks.get(claimed_employee_id, {})
        threshold = max(
            settings.similarity_threshold,
            float(risk.get("identity_threshold", settings.similarity_threshold))
        )

        active_templates = [
            t for t in self.employee_templates.get(claimed_employee_id, [])
            if t.get("is_active", 1) and not t.get("is_outlier", 0)
        ]

        if not active_templates:
            return {
                "status": "no_biometrics",
                "decision": "UNKNOWN",
                "reject_reason": "NO_ACTIVE_TEMPLATES",
                "claimed_employee_id": claimed_employee_id,
                "score": 0.0,
                "threshold": threshold,
                "message": "Data wajah karyawan belum terdaftar atau tidak aktif"
            }

        norm_probe = l2_normalize(probe_vector)
        sim_scores = []
        for t in active_templates:
            t_vec = l2_normalize(np.asarray(t["vector"], dtype=np.float32))
            sim_scores.append(float(np.dot(norm_probe, t_vec)))

        sim_scores.sort(reverse=True)
        top_k_scores = sim_scores[:min(3, len(sim_scores))]
        final_score = float(np.mean(top_k_scores))

        if final_score >= threshold:
            decision = "VERIFIED"
            reject_reason = None
            msg = "Verifikasi wajah 1:1 berhasil"
        else:
            decision = "UNKNOWN"
            reject_reason = "1TO1_SCORE_BELOW_THRESHOLD"
            msg = "Wajah tidak cocok dengan identitas yang dipilih"

        return {
            "status": "matched" if decision == "VERIFIED" else "unmatched",
            "decision": decision,
            "reject_reason": reject_reason,
            "claimed_employee_id": claimed_employee_id,
            "score": round(final_score, 4),
            "threshold": threshold,
            "message": msg
        }

    def match(
        self,
        query_vector: np.ndarray,
        company_id: int,
        allowed_company_ids: List[int],
        proyek_id: Optional[int] = None,
        cabang_id: Optional[int] = None,
        probe_quality: float = 85.0,
        probe_stability: float = 0.90,
        second_model_result: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        if len(self.gallery.prototypes) == 0:
            return {
                "status": "unknown",
                "decision": "UNKNOWN",
                "reject_reason": "EMPTY_GALLERY",
                "best_score": 0.0,
                "confidence_score": 0.0,
                "top1_score": 0.0,
                "top2_score": 0.0,
                "margin_to_second": 0.0,
                "top1_employee_id": None,
                "top2_employee_id": None,
                "employee": None,
                "candidates": [],
                "gallery_version": self.gallery_version
            }

        all_allowed_companies = set(allowed_company_ids)
        all_allowed_companies.add(company_id)

        allowed_employee_ids = [
            emp_id for emp_id, emp in self.employees.items()
            if emp.get("company_id") in all_allowed_companies
        ]

        stage_a_results: List[IdentityResult] = self.gallery.search(
            probe=query_vector,
            top_identity_k=settings.top_k,
            allowed_employee_ids=allowed_employee_ids
        )

        if not stage_a_results:
            return {
                "status": "unknown",
                "decision": "UNKNOWN",
                "reject_reason": "NO_CANDIDATE_FOUND",
                "best_score": 0.0,
                "confidence_score": 0.0,
                "top1_score": 0.0,
                "top2_score": 0.0,
                "margin_to_second": 0.0,
                "top1_employee_id": None,
                "top2_employee_id": None,
                "employee": None,
                "candidates": [],
                "gallery_version": self.gallery_version
            }

        candidate_ids = [r.employee_id for r in stage_a_results]
        if second_model_result and second_model_result.get("candidate_ids"):
            for sec_id in second_model_result["candidate_ids"]:
                if sec_id in allowed_employee_ids and sec_id not in candidate_ids:
                    candidate_ids.append(sec_id)

        stage_b_scores = self.gallery.stage_b_rerank(
            probe=query_vector,
            candidate_ids=candidate_ids,
            top_n=settings.stage_b_top_n
        )

        stage_a_score_map = {r.employee_id: r.score for r in stage_a_results}

        ranked_candidates = []
        for emp_id in candidate_ids:
            emp = self.employees.get(emp_id)
            if not emp:
                continue
            b_score = stage_b_scores.get(emp_id, 0.0)
            a_score = stage_a_score_map.get(emp_id, b_score)
            risk = self.identity_risks.get(emp_id, {})
            ranked_candidates.append({
                "employee": {
                    "employee_id": emp["employee_id"],
                    "external_karyawan_id": emp["external_karyawan_id"],
                    "company_id": emp["company_id"],
                    "proyek_id": emp.get("proyek_id"),
                    "cabang_id": emp.get("cabang_id"),
                    "id_karyawan": emp["id_karyawan"],
                    "nama_karyawan": emp["nama_karyawan"]
                },
                "score": round(b_score, 4),
                "stage_a_score": round(a_score, 4),
                "stage_b_score": round(b_score, 4),
                "identity_threshold": risk.get("identity_threshold", settings.similarity_threshold),
                "collision_risk_level": risk.get("risk_level", "LOW")
            })

        ranked_candidates.sort(key=lambda x: x["stage_b_score"], reverse=True)

        top1 = ranked_candidates[0]
        top1_id = top1["employee"]["employee_id"]
        top1_score = top1["stage_b_score"]

        top2 = ranked_candidates[1] if len(ranked_candidates) > 1 else None
        top2_id = top2["employee"]["employee_id"] if top2 else None
        top2_score = top2["stage_b_score"] if top2 else 0.0
        margin = round(top1_score - top2_score, 4) if top2 else 1.0

        top1_risk = dict(self.identity_risks.get(top1_id, {}))
        if top2_id:
            top2_risk = self.identity_risks.get(top2_id, {})
            top1_risk["top2_confusable_group_id"] = top2_risk.get("confusable_group_id")

        sec_model_accept = True
        sec_model_emp_id = top1_id
        sec_model_score = None
        if second_model_result:
            sec_model_accept = second_model_result.get("accepted", True)
            sec_model_emp_id = second_model_result.get("employee_id", top1_id)
            sec_model_score = second_model_result.get("score")

        decision_input = DecisionInput(
            top1_employee_id=top1_id,
            top1_score=top1_score,
            top2_employee_id=top2_id,
            top2_score=top2_score,
            stage_b_score=top1_score,
            second_model_accept=sec_model_accept,
            second_model_employee_id=sec_model_emp_id,
            probe_quality=probe_quality,
            probe_stability=probe_stability,
            risk=top1_risk,
            global_threshold=settings.similarity_threshold,
            margin_threshold=settings.ambiguity_margin,
            min_quality=settings.min_probe_quality,
            min_stability=settings.min_probe_stability,
            second_model_required=settings.second_model_required
        )

        decision, reject_reason = decide(decision_input)

        is_cross_location = False
        top_emp = top1["employee"]
        if (proyek_id and top_emp.get("proyek_id") != proyek_id) or (cabang_id and top_emp.get("cabang_id") != cabang_id):
            is_cross_location = True

        status = "matched" if decision == "VERIFIED" else ("ambiguous" if decision == "AMBIGUOUS" else "unknown")

        return {
            "status": status,
            "decision": decision,
            "reject_reason": reject_reason,
            "best_score": round(top1_score, 4),
            "confidence_score": round(top1_score, 4),
            "top1_score": round(top1_score, 4),
            "top2_score": round(top2_score, 4) if top2 else 0.0,
            "stage_b_score": round(top1_score, 4),
            "second_model_score": sec_model_score,
            "second_model_accept": sec_model_accept,
            "margin_to_second": round(margin, 4),
            "score_margin": round(margin, 4),
            "top1_employee_id": top1["employee"]["employee_id"],
            "top2_employee_id": top2["employee"]["employee_id"] if top2 else None,
            "is_cross_location": is_cross_location,
            "requires_secondary_verification": top1_risk.get("requires_secondary_verification", False),
            "collision_risk_level": top1_risk.get("risk_level", "LOW"),
            "employee": top1["employee"] if decision == "VERIFIED" else None,
            "candidates": ranked_candidates[:min(2, len(ranked_candidates))] if decision in ["AMBIGUOUS", "VERIFIED"] else [],
            "gallery_version": self.gallery_version
        }

matcher = FaceMatcher()
