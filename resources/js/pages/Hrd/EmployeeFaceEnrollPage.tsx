import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  BrainCircuit,
} from 'lucide-react';
import { checkPythonEngineHealth } from '@/lib/biometricEngine';
import axios from 'axios';
import { toast } from 'sonner';

type PoseKey = 'front' | 'slight_left' | 'slight_right';

interface PoseSpec {
  key: PoseKey;
  stepNumber: number;
  shortLabel: string;
  title: string;
  instruction: string;
  hint: string;
}

interface CapturedPose {
  pose: PoseKey;
  photoBase64: string;
  enrollData: any;
  meta: {
    quality_score?: number;
    blur_score?: number;
    brightness?: number;
    yaw?: number;
    pitch?: number;
    roll?: number;
  };
}

const REQUIRED_POSES: PoseSpec[] = [
  {
    key: 'front',
    stepNumber: 1,
    shortLabel: 'Lurus',
    title: 'Foto 1: Hadap Lurus',
    instruction: 'Hadapkan wajah tegak lurus ke kamera',
    hint: 'Posisi netral, mata menatap kamera, pencahayaan merata',
  },
  {
    key: 'slight_left',
    stepNumber: 2,
    shortLabel: 'Kiri',
    title: 'Foto 2: Tengok Kiri',
    instruction: 'Tengokkan wajah sedikit ke kiri',
    hint: 'Putar kepala ringan sekitar 10 sampai 30 derajat ke kiri',
  },
  {
    key: 'slight_right',
    stepNumber: 3,
    shortLabel: 'Kanan',
    title: 'Foto 3: Tengok Kanan',
    instruction: 'Tengokkan wajah sedikit ke kanan',
    hint: 'Putar kepala ringan sekitar 10 sampai 30 derajat ke kanan',
  },
];

export function EmployeeFaceEnrollPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const replaceEmbeddingId = searchParams.get('replace_embedding_id');
  const requestedPose = searchParams.get('pose') as PoseKey | null;
  const batchIdParam = searchParams.get('batch_id');
  const packetIdsParam = searchParams.get('packet_ids');
  const isSinglePoseMode =
    Boolean(requestedPose && ['front', 'slight_left', 'slight_right'].includes(requestedPose)) &&
    (Boolean(replaceEmbeddingId) || searchParams.get('single') === '1');
  const initialReplaceExisting = searchParams.get('mode') === 'replace';

  const targetPoses = isSinglePoseMode && requestedPose
    ? REQUIRED_POSES.filter((p) => p.key === requestedPose)
    : REQUIRED_POSES;

  const [loadingEmployee, setLoadingEmployee] = useState<boolean>(true);
  const [employee, setEmployee] = useState<any>(null);
  const [locationName, setLocationName] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState<boolean | null>(null);

  const [activePose, setActivePose] = useState<PoseKey>(
    isSinglePoseMode && requestedPose ? requestedPose : 'front'
  );
  const [captures, setCaptures] = useState<Partial<Record<PoseKey, CapturedPose>>>({});
  const [capturingPose, setCapturingPose] = useState<boolean>(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [replaceExisting, setReplaceExisting] = useState<boolean>(initialReplaceExisting);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    fetchEmployee();
    verifyEngine();
  }, [id]);

  useEffect(() => {
    if (!loadingEmployee && employee) {
      startCamera();
    }

    return () => {
      stopCamera();
    };
  }, [loadingEmployee, employee]);

  const fetchEmployee = async () => {
    if (!id) return;
    setLoadingEmployee(true);
    try {
      const res = await axios.get(`/api/hrd/employees/${id}`);
      setEmployee(res.data.employee);
      setLocationName(res.data.location?.location_name || null);
      if (searchParams.get('mode') === 'add') {
        setReplaceExisting(false);
      } else if (searchParams.get('mode') === 'replace') {
        setReplaceExisting(true);
      }
    } catch {
      toast.error('Gagal memuat data karyawan');
      navigate('/hrd/employees');
    } finally {
      setLoadingEmployee(false);
    }
  };

  const verifyEngine = async (): Promise<boolean> => {
    const status = await checkPythonEngineHealth();
    setEngineReady(status.available);
    return status.available;
  };

  const startCamera = async () => {
    stopCamera();
    setCameraReady(false);
    setCameraError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError('Perangkat atau browser tidak mendukung akses kamera langsung');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current
            ?.play()
            .then(() => setCameraReady(true))
            .catch(() => setCameraReady(true));
        };
        videoRef.current
          ?.play()
          .then(() => setCameraReady(true))
          .catch(() => setCameraReady(true));
      }

      setTimeout(() => {
        if (streamRef.current?.active && !cameraReady) {
          if (videoRef.current && !videoRef.current.srcObject) {
            videoRef.current.srcObject = streamRef.current;
          }
          videoRef.current?.play().catch(() => {});
          setCameraReady(true);
        }
      }, 750);
    } catch (err: any) {
      setCameraError(err?.message || 'Kamera tidak dapat diakses atau sedang dipakai aplikasi lain');
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
    setCameraReady(false);
  };

  const capturedCount = targetPoses.filter((p) => Boolean(captures[p.key])).length;
  const allRequiredCaptured = capturedCount === targetPoses.length;
  const activePoseSpec = targetPoses.find((p) => p.key === activePose) || targetPoses[0];

  const handleCapturePose = async () => {
    if (!employee || capturingPose) return;

    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      toast.error('Kamera belum siap, tunggu beberapa detik lalu coba lagi');
      return;
    }

    setCapturingPose(true);
    setCaptureError(null);

    try {
      const isEngineAvailable = engineReady ? true : await verifyEngine();
      if (!isEngineAvailable) {
        const msg = 'Mesin pengenalan wajah InsightFace (port 8005) belum aktif.';
        setCaptureError(msg);
        toast.error(msg);
        return;
      }

      const rawW = video.videoWidth || 640;
      const rawH = video.videoHeight || 480;
      const scale = rawW > 640 ? 640 / rawW : 1;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rawW * scale);
      canvas.height = Math.round(rawH * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCaptureError('Gagal menginisialisasi kanvas gambar kamera');
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const photoBase64 = canvas.toDataURL('image/jpeg', 0.85);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
      });

      if (!blob) {
        setCaptureError('Gagal mengambil data gambar dari kamera');
        return;
      }

      const formData = new FormData();
      formData.append('external_karyawan_id', employee.id.toString());
      formData.append('pose_label', activePose);
      formData.append('images', blob, `enroll_${activePose}.jpg`);

      const pyRes = await fetch('/api/face-engine/api/v1/enroll', {
        method: 'POST',
        body: formData,
      });

      if (!pyRes.ok) {
        const errJson = await pyRes.json().catch(() => ({}));
        const errMsg = errJson.detail || 'Wajah tidak memenuhi syarat pose atau kualitas';
        setCaptureError(errMsg);
        toast.error(errMsg);
        return;
      }

      const enrollData = await pyRes.json();
      const sampleMeta = enrollData.samples_metadata?.[0] || {};
      const newCapture: CapturedPose = {
        pose: activePose,
        photoBase64,
        enrollData,
        meta: {
          quality_score: sampleMeta.quality_score,
          blur_score: sampleMeta.blur_score,
          brightness: sampleMeta.brightness,
          yaw: sampleMeta.yaw,
          pitch: sampleMeta.pitch,
          roll: sampleMeta.roll,
        },
      };

      const nextCaptures: Partial<Record<PoseKey, CapturedPose>> = {
        ...captures,
        [activePose]: newCapture,
      };
      setCaptures(nextCaptures);
      toast.success(`${activePoseSpec.title} berhasil diambil`);

      const nextMissing = targetPoses.find((p) => !nextCaptures[p.key]);
      if (nextMissing) {
        setActivePose(nextMissing.key);
      }
    } catch {
      const msg = 'Terjadi gangguan jaringan saat memvalidasi foto wajah';
      setCaptureError(msg);
      toast.error(msg);
    } finally {
      setCapturingPose(false);
    }
  };

  const handleResetPose = (pose: PoseKey) => {
    setCaptures((prev) => {
      const next = { ...prev };
      delete next[pose];
      return next;
    });
    setActivePose(pose);
    setCaptureError(null);
  };

  const handleSaveFaces = async () => {
    if (!employee) return;

    if (!allRequiredCaptured) {
      toast.error(
        isSinglePoseMode
          ? 'Ambil foto pose wajah terlebih dahulu sebelum menyimpan'
          : 'Wajib mengambil ketiga foto pose wajah (Lurus, Kiri, Kanan) sebelum menyimpan'
      );
      return;
    }
    if (!consentChecked) {
      toast.error('Wajib mencentang persetujuan pemrosesan biometrik (UU PDP)');
      return;
    }

    setSaving(true);
    try {
      const templates: any[] = [];

      targetPoses.forEach((poseSpec) => {
        const item = captures[poseSpec.key];
        if (!item) return;

        const { enrollData, photoBase64, meta } = item;
        templates.push({
          embedding_vector: enrollData.mean_embedding,
          model_name: enrollData.model_name,
          model_version: enrollData.model_version,
          pose_label: poseSpec.key,
          photo_base64: photoBase64,
          quality_score: meta.quality_score,
          blur_score: meta.blur_score,
          brightness_score: meta.brightness,
          pose_yaw: meta.yaw,
          pose_pitch: meta.pitch,
          pose_roll: meta.roll,
        });

        if (enrollData.secondary_mean_embedding) {
          templates.push({
            embedding_vector: enrollData.secondary_mean_embedding,
            model_name: enrollData.secondary_model_name,
            model_version: enrollData.secondary_model_version,
            pose_label: poseSpec.key,
            photo_base64: null,
            quality_score: meta.quality_score,
            blur_score: meta.blur_score,
            brightness_score: meta.brightness,
            pose_yaw: meta.yaw,
            pose_pitch: meta.pitch,
            pose_roll: meta.roll,
          });
        }
      });

      const payload: any = {
        templates,
        consent_given: true,
      };

      if (isSinglePoseMode) {
        if (replaceEmbeddingId) {
          payload.replace_embedding_id = Number(replaceEmbeddingId);
        }
        if (batchIdParam) {
          payload.batch_id = batchIdParam;
        }
        if (packetIdsParam) {
          payload.packet_embedding_ids = packetIdsParam
            .split(',')
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n) && n > 0);
        }
      } else {
        payload.replace_existing = replaceExisting;
      }

      const res = await axios.post(`/api/hrd/employees/${employee.id}/enroll-face`, payload);

      if (res.data.success) {
        toast.success(
          isSinglePoseMode
            ? `Foto pose ${activePoseSpec.shortLabel} ${employee.nama_karyawan} berhasil disimpan`
            : `Paket 3 foto wajah ${employee.nama_karyawan} berhasil disimpan`
        );
        stopCamera();
        navigate(`/hrd/employees/${employee.id}?tab=faces`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan data biometrik wajah');
    } finally {
      setSaving(false);
    }
  };

  if (loadingEmployee) {
    return (
      <HrdLayout>
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
          <RefreshCw className="h-7 w-7 animate-spin text-primary" />
          <span>Menyiapkan halaman perekaman biometrik wajah...</span>
        </div>
      </HrdLayout>
    );
  }

  if (!employee) {
    return (
      <HrdLayout>
        <div className="py-16 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Data karyawan tidak ditemukan</p>
          <Button variant="outline" onClick={() => navigate('/hrd/employees')}>
            Kembali ke Daftar Karyawan
          </Button>
        </div>
      </HrdLayout>
    );
  }

  return (
    <HrdLayout>
      <div className="space-y-5 max-w-6xl mx-auto pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/hrd/employees/${employee.id}?tab=faces`)}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground -ml-2 w-fit min-h-9"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Kembali ke Detail Karyawan</span>
          </Button>

          <div className="flex items-center gap-2">
            {engineReady === false ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={verifyEngine}
                className="gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10 min-h-9"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                <span>Mesin Wajah Offline (Cek Ulang)</span>
              </Button>
            ) : (
              <Badge
                variant="outline"
                className="gap-1.5 py-1.5 px-3 text-xs bg-card text-foreground border-border"
              >
                <BrainCircuit className="h-3.5 w-3.5 text-primary" />
                <span>{engineReady === true ? 'InsightFace 512D Siap' : 'Memeriksa Mesin Wajah...'}</span>
              </Badge>
            )}
          </div>
        </div>

        <Card className="shadow-xs border">
          <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted border flex items-center justify-center shrink-0 font-bold text-sm text-foreground">
                {employee.profile_photo_url ? (
                  <img
                    src={employee.profile_photo_url}
                    alt={employee.nama_karyawan}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{employee.nama_karyawan?.slice(0, 2).toUpperCase() || 'EM'}</span>
                )}
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
                  {isSinglePoseMode
                    ? `Perbarui Foto Pose ${activePoseSpec.shortLabel}: ${employee.nama_karyawan}`
                    : employee.has_biometric
                    ? `Pendaftaran Paket Wajah: ${employee.nama_karyawan}`
                    : `Daftarkan Wajah Biometrik: ${employee.nama_karyawan}`}
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ID: <span className="font-mono font-medium text-foreground">{employee.id_karyawan}</span>
                  {' '}• NIK: {employee.nomor_induk || '-'}
                  {' '}• {employee.jabatan || 'Staf'}
                  {locationName ? ` • ${locationName}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Badge
                variant="outline"
                className={
                  allRequiredCaptured
                    ? 'gap-1.5 py-1 px-3 text-xs bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold'
                    : 'gap-1.5 py-1 px-3 text-xs bg-muted text-foreground border-border font-semibold'
                }
              >
                <ScanFace className="h-3.5 w-3.5" />
                <span>
                  {capturedCount} / {targetPoses.length} Foto Terambil
                </span>
              </Badge>
            </div>
          </CardContent>
        </Card>

        {!isSinglePoseMode && employee.has_biometric && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border bg-muted/30 text-xs text-foreground">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span>
                Karyawan sudah memiliki paket biometrik. Wajib mengambil <strong>3 foto pose langsung</strong> (Lurus, Kiri, Kanan). Pilih cara penyimpanan paket baru:
              </span>
            </div>
            <div className="flex rounded-lg border p-0.5 bg-background shrink-0">
              <button
                type="button"
                onClick={() => setReplaceExisting(true)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  replaceExisting ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Ganti Paket Lama
              </button>
              <button
                type="button"
                onClick={() => setReplaceExisting(false)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  !replaceExisting ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Tambah Paket Baru
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <Card className="lg:col-span-7 shadow-xs border">
            <CardHeader className="pb-3 space-y-2">
              <div>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <Camera className="h-4 w-4 text-primary" />
                  <span>
                    {allRequiredCaptured && !isSinglePoseMode
                      ? 'Ketiga Pose Selesai Diambil'
                      : activePoseSpec.title}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {allRequiredCaptured && !isSinglePoseMode
                    ? 'Periksa pratinjau di samping. Klik salah satu slot jika ingin mengulang pose tertentu.'
                    : activePoseSpec.hint}
                </CardDescription>
              </div>

              {targetPoses.length > 1 && (
                <div className="grid grid-cols-3 gap-1.5 rounded-lg border p-1 bg-muted/40">
                  {targetPoses.map((pose) => {
                    const isCaptured = Boolean(captures[pose.key]);
                    const isActive = activePose === pose.key;
                    return (
                      <button
                        key={pose.key}
                        type="button"
                        onClick={() => {
                          setActivePose(pose.key);
                          setCaptureError(null);
                        }}
                        className={`py-2 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 min-h-10 ${
                          isActive
                            ? 'bg-primary text-primary-foreground shadow-xs'
                            : isCaptured
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'text-muted-foreground hover:text-foreground hover:bg-card'
                        }`}
                      >
                        {isCaptured ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <span className="font-mono text-[11px]">{pose.stepNumber}.</span>
                        )}
                        <span>{pose.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-black border">
                <video
                  ref={(el) => {
                    videoRef.current = el;
                    if (el && streamRef.current && el.srcObject !== streamRef.current) {
                      el.srcObject = streamRef.current;
                      el.onloadedmetadata = () => {
                        el.play().then(() => setCameraReady(true)).catch(() => setCameraReady(true));
                      };
                      if (el.readyState >= 1) {
                        el.play().then(() => setCameraReady(true)).catch(() => setCameraReady(true));
                      }
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform -scale-x-100"
                />

                {!cameraError && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
                    <div className="w-44 h-56 sm:w-52 sm:h-64 rounded-[48%] border-2 border-primary/80 border-dashed" />
                    <div className="mt-3 rounded-full border border-white/25 bg-black/75 px-4 py-1.5 text-xs font-semibold text-white shadow-md backdrop-blur-xs text-center">
                      {activePoseSpec.instruction}
                    </div>
                  </div>
                )}

                {!cameraReady && !cameraError && (
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 text-white text-xs">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                    <span>Mengaktifkan kamera...</span>
                  </div>
                )}

                {cameraError && (
                  <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <AlertCircle className="h-8 w-8 text-rose-400" />
                    <p className="text-xs text-white max-w-sm">{cameraError}</p>
                    <Button type="button" size="sm" variant="secondary" onClick={startCamera} className="min-h-10 text-xs">
                      Coba Buka Kamera Lagi
                    </Button>
                  </div>
                )}
              </div>

              {captureError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-destructive"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Foto pose belum valid</div>
                    <div>{captureError}</div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  size="lg"
                  onClick={handleCapturePose}
                  disabled={!cameraReady || Boolean(cameraError) || capturingPose || saving}
                  className="flex-1 min-h-11 gap-2 text-sm font-semibold"
                >
                  {capturingPose ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Memvalidasi Pose Wajah...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4" />
                      <span>
                        {captures[activePose]
                          ? `Ambil Ulang ${activePoseSpec.title}`
                          : `Ambil ${activePoseSpec.title}`}
                      </span>
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5 shadow-xs border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base font-bold text-foreground">
                  {isSinglePoseMode ? `Foto Pose ${activePoseSpec.shortLabel}` : 'Daftar 3 Foto Wajib'}
                </CardTitle>
                <span className="text-xs font-mono font-semibold text-primary">
                  {capturedCount}/{targetPoses.length} Selesai
                </span>
              </div>
              <CardDescription className="text-xs">
                {isSinglePoseMode
                  ? 'Ambil ulang foto pose yang dipilih untuk memperbarui slot ini pada paket.'
                  : 'Ketiga sudut wajah harus terverifikasi sebelum perubahan dapat disimpan.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
                {targetPoses.map((pose) => {
                  const captured = captures[pose.key];
                  const isActive = activePose === pose.key;

                  return (
                    <div
                      key={pose.key}
                      className={`rounded-xl border p-3 transition-colors ${
                        captured
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : isActive
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-muted/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setActivePose(pose.key);
                            setCaptureError(null);
                          }}
                          className="relative w-20 aspect-4/3 rounded-lg overflow-hidden border bg-black/90 shrink-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`Pilih ${pose.title}`}
                        >
                          {captured ? (
                            <img
                              src={captured.photoBase64}
                              alt={pose.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Camera className="h-5 w-5 text-white/60" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-xs font-bold text-foreground truncate">
                              {pose.title}
                            </span>
                            {captured && (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            )}
                          </div>

                          {captured ? (
                            <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                              <div className="text-emerald-700 dark:text-emerald-300 font-medium">
                                Terverifikasi AI
                              </div>
                              <div className="font-mono text-[10px]">
                                Kualitas: {captured.meta.quality_score ?? '-'} • Yaw: {captured.meta.yaw ?? '-'}
                              </div>
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {isActive ? 'Sedang aktif di kamera' : 'Menunggu pengambilan foto'}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2.5 flex justify-end gap-2">
                        {captured ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleResetPose(pose.key)}
                            disabled={capturingPose || saving}
                            className="h-9 text-xs gap-1.5 w-full lg:w-auto"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Foto Ulang</span>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant={isActive ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => {
                              setActivePose(pose.key);
                              setCaptureError(null);
                            }}
                            disabled={capturingPose || saving}
                            className="h-9 text-xs w-full lg:w-auto"
                          >
                            {isActive ? 'Siap Difoto' : 'Pilih Pose Ini'}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-muted/30">
                <input
                  type="checkbox"
                  id="enrollConsent"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="enrollConsent" className="text-xs leading-relaxed text-foreground cursor-pointer">
                  Karyawan telah memberikan persetujuan eksplisit atas perekaman dan pembaruan data biometrik wajah (Kepatuhan UU PDP No. 27/2022).
                </label>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate(`/hrd/employees/${employee.id}?tab=faces`)}
                    disabled={saving}
                    className="sm:w-1/3 min-h-11 text-xs"
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveFaces}
                    disabled={!allRequiredCaptured || !consentChecked || saving || capturingPose}
                    className="sm:w-2/3 min-h-11 gap-2 text-xs font-semibold"
                  >
                    {saving ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Menyimpan Foto...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        <span>
                          {isSinglePoseMode
                            ? `Simpan Perubahan Pose (${capturedCount}/1)`
                            : `Simpan 3 Foto Wajah (${capturedCount}/3)`}
                        </span>
                      </>
                    )}
                  </Button>
                </div>

                {(!allRequiredCaptured || !consentChecked) && (
                  <p className="text-[11px] text-muted-foreground text-center">
                    {!allRequiredCaptured
                      ? isSinglePoseMode
                        ? 'Ambil foto pose terlebih dahulu sebelum tombol simpan aktif.'
                        : `Masih perlu ${targetPoses.length - capturedCount} foto pose lagi sebelum tombol simpan aktif.`
                      : 'Centang kotak persetujuan UU PDP untuk menyimpan perubahan wajah.'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </HrdLayout>
  );
}
