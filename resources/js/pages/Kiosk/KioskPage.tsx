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
  CheckCircle2,
  Clock,
  Sparkles,
  KeyRound,
  RefreshCw,
  SunMedium,
  UserCheck,
  Eye,
  EyeOff,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';
import {
  loadBiometricModels,
  detectFaceFast,
  assessLightingQuality,
  checkPythonEngineHealth,
  captureBurstFrames,
  captureFrameBlob,
  recognizeFaceWithPython,
  ActiveChallengeDetector,
} from '@/lib/biometricEngine';
import { cacheEmployees, getCachedEmployees } from '@/lib/offlineQueue';
import axios from 'axios';
import { toast } from 'sonner';

export function KioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [config, setConfig] = useState<any>(null);
  const [cachedEmployees, setCachedEmployees] = useState<any[]>([]);
  const [selectedType, setSelectedType] = useState<string>('clock_in');
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [lighting, setLighting] = useState<{ status: string; label: string }>({
    status: 'good',
    label: 'Mendeteksi cahaya...',
  });

  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'success'>('idle');
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
    text: 'Tengok Kiri / Kanan',
    subtext: 'Arahkan kepala sedikit ke kiri atau ke kanan',
    badgeClass: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/40 animate-pulse',
    borderClass: 'border-white/30 scale-100',
  });

  const scanLockRef = useRef<boolean>(false);
  const isDetectingRef = useRef<boolean>(false);
  const activeDetectorRef = useRef<ActiveChallengeDetector>(new ActiveChallengeDetector('HEAD_TURN'));
  const livenessFramesRef = useRef<Blob[]>([]);
  const lastLivenessCaptureRef = useRef<number>(0);

  useEffect(() => {
    loadConfig();
    loadEmployees();
    startCamera();

    loadBiometricModels()
      .then(() => {
        setModelReady(true);
      })
      .catch(() => {
        toast.error('Gagal memuat model neural network wajah');
      });

    return () => {
      stopCamera();
    };
  }, []);

  const loadConfig = async () => {
    try {
      const res = await axios.get('/api/kiosk/config');
      setConfig(res.data);
      autoSelectButton(res.data.buttons);
    } catch (err) {}
  };

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

      const pyStatus = await checkPythonEngineHealth();
      if (pyStatus.available) {
        setPythonEngineActive(true);
      } else {
        setPythonEngineActive(false);
      }
    } catch (err) {}
  };

  const startCamera = async () => {
    stopCamera();
    try {
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
    } catch (err) {
      setCameraActive(false);
      toast.error('Kamera tidak dapat diakses');
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

  const triggerRecognition = async (
    challengeType: string,
    challengeFrames: Blob[] = []
  ) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanStatus('scanning');

    if (pythonEngineActive && videoRef.current) {
      const frameCount = config?.settings?.capture_frame_count || 5;
      const bufferedFrames = challengeFrames.slice(-frameCount);
      const missingFrameCount = Math.max(0, frameCount - bufferedFrames.length);
      const additionalFrames = missingFrameCount > 0
        ? await captureBurstFrames(videoRef.current, missingFrameCount, 100)
        : [];
      const frames = [...bufferedFrames, ...additionalFrames].slice(-frameCount);
      if (frames.length > 0) {
        const companyId = config?.location?.company_id || 1;
        const allowedCompanyIds = [companyId];
        const proyekId = config?.location?.proyek_id;
        const cabangId = config?.location?.cabang_id;

        const recRes = await recognizeFaceWithPython(
          frames,
          companyId,
          allowedCompanyIds,
          proyekId,
          cabangId,
          challengeType
        );

        if (recRes.decision === 'VERIFIED' && recRes.employee) {
          executeAttendanceTap(
            recRes.employee,
            recRes.confidence_score || recRes.top1_score || 0.85,
            recRes.is_cross_location,
            recRes
          );
          return;
        } else if (recRes.decision === 'AMBIGUOUS' || recRes.status === 'ambiguous') {
          toast.warning(recRes.message || 'Ada lebih dari satu kandidat wajah. Gunakan jalur darurat ID dan PIN.');
          setIsFallbackOpen(true);
          setScanStatus('idle');
          scanLockRef.current = false;
          activeDetectorRef.current.pickRandomChallenge(config?.settings?.allowed_challenges);
          return;
        } else if (recRes.decision === 'RETRY') {
          toast.warning(recRes.message || 'Wajah belum dapat dipastikan, coba lagi');
          setScanStatus('idle');
          scanLockRef.current = false;
          activeDetectorRef.current.pickRandomChallenge(config?.settings?.allowed_challenges);
          return;
        } else if (recRes.decision === 'SPOOF_REJECTED') {
          toast.error(recRes.message || 'Verifikasi gagal: Keaslian wajah fisik tidak terdeteksi');
          setScanStatus('idle');
          scanLockRef.current = false;
          activeDetectorRef.current.pickRandomChallenge(config?.settings?.allowed_challenges);
          return;
        } else if (recRes.decision === 'QUALITY_REJECTED') {
          toast.warning(recRes.message || 'Kualitas frame wajah belum memenuhi standar');
          setScanStatus('idle');
          scanLockRef.current = false;
          return;
        } else {
          toast.info(recRes.message || 'Wajah tidak terdaftar dalam sistem');
          setFailedCount((prev) => {
            const next = prev + 1;
            if (next >= (config?.settings?.max_failed_scans || 3)) {
              setIsFallbackOpen(true);
              return 0;
            }
            return next;
          });
          setScanStatus('idle');
          scanLockRef.current = false;
          activeDetectorRef.current.pickRandomChallenge(config?.settings?.allowed_challenges);
          return;
        }
      }
    }

    toast.error('Mesin biometrik tidak tersedia. Gunakan jalur darurat ID dan PIN.');
    setIsFallbackOpen(true);
    setScanStatus('idle');
    scanLockRef.current = false;
  };

  useEffect(() => {
    const loopInterval = setInterval(async () => {
      if (
        !videoRef.current ||
        !cameraActive ||
        !modelReady ||
        scanLockRef.current ||
        isDetectingRef.current
      ) {
        return;
      }

      if (canvasRef.current) {
        const lightCheck = assessLightingQuality(videoRef.current, canvasRef.current);
        setLighting({ status: lightCheck.status, label: lightCheck.label });
      }

      isDetectingRef.current = true;

      try {
        const detection = await detectFaceFast(videoRef.current);

        if (overlayCanvasRef.current && videoRef.current) {
          const overlay = overlayCanvasRef.current;
          overlay.width = videoRef.current.videoWidth || 640;
          overlay.height = videoRef.current.videoHeight || 480;
          const ctx = overlay.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            if (detection) {
              const { x, y, width, height } = detection.box;
              ctx.strokeStyle = '#10b981';
              ctx.lineWidth = 3;
              ctx.strokeRect(x, y, width, height);
            }
          }
        }

        if (!detection) {
          activeDetectorRef.current.reset();
          livenessFramesRef.current = [];
          setChallengeUI({
            text: 'Tengok Kiri / Kanan',
            subtext: 'Arahkan kepala sedikit ke kiri atau ke kanan',
            badgeClass: 'bg-muted/80 text-muted-foreground border-border',
            borderClass: 'border-white/30 scale-100',
          });
          return;
        }

        const now = Date.now();
        if (now - lastLivenessCaptureRef.current >= 120 && videoRef.current) {
          const frame = await captureFrameBlob(videoRef.current);
          if (frame) {
            const frameLimit = Math.max(config?.settings?.capture_frame_count || 5, 6);
            livenessFramesRef.current = [...livenessFramesRef.current, frame].slice(-frameLimit);
            lastLivenessCaptureRef.current = now;
          }
        }

        const activeResult = activeDetectorRef.current.update(detection.landmarks);
        setChallengeUI({
          text: activeResult.text,
          subtext: activeResult.subtext,
          badgeClass: activeResult.badgeClass,
          borderClass: activeResult.borderClass,
        });

        if (activeResult.verified) {
          const challengeFrames = [...livenessFramesRef.current];
          livenessFramesRef.current = [];
          await triggerRecognition(
            activeDetectorRef.current.getChallenge(),
            challengeFrames
          );
          return;
        }
      } catch (err) {
      } finally {
        isDetectingRef.current = false;
      }
    }, 100);

    return () => clearInterval(loopInterval);
  }, [cameraActive, modelReady, cachedEmployees, config, selectedType, pythonEngineActive]);

  const generateUuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const executeAttendanceTap = async (
    employee: any,
    confidenceScore: number,
    isCrossLocation: boolean,
    verificationMeta?: any
  ) => {
    scanLockRef.current = true;
    setScanStatus('scanning');

    let proofPhotoBase64: string | null = null;
    if (videoRef.current && videoRef.current.readyState >= 2) {
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
      session_id: verificationMeta?.session_id || idempotencyKey,
      decision: verificationMeta?.decision || 'VERIFIED',
      reject_reason: verificationMeta?.reject_reason || null,
      top1_employee_id: verificationMeta?.top1_employee_id || verificationMeta?.employee?.employee_id || employee.id || employee.employee_id,
      top1_score: verificationMeta?.top1_score || confidenceScore,
      top2_employee_id: verificationMeta?.top2_employee_id || verificationMeta?.candidates?.[1]?.employee_id || null,
      top2_score: verificationMeta?.top2_score || null,
      score_margin: verificationMeta?.score_margin || null,
      passive_spoof_score: verificationMeta?.passive_spoof_score || null,
      active_liveness_type: verificationMeta?.challenge_type || activeDetectorRef.current.getChallenge(),
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
      toast.error('Verifikasi wajah membutuhkan koneksi server. Gunakan jalur darurat ID dan PIN.');
      setIsFallbackOpen(true);
      scanLockRef.current = false;
      setScanStatus('idle');
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
      toast.error('Gagal memproses tap absensi');
      scanLockRef.current = false;
      setScanStatus('idle');
    }
  };

  const showSuccessResult = (resultData: any) => {
    setLastResult(resultData);
    setScanStatus('success');

    setTimeout(() => {
      setLastResult(null);
      setScanStatus('idle');
      scanLockRef.current = false;
    }, 3500);
  };

  const handleManualFallbackClick = () => {
    setIsFallbackOpen(true);
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
                    ? 'border-primary animate-pulse scale-100 shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                    : challengeUI.borderClass
                }`}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white/40 rounded-full" />

                {challengeUI.text.includes('Tengok') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-indigo-400 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full animate-pulse">
                    <ScanFace className="h-6 w-6" />
                  </div>
                )}
                {challengeUI.text.includes('Buka') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-purple-400 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full animate-pulse">
                    <Sparkles className="h-6 w-6" />
                  </div>
                )}
                {challengeUI.text.includes('Kedip') && !challengeUI.text.includes('Tengok') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-sky-400 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full animate-bounce">
                    <Eye className="h-6 w-6" />
                  </div>
                )}
                {challengeUI.text.includes('Tertutup') && (
                  <div className="absolute top-1/3 flex items-center justify-center text-amber-300 bg-black/40 backdrop-blur-xs px-3 py-1.5 rounded-full">
                    <EyeOff className="h-6 w-6" />
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
                  className="gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30 backdrop-blur-md px-2.5 py-1 text-xs"
                >
                  <ShieldCheck className="h-3 w-3" />
                  <span>Server Liveness Aktif</span>
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
              <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
                <Card className="w-full max-w-md p-6 bg-card/95 border-emerald-500/40 shadow-2xl text-center space-y-4">
                  {lastResult.proof_photo_url ? (
                    <div className="relative mx-auto w-24 h-24 rounded-full overflow-hidden border-2 border-emerald-500 shadow-md">
                      <img
                        src={lastResult.proof_photo_url}
                        alt="Foto Wajah"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-emerald-600/90 text-white text-[9px] font-bold py-0.5">
                        TERVERIFIKASI
                      </div>
                    </div>
                  ) : (
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
                      <CheckCircle2 className="h-10 w-10 animate-bounce" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-foreground">
                      {lastResult.employee?.nama_karyawan}
                    </h3>
                    <div className="text-sm text-muted-foreground font-mono">
                      {lastResult.employee?.id_karyawan}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                    <Sparkles className="h-4 w-4" />
                    <span>{lastResult.status_label || lastResult.message || 'Absen Berhasil'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tercatat pukul: <span className="font-mono font-bold">{lastResult.recorded_time}</span>
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
              className="gap-2 text-xs font-semibold h-9 px-4 rounded-full border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
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
        onClose={() => setIsFallbackOpen(false)}
        videoRef={videoRef}
        selectedType={selectedType}
        locationInfo={config?.location}
        deviceInfo={config?.device}
        onSuccess={showSuccessResult}
      />
    </KioskLayout>
  );
}
