import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  ShieldCheck,
  ScanFace,
  KeyRound,
  Image as ImageIcon,
  ExternalLink,
  Copy,
  MapPin,
  Monitor,
  UserCheck,
  Maximize2,
  Check,
  Building,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { formatLateLabel } from '@/lib/utils';

export function LogDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [retrying, setRetrying] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [zoomPhoto, setZoomPhoto] = useState<{ url: string; title: string } | null>(null);

  const isFromEmployee = searchParams.get('from') === 'employee';
  const queryEmployeeId = searchParams.get('employee_id');
  const resolvedEmployeeId = event?.employee_id || queryEmployeeId;
  const backUrl =
    isFromEmployee && resolvedEmployeeId
      ? `/hrd/employees/${resolvedEmployeeId}?tab=attendances`
      : '/hrd/logs';
  const backButtonLabel = isFromEmployee ? 'Kembali ke Detail Karyawan' : 'Kembali ke Riwayat Log';

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/hrd/logs/${id}`);
      setEvent(res.data.event);
    } catch (err: any) {
      toast.error('Gagal mengambil data detail absensi');
    } finally {
      setLoading(false);
    }
  };

  const handleRetrySync = async () => {
    if (!event) return;
    setRetrying(true);
    try {
      const res = await axios.post(`/api/hrd/logs/${event.id}/retry`);
      if (res.data.success) {
        toast.success('Event presensi berhasil disinkronkan ulang');
        fetchDetail();
      }
    } catch (err) {
      toast.error('Gagal menyinkronkan ulang event');
    } finally {
      setRetrying(false);
    }
  };

  const copyIdempotencyKey = () => {
    if (!event?.idempotency_key) return;
    navigator.clipboard.writeText(event.idempotency_key);
    setCopiedKey(true);
    toast.success('Idempotency key disalin ke clipboard');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const formatAttendanceType = (type: string) => {
    switch (type) {
      case 'clock_in':
        return { label: 'Masuk', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
      case 'clock_out':
        return { label: 'Pulang', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
      case 'break_start':
        return { label: 'Istirahat Mulai', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
      case 'break_end':
        return { label: 'Istirahat Selesai', color: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' };
      case 'overtime_start':
        return { label: 'Lembur Mulai', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' };
      case 'overtime_end':
        return { label: 'Lembur Selesai', color: 'bg-pink-500/10 text-pink-600 border-pink-500/20' };
      default:
        return { label: type || '-', color: 'bg-muted text-muted-foreground border-border' };
    }
  };

  const formatSyncStatus = (status: string) => {
    switch (status) {
      case 'synced':
        return { label: 'Tersinkron', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' };
      case 'pending':
        return { label: 'Menunggu', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
      case 'failed':
        return { label: 'Gagal', color: 'bg-rose-500/10 text-rose-600 border-rose-500/20' };
      case 'period_locked':
        return { label: 'Periode Dikunci', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' };
      case 'manual_override_conflict':
        return { label: 'Konflik Manual', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20' };
      default:
        return { label: status || '-', color: 'bg-muted text-muted-foreground border-border' };
    }
  };

  if (loading) {
    return (
      <HrdLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <RotateCcw className="h-8 w-8 text-primary animate-spin" />
            <div className="text-sm font-medium text-muted-foreground">Memuat detail presensi & foto bukti...</div>
          </div>
        </div>
      </HrdLayout>
    );
  }

  if (!event) {
    return (
      <HrdLayout>
        <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <h2 className="text-xl font-bold">Data Presensi Tidak Ditemukan</h2>
          <p className="text-sm text-muted-foreground">
            Data absensi dengan ID tersebut tidak ditemukan pada database kiosk.
          </p>
          <Button onClick={() => navigate(backUrl)} variant="outline">
            {backButtonLabel}
          </Button>
        </div>
      </HrdLayout>
    );
  }

  const attType = formatAttendanceType(event.attendance_type);
  const syncStat = formatSyncStatus(event.sync_status);

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(backUrl)}
              className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{backButtonLabel}</span>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Detail Presensi #{event.id}
                </h1>
                <Badge variant="outline" className={`text-xs ${attType.color}`}>
                  {attType.label}
                </Badge>
                <Badge variant="outline" className={`text-xs ${syncStat.color}`}>
                  {syncStat.label}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Audit biometrik, visual bukti fisik, dan jejak integrasi transaksi presensi kiosk.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {event.sync_status !== 'synced' && (
              <Button
                variant="default"
                size="sm"
                onClick={handleRetrySync}
                disabled={retrying}
                className="gap-1.5 text-xs h-9"
              >
                <RotateCcw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
                <span>{retrying ? 'Menyinkronkan...' : 'Sinkronkan Ulang'}</span>
              </Button>
            )}
            {event.proof_photo_url && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs h-9"
                onClick={() => window.open(event.proof_photo_url, '_blank')}
              >
                <ExternalLink className="h-4 w-4" />
                <span>Buka Foto Asli</span>
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            <Card className="shadow-xs border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b bg-muted/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-primary" />
                    <CardTitle className="text-sm font-semibold">Foto Bukti Presensi</CardTitle>
                  </div>
                  {event.auth_method === 'face_liveness' ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1">
                      <ScanFace className="h-3 w-3" />
                      <span>Biometrik 512D</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] gap-1">
                      <KeyRound className="h-3 w-3" />
                      <span>Jalur Darurat (PIN)</span>
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4">
                {event.auth_method === 'face_liveness' ? (
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      {
                        key: 'front',
                        title: 'Lurus',
                        fullTitle: 'Foto Hadap Lurus',
                        url: event.proof_photo_url,
                      },
                      {
                        key: 'left',
                        title: 'Kiri',
                        fullTitle: 'Foto Tengok Kiri',
                        url: event.proof_photo_left_url,
                      },
                      {
                        key: 'right',
                        title: 'Kanan',
                        fullTitle: 'Foto Tengok Kanan',
                        url: event.proof_photo_right_url,
                      },
                    ].map((shot) => (
                      <div key={shot.key} className="space-y-1">
                        {shot.url ? (
                          <button
                            type="button"
                            onClick={() =>
                              setZoomPhoto({
                                url: shot.url,
                                title: `${shot.fullTitle} - ${event.nama_karyawan}`,
                              })
                            }
                            className="relative aspect-4/3 w-full rounded-lg overflow-hidden border bg-black group focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <img
                              src={shot.url}
                              alt={shot.fullTitle}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] font-semibold py-0.5 px-1.5 flex items-center justify-between">
                              <span>{shot.title}</span>
                              <Maximize2 className="h-2.5 w-2.5" />
                            </div>
                          </button>
                        ) : (
                          <div className="aspect-4/3 rounded-lg border border-dashed bg-muted/30 flex flex-col items-center justify-center p-2 text-center">
                            <ImageIcon className="h-4 w-4 text-muted-foreground/50 mb-1" />
                            <span className="text-[10px] text-muted-foreground">{shot.title}: N/A</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="relative aspect-4/3 rounded-xl overflow-hidden border bg-black flex items-center justify-center">
                    {event.proof_photo_url ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPhoto({
                            url: event.proof_photo_url,
                            title: `Foto Bukti Presensi - ${event.nama_karyawan}`,
                          })
                        }
                        className="w-full h-full relative focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <img
                          src={event.proof_photo_url}
                          alt="Foto Bukti Absensi"
                          className="w-full h-full object-contain"
                        />
                      </button>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-muted-foreground p-6 text-center space-y-2">
                        <ImageIcon className="h-10 w-10 stroke-1 text-muted-foreground/40" />
                        <div className="text-xs">Foto bukti fisik tidak tersedia pada record ini</div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-xs border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b bg-muted/20">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <span>Integritas & Verifikasi Biometrik</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between py-1 border-b">
                  <span className="text-muted-foreground">Metode Autentikasi</span>
                  <span className="font-semibold text-foreground">
                    {event.auth_method === 'face_liveness'
                      ? 'Pemindaian Wajah & Liveness'
                      : 'Jalur Darurat (PIN Karyawan)'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b">
                  <span className="text-muted-foreground">Skor Kecocokan AI</span>
                  <span className="font-mono font-bold text-foreground">
                    {event.confidence_score !== null ? `${event.confidence_score}%` : 'N/A (PIN Darurat)'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b">
                  <span className="text-muted-foreground">Hasil Uji Liveness</span>
                  <span className="font-medium">
                    {event.liveness_passed ? (
                      <span className="text-emerald-600 flex items-center gap-1 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Lolos Liveness
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Tidak Menggunakan Liveness</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b">
                  <span className="text-muted-foreground">Validitas Lokasi</span>
                  <span>
                    {event.is_cross_location ? (
                      <span className="text-amber-600 font-medium">Lintas Lokasi Terdeteksi</span>
                    ) : (
                      <span className="text-emerald-600 font-medium">Sesuai Penugasan</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Integritas Waktu</span>
                  <span>
                    {event.is_time_suspect ? (
                      <span className="text-rose-600 font-medium">Waktu Dicurigai</span>
                    ) : (
                      <span className="text-emerald-600 font-medium">Waktu Normal Sinkron</span>
                    )}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <Card className="shadow-xs border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-primary" />
                    <span>Profil Karyawan</span>
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 px-2 text-primary"
                    onClick={() => navigate(`/hrd/employees/${event.employee_id}`)}
                  >
                    <span>Buka Profil</span>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted border flex items-center justify-center shrink-0">
                    {event.profile_photo_url ? (
                      <img
                        src={event.profile_photo_url}
                        alt={event.nama_karyawan}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-bold text-lg text-muted-foreground">
                        {event.nama_karyawan ? event.nama_karyawan.slice(0, 2).toUpperCase() : 'EM'}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 flex-1">
                    <div className="text-lg font-bold text-foreground leading-tight">
                      {event.nama_karyawan}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{event.id_karyawan}</span>
                      <span>•</span>
                      <span>NIK: {event.nomor_induk || '-'}</span>
                      <span>•</span>
                      <span className="font-medium text-foreground">{event.jabatan || '-'}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Shift Terdaftar: <span className="font-medium text-foreground">{event.shift_name}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b bg-muted/20">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>Waktu & Terminal Presensi</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1 p-3 rounded-lg border bg-muted/20">
                    <div className="text-muted-foreground">Waktu Terverifikasi (WIB)</div>
                    <div className="font-semibold text-sm text-foreground">
                      {event.recorded_at_human}
                    </div>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      ISO: {event.recorded_at}
                    </div>
                  </div>

                  <div className="space-y-1 p-3 rounded-lg border bg-muted/20">
                    <div className="text-muted-foreground">Tanggal Siklus Kerja</div>
                    <div className="font-semibold text-sm text-foreground">
                      {event.work_date || '-'}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Tipe Event: <span className="font-medium uppercase">{event.attendance_type}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1 p-3 rounded-lg border bg-muted/20">
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <Monitor className="h-3.5 w-3.5 text-primary" />
                      <span>Perangkat Terminal Kiosk</span>
                    </div>
                    <div className="font-semibold text-foreground">{event.device_name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">
                      Token: {event.device_token}
                    </div>
                  </div>

                  <div className="space-y-1 p-3 rounded-lg border bg-muted/20">
                    <div className="text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Lokasi Presensi</span>
                    </div>
                    <div className="font-semibold text-foreground">{event.location_name}</div>
                    <div className="text-[11px] text-muted-foreground uppercase">
                      Tipe: {event.location_type || '-'}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs border overflow-hidden">
              <CardHeader className="py-3 px-4 border-b bg-muted/20">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Building className="h-4 w-4 text-primary" />
                  <span>Sinkronisasi ERP & Jejak Audit</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Idempotency Key:</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyIdempotencyKey}
                      className="h-6 px-1.5 gap-1 text-[11px] font-mono"
                    >
                      {copiedKey ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedKey ? 'Tersalin' : 'Salin Key'}</span>
                    </Button>
                  </div>
                  <div className="font-mono text-[11px] bg-background p-2 rounded-md border break-all select-all">
                    {event.idempotency_key}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Status Sinkron:</span>
                    <Badge variant="outline" className={`text-[10px] ${syncStat.color}`}>
                      {syncStat.label}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Percobaan Sinkron:</span>
                    <span className="font-semibold text-foreground">{event.sync_attempts} kali</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Status Pesan ERP:</span>
                    <span className="font-medium text-foreground">{formatLateLabel(event.main_app_status_label)}</span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b">
                    <span className="text-muted-foreground">Waktu Sinkronisasi:</span>
                    <span className="font-mono text-foreground">{event.synced_at || '-'}</span>
                  </div>
                </div>

                {event.last_sync_error && (
                  <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs space-y-1">
                    <div className="font-semibold">Pesan Error Sinkronisasi:</div>
                    <div className="font-mono text-[11px]">{event.last_sync_error}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={zoomPhoto !== null} onOpenChange={() => setZoomPhoto(null)}>
        <DialogContent className="sm:max-w-2xl p-4">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-sm font-semibold truncate">
              {zoomPhoto?.title || 'Foto Bukti Presensi'}
            </DialogTitle>
          </DialogHeader>
          {zoomPhoto && (
            <div className="relative rounded-xl overflow-hidden border bg-black flex items-center justify-center max-h-[80vh]">
              <img
                src={zoomPhoto.url}
                alt={zoomPhoto.title}
                className="max-h-[80vh] w-auto object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </HrdLayout>
  );
}
