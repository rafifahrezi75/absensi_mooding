import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  BrainCircuit,
  ShieldCheck,
  Building2,
  Clock,
  Maximize2,
  History,
  Upload,
  Trash2,
  ExternalLink,
  Layers,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

const POSE_SLOTS = [
  { key: 'front', label: 'Hadap Lurus', shortLabel: 'Lurus' },
  { key: 'slight_left', label: 'Tengok Kiri', shortLabel: 'Kiri' },
  { key: 'slight_right', label: 'Tengok Kanan', shortLabel: 'Kanan' },
] as const;

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialTabParam = searchParams.get('tab');
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'faces' | 'attendances' | 'profile'>(
    initialTabParam === 'attendances' || initialTabParam === 'profile' ? initialTabParam : 'faces'
  );
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [selectedFaceAction, setSelectedFaceAction] = useState<{
    item: any;
    packet: any;
    poseLabelText: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'single'; item: any; poseLabelText: string }
    | { type: 'packet'; packet: any; packetNumber: number }
    | null
  >(null);
  const [deletingFace, setDeletingFace] = useState<boolean>(false);

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

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'faces' || tabParam === 'attendances' || tabParam === 'profile') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchDetail();
    return () => {
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

  const goToFaceEnrollPage = (mode: 'replace' | 'add' = 'replace') => {
    if (!id) return;
    navigate(`/hrd/employees/${id}/face?mode=${mode}`);
  };

  const goToUpdateSinglePose = (item: any, packet: any) => {
    if (!id) return;
    const params = new URLSearchParams({
      replace_embedding_id: String(item.id),
      pose: String(item.pose_label || 'front'),
      single: '1',
    });
    if (item.batch_id) {
      params.set('batch_id', String(item.batch_id));
    }
    if (packet?.embedding_ids?.length) {
      params.set('packet_ids', packet.embedding_ids.join(','));
    }
    setSelectedFaceAction(null);
    navigate(`/hrd/employees/${id}/face?${params.toString()}`);
  };

  const goToAddMissingPose = (poseKey: string, packet: any) => {
    if (!id) return;
    const params = new URLSearchParams({
      pose: poseKey,
      single: '1',
    });
    if (packet?.batch_id) {
      params.set('batch_id', String(packet.batch_id));
    }
    if (packet?.embedding_ids?.length) {
      params.set('packet_ids', packet.embedding_ids.join(','));
    }
    navigate(`/hrd/employees/${id}/face?${params.toString()}`);
  };

  const handleConfirmDeleteFace = async () => {
    if (!deleteTarget || !data?.employee) return;
    setDeletingFace(true);
    try {
      if (deleteTarget.type === 'single') {
        const res = await axios.delete(
          `/api/hrd/employees/${data.employee.id}/face-embeddings/${deleteTarget.item.id}`
        );
        if (res.data.success) {
          toast.success(`Foto pose ${deleteTarget.poseLabelText} berhasil dihapus`);
        }
      } else {
        const res = await axios.delete(`/api/hrd/employees/${data.employee.id}/face-packets`, {
          data: {
            batch_id: deleteTarget.packet.batch_id,
            embedding_ids: deleteTarget.packet.embedding_ids,
          },
        });
        if (res.data.success) {
          toast.success(`Paket foto #${deleteTarget.packetNumber} berhasil dihapus`);
        }
      }
      setDeleteTarget(null);
      setSelectedFaceAction(null);
      fetchDetail();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menghapus data foto wajah');
    } finally {
      setDeletingFace(false);
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
  const allEmbeddings = data.face_embeddings || [];
  const facePackets = data.face_packets || [];
  const primaryEmbeddings = allEmbeddings.filter(
    (f: any) => Boolean(f.photo_url) || f.dimensions === 512
  );
  const visibleFaces = primaryEmbeddings.length > 0 ? primaryEmbeddings : allEmbeddings;

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

          <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => goToFaceEnrollPage(data.employee.has_biometric ? 'replace' : 'add')}
            >
              <ScanFace className="h-4 w-4 text-primary" />
              <span>{data.employee.has_biometric ? 'Ubah Wajah' : 'Daftarkan Wajah'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5 text-amber-700 dark:text-amber-300 hover:text-amber-800"
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
                    <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 text-xs py-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{visibleFaces.length} Foto Wajah Terdaftar (InsightFace 512D)</span>
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
              <span>Foto & Data Wajah Terdaftar ({visibleFaces.length})</span>
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-foreground">
                      Paket Foto & Vektor Biometrik Wajah ({facePackets.length} Paket)
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Setiap paket berisi 3 pose (Lurus, Kiri, Kanan). Klik foto untuk mengubah atau menghapus satu pose, atau hapus langsung satu paket.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => goToFaceEnrollPage('add')}
                    className="text-xs gap-1.5 h-9 w-fit"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <span>{facePackets.length > 0 ? 'Tambah Paket Wajah (3 Foto)' : 'Daftarkan Wajah (3 Foto)'}</span>
                  </Button>
                </div>

                {facePackets.length === 0 ? (
                  <div className="p-12 text-center rounded-xl border border-dashed bg-muted/20 flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-3">
                      <ScanFace className="h-7 w-7" />
                    </div>
                    <div className="text-sm font-semibold text-foreground">Belum Ada Wajah Terdaftar</div>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Karyawan ini belum memiliki referensi biometrik wajah. Daftarkan 3 foto pose (lurus, kiri, kanan) melalui halaman perekaman wajah.
                    </p>
                    <Button size="sm" className="mt-4 gap-1.5 text-xs h-9" onClick={() => goToFaceEnrollPage('add')}>
                      <Camera className="h-3.5 w-3.5" />
                      <span>Daftarkan Wajah Sekarang</span>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {facePackets.map((packet: any, pIdx: number) => {
                      const packetNumber = facePackets.length - pIdx;
                      return (
                        <Card key={packet.packet_key || pIdx} className="border bg-card shadow-2xs overflow-hidden">
                          <CardHeader className="py-3 px-4 border-b bg-muted/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
                                <Layers className="h-4 w-4 text-primary" />
                                <span>Paket Wajah #{packetNumber}</span>
                              </div>
                              <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/25 font-semibold">
                                {packet.completed_count || 0}/3 Pose
                              </Badge>
                              <span className="text-[11px] font-mono text-muted-foreground">
                                {packet.created_at || '-'}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                oleh {packet.enrolled_by_name || 'HRD'}
                              </span>
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setDeleteTarget({
                                  type: 'packet',
                                  packet,
                                  packetNumber,
                                })
                              }
                              className="h-8 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive w-fit shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Hapus Paket</span>
                            </Button>
                          </CardHeader>

                          <CardContent className="p-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              {POSE_SLOTS.map((slot) => {
                                const fb = packet.poses?.[slot.key] || null;

                                if (!fb) {
                                  return (
                                    <div
                                      key={slot.key}
                                      className="rounded-xl border-2 border-dashed bg-muted/20 p-3 flex flex-col justify-between min-h-[210px]"
                                    >
                                      <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
                                          {slot.shortLabel}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground">Belum terisi</span>
                                      </div>

                                      <div className="my-auto py-4 flex flex-col items-center text-center gap-2">
                                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                          <Camera className="h-4 w-4" />
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                          Foto pose {slot.shortLabel} belum ada atau sudah dihapus
                                        </p>
                                      </div>

                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => goToAddMissingPose(slot.key, packet)}
                                        className="w-full h-8 text-xs gap-1.5"
                                      >
                                        <Camera className="h-3.5 w-3.5" />
                                        <span>Ambil Foto {slot.shortLabel}</span>
                                      </Button>
                                    </div>
                                  );
                                }

                                return (
                                  <div
                                    key={fb.id || slot.key}
                                    className="rounded-xl border bg-background p-3 space-y-2.5 flex flex-col"
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      <div className="flex flex-wrap items-center gap-1">
                                        <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider bg-primary/10 text-primary border-primary/20">
                                          {slot.shortLabel}
                                        </Badge>
                                        {fb.has_sface && (
                                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
                                            +SFace
                                          </Badge>
                                        )}
                                      </div>
                                      <span className="text-[10px] font-mono text-muted-foreground">
                                        #{fb.id}
                                      </span>
                                    </div>

                                    {fb.photo_url ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSelectedFaceAction({
                                            item: fb,
                                            packet,
                                            poseLabelText: slot.label,
                                          })
                                        }
                                        className="relative aspect-4/3 w-full rounded-lg overflow-hidden border bg-black group text-left focus-visible:outline-2 focus-visible:outline-ring"
                                      >
                                        <img
                                          src={fb.photo_url}
                                          alt={`${slot.label} #${fb.id}`}
                                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-2.5 py-2 flex items-center justify-between text-white text-[11px] font-medium">
                                          <span>Klik: Ubah / Hapus</span>
                                          <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                                        </div>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSelectedFaceAction({
                                            item: fb,
                                            packet,
                                            poseLabelText: slot.label,
                                          })
                                        }
                                        className="aspect-4/3 w-full rounded-lg border-2 border-dashed bg-muted/30 flex flex-col items-center justify-center p-3 text-center hover:border-primary/50 transition-colors"
                                      >
                                        <BrainCircuit className="h-5 w-5 text-primary mb-1.5" />
                                        <div className="text-xs font-semibold text-foreground">
                                          Vektor Aktif ({fb.dimensions}D)
                                        </div>
                                        <span className="text-[10px] text-primary font-medium mt-1">
                                          Klik untuk Ubah / Hapus
                                        </span>
                                      </button>
                                    )}

                                    <div className="text-[11px] text-muted-foreground space-y-1 pt-0.5">
                                      <div className="flex justify-between">
                                        <span>Model:</span>
                                        <span className="font-mono text-foreground">{fb.model_version || 'arcface_r50_v1'}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span>Kualitas / Yaw:</span>
                                        <span className="font-mono text-foreground">
                                          {fb.quality_score ?? '-'} / {fb.pose_yaw ?? '-'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
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
                                onClick={() => navigate(`/hrd/logs/${ev.id}?from=employee&employee_id=${data.employee.id}`)}
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

      <Dialog open={selectedFaceAction !== null} onOpenChange={() => setSelectedFaceAction(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              {selectedFaceAction?.poseLabelText} (Vektor #{selectedFaceAction?.item?.id})
            </DialogTitle>
            <DialogDescription className="text-xs">
              Kelola foto pose ini: ubah dengan foto pose baru atau hapus dari paket biometrik.
            </DialogDescription>
          </DialogHeader>

          {selectedFaceAction && (
            <div className="space-y-4">
              {selectedFaceAction.item.photo_url ? (
                <div className="relative aspect-4/3 rounded-xl overflow-hidden border bg-black flex items-center justify-center">
                  <img
                    src={selectedFaceAction.item.photo_url}
                    alt={selectedFaceAction.poseLabelText}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <div className="aspect-4/3 rounded-xl border border-dashed bg-muted/30 flex flex-col items-center justify-center p-6 text-center gap-2">
                  <BrainCircuit className="h-8 w-8 text-primary" />
                  <div className="text-xs font-semibold">
                    Vektor Biometrik Aktif ({selectedFaceAction.item.dimensions}D)
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-3 rounded-lg border">
                <div>
                  <span className="text-muted-foreground">Waktu: </span>
                  <span className="font-mono text-foreground">{selectedFaceAction.item.created_at || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Kualitas: </span>
                  <span className="font-mono text-foreground">{selectedFaceAction.item.quality_score ?? '-'}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDeleteTarget({
                      type: 'single',
                      item: selectedFaceAction.item,
                      poseLabelText: selectedFaceAction.poseLabelText,
                    })
                  }
                  className="sm:flex-1 h-10 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Hapus Foto Ini</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => goToUpdateSinglePose(selectedFaceAction.item, selectedFaceAction.packet)}
                  className="sm:flex-1 h-10 text-xs gap-1.5"
                >
                  <Camera className="h-4 w-4" />
                  <span>Ubah Foto Ini</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={() => !deletingFace && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-destructive flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <span>
                {deleteTarget?.type === 'packet'
                  ? `Hapus Paket Wajah #${deleteTarget.packetNumber}?`
                  : `Hapus Foto ${deleteTarget?.poseLabelText}?`}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {deleteTarget?.type === 'packet'
                ? 'Seluruh foto dan vektor biometrik dalam paket ini akan dinonaktifkan dari pencocokan Kiosk.'
                : 'Foto dan vektor pose ini akan dinonaktifkan dari paket dan disinkronkan ulang ke mesin wajah.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deletingFace}
              onClick={() => setDeleteTarget(null)}
              className="h-9 text-xs"
            >
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deletingFace}
              onClick={handleConfirmDeleteFace}
              className="h-9 text-xs gap-1.5"
            >
              {deletingFace && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              <span>{deletingFace ? 'Menghapus...' : 'Ya, Hapus'}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
