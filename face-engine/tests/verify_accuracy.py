import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import json
import sqlite3
import cv2
import numpy as np
import requests

BASE_URL = "http://127.0.0.1:8005"

def log_test(name, passed, detail=""):
    status_str = "PASS" if passed else "FAIL"
    print(f"[{status_str}] {name}: {detail}")
    if not passed:
        sys.exit(1)

def test_1_health_and_model():
    res = requests.get(f"{BASE_URL}/health", timeout=10)
    if res.status_code != 200:
        log_test("Test 1 - Health Status", False, f"HTTP {res.status_code}")
        return

    data = res.json()
    model_loaded = data.get("model_loaded") is True
    model_version = data.get("model_version") == "buffalo_s"
    models_dir = os.path.exists("./models")

    passed = model_loaded and model_version and models_dir
    log_test("Test 1 (Startup & Model Offline)", passed, f"model_loaded={model_loaded}, version={data.get('model_version')}")

def extract_portrait(name):
    base = os.path.abspath("../node_modules/@vladmandic/face-api/demo")
    img = cv2.imread(os.path.join(base, name))
    from app.core.recognizer import recognizer
    if not recognizer.initialized:
        recognizer.initialize()

    faces = recognizer.app.get(img)
    faces.sort(key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)
    f = faces[0]
    x1, y1, x2, y2 = [int(v) for v in f.bbox]
    cx = (x1 + x2) // 2
    cy = (y1 + y2) // 2
    size = int(max(x2 - x1, y2 - y1) * 1.1)
    h, w, _ = img.shape
    c_x1 = max(0, cx - size)
    c_x2 = min(w, cx + size)
    c_y1 = max(0, cy - size)
    c_y2 = min(h, cy + size)
    crop = img[c_y1:c_y2, c_x1:c_x2]
    crop = cv2.resize(crop, (400, 400))
    kernel = np.array([[0, -0.3, 0], [-0.3, 2.2, -0.3], [0, -0.3, 0]])
    return cv2.filter2D(crop, -1, kernel)

def create_enroll_variations(portrait_bgr):
    h, w, _ = portrait_bgr.shape
    v1 = portrait_bgr.copy()

    m_rot = cv2.getRotationMatrix2D((w / 2, h / 2), 2, 1.0)
    v2 = cv2.warpAffine(portrait_bgr, m_rot, (w, h), borderMode=cv2.BORDER_REPLICATE)

    m_rot_neg = cv2.getRotationMatrix2D((w / 2, h / 2), -2, 1.0)
    v3 = cv2.warpAffine(portrait_bgr, m_rot_neg, (w, h), borderMode=cv2.BORDER_REPLICATE)

    return [v1, v2, v3]

def create_liveness_burst(portrait_bgr):
    h, w, _ = portrait_bgr.shape
    f1 = portrait_bgr.copy()

    m1 = np.float32([[1, 0, 15], [0, 1, 6]])
    f2 = cv2.warpAffine(portrait_bgr, m1, (w, h), borderMode=cv2.BORDER_REPLICATE)

    m2 = np.float32([[1, 0, -15], [0, 1, -6]])
    f3 = cv2.warpAffine(portrait_bgr, m2, (w, h), borderMode=cv2.BORDER_REPLICATE)

    return [f1, f2, f3]

