export function computeCosineSimilarity(v1: number[], v2: number[]): number {
  if (!v1 || !v2 || v1.length === 0 || v2.length === 0 || v1.length !== v2.length) {
    return 0;
  }
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }
  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
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

export function extractFeatureVector(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): number[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Array(128).fill(0);

  canvas.width = 64;
  canvas.height = 64;
  ctx.drawImage(video, 0, 0, 64, 64);

  const imgData = ctx.getImageData(0, 0, 64, 64);
  const data = imgData.data;

  const vector: number[] = [];
  const blockSize = 8;

  for (let by = 0; by < 64; by += blockSize) {
    for (let bx = 0; bx < 64; bx += blockSize) {
      let sum = 0;
      let count = 0;
      let variance = 0;

      for (let y = by; y < by + blockSize; y++) {
        for (let x = bx; x < bx + blockSize; x++) {
          const idx = (y * 64 + x) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          sum += gray;
          count++;
        }
      }
      const mean = sum / count;

      for (let y = by; y < by + blockSize; y++) {
        for (let x = bx; x < bx + blockSize; x++) {
          const idx = (y * 64 + x) * 4;
          const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          variance += Math.pow(gray - mean, 2);
        }
      }
      const stdDev = Math.sqrt(variance / count);

      vector.push(mean / 255.0);
      vector.push(stdDev / 128.0);
    }
  }

  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / norm;
    }
  }

  return vector;
}

export function identifyEmployee(
  detectedVector: number[],
  cachedEmployees: any[],
  currentLocation: any,
  similarityThreshold: number = 0.75,
  ambiguityMargin: number = 0.08
): {
  matched: boolean;
  employee: any | null;
  score: number;
  isCrossLocation: boolean;
  ambiguous: boolean;
  secondaryEmployee?: any | null;
} {
  if (!detectedVector || detectedVector.length === 0 || !cachedEmployees || cachedEmployees.length === 0) {
    return { matched: false, employee: null, score: 0, isCrossLocation: false, ambiguous: false };
  }

  const locId = currentLocation ? currentLocation.id : null;
  const cabangId = currentLocation ? currentLocation.cabang_id : null;
  const proyekId = currentLocation ? currentLocation.proyek_id : null;

  const tier1Employees = cachedEmployees.filter((emp) => {
    if (proyekId && emp.proyek_id === proyekId) return true;
    if (cabangId && emp.cabang_id === cabangId) return true;
    return false;
  });

  const tier2Employees = cachedEmployees.filter((emp) => {
    if (proyekId && emp.proyek_id === proyekId) return false;
    if (cabangId && emp.cabang_id === cabangId) return false;
    return true;
  });

  const evaluateTier = (list: any[]) => {
    const scores: { employee: any; score: number }[] = [];
    for (const emp of list) {
      if (!emp.embeddings || emp.embeddings.length === 0) continue;
      let maxScore = 0;
      for (const emb of emp.embeddings) {
        if (!emb.vector || emb.vector.length === 0) continue;
        const sim = computeCosineSimilarity(detectedVector, emb.vector);
        if (sim > maxScore) maxScore = sim;
      }
      if (maxScore > 0) {
        scores.push({ employee: emp, score: maxScore });
      }
    }
    scores.sort((a, b) => b.score - a.score);
    return scores;
  };

  const tier1Scores = evaluateTier(tier1Employees);
  if (tier1Scores.length > 0 && tier1Scores[0].score >= similarityThreshold) {
    const best = tier1Scores[0];
    const second = tier1Scores[1];
    if (second && best.score - second.score < ambiguityMargin) {
      return {
        matched: true,
        employee: best.employee,
        score: best.score,
        isCrossLocation: false,
        ambiguous: true,
        secondaryEmployee: second.employee,
      };
    }
    return {
      matched: true,
      employee: best.employee,
      score: best.score,
      isCrossLocation: false,
      ambiguous: false,
    };
  }

  const tier2Scores = evaluateTier(tier2Employees);
  if (tier2Scores.length > 0 && tier2Scores[0].score >= similarityThreshold) {
    const best = tier2Scores[0];
    const second = tier2Scores[1];
    if (second && best.score - second.score < ambiguityMargin) {
      return {
        matched: true,
        employee: best.employee,
        score: best.score,
        isCrossLocation: true,
        ambiguous: true,
        secondaryEmployee: second.employee,
      };
    }
    return {
      matched: true,
      employee: best.employee,
      score: best.score,
      isCrossLocation: true,
      ambiguous: false,
    };
  }

  return { matched: false, employee: null, score: 0, isCrossLocation: false, ambiguous: false };
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
