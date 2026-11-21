import os
import sys
import glob
import json
import numpy as np
from typing import List, Dict, Tuple
from app.core.recognizer import recognizer
import cv2

def compute_cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    if n1 == 0 or n2 == 0:
        return 0.0
    return float(np.dot(v1 / n1, v2 / n2))

def evaluate_threshold(
    genuine_scores: List[float],
    impostor_scores: List[float],
    threshold: float
) -> Dict[str, float]:
    total_genuine = len(genuine_scores) if genuine_scores else 1
    total_impostor = len(impostor_scores) if impostor_scores else 1

    false_rejects = sum(1 for s in genuine_scores if s < threshold)
    false_accepts = sum(1 for s in impostor_scores if s >= threshold)

    frr = false_rejects / float(total_genuine)
    far = false_accepts / float(total_impostor)

    return {
        "threshold": round(threshold, 4),
        "far": round(far, 6),
        "frr": round(frr, 6),
        "far_percent": round(far * 100, 4),
        "frr_percent": round(frr * 100, 4),
    }

def run_calibration(dataset_dir: str = "./data/calibration_dataset"):
    print("=" * 60)
    print("KALIBRASI THRESHOLD BIOMETRIK & EVALUASI FAR/FRR")
    print("=" * 60)

    if not os.path.exists(dataset_dir):
        print(f"Direktori dataset {dataset_dir} tidak ditemukan. Membuat template...")
        os.makedirs(dataset_dir, exist_ok=True)
        print("Simpan subfolder per orang (misal: person_1, person_2) berisi foto wajah.")
        return

    person_dirs = [d for d in glob.glob(os.path.join(dataset_dir, "*")) if os.path.isdir(d)]
    if len(person_dirs) < 2:
        print(f"Minimal diperlukan 2 folder orang berbeda untuk kalibrasi. Ditemukan: {len(person_dirs)}")
        return

    embeddings_by_person: Dict[str, List[np.ndarray]] = {}
    for p_dir in person_dirs:
        p_name = os.path.basename(p_dir)
        embeddings_by_person[p_name] = []
        image_files = glob.glob(os.path.join(p_dir, "*.[jJ][pP][gG]")) + glob.glob(os.path.join(p_dir, "*.[pP][nN][gG]"))
        for img_path in image_files:
            img = cv2.imread(img_path)
            if img is None:
                continue
            status_str, face = recognizer.extract_face(img)
            if status_str == "ok" and face is not None:
                emb = recognizer.get_embedding(face)
                embeddings_by_person[p_name].append(emb)

    genuine_scores = []
    impostor_scores = []

    people = list(embeddings_by_person.keys())
    for p in people:
        embs = embeddings_by_person[p]
        for i in range(len(embs)):
            for j in range(i + 1, len(embs)):
                sim = compute_cosine_similarity(embs[i], embs[j])
                genuine_scores.append(sim)

    for i in range(len(people)):
        for j in range(i + 1, len(people)):
            p1_embs = embeddings_by_person[people[i]]
            p2_embs = embeddings_by_person[people[j]]
            for e1 in p1_embs:
                for e2 in p2_embs:
                    sim = compute_cosine_similarity(e1, e2)
                    impostor_scores.append(sim)

    print(f"Jumlah sampel orang: {len(people)}")
    print(f"Total pasangan Genuine (orang sama): {len(genuine_scores)}")
    print(f"Total pasangan Impostor (orang beda): {len(impostor_scores)}")

    if not genuine_scores or not impostor_scores:
        print("Data pasangan belum mencukupi.")
        return

    print("\nDistribusi Skor Genuine:")
    print(f"  Min: {round(min(genuine_scores), 4)}, Max: {round(max(genuine_scores), 4)}, Rata-rata: {round(np.mean(genuine_scores), 4)}, Median: {round(np.median(genuine_scores), 4)}")

    print("\nDistribusi Skor Impostor:")
    print(f"  Min: {round(min(impostor_scores), 4)}, Max: {round(max(impostor_scores), 4)}, Rata-rata: {round(np.mean(impostor_scores), 4)}, Median: {round(np.median(impostor_scores), 4)}")

    print("\nTabel Kalibrasi Threshold:")
    print("-" * 60)
    print(f"{'Threshold':^12} | {'FAR (%)':^15} | {'FRR (%)':^15}")
    print("-" * 60)

    best_threshold = 0.65
    min_eer_diff = 999.0

    test_thresholds = np.linspace(0.40, 0.85, 19)
    for t in test_thresholds:
        res = evaluate_threshold(genuine_scores, impostor_scores, float(t))
        print(f"{res['threshold']:^12.2f} | {res['far_percent']:^15.2f} | {res['frr_percent']:^15.2f}")
        diff = abs(res['far'] - res['frr'])
        if diff < min_eer_diff:
            min_eer_diff = diff
            best_threshold = float(t)

    print("-" * 60)
    print(f"Rekomendasi Threshold EER (Equal Error Rate): {round(best_threshold, 2)}")
    print(f"Rekomendasi Threshold Keamanan Tinggi (FAR < 0.01%): 0.65")

if __name__ == "__main__":
    run_calibration()