def test_2_same_vs_different_person():
    portrait_a = extract_portrait("sample1.jpg")
    portrait_b = extract_portrait("sample4.jpg")
    portrait_c = extract_portrait("sample5.jpg")

    poses_a = create_enroll_variations(portrait_a)
    poses_b = create_enroll_variations(portrait_b)

    files_a = [("images", (f"a_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg")) for i, p in enumerate(poses_a)]
    res_a = requests.post(f"{BASE_URL}/api/v1/enroll", data={"external_karyawan_id": 1001}, files=files_a, timeout=15)
    data_a = res_a.json()
    if res_a.status_code != 200:
        log_test("Test 2 - Enroll Person A", False, f"Failed: {data_a}")
        return

    files_b = [("images", (f"b_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg")) for i, p in enumerate(poses_b)]
    res_b = requests.post(f"{BASE_URL}/api/v1/enroll", data={"external_karyawan_id": 1002}, files=files_b, timeout=15)
    data_b = res_b.json()
    if res_b.status_code != 200:
        log_test("Test 2 - Enroll Person B", False, f"Failed: {data_b}")
        return

    vec_a = np.array(data_a["mean_embedding"], dtype=np.float32)
    vec_b = np.array(data_b["mean_embedding"], dtype=np.float32)
    inter_person_sim = float(np.dot(vec_a, vec_b))

    sync_payload = {
        "replace_all": True,
        "employees": [
            {
                "employee_id": 1,
                "external_karyawan_id": 1001,
                "company_id": 1,
                "proyek_id": 10,
                "cabang_id": 1,
                "id_karyawan": "EMP001",
                "nama_karyawan": "Budi Santoso",
                "embeddings": data_a["embeddings"]
            },
            {
                "employee_id": 2,
                "external_karyawan_id": 1002,
                "company_id": 1,
                "proyek_id": 10,
                "cabang_id": 1,
                "id_karyawan": "EMP002",
                "nama_karyawan": "Rizky Pratama",
                "embeddings": data_b["embeddings"]
            }
        ]
    }
    requests.post(f"{BASE_URL}/api/v1/cache/sync", json=sync_payload, timeout=10)

    burst_a = [
        ("frames", (f"frame_a_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg"))
        for i, p in enumerate(create_liveness_burst(portrait_a))
    ]
    rec_a = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1, "proyek_id": 10, "cabang_id": 1},
        files=burst_a,
        timeout=15
    ).json()

    matched_a = (
        rec_a.get("status") == "matched" and
        rec_a.get("employee", {}).get("external_karyawan_id") == 1001 and
        rec_a.get("confidence_score", 0) >= 0.55
    )

    burst_b = [
        ("frames", (f"frame_b_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg"))
        for i, p in enumerate(create_liveness_burst(portrait_b))
    ]
    rec_b = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1, "proyek_id": 10, "cabang_id": 1},
        files=burst_b,
        timeout=15
    ).json()

    matched_b = (
        rec_b.get("status") == "matched" and
        rec_b.get("employee", {}).get("external_karyawan_id") == 1002 and
        rec_b.get("confidence_score", 0) >= 0.55
    )

    burst_c = [
        ("frames", (f"frame_c_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg"))
        for i, p in enumerate(create_liveness_burst(portrait_c))
    ]
    rec_c = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1, "proyek_id": 10, "cabang_id": 1},
        files=burst_c,
        timeout=15
    ).json()

    unknown_c = (
        rec_c.get("status") == "unknown" and
        rec_c.get("best_score", 0) < 0.45
    )

    sim_ab_valid = inter_person_sim < 0.35

    all_passed = matched_a and matched_b and unknown_c and sim_ab_valid
    detail = f"MatchedA={matched_a} (score={rec_a.get('confidence_score')}), MatchedB={matched_b} (score={rec_b.get('confidence_score')}), InterSim={inter_person_sim:.4f} (<0.35: {sim_ab_valid}), UnknownC={unknown_c} (best={rec_c.get('best_score')})"
    log_test("Test 2 (Same Person vs Different Person — Anti-Pixel Bug)", all_passed, detail)

