import * as faceapi from '@vladmandic/face-api';

let modelsLoaded = false;
let modelLoadingPromise: Promise<void> | null = null;

export async function loadBiometricModels(): Promise<void> {
  if (modelsLoaded) return;
  if (modelLoadingPromise) return modelLoadingPromise;

  modelLoadingPromise = (async () => {
    const modelPath = '/models';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
    ]);
    modelsLoaded = true;
  })();

  return modelLoadingPromise;
}

export function isBiometricModelsLoaded(): boolean {
  return modelsLoaded;
}

export async function detectFaceFast(
  video: HTMLVideoElement
): Promise<{
  detected: boolean;
  landmarks: any;
  box: { x: number; y: number; width: number; height: number };
} | null> {
  if (!modelsLoaded || !video || video.readyState < 2) {
    return null;
  }

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.35,
  });

  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks();

  if (!detection) {
    return null;
  }

  const box = detection.detection.box;

  return {
    detected: true,
    landmarks: detection.landmarks,
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
  };
}

export async function detectFaceWithDescriptor(
  video: HTMLVideoElement
): Promise<{
  detected: boolean;
  descriptor: number[];
  landmarks: any;
  box: { x: number; y: number; width: number; height: number };
} | null> {
  if (!modelsLoaded || !video || video.readyState < 2) {
    return null;
  }

  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.5,
  });

  const detection = await faceapi
    .detectSingleFace(video, options)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return null;
  }

  const box = detection.detection.box;

  return {
    detected: true,
    descriptor: Array.from(detection.descriptor),
    landmarks: detection.landmarks,
    box: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
  };
}

export function computeEyeAspectRatio(eyePoints: any[]): number {
  if (!eyePoints || eyePoints.length < 6) return 0.3;
  const p1 = eyePoints[0];
  const p2 = eyePoints[1];
  const p3 = eyePoints[2];
  const p4 = eyePoints[3];
  const p5 = eyePoints[4];
  const p6 = eyePoints[5];

  const distVertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const distVertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const distHorizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);

  if (distHorizontal === 0) return 0.3;
  return (distVertical1 + distVertical2) / (2.0 * distHorizontal);
}

export type ChallengeType = 'HEAD_TURN' | 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK' | 'OPEN_MOUTH';

export class ActiveChallengeDetector {
  private currentChallenge: ChallengeType = 'HEAD_TURN';
  private state: 'waiting_face' | 'prompting' | 'action_started' | 'action_completed' = 'waiting_face';
  private startTimestamp: number = 0;
  private lastVerifiedTimestamp: number = 0;
  private baselineNoseRatio: number = 0.5;
  private baselineEar: number = 0.25;

  constructor(initialChallenge: ChallengeType = 'HEAD_TURN') {
    this.currentChallenge = initialChallenge;
  }

  public setChallenge(challenge: ChallengeType) {
    this.currentChallenge = challenge;
    this.reset();
  }

  public getChallenge(): ChallengeType {
    return this.currentChallenge;
  }

  public pickRandomChallenge(allowed: ChallengeType[] = ['HEAD_TURN']): ChallengeType {
    this.setChallenge('HEAD_TURN');
    return 'HEAD_TURN';
  }

  public reset() {
    this.state = 'waiting_face';
    this.startTimestamp = 0;
    this.lastVerifiedTimestamp = 0;
    this.baselineNoseRatio = 0.5;
  }

