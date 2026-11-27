import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ClipboardList,
  Search,
  Filter,
  RefreshCw,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  ScanFace,
  RotateCcw,
  FileText,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { formatLateLabel } from '@/lib/utils';

export function LogsPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [attendanceType, setAttendanceType] = useState<string>('');
  const [authMethod, setAuthMethod] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [anomalyOnly, setAnomalyOnly] = useState<boolean>(false);

  useEffect(() => {
    fetchLogs();
  }, [page, attendanceType, authMethod, syncStatus, anomalyOnly]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params: any = { page, per_page: 10 };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (attendanceType) params.attendance_type = attendanceType;
      if (authMethod) params.auth_method = authMethod;
      if (syncStatus) params.sync_status = syncStatus;
      if (anomalyOnly) params.anomaly = 'true';

      const res = await axios.get('/api/hrd/logs', { params });
      setLogs(res.data.data || []);
      setTotalPages(res.data.last_page || 1);
    } catch (err) {
      toast.error('Gagal mengambil riwayat absensi');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const handleRetrySync = async (id: number) => {
    try {
      const res = await axios.post(`/api/hrd/logs/${id}/retry`);
      if (res.data.success) {
        toast.success('Event berhasil disinkronkan ulang');
        fetchLogs();
      }
    } catch (err) {
      toast.error('Gagal sinkron ulang');
    }
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
        return { label: 'Istirahat Selesai', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' };
      case 'overtime_start':
        return { label: 'Lembur Mulai', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' };
      case 'overtime_end':
        return { label: 'Lembur Selesai', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20' };
      default:
        return { label: type, color: 'bg-muted text-muted-foreground' };
    }
  };

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Log & Audit Absensi</h1>
            <p className="text-xs text-muted-foreground">
              Riwayat lengkap tap kehadiran biometrik, verifikasi foto bukti darurat, dan status integrasi ERP.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchLogs}
              disabled={loading}
              className="gap-1.5 text-xs h-9"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Perbarui Data</span>
            </Button>
          </div>
        </div>

        <Card className="shadow-xs border">
          <CardHeader className="pb-3 border-b bg-muted/20">
            <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-center gap-2.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Dari:</span>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Sampai:</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>

              <select
                value={attendanceType}
                onChange={(e) => {
                  setAttendanceType(e.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-md border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary"
              >
                <option value="">Semua Tipe Absen</option>
                <option value="clock_in">Masuk</option>
                <option value="break_start">Istirahat Mulai</option>
                <option value="break_end">Istirahat Selesai</option>
                <option value="clock_out">Pulang</option>
                <option value="overtime_start">Lembur Mulai</option>
                <option value="overtime_end">Lembur Selesai</option>
              </select>

              <select
                value={authMethod}
                onChange={(e) => {
                  setAuthMethod(e.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-md border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary"
              >
                <option value="">Semua Metode</option>
                <option value="face_liveness">Biometrik Wajah</option>
                <option value="fallback_pin">Jalur Darurat (PIN)</option>
              </select>

              <select
                value={syncStatus}
                onChange={(e) => {
                  setSyncStatus(e.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-md border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary"
              >
                <option value="">Semua Status Sinkron</option>
                <option value="synced">Tersinkron (synced)</option>
                <option value="pending">Pending</option>
                <option value="period_locked">Periode Terkunci</option>
                <option value="manual_override_conflict">Konflik Koreksi HRD</option>
                <option value="duplicate_ignored">Duplikat Diabaikan</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setAnomalyOnly(!anomalyOnly);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                  anomalyOnly
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
                    : 'bg-background hover:bg-muted text-muted-foreground'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Hanya Anomali</span>
              </button>

              <Button type="submit" size="sm" variant="secondary" className="h-8 text-xs">
                Terapkan
              </Button>
            </form>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-muted-foreground border-b bg-muted/30 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Waktu & Tanggal</th>
                    <th className="py-2.5 px-4">Karyawan</th>
                    <th className="py-2.5 px-4">Tipe Absen</th>
                    <th className="py-2.5 px-4">Metode & Skor</th>
                    <th className="py-2.5 px-4">Status Integrasi</th>
                    <th className="py-2.5 px-4">Lokasi & Anomali</th>
                    <th className="py-2.5 px-4 text-right">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        Memuat data riwayat absensi...
                      </td>
                    </tr>
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        Tidak ada log absensi yang cocok
                      </td>
                    </tr>
                  ) : (
                    logs.map((ev) => {
                      const typeInfo = formatAttendanceType(ev.attendance_type);
                      return (
                        <tr key={ev.id} className="hover:bg-muted/30">
                          <td className="py-3 px-4 font-mono">
                            <div className="font-semibold text-foreground">
                              {ev.recorded_at ? new Date(ev.recorded_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : '-'}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {ev.work_date || (ev.recorded_at ? new Date(ev.recorded_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-')}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-semibold text-foreground">{ev.nama_karyawan}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{ev.id_karyawan}</div>
                          </td>

                          <td className="py-3 px-4">
                            <Badge variant="outline" className={`font-medium ${typeInfo.color}`}>
                              {typeInfo.label}
                            </Badge>
                          </td>

                          <td className="py-3 px-4">
                            {ev.auth_method === 'face_liveness' ? (
                              <div className="flex items-center gap-1.5">
                                <ScanFace className="h-3.5 w-3.5 text-primary" />
                                <span className="font-mono text-emerald-600 font-semibold">
                                  {ev.confidence_score ? `${Math.round(ev.confidence_score * 100)}%` : '100%'}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-amber-600 font-medium">
                                <KeyRound className="h-3.5 w-3.5" />
                                <span>PIN Darurat</span>
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <div>
                                {ev.sync_status === 'synced' ? (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                    Tersinkron
                                  </Badge>
                                ) : ev.sync_status === 'period_locked' ? (
                                  <Badge variant="destructive" className="text-[10px]">
                                    Periode Terkunci
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                                    {ev.sync_status}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {formatLateLabel(ev.main_app_status_label)}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="text-[11px] text-foreground font-medium">{ev.location_name}</div>
                            <div className="flex items-center gap-1 pt-0.5">
                              {ev.is_time_suspect && (
                                <Badge variant="destructive" className="text-[9px] px-1 py-0">
                                  Waktu Suspek
                                </Badge>
                              )}
                              {ev.is_cross_location && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-500/30 text-blue-600">
                                  Lintas Lokasi
                                </Badge>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {ev.proof_photo_url ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 px-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                                  onClick={() => navigate(`/hrd/logs/${ev.id}`)}
                                >
                                  <ImageIcon className="h-3 w-3" />
                                  <span>Foto Bukti</span>
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
                                  onClick={() => navigate(`/hrd/logs/${ev.id}`)}
                                >
                                  <FileText className="h-3 w-3" />
                                  <span>Detail</span>
                                </Button>
                              )}

                              {ev.sync_status !== 'synced' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1 px-2 text-primary"
                                  onClick={() => handleRetrySync(ev.id)}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Retry</span>
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
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
    </HrdLayout>
  );
}
