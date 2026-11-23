import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  ArrowLeft,
  ScanFace,
  KeyRound,
  RefreshCw,
  Camera,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  UserCheck,
  BrainCircuit,
  ShieldCheck,
  Building2,
  Clock,
  Calendar,
  Layers,
  Maximize2,
  User,
  History,
  Fingerprint,
  Upload,
  Trash2,
  Image as ImageIcon,
  ExternalLink,
  FileText,
} from 'lucide-react';
import {
  checkPythonEngineHealth,
} from '@/lib/biometricEngine';
import axios from 'axios';
import { toast } from 'sonner';

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'faces' | 'attendances' | 'profile'>('faces');
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);

  const [enrollModalOpen, setEnrollModalOpen] = useState<boolean>(false);
  const [consentChecked, setConsentChecked] = useState<boolean>(false);
  const [poseLabel, setPoseLabel] = useState<string>('front');
  const [enrolling, setEnrolling] = useState<boolean>(false);

  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [newPin, setNewPin] = useState<string>('');
  const [savingPin, setSavingPin] = useState<boolean>(false);

  const [photoModalOpen, setPhotoModalOpen] = useState<boolean>(false);
  const [photoMode, setPhotoMode] = useState<'upload' | 'camera'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileCameraRef = useRef<HTMLVideoElement | null>(null);
  const profileStreamRef = useRef<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enrollStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    fetchDetail();
    return () => {
      stopCamera();
      stopProfileCamera();
    };
  }, [id]);

  const startProfileCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
        audio: false,
      });
      profileStreamRef.current = stream;
      if (profileCameraRef.current) {
        profileCameraRef.current.srcObject = stream;
        profileCameraRef.current.play();
      }
    } catch (err) {
      toast.error('Tidak dapat mengakses kamera');
    }
  };

  const stopProfileCamera = () => {
    if (profileStreamRef.current) {
      profileStreamRef.current.getTracks().forEach((t) => t.stop());
      profileStreamRef.current = null;
    }
    if (profileCameraRef.current) {
      profileCameraRef.current.srcObject = null;
    }
  };

  const snapProfileCamera = () => {
    if (profileCameraRef.current) {
      const video = profileCameraRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth || 640, 640);
      canvas.height = Math.min(video.videoHeight || 640, 640);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        setPhotoPreview(dataUrl);
        setSelectedFile(null);
        stopProfileCamera();
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Ukuran file maksimal 5MB');
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveProfilePhoto = async () => {
    if (!photoPreview && !selectedFile) {
      toast.error('Pilih file atau ambil foto terlebih dahulu');
      return;
    }
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('photo', selectedFile);
      } else if (photoPreview) {
        formData.append('photo_base64', photoPreview);
      }
      const res = await axios.post(`/api/hrd/employees/${data.employee.id}/upload-profile-photo`, formData);
      if (res.data.success) {
        toast.success('Foto profil berhasil diperbarui');
        setPhotoModalOpen(false);
        setPhotoPreview(null);
        setSelectedFile(null);
        stopProfileCamera();
        fetchDetail();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan foto profil');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDeleteProfilePhoto = async () => {
    if (!confirm('Apakah Anda yakin ingin menghapus foto profil karyawan ini?')) return;
    setUploadingPhoto(true);
    try {
      const res = await axios.delete(`/api/hrd/employees/${data.employee.id}/profile-photo`);
      if (res.data.success) {
        toast.success('Foto profil berhasil dihapus');
        setPhotoModalOpen(false);
        setPhotoPreview(null);
        setSelectedFile(null);
        fetchDetail();
      }
    } catch (err: any) {
      toast.error('Gagal menghapus foto profil');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/hrd/employees/${id}`);
      setData(res.data);
    } catch (err) {
      toast.error('Gagal mengambil data detail karyawan');
      navigate('/hrd/employees');
    } finally {
      setLoading(false);
    }
  };

  const openEnrollModal = () => {
    setConsentChecked(false);
    setPoseLabel('front');
    setEnrollModalOpen(true);

    setTimeout(() => {
      startCamera();
    }, 250);
  };

  const closeEnrollModal = () => {
    stopCamera();
    setEnrollModalOpen(false);
  };

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
    if (!consentChecked) {
      toast.error('Wajib mencentang persetujuan pemrosesan biometrik (UU PDP)');
      return;
    }
    if (!videoRef.current || !data?.employee) return;

    setEnrolling(true);
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
          formData.append('external_karyawan_id', data.employee.id.toString());
          formData.append('pose_label', poseLabel);
          formData.append('images', blob, 'enroll.jpg');

          const pyRes = await fetch('/api/face-engine/api/v1/enroll', {
            method: 'POST',
            body: formData,
          });

          if (pyRes.ok) {
            const enrollData = await pyRes.json();
            const sampleMeta = enrollData.samples_metadata?.[0] || {};
            const templates = [
              {
                embedding_vector: enrollData.mean_embedding,
                model_name: enrollData.model_name,
                model_version: enrollData.model_version,
                pose_label: poseLabel,
                photo_base64: photoBase64,
                quality_score: sampleMeta.quality_score,
                blur_score: sampleMeta.blur_score,
                brightness_score: sampleMeta.brightness,
                pose_yaw: sampleMeta.yaw,
                pose_pitch: sampleMeta.pitch,
                pose_roll: sampleMeta.roll,
              },
            ];
            if (enrollData.secondary_mean_embedding) {
              templates.push({
                embedding_vector: enrollData.secondary_mean_embedding,
                model_name: enrollData.secondary_model_name,
                model_version: enrollData.secondary_model_version,
                pose_label: poseLabel,
                photo_base64: null,
                quality_score: sampleMeta.quality_score,
                blur_score: sampleMeta.blur_score,
                brightness_score: sampleMeta.brightness,
                pose_yaw: sampleMeta.yaw,
                pose_pitch: sampleMeta.pitch,
                pose_roll: sampleMeta.roll,
              });
            }
            const res = await axios.post(`/api/hrd/employees/${data.employee.id}/enroll-face`, {
              templates,
              consent_given: true,
            });

            if (res.data.success) {
              toast.success(`Wajah ${data.employee.nama_karyawan} berhasil didaftarkan (InsightFace 512D)`);
              closeEnrollModal();
              fetchDetail();
              return;
            }
          } else {
            const errJson = await pyRes.json().catch(() => ({}));
            toast.error(errJson.detail || 'Wajah tidak terdeteksi di mesin InsightFace');
            setEnrolling(false);
            return;
          }
        }
      }

      toast.error('Mesin InsightFace tidak tersedia. Pendaftaran wajah dibatalkan agar format biometrik tetap konsisten.');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan biometrik wajah');
    } finally {
      setEnrolling(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.employee || !newPin) return;

    setSavingPin(true);
    try {
      const res = await axios.post(`/api/hrd/employees/${data.employee.id}/reset-pin`, {
        pin: newPin,
      });
      if (res.data.success) {
        toast.success(`PIN ${data.employee.nama_karyawan} berhasil diubah`);
        setPinModalOpen(false);
        setNewPin('');
        fetchDetail();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal mengubah PIN');
    } finally {
      setSavingPin(false);
    }
  };

  if (loading) {
    return (
      <HrdLayout>
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
          <RefreshCw className="h-7 w-7 animate-spin text-primary" />
          <span>Memuat rincian data karyawan & foto biometrik...</span>
        </div>
      </HrdLayout>
    );
  }

  if (!data?.employee) {
    return (
      <HrdLayout>
        <div className="py-16 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Karyawan tidak ditemukan</p>
          <Button variant="outline" onClick={() => navigate('/hrd/employees')}>
            Kembali ke Daftar Karyawan
          </Button>
        </div>
      </HrdLayout>
    );
  }

  const profilePhotoUrl = data.employee?.profile_photo_url;
  const primaryFacePhotoUrl = data.face_embeddings?.find((f: any) => f.photo_url)?.photo_url;

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/hrd/employees')}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Kembali ke Daftar Karyawan</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5"
              onClick={() => {
                setPhotoPreview(profilePhotoUrl);
                setSelectedFile(null);
                setPhotoMode('upload');
                setPhotoModalOpen(true);
              }}
            >
              <Camera className="h-4 w-4 text-sky-600" />
              <span>{profilePhotoUrl ? 'Ubah Foto Profil' : 'Unggah Foto Profil'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5"
              onClick={openEnrollModal}
            >
              <ScanFace className="h-4 w-4 text-primary" />
              <span>{data.employee.has_biometric ? 'Ubah / Tambah Wajah' : 'Daftarkan Wajah'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5 text-amber-600 hover:text-amber-700"
              onClick={() => {
                setNewPin('');
                setPinModalOpen(true);
              }}
            >
              <KeyRound className="h-4 w-4" />
              <span>Atur PIN</span>
            </Button>
          </div>
        </div>

        <Card className="shadow-xs border overflow-hidden p-0 py-0 gap-0">
          <div className="p-6 bg-muted/40 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b">
            <div className="flex items-center gap-5">
              <div
                className="relative w-20 h-20 rounded-2xl overflow-hidden bg-muted flex items-center justify-center shrink-0 border-2 border-primary/20 shadow-md cursor-pointer group"
                onClick={() => {
                  setPhotoPreview(profilePhotoUrl);
                  setSelectedFile(null);
                  setPhotoMode('upload');
                  setPhotoModalOpen(true);
                }}
                title="Klik untuk mengubah foto profil"
              >
                {profilePhotoUrl ? (
                  <>
                    <img
                      src={profilePhotoUrl}
                      alt={data.employee.nama_karyawan}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1 text-[10px] font-medium">
                      <Camera className="h-5 w-5" />
                      <span>Ubah Foto</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-2xl text-muted-foreground group-hover:hidden">
                      {data.employee.nama_karyawan?.slice(0, 2).toUpperCase() || 'EM'}
                    </span>
                    <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-primary gap-1 text-[10px] font-medium">
                      <Camera className="h-5 w-5" />
                      <span>Unggah</span>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    {data.employee.nama_karyawan}
                  </h1>
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">
                    Aktif
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono font-medium text-foreground">ID: {data.employee.id_karyawan}</span>
                  <span>•</span>
                  <span>NIK: {data.employee.nomor_induk || '-'}</span>
                  <span>•</span>
                  <span>Jabatan: {data.employee.jabatan || 'Staf'}</span>
                  {data.location && (
                    <>
                      <span>•</span>
                      <span>Cabang: {data.location.location_name}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1.5">
                  {data.employee.has_biometric ? (
                    <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs py-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{data.face_embeddings?.length} Foto Wajah Terdaftar (InsightFace 512D)</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20 text-xs py-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>Belum Terdaftar Biometrik</span>
                    </Badge>
                  )}

                  {data.employee.biometric_consent_at ? (
                    <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs py-1">
                      <FileCheck2 className="h-3.5 w-3.5" />
                      <span>Konsen PDP: {data.employee.biometric_consent_at}</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground text-xs py-1">
                      <span>Belum Ada Konsen PDP</span>
                    </Badge>
                  )}

                  {data.employee.has_pin ? (
                    <Badge variant="outline" className="gap-1 bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs py-1">
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>PIN Aktif</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground text-xs py-1">
                      <span>PIN Belum Dibuat</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex border-b text-xs font-medium px-6 bg-muted/10">
            <button
              type="button"
              onClick={() => setActiveTab('faces')}
              className={`flex items-center gap-2 py-3 px-4 border-b-2 transition-colors ${
                activeTab === 'faces'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <ScanFace className="h-4 w-4" />
              <span>Foto & Data Wajah Terdaftar ({data.face_embeddings?.length || 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attendances')}
              className={`flex items-center gap-2 py-3 px-4 border-b-2 transition-colors ${
                activeTab === 'attendances'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <History className="h-4 w-4" />
              <span>Riwayat Presensi & Foto Kiosk ({data.recent_attendances?.length || 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 py-3 px-4 border-b-2 transition-colors ${
                activeTab === 'profile'
                  ? 'border-primary text-primary font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Building2 className="h-4 w-4" />
              <span>Profil & Penugasan Shift</span>
            </button>
          </div>

          <CardContent className="p-6">
            {activeTab === 'faces' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Galeri Foto & Vektor Biometrik Wajah
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Foto asli yang disimpan saat karyawan mendaftarkan wajah ke sistem biometrik.
                    </p>
                  </div>
                  <Button size="sm" onClick={openEnrollModal} className="text-xs gap-1.5 h-8">
                    <Camera className="h-3.5 w-3.5" />
                    <span>Ambil Foto Wajah Baru</span>
                  </Button>
                </div>

                {data.face_embeddings?.length === 0 ? (
                  <div className="p-12 text-center rounded-xl border border-dashed bg-muted/20 flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
                      <ScanFace className="h-7 w-7" />
                    </div>
                    <div className="text-sm font-semibold text-foreground">Belum Ada Wajah Terdaftar</div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Karyawan ini belum memiliki referensi biometrik wajah. Daftarkan foto lurus, kiri, dan kanan melalui kamera.
                    </p>
                    <Button size="sm" className="mt-4 gap-1.5 text-xs" onClick={openEnrollModal}>
                      <Camera className="h-3.5 w-3.5" />
                      <span>Daftarkan Wajah Sekarang</span>
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {data.face_embeddings.map((fb: any, idx: number) => (
                      <div key={fb.id || idx} className="rounded-xl border bg-card p-4 shadow-2xs space-y-3.5 hover:shadow-xs transition-shadow">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider bg-primary/10 text-primary border-primary/20">
                              Pose: {fb.pose_label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                              {fb.model_version || 'InsightFace 512D'}
                            </Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Vektor #{fb.id}
                          </span>
                        </div>

                        {fb.photo_url ? (
                          <div
                            className="relative aspect-4/3 rounded-lg overflow-hidden border bg-black group cursor-pointer"
                            onClick={() =>
                              setLightboxImage({
                                url: fb.photo_url,
                                title: `Foto Wajah #${fb.id} - ${data.employee.nama_karyawan} (Pose: ${fb.pose_label})`,
                              })
                            }
                          >
                            <img
                              src={fb.photo_url}
                              alt={`Face ${fb.id}`}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium">
                              <Maximize2 className="h-4 w-4" />
                              <span>Klik untuk memperbesar</span>
                            </div>
                          </div>
                        ) : (
                          <div className="aspect-4/3 rounded-lg border-2 border-dashed bg-muted/30 flex flex-col items-center justify-center p-4 text-center">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
                              <BrainCircuit className="h-5 w-5" />
                            </div>
                            <div className="text-xs font-semibold">Vektor Biometrik Aktif ({fb.dimensions}D)</div>
                            <p className="text-[10px] text-muted-foreground mt-1 max-w-xs">
                              Foto snapshot pendaftaran awal belum tersimpan, namun vektor biometrik tersimpan di database dan aktif dicocokkan di Kiosk.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2.5 text-xs h-7 gap-1"
                              onClick={openEnrollModal}
                            >
                              <Camera className="h-3 w-3" />
                              <span>Perbarui Foto</span>
                            </Button>
                          </div>
                        )}

                        <div className="space-y-1.5 text-xs border-t pt-3">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Waktu Pendaftaran:</span>
                            <span className="font-mono text-foreground font-medium">{fb.created_at || '-'}</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Didaftarkan Oleh:</span>
                            <span className="text-foreground font-medium">{fb.enrolled_by_name || 'HRD'}</span>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Dimensi Fitur:</span>
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{fb.dimensions} Floats</span>
                          </div>
                        </div>

                        {fb.vector_preview && fb.vector_preview.length > 0 && (
                          <div className="p-2.5 rounded-lg bg-muted/40 border text-[10px] font-mono text-muted-foreground">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                              Cuplikan Vektor Fitur AI (5 sampel awal):
                            </div>
                            <div className="text-foreground truncate">
                              [{fb.vector_preview.map((v: number) => (typeof v === 'number' ? v.toFixed(4) : v)).join(', ')}, ...]
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'attendances' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Riwayat Presensi & Foto Audit Kiosk
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Perbandingan foto wajah asli saat karyawan melakukan tap absensi di perangkat Kiosk.
                  </p>
                </div>

                {data.recent_attendances?.length === 0 ? (
                  <div className="p-12 text-center rounded-xl border border-dashed bg-muted/20 text-muted-foreground text-xs">
                    Belum ada rekaman presensi kiosk untuk karyawan ini.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-muted/40 uppercase tracking-wider font-semibold text-muted-foreground border-b">
                        <tr>
                          <th className="py-3 px-4">Foto Bukti Kiosk</th>
                          <th className="py-3 px-4">Waktu Presensi</th>
                          <th className="py-3 px-4">Tipe Absensi</th>
                          <th className="py-3 px-4">Metode & Kecocokan</th>
                          <th className="py-3 px-4">Lokasi & Device</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Audit Forensik</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.recent_attendances.map((ev: any) => (
                          <tr key={ev.id} className="hover:bg-muted/20">
                            <td className="py-3 px-4">
                              {ev.proof_photo_url ? (
                                <div
                                  className="relative w-14 h-14 rounded-lg overflow-hidden border bg-black cursor-pointer group shrink-0"
                                  onClick={() =>
                                    setLightboxImage({
                                      url: ev.proof_photo_url,
                                      title: `Foto Bukti Presensi #${ev.id} - ${data.employee.nama_karyawan} (${ev.recorded_at})`,
                                    })
                                  }
                                >
                                  <img
                                    src={ev.proof_photo_url}
                                    alt="Proof"
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white">
                                    <Maximize2 className="h-3.5 w-3.5" />
                                  </div>
                                </div>
                              ) : (
                                <div className="w-14 h-14 rounded-lg border border-dashed bg-muted flex items-center justify-center text-muted-foreground text-[10px]">
                                  N/A
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-mono font-medium text-foreground text-xs">{ev.recorded_at}</div>
                              <div className="text-[11px] text-muted-foreground">{ev.work_date}</div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="text-xs capitalize font-medium">
                                {ev.attendance_type.replace('_', ' ')}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium text-foreground capitalize">
                                {ev.auth_method === 'face_liveness' ? 'Verifikasi Wajah' : 'PIN Darurat'}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {ev.confidence_score ? `Kecocokan: ${ev.confidence_score}%` : 'Jalur Fallback'}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-medium">{ev.location_name}</div>
                              <div className="text-[11px] text-muted-foreground">{ev.device_name}</div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                {ev.status_label || 'Tercatat'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 border-amber-500/30 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 cursor-pointer"
                                onClick={() => navigate(`/hrd/logs/${ev.id}`)}
                              >
                                <ExternalLink className="h-3 w-3" />
                                Detail & Audit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="shadow-2xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <Clock className="h-4 w-4" />
                      <span>Jadwal Shift Kerja</span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Konfigurasi jam masuk, jam pulang, dan jam istirahat.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {data.shift ? (
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between border-b pb-2">
                          <span className="text-muted-foreground">Nama Shift:</span>
                          <span className="font-semibold text-foreground">{data.shift.shift_name}</span>
                        </div>
                        <div className="flex justify-between border-b pb-2">
                          <span className="text-muted-foreground">Jam Kerja:</span>
                          <span className="font-mono font-medium text-foreground">
                            {data.shift.start_time} — {data.shift.end_time} WIB
                          </span>
                        </div>
                        <div className="flex justify-between border-b pb-2">
                          <span className="text-muted-foreground">Jam Istirahat:</span>
                          <span className="font-mono font-medium text-foreground">
                            {data.shift.break_start_time || '-'} — {data.shift.break_end_time || '-'} WIB
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Shift Lintas Hari (Overnight):</span>
                          <span className="font-medium text-foreground">
                            {data.shift.is_overnight ? 'Ya' : 'Tidak'}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground py-4 text-center">
                        Shift kerja belum diatur
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-2xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2 text-primary">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Keamanan & Data Kepatuhan</span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Audit persetujuan privasi biometrik dan jalur darurat.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 text-xs">
                      <div className="flex justify-between border-b pb-2">
                        <span className="text-muted-foreground">Status PIN Darurat:</span>
                        <span className="font-medium text-foreground">
                          {data.employee.has_pin ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                              Tersedia
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]">
                              Belum Dibuat
                            </Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between border-b pb-2">
                        <span className="text-muted-foreground">Persetujuan UU PDP (Biometrik):</span>
                        <span className="font-mono text-foreground font-medium">
                          {data.employee.biometric_consent_at || 'Belum Ada'}
                        </span>
                      </div>
                      <div className="flex justify-between border-b pb-2">
                        <span className="text-muted-foreground">Sinkron Master Terakhir:</span>
                        <span className="font-mono text-foreground">
                          {data.employee.synced_at || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ID Absensi / External:</span>
                        <span className="font-mono text-foreground font-medium">
                          {data.employee.id_absensi || '-'} (Ext ID: {data.employee.external_karyawan_id || '-'})
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={lightboxImage !== null} onOpenChange={() => setLightboxImage(null)}>
        <DialogContent className="sm:max-w-2xl p-4">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-sm font-semibold truncate">
              {lightboxImage?.title || 'Tinjauan Foto'}
            </DialogTitle>
          </DialogHeader>
          {lightboxImage && (
            <div className="relative rounded-xl overflow-hidden border bg-black flex items-center justify-center max-h-[80vh]">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title}
                className="max-h-[80vh] w-auto object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={enrollModalOpen} onOpenChange={closeEnrollModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="h-5 w-5 text-primary" />
              <span>Pendaftaran Wajah: {data.employee.nama_karyawan}</span>
            </DialogTitle>
            <DialogDescription>
              Pilih pose yang akan direkam, arahkan wajah sesuai petunjuk, lalu ambil foto. Tidak perlu berkedip atau membuka mulut.
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
                <div className="w-48 h-60 rounded-[48%] border-2 border-primary/60 border-dashed" />
                <div className="mt-2.5 rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow-md backdrop-blur-md">
                  {poseLabel === 'front' && 'Hadap lurus ke kamera'}
                  {poseLabel === 'slight_left' && 'Tengok sedikit ke kiri'}
                  {poseLabel === 'slight_right' && 'Tengok sedikit ke kanan'}
                </div>
              </div>

              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <Badge variant="outline" className="gap-1 bg-black/60 text-white border-white/20 text-[10px]">
                  <BrainCircuit className="h-3 w-3 text-blue-400" />
                  <span>InsightFace 512D</span>
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/20">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold">Perekaman Manual Berpanduan</div>
                  <div className="text-[10px] text-muted-foreground">Foto diperiksa mesin sesuai pose yang dipilih</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Pose Wajah</label>
              <div className="flex rounded-md border p-0.5 bg-muted/40 text-xs">
                {[
                  { value: 'front', label: 'Lurus' },
                  { value: 'slight_left', label: 'Kiri' },
                  { value: 'slight_right', label: 'Kanan' },
                ].map((pose) => (
                  <button
                    key={pose.value}
                    type="button"
                    onClick={() => setPoseLabel(pose.value)}
                    className={`flex-1 py-1 rounded-sm font-medium capitalize transition-colors ${
                      poseLabel === pose.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                    }`}
                  >
                    {pose.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg border bg-muted/30">
              <input
                type="checkbox"
                id="consentCheckDetail"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor="consentCheckDetail" className="text-xs leading-relaxed text-muted-foreground">
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
              Atur 4–6 digit angka untuk jalur darurat Kiosk milik {data.employee.nama_karyawan}.
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

      <Dialog
        open={photoModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            stopProfileCamera();
            setPhotoModalOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <span>Kelola Foto Profil Karyawan</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Foto profil ini digunakan sebagai foto resmi identitas karyawan di sistem (terpisah dari template biometrik wajah).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="flex rounded-lg border p-1 bg-muted/30 text-xs">
              <button
                type="button"
                onClick={() => {
                  stopProfileCamera();
                  setPhotoMode('upload');
                }}
                className={`flex-1 py-1.5 rounded-md font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${
                  photoMode === 'upload' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Unggah File</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhotoMode('camera');
                  startProfileCamera();
                }}
                className={`flex-1 py-1.5 rounded-md font-medium text-center transition-colors flex items-center justify-center gap-1.5 ${
                  photoMode === 'camera' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
                }`}
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Gunakan Kamera</span>
              </button>
            </div>

            {photoMode === 'upload' && (
              <div className="space-y-3">
                <div
                  className="border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 transition-colors bg-muted/10"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photoPreview ? (
                    <div className="relative w-36 h-36 rounded-2xl overflow-hidden border shadow-md">
                      <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                        <Upload className="h-6 w-6" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium text-foreground">Klik untuk memilih foto dari komputer</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Format JPG, PNG, atau WebP (Maks. 5MB)</p>
                      </div>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                {photoPreview && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Pilih Foto Lain
                  </Button>
                )}
              </div>
            )}

            {photoMode === 'camera' && (
              <div className="space-y-3">
                {!photoPreview ? (
                  <div className="relative aspect-square max-w-[280px] mx-auto rounded-2xl overflow-hidden bg-black border shadow-md">
                    <video ref={profileCameraRef} playsInline autoPlay muted className="w-full h-full object-cover transform -scale-x-100" />
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-48 h-48 rounded-full border-2 border-dashed border-white/60" />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={snapProfileCamera}
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full h-9 px-4 text-xs shadow-lg gap-1.5"
                    >
                      <Camera className="h-4 w-4" />
                      <span>Ambil Foto</span>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 text-center">
                    <div className="relative w-36 h-36 mx-auto rounded-2xl overflow-hidden border shadow-md">
                      <img src={photoPreview} alt="Snapshot Preview" className="w-full h-full object-cover" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setPhotoPreview(null);
                        startProfileCamera();
                      }}
                    >
                      Foto Ulang
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              {data.employee.profile_photo_url ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-rose-500 hover:text-rose-600 gap-1 px-2"
                  onClick={handleDeleteProfilePhoto}
                  disabled={uploadingPhoto}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Hapus Foto</span>
                </Button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    stopProfileCamera();
                    setPhotoModalOpen(false);
                  }}
                  disabled={uploadingPhoto}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={handleSaveProfilePhoto}
                  disabled={uploadingPhoto || !photoPreview}
                >
                  {uploadingPhoto && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Simpan Foto Profil</span>
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </HrdLayout>
  );
}