  public update(landmarks: any): {
    verified: boolean;
    stage: string;
    text: string;
    subtext: string;
    badgeClass: string;
    borderClass: string;
  } {
    if (!landmarks) {
      this.state = 'waiting_face';
      return {
        verified: false,
        stage: 'no_face',
        text: 'Posisikan Wajah',
        subtext: 'Arahkan wajah ke dalam lingkaran panduan',
        badgeClass: 'bg-muted/80 text-muted-foreground border-border',
        borderClass: 'border-white/30 scale-100',
      };
    }

    const now = Date.now();
    if (now - this.lastVerifiedTimestamp < 1500) {
      return {
        verified: false,
        stage: 'verified',
        text: 'Tantangan Terverifikasi!',
        subtext: 'Mencocokkan biometrik...',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        borderClass: 'border-emerald-500 scale-105 shadow-[0_0_35px_rgba(16,185,129,0.7)]',
      };
    }

    let avgEar = 0.3;
    let noseRatio = 0.5;
    let mar = 0.1;

    try {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const leftEar = computeEyeAspectRatio(leftEye);
      const rightEar = computeEyeAspectRatio(rightEye);
      avgEar = (leftEar + rightEar) / 2.0;

      const positions = landmarks.positions;
      if (positions && positions.length >= 68) {
        const jawLeft = positions[0];
        const jawRight = positions[16];
        const noseTip = positions[30];
        const jawWidth = Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y);
        if (jawWidth > 0) {
          noseRatio = (noseTip.x - jawLeft.x) / jawWidth;
          if (this.state === 'waiting_face' && noseRatio > 0.25 && noseRatio < 0.75) {
            this.baselineNoseRatio = noseRatio;
            this.state = 'prompting';
          }
        }

        const lipTop = positions[62];
        const lipBot = positions[66];
        const mouthLeft = positions[60];
        const mouthRight = positions[64];
        const mouthWidth = Math.hypot(mouthRight.x - mouthLeft.x, mouthRight.y - mouthLeft.y);
        const mouthHeight = Math.hypot(lipBot.x - lipTop.x, lipBot.y - lipTop.y);
        if (mouthWidth > 0) {
          mar = mouthHeight / mouthWidth;
        }
      }
    } catch {
      return {
        verified: false,
        stage: 'error',
        text: 'Posisikan Wajah',
        subtext: 'Menyelaraskan titik wajah...',
        badgeClass: 'bg-muted/80 text-muted-foreground border-border',
        borderClass: 'border-white/30 scale-100',
      };
    }

    if (avgEar > 0.15) {
      this.baselineEar = this.baselineEar * 0.85 + avgEar * 0.15;
    }

    if (this.currentChallenge === 'BLINK') {
      const closedThreshold = Math.min(0.22, this.baselineEar * 0.78);
      const reOpenThreshold = Math.max(0.18, this.baselineEar * 0.84);

      if (this.state === 'waiting_face' || this.state === 'prompting') {
        if (avgEar <= closedThreshold) {
          this.state = 'action_started';
          this.startTimestamp = now;
          return {
            verified: false,
            stage: 'action_started',
            text: 'Mata Berkedip...',
            subtext: 'Buka mata untuk menyelesaikan verifikasi',
            badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
            borderClass: 'border-amber-400 scale-100 shadow-[0_0_25px_rgba(251,191,36,0.35)]',
          };
        } else {
          this.state = 'prompting';
          return {
            verified: false,
            stage: 'prompting',
            text: 'Kedipkan Mata',
            subtext: 'Kedipkan mata atau tahan posisi wajah sejenak',
            badgeClass: 'bg-sky-500/20 text-sky-400 border-sky-500/40 animate-pulse',
            borderClass: 'border-sky-400 scale-100 shadow-[0_0_25px_rgba(56,189,248,0.35)]',
          };
        }
      }

      if (this.state === 'action_started') {
        const duration = now - this.startTimestamp;
        if (avgEar >= reOpenThreshold && duration >= 30 && duration <= 2000) {
          this.state = 'action_completed';
          this.lastVerifiedTimestamp = now;
          return {
            verified: true,
            stage: 'verified',
            text: 'Kedipan Terverifikasi!',
            subtext: 'Liveness terkonfirmasi, memproses verifikasi...',
            badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
            borderClass: 'border-emerald-500 scale-105 shadow-[0_0_35px_rgba(16,185,129,0.7)]',
          };
        }
        if (duration > 2000) {
          this.state = 'prompting';
        }
        return {
          verified: false,
          stage: 'action_started',
          text: 'Mata Berkedip...',
          subtext: 'Buka mata kembali',
          badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          borderClass: 'border-amber-400 scale-100',
        };
      }
    }

    if (this.currentChallenge === 'HEAD_TURN' || this.currentChallenge === 'TURN_LEFT' || this.currentChallenge === 'TURN_RIGHT') {
      const isTurnedLeft = noseRatio < 0.44;
      const isTurnedRight = noseRatio > 0.56;
      const turnDelta = Math.abs(noseRatio - this.baselineNoseRatio);

      if (isTurnedLeft || isTurnedRight || turnDelta >= 0.05) {
        this.lastVerifiedTimestamp = now;
        return {
          verified: true,
          stage: 'verified',
          text: 'Tengok Terverifikasi!',
          subtext: 'Gerakan terkonfirmasi, memproses verifikasi...',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          borderClass: 'border-emerald-500 scale-105 shadow-[0_0_35px_rgba(16,185,129,0.7)]',
        };
      }

      return {
        verified: false,
        stage: 'prompting',
        text: 'Tengok Kiri / Kanan',
        subtext: 'Arahkan kepala sedikit ke kiri atau ke kanan',
        badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse',
        borderClass: 'border-indigo-400 scale-100 shadow-[0_0_25px_rgba(99,102,241,0.35)]',
      };
    }

