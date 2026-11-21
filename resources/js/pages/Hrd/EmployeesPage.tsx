import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Search,
  ScanFace,
  KeyRound,
  RefreshCw,
  Camera,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  BrainCircuit,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import {
  loadBiometricModels,
  detectFaceWithDescriptor,
  isBiometricModelsLoaded,
  checkPythonEngineHealth,
  BlinkDetector,
  BlinkStage,
  getBlinkInstruction,
} from '@/lib/biometricEngine';
import axios from 'axios';
import { toast } from 'sonner';

export function EmployeesPage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [filterBio, setFilterBio] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  const [enrollModalOpen, setEnrollModalOpen] = useState<boolean>(false);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [poseLabel, setPoseLabel] = useState<string>('front');
  const [enrolling, setEnrolling] = useState<boolean>(false);
  const [modelReady, setModelReady] = useState<boolean>(false);

  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [newPin, setNewPin] = useState<string>('');
  const [savingPin, setSavingPin] = useState<boolean>(false);

  const [syncingMaster, setSyncingMaster] = useState<boolean>(false);
  const [autoBlinkEnroll, setAutoBlinkEnroll] = useState<boolean>(true);
  const [enrollBlinkStage, setEnrollBlinkStage] = useState<BlinkStage>('no_face');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enrollStreamRef = useRef<MediaStream | null>(null);
  const enrollBlinkDetectorRef = useRef<BlinkDetector>(new BlinkDetector());
  const enrollLoopRef = useRef<any>(null);
  const isEnrollingRef = useRef<boolean>(false);
  const consentCheckedRef = useRef<boolean>(false);

  useEffect(() => {
    fetchEmployees();
    loadBiometricModels()
      .then(() => setModelReady(true))
      .catch(() => {});

    return () => {
      stopCamera();
    };
  }, [page, filterBio]);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: 10 };
      if (search) params.search = search;
      if (filterBio !== 'all') params.has_biometric = filterBio;

      const res = await axios.get('/api/hrd/employees', { params });
      setEmployees(res.data.data || []);
      setTotalPages(res.data.last_page || 1);
    } catch (err) {
      toast.error('Gagal mengambil daftar karyawan');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchEmployees();
  };

  const handleSyncMaster = async () => {
    setSyncingMaster(true);
    try {
      const res = await axios.post('/api/hrd/sync-master');
      toast.success(res.data.message || 'Master data berhasil disinkronkan');
      fetchEmployees();
    } catch (err) {
      toast.error('Gagal sinkron master data');
    } finally {
      setSyncingMaster(false);
    }
  };

  const openEnrollModal = (emp: any) => {
    setSelectedEmployee(emp);
    setConsentChecked(false);
    setPoseLabel('front');
    setEnrollModalOpen(true);

    if (!isBiometricModelsLoaded()) {
      loadBiometricModels().then(() => setModelReady(true));
    }

    setTimeout(() => {
      startCamera();
    }, 250);
  };

  const closeEnrollModal = () => {
    if (enrollLoopRef.current) clearInterval(enrollLoopRef.current);
    stopCamera();
    setEnrollModalOpen(false);
    setSelectedEmployee(null);
    setEnrollBlinkStage('no_face');
    enrollBlinkDetectorRef.current.reset();
  };

  useEffect(() => {
    consentCheckedRef.current = consentChecked;
  }, [consentChecked]);

  useEffect(() => {
    if (!enrollModalOpen || !autoBlinkEnroll) {
      if (enrollLoopRef.current) clearInterval(enrollLoopRef.current);
      setEnrollBlinkStage('no_face');
      enrollBlinkDetectorRef.current.reset();
      return;
    }

    enrollLoopRef.current = setInterval(async () => {
      if (!videoRef.current || isEnrollingRef.current || videoRef.current.readyState < 2) {
        return;
      }

      try {
        const detection = await detectFaceWithDescriptor(videoRef.current);
        if (!detection) {
          enrollBlinkDetectorRef.current.reset();
          setEnrollBlinkStage('no_face');
          return;
        }

        const bState = enrollBlinkDetectorRef.current.update(detection.landmarks);
        setEnrollBlinkStage(bState.stage);

        if (bState.blinkDetected) {
          if (consentCheckedRef.current) {
            handleCaptureAndEnroll();
          } else {
            toast.info('Centang persetujuan biometrik (UU PDP) untuk mengaktifkan simpan otomatis');
          }
        }
      } catch (err) {}
    }, 200);

    return () => {
      if (enrollLoopRef.current) clearInterval(enrollLoopRef.current);
    };
  }, [enrollModalOpen, autoBlinkEnroll]);

  const startCamera = async () => {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      enrollStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
        };
      }
    } catch (err: any) {
      toast.error('Tidak dapat mengakses webcam: ' + (err.message || 'Perangkat kamera sedang digunakan'));
    }
  };

  const stopCamera = () => {
    if (enrollStreamRef.current) {
      enrollStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      enrollStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleCaptureAndEnroll = async () => {
    if (!consentCheckedRef.current && !consentChecked) {
      toast.error('Wajib mencentang persetujuan pemrosesan biometrik (UU PDP)');
      return;
    }
    if (!videoRef.current || !selectedEmployee) return;

    setEnrolling(true);
    isEnrollingRef.current = true;
    try {
      let photoBase64: string | null = null;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(videoRef.current.videoWidth || 640, 640);
      canvas.height = Math.min(videoRef.current.videoHeight || 480, 480);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        photoBase64 = canvas.toDataURL('image/jpeg', 0.85);
      }

      const pyHealth = await checkPythonEngineHealth();
      if (pyHealth.available && canvas) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
        });
        if (blob) {
          const formData = new FormData();
          formData.append('external_karyawan_id', selectedEmployee.id.toString());
          formData.append('images', blob, 'enroll.jpg');

          const pyRes = await fetch('/api/face-engine/api/v1/enroll', {
            method: 'POST',
            body: formData,
          });

          if (pyRes.ok) {
            const enrollData = await pyRes.json();
            const res = await axios.post(`/api/hrd/employees/${selectedEmployee.id}/enroll-face`, {
              embedding_vector: enrollData.mean_embedding,
              model_version: 'buffalo_s',
              pose_label: poseLabel,
              consent_given: true,
              photo_base64: photoBase64,
            });

            if (res.data.success) {
              toast.success(`Wajah ${selectedEmployee.nama_karyawan} berhasil didaftarkan (InsightFace 512D)`);
              closeEnrollModal();
              fetchEmployees();
              return;
            }
          } else {
            const errJson = await pyRes.json().catch(() => ({}));
            toast.error(errJson.detail || 'Wajah tidak terdeteksi di mesin InsightFace');
            setEnrolling(false);
            isEnrollingRef.current = false;
            return;
          }
        }
      }

      if (!isBiometricModelsLoaded()) {
        await loadBiometricModels();
      }

      const detection = await detectFaceWithDescriptor(videoRef.current);
      if (!detection || !detection.descriptor || detection.descriptor.length === 0) {
        toast.error('Wajah tidak terdeteksi. Posisikan wajah tepat di depan kamera.');
        setEnrolling(false);
        isEnrollingRef.current = false;
        return;
      }

      const res = await axios.post(`/api/hrd/employees/${selectedEmployee.id}/enroll-face`, {
        embedding_vector: detection.descriptor,
        pose_label: poseLabel,
        consent_given: true,
        photo_base64: photoBase64,
      });

      if (res.data.success) {
        toast.success(`Wajah ${selectedEmployee.nama_karyawan} berhasil didaftarkan`);
        closeEnrollModal();
        fetchEmployees();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan biometrik wajah');
    } finally {
      setEnrolling(false);
      isEnrollingRef.current = false;
    }
  };

  const openPinModal = (emp: any) => {
    setSelectedEmployee(emp);
    setNewPin('');
    setPinModalOpen(true);
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !newPin) return;

    setSavingPin(true);
    try {
      const res = await axios.post(`/api/hrd/employees/${selectedEmployee.id}/reset-pin`, {
        pin: newPin,
      });
      if (res.data.success) {
        toast.success(`PIN ${selectedEmployee.nama_karyawan} berhasil diubah`);
        setPinModalOpen(false);
        setNewPin('');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal mengubah PIN');
    } finally {
      setSavingPin(false);
    }
  };

  const enrollInstruction = getBlinkInstruction(enrollBlinkStage);

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Karyawan & Biometrik</h1>
            <p className="text-xs text-muted-foreground">
              Manajemen profil karyawan, pemantauan foto biometrik terdaftar, dan audit log presensi kiosk.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleSyncMaster}
              disabled={syncingMaster}
              className="gap-1.5 text-xs h-9"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingMaster ? 'animate-spin' : ''}`} />
              <span>Sinkron dari Aplikasi Utama</span>
            </Button>
          </div>
        </div>

        <Card className="shadow-xs border">
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-sm w-full">
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Cari nama, ID, jabatan..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-9 text-xs"
                  />
                </div>
                <Button type="submit" size="sm" variant="secondary" className="h-9 text-xs px-3">
                  Cari
                </Button>
              </form>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Status Wajah:</span>
                <div className="flex rounded-md border p-0.5 bg-muted/40 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBio('all');
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${
                      filterBio === 'all' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBio('yes');
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${
                      filterBio === 'yes' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    Terdaftar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBio('no');
                      setPage(1);
                    }}
                    className={`px-2.5 py-1 rounded-sm font-medium transition-colors ${
                      filterBio === 'no' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    Belum
                  </button>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-muted-foreground border-y bg-muted/30 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Karyawan</th>
                    <th className="py-2.5 px-4">ID & Jabatan</th>
                    <th className="py-2.5 px-4">Shift Kerja</th>
                    <th className="py-2.5 px-4">Status Biometrik</th>
                    <th className="py-2.5 px-4">Persetujuan (UU PDP)</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        Memuat data karyawan...
                      </td>
                    </tr>
                  ) : employees.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        Tidak ada data karyawan ditemukan
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-muted/30">
                        <td className="py-3 px-4 font-semibold text-foreground">
                          <div className="flex items-center gap-3">
                            <div className="relative w-9 h-9 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0 border">
                              {emp.profile_photo_url ? (
                                <img
                                  src={emp.profile_photo_url}
                                  alt={emp.nama_karyawan}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="font-bold text-xs text-muted-foreground">
                                  {emp.nama_karyawan ? emp.nama_karyawan.slice(0, 2).toUpperCase() : 'EM'}
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-foreground">{emp.nama_karyawan}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">
                                NIK: {emp.nomor_induk || '-'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono font-medium">{emp.id_karyawan}</div>
                          <div className="text-[10px] text-muted-foreground">{emp.jabatan || '-'}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-medium">{emp.shift_name}</span>
                        </td>
                        <td className="py-3 px-4">
                          {emp.has_biometric ? (
                            <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>{emp.embeddings_count} Vektor ResNet</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground border-border">
                              <AlertCircle className="h-3 w-3" />
                              <span>Belum Terdaftar</span>
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {emp.biometric_consent_at ? (
                            <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                              <FileCheck2 className="h-3.5 w-3.5" />
                              <span>{new Date(emp.biometric_consent_at).toLocaleDateString('id-ID')}</span>
                            </div>
                          ) : (
                            <span className="text-[11px]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 text-xs text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/30"
                              onClick={() => navigate(`/hrd/employees/${emp.id}`)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Detail</span>
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              onClick={() => openEnrollModal(emp)}
                            >
                              <ScanFace className="h-3.5 w-3.5 text-primary" />
                              <span>{emp.has_biometric ? 'Ubah Wajah' : 'Daftar Wajah'}</span>
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                              onClick={() => openPinModal(emp)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>PIN</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between p-4 border-t text-xs text-muted-foreground">
              <div>Halaman {page} dari {totalPages}</div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 text-xs"
                >
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 text-xs"
                >
                  Selanjutnya
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={enrollModalOpen} onOpenChange={closeEnrollModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="h-5 w-5 text-primary" />
              <span>Pendaftaran Wajah: {selectedEmployee?.nama_karyawan}</span>
            </DialogTitle>
            <DialogDescription>
              Arahkan wajah karyawan tegak ke kamera. Ekstraksi biometrik InsightFace 512D otomatis diproses saat kedipan mata terverifikasi (UU PDP No. 27/2022).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="relative aspect-4/3 rounded-xl overflow-hidden bg-black border">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform -scale-x-100"
              />
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                <div
                  className={`w-48 h-60 rounded-[48%] border-2 transition-all duration-300 flex items-center justify-center relative ${
                    autoBlinkEnroll ? enrollInstruction.borderClass : 'border-primary/60 border-dashed'
                  }`}
                >
                  {autoBlinkEnroll && enrollBlinkStage === 'eyes_open' && (
                    <div className="flex items-center justify-center text-sky-400 bg-black/50 backdrop-blur-xs px-2.5 py-1 rounded-full animate-bounce">
                      <Eye className="h-5 w-5" />
                    </div>
                  )}
                  {autoBlinkEnroll && enrollBlinkStage === 'eyes_closing' && (
                    <div className="flex items-center justify-center text-amber-300 bg-black/50 backdrop-blur-xs px-2.5 py-1 rounded-full">
                      <EyeOff className="h-5 w-5" />
                    </div>
                  )}
                  {autoBlinkEnroll && enrollBlinkStage === 'blink_verified' && (
                    <div className="flex items-center justify-center text-emerald-400 bg-black/50 backdrop-blur-xs px-2.5 py-1 rounded-full animate-pulse">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  )}
                </div>

                {autoBlinkEnroll && (
                  <div className="mt-2.5 pointer-events-auto">
                    <div
                      className={`px-3 py-1.5 rounded-full border backdrop-blur-md flex items-center gap-1.5 shadow-md text-xs font-semibold ${enrollInstruction.badgeClass}`}
                    >
                      {enrollBlinkStage === 'eyes_open' ? (
                        <Eye className="h-3.5 w-3.5 text-sky-400 animate-pulse" />
                      ) : enrollBlinkStage === 'eyes_closing' ? (
                        <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                      ) : enrollBlinkStage === 'blink_verified' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <ScanFace className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span>{enrollInstruction.text}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <Badge variant="outline" className="gap-1 bg-black/60 text-white border-white/20 text-[10px]">
                  <BrainCircuit className="h-3 w-3 text-blue-400" />
                  <span>InsightFace 512D</span>
                </Badge>
                {autoBlinkEnroll && (
                  <Badge variant="outline" className="gap-1 bg-purple-500/30 text-purple-200 border-purple-500/40 text-[10px]">
                    <Sparkles className="h-3 w-3" />
                    <span>e-KYC Bank</span>
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold">Mode Verifikasi Kedip (e-KYC)</div>
                  <div className="text-[10px] text-muted-foreground">Kamera otomatis jepret dan simpan saat mata berkedip</div>
                </div>
              </div>
              <Button
                type="button"
                variant={autoBlinkEnroll ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setAutoBlinkEnroll(!autoBlinkEnroll)}
              >
                {autoBlinkEnroll ? 'Aktif' : 'Manual'}
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Pose Wajah</label>
              <div className="flex rounded-md border p-0.5 bg-muted/40 text-xs">
                {['front', 'slight_left', 'slight_right'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPoseLabel(p)}
                    className={`flex-1 py-1 rounded-sm font-medium capitalize transition-colors ${
                      poseLabel === p ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    {p.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-muted/30">
              <input
                type="checkbox"
                id="consentCheck"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="consentCheck" className="text-xs leading-relaxed text-muted-foreground">
                Karyawan telah memberikan persetujuan eksplisit atas perekaman dan pemrosesan data biometrik wajah untuk keperluan pencatatan kehadiran (Kepatuhan UU PDP No. 27/2022).
              </label>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="ghost" className="w-1/2" onClick={closeEnrollModal}>
                Batal
              </Button>
              <Button
                type="button"
                className="w-1/2 gap-1.5"
                disabled={enrolling || !consentChecked}
                onClick={handleCaptureAndEnroll}
              >
                <Camera className="h-4 w-4" />
                <span>{enrolling ? 'Mengekstrak AI...' : 'Ambil & Simpan Wajah'}</span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pinModalOpen} onOpenChange={setPinModalOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              <span>Atur PIN Darurat</span>
            </DialogTitle>
            <DialogDescription>
              Atur 4–6 digit angka untuk jalur darurat Kiosk milik {selectedEmployee?.nama_karyawan}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSavePin} className="space-y-4 pt-2">
            <Input
              type="password"
              maxLength={6}
              placeholder="Contoh: 1234"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="text-center font-mono text-2xl tracking-widest h-12"
              autoFocus
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="w-1/2"
                onClick={() => setPinModalOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" className="w-1/2" disabled={savingPin || newPin.length < 4}>
                {savingPin ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </HrdLayout>
  );
}