def test_3_edge_cases():
    black_img = np.zeros((300, 300, 3), dtype=np.uint8)
    files_black = [("frames", ("black.jpg", cv2.imencode(".jpg", black_img)[1].tobytes(), "image/jpeg"))]
    res_black = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1},
        files=files_black,
        timeout=10
    ).json()

    black_ok = res_black.get("status") in ["poor_quality", "no_face"]

    img1 = extract_portrait("sample1.jpg")
    img2 = extract_portrait("sample4.jpg")
    h = min(img1.shape[0], img2.shape[0])
    w = min(img1.shape[1], img2.shape[1])
    img1_crop = cv2.resize(img1, (w, h))
    img2_crop = cv2.resize(img2, (w, h))
    stacked = np.hstack([img1_crop, img2_crop])

    files_two = [
        ("frames", (f"two_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg"))
        for i, p in enumerate(create_liveness_burst(stacked))
    ]
    res_two = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1},
        files=files_two,
        timeout=10
    ).json()

    two_ok = res_two.get("status") == "multiple_faces"

    passed = black_ok and two_ok
    log_test("Test 3 (Edge Cases Kualitas & Jumlah Wajah)", passed, f"black_status={res_black.get('status')}, two_faces_status={res_two.get('status')}")

def test_4_performance_1000_employees():
    dummy_employees = []
    for i in range(1, 1001):
        rand_vec = np.random.randn(512).astype(np.float32)
        rand_vec = rand_vec / np.linalg.norm(rand_vec)
        dummy_employees.append({
            "employee_id": 1000 + i,
            "external_karyawan_id": 10000 + i,
            "company_id": 1,
            "proyek_id": 10,
            "cabang_id": 1,
            "id_karyawan": f"EMP{i:04d}",
            "nama_karyawan": f"Dummy Employee {i}",
            "embeddings": [rand_vec.tolist()]
        })

    sync_payload = {
        "replace_all": False,
        "employees": dummy_employees
    }
    sync_res = requests.post(f"{BASE_URL}/api/v1/cache/sync", json=sync_payload, timeout=30).json()

    query_vec = np.random.randn(512).astype(np.float32)
    query_vec = query_vec / np.linalg.norm(query_vec)

    from app.core.matcher import matcher
    t0 = time.perf_counter()
    res = matcher.match(query_vec, company_id=1, allowed_company_ids=[1], proyek_id=10, cabang_id=1)
    numpy_time_ms = (time.perf_counter() - t0) * 1000

    portrait_a = extract_portrait("sample1.jpg")
    burst_a = [
        ("frames", (f"perf_{i}.jpg", cv2.imencode(".jpg", p)[1].tobytes(), "image/jpeg"))
        for i, p in enumerate(create_liveness_burst(portrait_a))
    ]
    t_req_0 = time.perf_counter()
    rec_perf = requests.post(
        f"{BASE_URL}/api/v1/recognize",
        data={"company_id": 1, "proyek_id": 10, "cabang_id": 1},
        files=burst_a,
        timeout=15
    ).json()
    req_time_ms = (time.perf_counter() - t_req_0) * 1000

    passed = numpy_time_ms < 5.0 and req_time_ms < 500.0
    log_test(
        "Test 4 (Performa Ratusan Karyawan)",
        passed,
        f"NumPy matching={numpy_time_ms:.2f}ms (<5ms), Total recognize={req_time_ms:.2f}ms (<500ms), Cached={sync_res.get('total_vectors')}"
    )

def test_5_persistence_offline():
    from app.core.matcher import FaceMatcher
    new_matcher = FaceMatcher()
    new_matcher.load_from_db()

    res = requests.get(f"{BASE_URL}/health", timeout=10).json()
    cached_emp = res.get("cached_employees", 0)

    with sqlite3.connect("./data/local_cache.sqlite3") as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM employees")
        sqlite_count = cursor.fetchone()[0]

    passed = cached_emp > 0 and cached_emp == sqlite_count
    log_test("Test 5 (Persistensi Restart Offline)", passed, f"cached_employees={cached_emp}, sqlite_count={sqlite_count}")

if __name__ == "__main__":
    time.sleep(1)
    test_1_health_and_model()
    test_2_same_vs_different_person()
    test_3_edge_cases()
    test_4_performance_1000_employees()
    test_5_persistence_offline()
    print("ALL 5 TESTS PASSED SUCCESSFULLY!")