    if (this.currentChallenge === 'OPEN_MOUTH') {
      if (mar > 0.38) {
        this.lastVerifiedTimestamp = now;
        return {
          verified: true,
          stage: 'verified',
          text: 'Buka Mulut Terverifikasi!',
          subtext: 'Gerakan terkonfirmasi, memproses verifikasi...',
          badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          borderClass: 'border-emerald-500 scale-105 shadow-[0_0_35px_rgba(16,185,129,0.7)]',
        };
      }
      return {
        verified: false,
        stage: 'prompting',
        text: 'Buka Sedikit Mulut',
        subtext: 'Buka sedikit mulut untuk verifikasi keaslian',
        badgeClass: 'bg-purple-500/20 text-purple-400 border-purple-500/40 animate-pulse',
        borderClass: 'border-purple-400 scale-100 shadow-[0_0_25px_rgba(168,85,247,0.35)]',
      };
    }

    return {
      verified: false,
      stage: 'prompting',
      text: 'Posisikan Wajah',
      subtext: 'Ikuti instruksi gerakan',
      badgeClass: 'bg-muted/80 text-muted-foreground border-border',
      borderClass: 'border-white/30 scale-100',
    };
  }
}

export type BlinkStage = 'no_face' | 'eyes_open' | 'eyes_closing' | 'blink_verified';

export class BlinkDetector {
  private state: 'waiting_face' | 'eyes_open' | 'eyes_closed' = 'waiting_face';
  private closedTimestamp: number = 0;
  private lastBlinkTimestamp: number = 0;
  private baselineEar: number = 0.25;

  public update(landmarks: any): {
    stage: BlinkStage;
    avgEar: number;
    blinkDetected: boolean;
  } {
    if (!landmarks) {
      this.state = 'waiting_face';
      return { stage: 'no_face', avgEar: 0, blinkDetected: false };
    }

    let avgEar = 0.3;
    try {
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      const leftEar = computeEyeAspectRatio(leftEye);
      const rightEar = computeEyeAspectRatio(rightEye);
      avgEar = (leftEar + rightEar) / 2.0;
    } catch {
      return { stage: 'no_face', avgEar: 0, blinkDetected: false };
    }

    if (avgEar > 0.19) {
      this.baselineEar = this.baselineEar * 0.8 + avgEar * 0.2;
    }

    const closedThreshold = Math.min(0.20, this.baselineEar * 0.74);
    const openThreshold = Math.max(0.19, this.baselineEar * 0.82);

    const now = Date.now();

    if (now - this.lastBlinkTimestamp < 1500) {
      return { stage: 'blink_verified', avgEar, blinkDetected: false };
    }

    if (this.state === 'waiting_face' || this.state === 'eyes_open') {
      if (avgEar <= closedThreshold) {
        this.state = 'eyes_closed';
        this.closedTimestamp = now;
        return { stage: 'eyes_closing', avgEar, blinkDetected: false };
      } else {
        this.state = 'eyes_open';
        return { stage: 'eyes_open', avgEar, blinkDetected: false };
      }
    }

    if (this.state === 'eyes_closed') {
      const duration = now - this.closedTimestamp;
      if (avgEar >= openThreshold) {
        if (duration >= 40 && duration <= 1600) {
          this.state = 'eyes_open';
          this.lastBlinkTimestamp = now;
          return { stage: 'blink_verified', avgEar, blinkDetected: true };
        } else {
          this.state = 'eyes_open';
          return { stage: 'eyes_open', avgEar, blinkDetected: false };
        }
      } else if (duration > 2000) {
        this.state = 'eyes_open';
        return { stage: 'eyes_open', avgEar, blinkDetected: false };
      } else {
        return { stage: 'eyes_closing', avgEar, blinkDetected: false };
      }
    }

    return { stage: 'eyes_open', avgEar, blinkDetected: false };
  }

  public reset() {
    this.state = 'waiting_face';
    this.closedTimestamp = 0;
    this.lastBlinkTimestamp = 0;
  }
}

