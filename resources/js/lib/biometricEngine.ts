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
  maxDistanceThreshold: number = 0.55,
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
        if (!emb.vector || emb.vector.length === 0) continue;
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
