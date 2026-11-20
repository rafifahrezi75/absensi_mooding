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
  AlertCircle,
  KeyRound,
  RefreshCw,
  SunMedium,
  UserCheck,
  BrainCircuit,
} from 'lucide-react';
import {
  loadBiometricModels,
  detectFaceWithDescriptor,
  verifyLivenessFromLandmarks,
  matchFaceToEmployees,
  assessLightingQuality,
} from '@/lib/biometricEngine';
import {
  cacheEmployees,
  getCachedEmployees,
  saveOfflineEvent,
} from '@/lib/offlineQueue';
import axios from 'axios';
import { toast } from 'sonner';

export function KioskPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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

  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'success' | 'ambiguous'>('idle');
  const [lastResult, setLastResult] = useState<any>(null);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [isFallbackOpen, setIsFallbackOpen] = useState<boolean>(false);
  const [ambiguousData, setAmbiguousData] = useState<any>(null);
  const [digitConfirm, setDigitConfirm] = useState<string>('');

  const scanLockRef = useRef<boolean>(false);
  const isDetectingRef = useRef<boolean>(false);

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
    const currentHms = now.toTimeString().split(' ')[0];

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
    } catch (err) {}
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
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
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
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
        const detection = await detectFaceWithDescriptor(videoRef.current);

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

        if (detection && detection.descriptor) {
          const livenessOk = verifyLivenessFromLandmarks(detection.landmarks);
          if (!livenessOk) {
            isDetectingRef.current = false;
            return;
          }

          const maxDist = 0.55;
          const margin = config?.settings?.ambiguity_margin || 0.08;

          const matchResult = matchFaceToEmployees(
            detection.descriptor,
            cachedEmployees,
            config?.location,
            maxDist,
            margin
          );

          if (matchResult.matched && matchResult.employee) {
            if (matchResult.ambiguous) {
              setAmbiguousData(matchResult);
              setScanStatus('ambiguous');
              isDetectingRef.current = false;
              return;
            }

            executeAttendanceTap(
              matchResult.employee,
              matchResult.confidenceScore,
              matchResult.isCrossLocation
            );
          } else {
            setFailedCount((prev) => {
              const next = prev + 1;
              if (next >= (config?.settings?.max_failed_scans || 3)) {
                setIsFallbackOpen(true);
                return 0;
              }
              return next;
            });
          }
        }
      } catch (err) {
      } finally {
        isDetectingRef.current = false;
      }
    }, 500);

    return () => clearInterval(loopInterval);
  }, [cameraActive, modelReady, cachedEmployees, config, selectedType]);

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
    isCrossLocation: boolean
  ) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanStatus('scanning');

    const idempotencyKey = generateUuid();
    const now = new Date();
    const workDate = now.toISOString().split('T')[0];
    const recordedAt = now.toISOString();

    const payload = {
      idempotency_key: idempotencyKey,
      employee_id: employee.id,
      kiosk_device_id: config?.device?.id || null,
      kiosk_location_id: config?.location?.id || null,
      work_date: workDate,
      attendance_type: selectedType,
      auth_method: 'face_liveness',
      recorded_at: recordedAt,
      confidence_score: Math.round(confidenceScore * 1000) / 1000,
      liveness_passed: true,
      is_cross_location: isCrossLocation,
    };

    if (!navigator.onLine) {
      try {
        await saveOfflineEvent(payload);
        const resultDisplay = {
          employee: {
            nama_karyawan: employee.nama_karyawan,
            id_karyawan: employee.id_karyawan,
          },
          status_label: 'Tersimpan Offline — Akan Disinkronkan Otomatis',
          recorded_time: now.toLocaleTimeString('id-ID'),
        };
        showSuccessResult(resultDisplay);
      } catch (err) {
        scanLockRef.current = false;
        setScanStatus('idle');
      }
      return;
    }

    try {
      const res = await axios.post('/api/kiosk/attendance-tap', payload);
      showSuccessResult(res.data);
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

  const handleConfirmAmbiguity = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ambiguousData) return;

    const cand1 = ambiguousData.employee;
    const cand2 = ambiguousData.secondaryEmployee;

    let selectedCandidate = null;
    if (cand1 && cand1.id_karyawan.endsWith(digitConfirm)) {
      selectedCandidate = cand1;
    } else if (cand2 && cand2.id_karyawan.endsWith(digitConfirm)) {
      selectedCandidate = cand2;
    }

    if (selectedCandidate) {
      setScanStatus('idle');
      setAmbiguousData(null);
      setDigitConfirm('');
      executeAttendanceTap(
        selectedCandidate,
        ambiguousData.confidenceScore,
        ambiguousData.isCrossLocation
      );
    } else {
      toast.error('4 digit terakhir tidak sesuai dengan kandidat wajah');
    }
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
    <KioskLayout locationInfo={config?.location}>
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

            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                className={`w-64 h-80 rounded-[48%] border-4 transition-all duration-300 ${
                  scanStatus === 'success'
                    ? 'border-emerald-500 scale-105 shadow-[0_0_40px_rgba(16,185,129,0.6)]'
                    : scanStatus === 'scanning'
                    ? 'border-primary animate-pulse scale-100 shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                    : 'border-white/40 scale-100'
                }`}
              >
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white/40 rounded-full" />
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

                {modelReady ? (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-blue-500/20 text-blue-300 border-blue-500/30 backdrop-blur-md px-2.5 py-1 text-xs"
                  >
                    <BrainCircuit className="h-3 w-3" />
                    <span>ResNet AI</span>
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-amber-500/20 text-amber-300 border-amber-500/30 backdrop-blur-md px-2.5 py-1 text-xs animate-pulse"
                  >
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Memuat AI...</span>
                  </Badge>
                )}
              </div>

              <Badge
                variant="outline"
                className="bg-black/40 text-white/90 border-white/20 backdrop-blur-md px-3 py-1 text-xs"
              >
                {cachedEmployees.length} Wajah Terdaftar
              </Badge>
            </div>

            {scanStatus === 'success' && lastResult && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in zoom-in-95 duration-200">
                <Card className="w-full max-w-md p-6 bg-card/95 border-emerald-500/40 shadow-2xl text-center space-y-4">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
                    <CheckCircle2 className="h-10 w-10 animate-bounce" />
                  </div>
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

            {scanStatus === 'ambiguous' && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in duration-200">
                <Card className="w-full max-w-md p-6 bg-card text-center space-y-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
                    <AlertCircle className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Wajah Sangat Mirip</h3>
                    <p className="text-xs text-muted-foreground">
                      Sistem mendeteksi 2 karyawan dengan profil wajah serupa. Masukkan 4 digit terakhir ID Karyawan Anda untuk konfirmasi.
                    </p>
                  </div>
                  <form onSubmit={handleConfirmAmbiguity} className="space-y-3">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="Contoh: 0001"
                      value={digitConfirm}
                      onChange={(e) => setDigitConfirm(e.target.value)}
                      className="w-full text-center text-2xl font-mono tracking-widest border rounded-md h-12 bg-background"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-1/2"
                        onClick={() => {
                          setScanStatus('idle');
                          setAmbiguousData(null);
                        }}
                      >
                        Batal
                      </Button>
                      <Button type="submit" className="w-1/2" disabled={digitConfirm.length < 2}>
                        Konfirmasi
                      </Button>
                    </div>
                  </form>
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
              <span>Model AI Biometrik ResNet</span>
            </div>
            <ul className="space-y-1 list-disc pl-4 leading-relaxed">
              <li>Mendeteksi 68 landmark wajah untuk liveness anti-spoofing foto/layar HP.</li>
              <li>Ekstraksi vektor embedding 128 dimensi berakurasi tinggi (ResNet-34).</li>
              <li>Beda orang (seperti Budi dan Rizky) terjamin tidak akan tertukar.</li>
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