export function getBlinkInstruction(stage: BlinkStage): {
  text: string;
  subtext: string;
  badgeClass: string;
  borderClass: string;
} {
  switch (stage) {
    case 'no_face':
      return {
        text: 'Posisikan Wajah',
        subtext: 'Arahkan wajah ke dalam lingkaran panduan',
        badgeClass: 'bg-muted/80 text-muted-foreground border-border',
        borderClass: 'border-white/30 scale-100',
      };
    case 'eyes_open':
      return {
        text: 'Silakan Kedipkan Mata',
        subtext: 'Verifikasi wajah asli seperti verifikasi bank',
        badgeClass: 'bg-sky-500/20 text-sky-400 border-sky-500/40 animate-pulse',
        borderClass: 'border-sky-400 scale-100 shadow-[0_0_25px_rgba(56,189,248,0.35)]',
      };
    case 'eyes_closing':
      return {
        text: 'Mata Tertutup...',
        subtext: 'Buka mata kembali untuk menyelesaikan verifikasi',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        borderClass: 'border-amber-400 scale-100 shadow-[0_0_25px_rgba(251,191,36,0.35)]',
      };
    case 'blink_verified':
      return {
        text: 'Kedipan Terverifikasi!',
        subtext: 'Liveness terkonfirmasi, mencocokkan biometrik...',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        borderClass: 'border-emerald-500 scale-105 shadow-[0_0_35px_rgba(16,185,129,0.7)]',
      };
  }
}

export function verifyLivenessFromLandmarks(landmarks: any): boolean {
  if (!landmarks) return false;
  try {
    const leftEye = landmarks.getLeftEye();
    const rightEye = landmarks.getRightEye();

    const leftEar = computeEyeAspectRatio(leftEye);
    const rightEar = computeEyeAspectRatio(rightEye);
    const avgEar = (leftEar + rightEar) / 2.0;

    return avgEar >= 0.12;
  } catch (err) {
    return true;
  }
}

export function calculateDistance(v1: number[], v2: number[]): number {
  if (!v1 || !v2 || v1.length !== v2.length) return 1.0;
  return faceapi.euclideanDistance(v1, v2);
}

export function matchFaceToEmployees(
  detectedDescriptor: number[],
  cachedEmployees: any[],
  currentLocation: any,
  maxDistanceThreshold: number = 0.40,
  ambiguityMargin: number = 0.08
): {
  matched: boolean;
  employee: any | null;
  distance: number;
  confidenceScore: number;
  isCrossLocation: boolean;
  ambiguous: boolean;
  secondaryEmployee?: any | null;
} {
  if (!detectedDescriptor || detectedDescriptor.length === 0 || !cachedEmployees || cachedEmployees.length === 0) {
    return {
      matched: false,
      employee: null,
      distance: 1.0,
      confidenceScore: 0,
      isCrossLocation: false,
      ambiguous: false,
    };
  }

  const cabangId = currentLocation ? currentLocation.cabang_id : null;
  const proyekId = currentLocation ? currentLocation.proyek_id : null;

  const tier1List = cachedEmployees.filter((emp) => {
    if (proyekId && emp.proyek_id === proyekId) return true;
    if (cabangId && emp.cabang_id === cabangId) return true;
    return false;
  });

  const tier2List = cachedEmployees.filter((emp) => {
    if (proyekId && emp.proyek_id === proyekId) return false;
    if (cabangId && emp.cabang_id === cabangId) return false;
    return true;
  });

  const evaluateGroup = (employeesGroup: any[]) => {
    const scored: { employee: any; distance: number }[] = [];

    for (const emp of employeesGroup) {
      if (!emp.embeddings || emp.embeddings.length === 0) continue;

      let minDistance = 999.0;
      for (const emb of emp.embeddings) {
        if (!emb.vector || emb.vector.length === 0 || emb.vector.length !== detectedDescriptor.length) continue;
        const d = calculateDistance(detectedDescriptor, emb.vector);
        if (d < minDistance) {
          minDistance = d;
        }
      }

      if (minDistance < 900.0) {
        scored.push({ employee: emp, distance: minDistance });
      }
    }

    scored.sort((a, b) => a.distance - b.distance);
    return scored;
  };

  const tier1Scored = evaluateGroup(tier1List);
  if (tier1Scored.length > 0 && tier1Scored[0].distance <= maxDistanceThreshold) {
    const best = tier1Scored[0];
    const second = tier1Scored[1];
    const confidence = Math.max(0, Math.min(1, 1 - best.distance));

    if (second && second.distance - best.distance < ambiguityMargin) {
      return {
        matched: true,
        employee: best.employee,
        distance: best.distance,
        confidenceScore: confidence,
        isCrossLocation: false,
        ambiguous: true,
        secondaryEmployee: second.employee,
      };
    }

    return {
      matched: true,
      employee: best.employee,
      distance: best.distance,
      confidenceScore: confidence,
      isCrossLocation: false,
      ambiguous: false,
    };
  }

  const tier2Scored = evaluateGroup(tier2List);
  if (tier2Scored.length > 0 && tier2Scored[0].distance <= maxDistanceThreshold) {
    const best = tier2Scored[0];
    const second = tier2Scored[1];
    const confidence = Math.max(0, Math.min(1, 1 - best.distance));

    if (second && second.distance - best.distance < ambiguityMargin) {
      return {
        matched: true,
        employee: best.employee,
        distance: best.distance,
        confidenceScore: confidence,
        isCrossLocation: true,
        ambiguous: true,
        secondaryEmployee: second.employee,
      };
    }

    return {
      matched: true,
      employee: best.employee,
      distance: best.distance,
      confidenceScore: confidence,
      isCrossLocation: true,
      ambiguous: false,
    };
  }

  return {
    matched: false,
    employee: null,
    distance: 1.0,
    confidenceScore: 0,
    isCrossLocation: false,
    ambiguous: false,
  };
}

