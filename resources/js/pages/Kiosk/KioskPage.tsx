import React, { useState, useEffect, useRef } from 'react';
import { KioskLayout } from '@/layouts/KioskLayout';
import { FallbackModal } from './FallbackModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LogIn,
  LogOut,
  Coffee,
  Check,
  CheckCircle2,
  Clock,
  AlertCircle,
  KeyRound,
  RefreshCw,
  SunMedium,
  UserCheck,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';
import {
  assessLightingQuality,
  checkPythonEngineHealth,
  captureFrameBlob,
  detectFaceBoxFast,
  loadFaceDetectionModel,
  recognizeFaceWithPython,
} from '@/lib/biometricEngine';
import { cacheEmployees, getCachedEmployees } from '@/lib/offlineQueue';
import axios from 'axios';
import { toast } from 'sonner';
import { formatLateLabel } from '@/lib/utils';

const ERROR_COOLDOWN_MS = {
  info: 3000,
  warning: 4000,
  error: 5000,
} as const;
const ERROR_TOAST_ID = 'kiosk-biometric-error';
const CAMERA_TOAST_ID = 'kiosk-camera-error';

export function KioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [config, setConfig] = useState<any>(null);
  const [cachedEmployees, setCachedEmployees] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState<string>('clock_in');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [lighting, setLighting] = useState<{ status: string; label: string }>({
    status: 'good',
    label: 'Mendeteksi cahaya...',
  });

  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'success' | 'cooldown'>('idle');
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [lastResult, setLastResult] = useState<any>(null);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [pythonEngineActive, setPythonEngineActive] = useState<boolean>(false);
  const [isFallbackOpen, setIsFallbackOpen] = useState<boolean>(false);
  const [challengeUI, setChallengeUI] = useState<{
    text: string;
    subtext: string;
    badgeClass: string;
    borderClass: string;
  }>({
    text: 'Hadap Lurus',
    subtext: 'Posisikan wajah di dalam bingkai',
    badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse',
    borderClass: 'border-white/30 scale-100',
  });

  const scanLockRef = useRef<boolean>(false);
  const isDetectingRef = useRef<boolean>(false);
  const isDrawingFaceBoxRef = useRef<boolean>(false);
  const livenessFramesRef = useRef<Blob[]>([]);
  const phaseProofRef = useRef<{ front?: Blob; slight_left?: Blob; slight_right?: Blob }>({});
  const errorCooldownTimeoutRef = useRef<number | null>(null);
  const errorCooldownIntervalRef = useRef<number | null>(null);
  const successTimeoutRef = useRef<number | null>(null);
  const serverOnlyTimerRef = useRef<number>(0);

  useEffect(() => {
    loadConfig();
    loadEmployees();
    startCamera();
    loadFaceDetectionModel().catch(() => {});
    const engineHealthInterval = window.setInterval(async () => {
      const engineStatus = await checkPythonEngineHealth();
      setPythonEngineActive(engineStatus.available);
    }, 10000);

    return () => {
      stopCamera();
      window.clearInterval(engineHealthInterval);
      if (errorCooldownTimeoutRef.current !== null) {
        window.clearTimeout(errorCooldownTimeoutRef.current);
      }
      if (errorCooldownIntervalRef.current !== null) {
        window.clearInterval(errorCooldownIntervalRef.current);
      }
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const loadConfig = async () => {
    try {
      const res = await axios.get('/api/kiosk/config');
      setConfig(res.data);
      autoSelectButton(res.data.buttons);
    } catch (err) {}
  };

  useEffect(() => {
    const faceBoxInterval = window.setInterval(async () => {
      if (
        !cameraActive ||
        !videoRef.current ||
        !overlayCanvasRef.current ||
        isDrawingFaceBoxRef.current ||
        isFallbackOpen
      ) {
        return;
      }

      isDrawingFaceBoxRef.current = true;
      try {
        const video = videoRef.current;
        const overlay = overlayCanvasRef.current;
        overlay.width = video.videoWidth || 640;
        overlay.height = video.videoHeight || 480;

        const context = overlay.getContext('2d');
        if (!context) return;

        context.clearRect(0, 0, overlay.width, overlay.height);
        const faceBox = await detectFaceBoxFast(video);
        if (faceBox) {
          context.strokeStyle = '#34d399';
          context.lineWidth = 3;
          context.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height);
        }
      } catch {
      } finally {
        isDrawingFaceBoxRef.current = false;
      }
    }, 300);

    return () => window.clearInterval(faceBoxInterval);
  }, [cameraActive, isFallbackOpen]);

  const autoSelectButton = (buttons: any[]) => {
    if (!buttons || buttons.length === 0) return;
    const now = new Date();
    const currentHms = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false });

    const matched = buttons.find((b: any) => {
      if (!b.is_enabled || !b.auto_highlight_start || !b.auto_highlight_end) return false;
      return currentHms >= b.auto_highlight_start && currentHms <= b.auto_highlight_end;
    });

    if (matched) {
      setSelectedType(matched.attendance_type);
    } else {
      setSelectedType(buttons[0].attendance_type);
    }
  };

  const loadEmployees = async () => {
    try {
      const local = await getCachedEmployees();
      if (local && local.length > 0) {
        setCachedEmployees(local);
      }

      if (navigator.onLine) {
        const res = await axios.get('/api/kiosk/employees-cache');
        if (res.data.employees) {
          setCachedEmployees(res.data.employees);
          await cacheEmployees(res.data.employees);
        }
      }

      const checkEngine = async () => {
        const pyStatus = await checkPythonEngineHealth();
        if (pyStatus.available) {
          setPythonEngineActive(true);
        } else {
          setPythonEngineActive(false);
          setTimeout(async () => {
            const retryStatus = await checkPythonEngineHealth();
            if (retryStatus.available) {
              setPythonEngineActive(true);
            }
          }, 2000);
        }
      };
      checkEngine();
    } catch (err) {}
  };

  const startCamera = async () => {
    stopCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Akses kamera memerlukan HTTPS', {
          id: CAMERA_TOAST_ID,
          duration: ERROR_COOLDOWN_MS.error,
        });
        setCameraActive(false);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraActive(true);
        };
      }
    } catch (err: any) {
      setCameraActive(false);
      toast.error('Kamera tidak dapat diakses', {
        id: CAMERA_TOAST_ID,
        duration: ERROR_COOLDOWN_MS.error,
      });
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const beginErrorCooldown = (
    message: string,
    severity: 'info' | 'warning' | 'error' = 'warning',
    openFallback: boolean = false
  ) => {
    if (errorCooldownTimeoutRef.current !== null) {
      window.clearTimeout(errorCooldownTimeoutRef.current);
    }
    if (errorCooldownIntervalRef.current !== null) {
      window.clearInterval(errorCooldownIntervalRef.current);
    }

    const cooldownMs = ERROR_COOLDOWN_MS[severity];
    const cooldownEndsAt = Date.now() + cooldownMs;
    scanLockRef.current = true;
    livenessFramesRef.current = [];
    phaseProofRef.current = {};
    serverOnlyTimerRef.current = 0;
    setScanStatus('cooldown');
    setCooldownSeconds(Math.ceil(cooldownMs / 1000));

    const toastOptions = { id: ERROR_TOAST_ID, duration: cooldownMs };
    if (severity === 'error') {
      toast.error(message, toastOptions);
    } else if (severity === 'info') {
      toast.info(message, toastOptions);
    } else {
      toast.warning(message, toastOptions);
    }

    if (openFallback) {
      openFallbackModal();
    }

    errorCooldownIntervalRef.current = window.setInterval(() => {
      setCooldownSeconds(Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000)));
    }, 250);

    errorCooldownTimeoutRef.current = window.setTimeout(() => {
      if (errorCooldownIntervalRef.current !== null) {
        window.clearInterval(errorCooldownIntervalRef.current);
        errorCooldownIntervalRef.current = null;
      }
      errorCooldownTimeoutRef.current = null;
      setCooldownSeconds(0);
      setScanStatus('idle');
      scanLockRef.current = false;
      setChallengeUI({
        text: 'Hadap Lurus',
        subtext: 'Posisikan wajah di dalam bingkai',
        badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse',
        borderClass: 'border-white/30 scale-100',
      });
    }, cooldownMs);
  };

  const triggerRecognition = async (
    challengeType: string = 'FRONTAL',
    challengeFrames: Blob[] = []
  ) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanStatus('scanning');

    if (pythonEngineActive && videoRef.current) {
      const minRequired = challengeType === 'FRONTAL' ? 1 : Math.min(config?.settings?.min_consistent_frames || 1, config?.settings?.capture_frame_count || 1);
      const frames = [...challengeFrames];
      if (frames.length >= minRequired) {
        const companyId = config?.location?.company_id || 1;
        const allowedCompanyIds = [companyId];
        const proyekId = config?.location?.proyek_id;
        const cabangId = config?.location?.cabang_id;

        let recRes: any;
        try {
          recRes = await recognizeFaceWithPython(
            frames,
            companyId,
            allowedCompanyIds,
            proyekId,
            cabangId,
            challengeType
          );
        } catch {
          setPythonEngineActive(false);
          beginErrorCooldown(
            'Koneksi ke mesin biometrik terputus. Gunakan jalur darurat ID dan PIN.',
            'error',
            true
          );
          return;
        }

        if (recRes.status === 'error' || recRes.decision === 'ERROR') {
          beginErrorCooldown(
            'Mesin biometrik gagal memproses wajah. Silakan coba lagi.',
            'error'
          );
          return;
        } else if (recRes.decision === 'VERIFIED' && recRes.employee) {
          executeAttendanceTap(
            recRes.employee,
            recRes.confidence_score || recRes.top1_score || 0.85,
            recRes.is_cross_location,
            recRes,
            frames
          );
          return;
        } else if (recRes.decision === 'AMBIGUOUS' || recRes.status === 'ambiguous') {
          beginErrorCooldown(
            recRes.message || 'Ada lebih dari satu kandidat wajah. Gunakan jalur darurat ID dan PIN.',
            'warning',
            true
          );
          return;
        } else if (recRes.decision === 'RETRY') {
          beginErrorCooldown(recRes.message || 'Wajah belum dapat dipastikan, coba lagi');
          return;
        } else if (recRes.decision === 'SPOOF_REJECTED') {
          beginErrorCooldown(
            recRes.message || 'Verifikasi gagal: Keaslian wajah fisik tidak terdeteksi',
            'error'
          );
          return;
        } else if (recRes.decision === 'QUALITY_REJECTED') {
          if (recRes.reject_reason === 'FACE_NOT_DETECTED' || recRes.reject_reason === 'NO_FRAMES_SUBMITTED') {
            scanLockRef.current = false;
            setScanStatus('idle');
            return;
          }
          beginErrorCooldown(recRes.message || 'Kualitas frame wajah belum memenuhi standar');
          return;
        } else {
          setFailedCount((prev) => {
            const next = prev + 1;
            if (next >= (config?.settings?.max_failed_scans || 3)) {
              openFallbackModal();
              return 0;
            }
            return next;
          });
          beginErrorCooldown(recRes.message || 'Wajah tidak terdaftar dalam sistem', 'info');
          return;
        }
      }

      beginErrorCooldown('Kamera belum menangkap frame wajah yang cukup. Posisikan wajah lalu coba lagi.');
      return;
    }

    beginErrorCooldown(
      'Mesin biometrik tidak tersedia. Gunakan jalur darurat ID dan PIN.',
      'error',
      true
    );
  };

  useEffect(() => {
    let steadyFaceCount = 0;
    const loopInterval = setInterval(async () => {
      if (
        !videoRef.current ||
        !cameraActive ||
        scanLockRef.current ||
        isDetectingRef.current ||
        isFallbackOpen
      ) {
        return;
      }

      if (!pythonEngineActive) {
        return;
      }

      if (canvasRef.current) {
        const lightCheck = assessLightingQuality(videoRef.current, canvasRef.current);
        setLighting({ status: lightCheck.status, label: lightCheck.label });
      }

      isDetectingRef.current = true;

      try {
        serverOnlyTimerRef.current++;
        const timerStep = serverOnlyTimerRef.current;

        setChallengeUI({
          text: 'Hadap Lurus',
          subtext: 'Posisikan wajah di dalam bingkai',
          badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40 animate-pulse',
          borderClass: 'border-sky-400 scale-100 shadow-[0_0_25px_rgba(56,189,248,0.35)]',
        });

        if (videoRef.current.readyState >= 2) {
          const faceBox = await detectFaceBoxFast(videoRef.current);
          if (faceBox && faceBox.width >= 50 && faceBox.height >= 50) {
            steadyFaceCount++;
          } else {
            steadyFaceCount = 0;
          }

          const shouldScan = steadyFaceCount >= 2 || (timerStep >= 12 && steadyFaceCount >= 1);
          if (shouldScan) {
            steadyFaceCount = 0;
            serverOnlyTimerRef.current = 0;
            const frame = await captureFrameBlob(videoRef.current);
            if (frame) {
              setChallengeUI({
                text: 'Memverifikasi...',
                subtext: 'Mencocokkan biometrik wajah...',
                badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse',
                borderClass: 'border-emerald-400 scale-100 shadow-[0_0_25px_rgba(52,211,153,0.35)]',
              });
              await triggerRecognition('FRONTAL', [frame]);
              return;
            }
          }
        }
      } catch (err) {
      } finally {
        isDetectingRef.current = false;
      }
    }, 120);

    return () => clearInterval(loopInterval);
  }, [cameraActive, cachedEmployees, config, selectedType, pythonEngineActive, isFallbackOpen]);

  const generateUuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const blobToBase64 = (blob: Blob | null | undefined): Promise<string | null> => {
    if (!blob) return Promise.resolve(null);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  };

  const executeAttendanceTap = async (
    employee: any,
    confidenceScore: number,
    isCrossLocation: boolean,
    verificationMeta?: any,
    capturedFrames: Blob[] = []
  ) => {
    scanLockRef.current = true;
    setScanStatus('scanning');

    const frontBlob = capturedFrames[0] || phaseProofRef.current.front || null;
    let proofPhotoBase64 = await blobToBase64(frontBlob);
    phaseProofRef.current = {};

    if (!proofPhotoBase64 && videoRef.current && videoRef.current.readyState >= 2) {
      try {
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = Math.min(videoRef.current.videoWidth || 640, 640);
        snapCanvas.height = Math.min(videoRef.current.videoHeight || 480, 480);
        const ctx = snapCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, snapCanvas.width, snapCanvas.height);
          proofPhotoBase64 = snapCanvas.toDataURL('image/jpeg', 0.85);
        }
      } catch (e) {}
    }

    const idempotencyKey = generateUuid();
    const now = new Date();
    const workDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const recordedAt = now.toISOString();

    const payload = {
      idempotency_key: idempotencyKey,
      employee_id: employee.id || employee.employee_id,
      kiosk_device_id: config?.device?.id || null,
      kiosk_location_id: config?.location?.id || null,
      work_date: workDate,
      attendance_type: selectedType,
      auth_method: 'face_liveness',
      recorded_at: recordedAt,
      confidence_score: Math.round(confidenceScore * 1000) / 1000,
      liveness_passed: true,
      is_cross_location: isCrossLocation,
      proof_photo_base64: proofPhotoBase64,
      proof_photo_left_base64: null,
      proof_photo_right_base64: null,
      session_id: verificationMeta?.session_id || idempotencyKey,
      decision: verificationMeta?.decision || 'VERIFIED',
      reject_reason: verificationMeta?.reject_reason || null,
      top1_employee_id: verificationMeta?.top1_employee_id || verificationMeta?.employee?.employee_id || employee.id || employee.employee_id,
      top1_score: verificationMeta?.top1_score || confidenceScore,
      top2_employee_id: verificationMeta?.top2_employee_id || verificationMeta?.candidates?.[1]?.employee_id || null,
      top2_score: verificationMeta?.top2_score || null,
      score_margin: verificationMeta?.score_margin || null,
      passive_spoof_score: verificationMeta?.passive_spoof_score || null,
      active_liveness_type: verificationMeta?.challenge_type || 'FRONTAL',
      captured_frames: verificationMeta?.captured_frames || 1,
      consistent_frames: verificationMeta?.consistent_frames || 1,
      quality_score: verificationMeta?.quality_metrics?.quality_score || 100,
      blur_score: verificationMeta?.quality_metrics?.blur_score || null,
      brightness_score: verificationMeta?.quality_metrics?.brightness || null,
      pose_yaw: verificationMeta?.quality_metrics?.yaw || null,
      pose_pitch: verificationMeta?.quality_metrics?.pitch || null,
      pose_roll: verificationMeta?.quality_metrics?.roll || null,
      attestation_token: verificationMeta?.attestation_token || null,
      attestation_timestamp: verificationMeta?.attestation_timestamp || null,
    };

    if (!navigator.onLine) {
      beginErrorCooldown(
        'Verifikasi wajah membutuhkan koneksi server. Gunakan jalur darurat ID dan PIN.',
        'error',
        true
      );
      return;
    }

    try {
      const res = await axios.post('/api/kiosk/attendance-tap', payload);
      showSuccessResult({
        ...res.data,
        proof_photo_url: res.data.proof_photo_url || proofPhotoBase64,
      });
      setFailedCount(0);
    } catch (err: any) {
      beginErrorCooldown(
        err.response?.data?.message || 'Gagal memproses tap absensi. Silakan coba lagi.',
        'error'
      );
    }
  };

  const showSuccessResult = (resultData: any) => {
    if (errorCooldownTimeoutRef.current !== null) {
      window.clearTimeout(errorCooldownTimeoutRef.current);
      errorCooldownTimeoutRef.current = null;
    }
    if (errorCooldownIntervalRef.current !== null) {
      window.clearInterval(errorCooldownIntervalRef.current);
      errorCooldownIntervalRef.current = null;
    }
    toast.dismiss(ERROR_TOAST_ID);
    setCooldownSeconds(0);
    setLastResult(resultData);
    setScanStatus('success');

    if (successTimeoutRef.current !== null) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => {
      setLastResult(null);
      setScanStatus('idle');
      scanLockRef.current = false;
      successTimeoutRef.current = null;
      serverOnlyTimerRef.current = 0;
      livenessFramesRef.current = [];
      phaseProofRef.current = {};
      setChallengeUI({
        text: 'Hadap Lurus',
        subtext: 'Posisikan wajah di dalam bingkai',
        badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse',
        borderClass: 'border-white/30 scale-100',
      });
    }, 3500);
  };

  const openFallbackModal = () => {
    stopCamera();
    serverOnlyTimerRef.current = 0;
    livenessFramesRef.current = [];
    phaseProofRef.current = {};
    if (overlayCanvasRef.current) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
    }
    setIsFallbackOpen(true);
  };

  const closeFallbackModal = () => {
    setIsFallbackOpen(false);
    startCamera();
  };

  const handleFallbackSuccess = (resultData: any) => {
    setIsFallbackOpen(false);
    showSuccessResult(resultData);
    startCamera();
  };

  const handleManualFallbackClick = () => {
    openFallbackModal();
  };

  const defaultButtons = [
    { attendance_type: 'clock_in', label: 'Masuk', icon: LogIn },
    { attendance_type: 'break_start', label: 'Istirahat Mulai', icon: Coffee },
    { attendance_type: 'break_end', label: 'Istirahat Selesai', icon: Coffee },
    { attendance_type: 'clock_out', label: 'Pulang', icon: LogOut },
    { attendance_type: 'overtime_start', label: 'Lembur Mulai', icon: Clock },
    { attendance_type: 'overtime_end', label: 'Lembur Selesai', icon: Clock },
  ];

  const buttonsToRender =
    config?.buttons && config.buttons.length > 0
      ? config.buttons.map((b: any) => {
          const matchDef = defaultButtons.find((d) => d.attendance_type === b.attendance_type);
          return {
            ...b,
            icon: matchDef ? matchDef.icon : Clock,
          };
        })
      : defaultButtons;

  return (
    <KioskLayout
      locationInfo={config?.location}
      onOpenHrdModal={stopCamera}
      onCloseHrdModal={startCamera}
    >
      <div className="flex-1 flex flex-col md:flex-row p-3 md:p-6 gap-4 md:gap-6 max-w-7xl mx-auto w-full">
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="relative w-full max-w-2xl aspect-4/3 rounded-3xl overflow-hidden bg-black/95 shadow-2xl border-4 border-card">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover transform -scale-x-100"
            />
            <canvas ref={canvasRef} className="hidden" />
            <canvas
              ref={overlayCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none transform -scale-x-100"
            />

            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <div
                className={`w-64 h-80 rounded-[48%] border-4 transition-all duration-300 flex items-center justify-center relative ${
                  scanStatus === 'success'
                    ? 'border-emerald-500 scale-105 shadow-[0_0_40px_rgba(16,185,129,0.6)]'
                    : scanStatus === 'scanning'
                    ? 'border-primary animate-pulse scale-100 shadow-[0_0_30px_rgba(76,88,111,0.6)]'
                    : challengeUI.borderClass
                }`}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white/40 rounded-full" />

                {challengeUI.text.includes('Tengok') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-indigo-400 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full animate-pulse">
                    <ScanFace className="h-6 w-6" />
                  </div>
                )}
                {challengeUI.text.includes('Terverifikasi') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-emerald-400 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full animate-pulse">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                )}
              </div>

              <div className="mt-4 pointer-events-auto">
                <div
                  className={`px-4 py-2 rounded-full border backdrop-blur-md flex items-center gap-2 shadow-lg transition-all duration-200 ${challengeUI.badgeClass}`}
                >
                  <ScanFace className="h-4 w-4 shrink-0" />
                  <div className="text-center">
                    <div className="text-xs font-bold leading-tight">{challengeUI.text}</div>
                    <div className="text-[10px] opacity-80">{challengeUI.subtext}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`gap-1.5 backdrop-blur-md px-3 py-1 font-medium ${
                    lighting.status === 'good'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  <SunMedium className="h-3.5 w-3.5" />
                  <span>{lighting.label}</span>
                </Badge>

                <Badge
                  variant="outline"
                  className={`gap-1 backdrop-blur-md px-2.5 py-1 text-xs ${
                    pythonEngineActive
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  <ShieldCheck className="h-3 w-3" />
                  <span>{pythonEngineActive ? 'Server Liveness Aktif' : 'Menghubungkan Mesin Wajah'}</span>
                </Badge>
              </div>

              <Badge
                variant="outline"
                className="bg-black/40 text-white/90 border-white/20 backdrop-blur-md px-3 py-1 text-xs"
              >
                {cachedEmployees.filter((e: any) => e.has_biometric || (e.embeddings && e.embeddings.length > 0)).length} Wajah Terdaftar
              </Badge>
            </div>

            {scanStatus === 'success' && lastResult && (
              <div
                className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6"
                role="status"
                aria-live="polite"
              >
                <Card className="w-full max-w-md p-6 bg-card/95 border-emerald-500/40 shadow-2xl text-center space-y-4">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md">
                    <Check className="h-11 w-11" strokeWidth={3} aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                      Absensi Berhasil
                    </div>
                    <h3 className="text-xl font-bold tracking-tight text-foreground">
                      {lastResult.employee?.nama_karyawan}
                    </h3>
                    <div className="text-sm text-muted-foreground font-mono">
                      {lastResult.employee?.id_karyawan}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold text-sm">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <span>{formatLateLabel(lastResult.status_label) || lastResult.message || 'Absen Berhasil'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tercatat pukul: <span className="font-mono font-bold">{lastResult.recorded_time}</span>
                  </div>
                </Card>
              </div>
            )}

            {scanStatus === 'cooldown' && (
              <div
                className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6"
                role="status"
                aria-live="polite"
              >
                <Card className="w-full max-w-sm p-6 bg-card/95 border-amber-500/50 shadow-xl text-center space-y-4">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/50">
                    <AlertCircle className="h-9 w-9" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">Pemindaian Dijeda</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Kamera akan mencoba lagi dalam {cooldownSeconds} detik.
                    </p>
                  </div>
                </Card>
              </div>
            )}

          </div>

          <div className="flex items-center justify-center gap-3 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualFallbackClick}
              className="gap-2 text-xs font-semibold h-11 px-4 rounded-full border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Jalur Darurat (ID & PIN)</span>
            </Button>
          </div>
        </div>

        <div className="w-full md:w-80 flex flex-col justify-between gap-4">
          <Card className="p-4 shadow-sm border space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Pilih Tipe Absen
              </span>
              <Badge variant="secondary" className="text-[10px] uppercase">
                Auto-Highlight
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-1 gap-2.5">
              {buttonsToRender.map((btn: any) => {
                const isSelected = selectedType === btn.attendance_type;
                const IconComponent = btn.icon || Clock;

                return (
                  <button
                    key={btn.attendance_type}
                    type="button"
                    onClick={() => setSelectedType(btn.attendance_type)}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-left font-medium transition-all duration-150 ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]'
                        : 'bg-card hover:bg-accent/60 border-border text-foreground'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        isSelected
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{btn.label}</div>
                      <div
                        className={`text-[11px] ${
                          isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                        }`}
                      >
                        {isSelected ? 'Sedang Aktif' : 'Klik untuk pilih'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="p-4 bg-muted/30 border text-xs text-muted-foreground space-y-2">
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <UserCheck className="h-4 w-4 text-primary" />
              <span>Verifikasi Wajah Multi-Frame</span>
            </div>
            <ul className="space-y-1 list-disc pl-4 leading-relaxed">
              <li>Memeriksa gerakan kepala dan kualitas wajah pada beberapa frame.</li>
              <li>Mencocokkan embedding InsightFace 512 dimensi dengan verifikasi model kedua.</li>
              <li>Hasil yang terlalu dekat dialihkan ke jalur verifikasi ID dan PIN.</li>
            </ul>
          </Card>
        </div>
      </div>

      <FallbackModal
        isOpen={isFallbackOpen}
        onClose={closeFallbackModal}
        videoRef={videoRef}
        selectedType={selectedType}
        locationInfo={config?.location}
        deviceInfo={config?.device}
        onSuccess={handleFallbackSuccess}
      />
    </KioskLayout>
  );
}