export function assessLightingQuality(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): { score: number; status: 'good' | 'too_dark' | 'too_bright'; label: string } {
  const ctx = canvas.getContext('2d');
  if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
    return { score: 100, status: 'good', label: 'Siap' };
  }

  canvas.width = 160;
  canvas.height = 120;
  ctx.drawImage(video, 0, 0, 160, 120);

  const imgData = ctx.getImageData(0, 0, 160, 120);
  const data = imgData.data;
  let totalBrightness = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    totalBrightness += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const avgBrightness = totalBrightness / (data.length / 4);

  if (avgBrightness < 45) {
    return { score: avgBrightness, status: 'too_dark', label: 'Terlalu Gelap' };
  }
  if (avgBrightness > 220) {
    return { score: avgBrightness, status: 'too_bright', label: 'Terlalu Terang' };
  }
  return { score: avgBrightness, status: 'good', label: 'Pencahayaan Baik' };
}

export function compressProofPhoto(
  video: HTMLVideoElement,
  maxWidth: number = 640,
  quality: number = 0.7
): string {
  const canvas = document.createElement('canvas');
  let width = video.videoWidth || 640;
  let height = video.videoHeight || 480;

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(video, 0, 0, width, height);
  }

  return canvas.toDataURL('image/jpeg', quality);
}

const PYTHON_ENGINE_URL = '/api/face-engine';

export async function checkPythonEngineHealth(): Promise<{
  available: boolean;
  version?: string;
  loaded?: boolean;
}> {
  try {
    const res = await fetch(`${PYTHON_ENGINE_URL}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { available: false };
    const data = await res.json();
    return {
      available: data.status === 'ok',
      version: data.model_version,
      loaded: data.model_loaded,
    };
  } catch (err) {
    return { available: false };
  }
}

export async function syncEmployeesToPythonEngine(employees: any[]): Promise<boolean> {
  try {
    const formatted = employees.map((emp) => ({
      employee_id: emp.id || emp.employee_id,
      external_karyawan_id: emp.id || emp.external_karyawan_id,
      company_id: emp.company_id || 1,
      entitasshelter_id: emp.entitasshelter_id || null,
      cabang_id: emp.cabang_id || null,
      proyek_id: emp.proyek_id || null,
      id_karyawan: emp.id_karyawan,
      id_absensi: emp.id_absensi || null,
      nama_karyawan: emp.nama_karyawan,
      embeddings: (emp.embeddings || []).map((e: any) => e.vector || e),
    }));

    const res = await fetch(`${PYTHON_ENGINE_URL}/api/v1/cache/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_all: true, employees: formatted }),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function captureBurstFrames(
  video: HTMLVideoElement,
  count: number = 3,
  intervalMs: number = 80
): Promise<Blob[]> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(video.videoWidth || 640, 640);
  canvas.height = Math.min(video.videoHeight || 480, 480);
  const ctx = canvas.getContext('2d');

  const blobs: Blob[] = [];

  for (let i = 0; i < count; i++) {
    if (ctx && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
      });
      if (blob) blobs.push(blob);
    }
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return blobs;
}

export async function recognizeFaceWithPython(
  frames: Blob[],
  companyId: number,
  allowedCompanyIds: number[],
  proyekId?: number,
  cabangId?: number,
  challengeType: string = 'BLINK'
): Promise<any> {
  const formData = new FormData();
  frames.forEach((blob, idx) => {
    formData.append('frames', blob, `frame_${idx}.jpg`);
  });
  formData.append('company_id', companyId.toString());
  formData.append('allowed_company_ids', JSON.stringify(allowedCompanyIds));
  if (proyekId) formData.append('proyek_id', proyekId.toString());
  if (cabangId) formData.append('cabang_id', cabangId.toString());
  formData.append('challenge_type', challengeType);

  const res = await fetch(`${PYTHON_ENGINE_URL}/api/v1/recognize`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    return { status: 'error', decision: 'ERROR' };
  }
  return await res.json();
}
