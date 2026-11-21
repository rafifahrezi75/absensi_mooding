import React, { useState, useEffect } from 'react';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  ScanFace,
  UserCheck,
  ClockAlert,
  LogOut,
  Clock,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  Server,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

export function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncingQueue, setSyncingQueue] = useState<boolean>(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hrd/dashboard');
      setData(res.data);
    } catch (err) {
      toast.error('Gagal mengambil data ringkasan dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncQueue = async () => {
    setSyncingQueue(true);
    try {
      const res = await axios.post('/api/hrd/sync-queue');
      toast.success(res.data.message || 'Antrean berhasil disinkronkan');
      fetchDashboard();
    } catch (err) {
      toast.error('Gagal melakukan sinkronisasi antrean');
    } finally {
      setSyncingQueue(false);
    }
  };

  const summary = data?.summary || {};
  const devices = data?.devices || [];
  const alerts = data?.alerts || {};

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard Presensi Kiosk</h1>
            <p className="text-xs text-muted-foreground">
              Pemantauan aktivitas kehadiran biometrik, kesehatan perangkat, dan integritas sinkronisasi.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDashboard}
              disabled={loading}
              className="gap-1.5 text-xs h-9"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Perbarui</span>
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={handleSyncQueue}
              disabled={syncingQueue || summary.offline_pending_count === 0}
              className="gap-1.5 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
              <span>Sinkronkan Antrean ({summary.offline_pending_count || 0})</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Karyawan</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{summary.total_employees ?? 0}</div>
              <p className="text-[11px] text-muted-foreground mt-1">Status aktif di sistem</p>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Wajah Terdaftar</CardTitle>
              <ScanFace className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {summary.enrolled_faces ?? 0}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {summary.total_employees
                  ? Math.round(((summary.enrolled_faces || 0) / summary.total_employees) * 100)
                  : 0}
                % persetujuan biometrik
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Masuk Hari Ini</CardTitle>
              <UserCheck className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{summary.today_hadir ?? 0}</div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                <span className="text-emerald-600 font-medium">{summary.today_tepat_waktu ?? 0} tepat waktu</span>
                <span>•</span>
                <span className="text-amber-600 font-medium">{summary.today_terlambat ?? 0} telat</span>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">Jalur Darurat (PIN)</CardTitle>
              <KeyRound className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
                {summary.today_fallback_pin ?? 0}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Foto bukti tersimpan untuk audit</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="shadow-xs border">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Status Perangkat Kiosk</CardTitle>
                  <CardDescription className="text-xs">
                    Titik Kiosk yang terpasang di cabang, gudang, dan site proyek.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs">
                  {devices.length} Perangkat
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="text-muted-foreground border-b bg-muted/40 uppercase tracking-wider font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Nama Perangkat</th>
                        <th className="py-2.5 px-3">Lokasi / Tipe</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Versi</th>
                        <th className="py-2.5 px-3 text-right">Terakhir Aktif</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {devices.map((d: any) => (
                        <tr key={d.id} className="hover:bg-muted/30">
                          <td className="py-3 px-3 font-semibold text-foreground">
                            {d.device_name}
                            <div className="text-[10px] text-muted-foreground font-mono">{d.device_token}</div>
                          </td>
                          <td className="py-3 px-3">
                            <div>{d.location_name}</div>
                            <span className="text-[10px] text-muted-foreground uppercase">{d.location_type}</span>
                          </td>
                          <td className="py-3 px-3">
                            {d.is_online ? (
                              <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Online
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 bg-muted text-muted-foreground border-border">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                Standby
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-muted-foreground">v{d.app_version || '1.0.0'}</td>
                          <td className="py-3 px-3 text-right text-muted-foreground">
                            {d.last_seen_at ? new Date(d.last_seen_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-xs border">
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span>Audit & Anomali</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Peringatan integritas data sebelum periode payroll ditutup.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="text-xs font-semibold">Periode Terkunci</div>
                    <div className="text-[11px] text-muted-foreground">Percobaan absen menabrak kunci payroll</div>
                  </div>
                  <Badge variant={alerts.period_locked > 0 ? 'destructive' : 'secondary'} className="font-mono">
                    {alerts.period_locked || 0}
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="text-xs font-semibold">Deviasi Jam Kiosk</div>
                    <div className="text-[11px] text-muted-foreground">Flag is_time_suspect perangkat</div>
                  </div>
                  <Badge variant={alerts.is_time_suspect > 0 ? 'destructive' : 'secondary'} className="font-mono">
                    {alerts.is_time_suspect || 0}
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                  <div>
                    <div className="text-xs font-semibold">Audit Foto Bukti PIN</div>
                    <div className="text-[11px] text-muted-foreground">Absensi jalur PIN belum diperiksa</div>
                  </div>
                  <Badge variant={alerts.fallback_pin_unverified > 0 ? 'outline' : 'secondary'} className="font-mono text-amber-600 border-amber-500/30">
                    {alerts.fallback_pin_unverified || 0}
                  </Badge>
                </div>

                <div className="pt-2">
                  <Link to="/hrd/logs?anomaly=true">
                    <Button variant="outline" size="sm" className="w-full justify-between text-xs">
                      <span>Buka Log Anomali Lengkap</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xs border bg-primary/5 border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Integrasi Aplikasi Utama
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Protokol Keamanan:</span>
                  <span className="font-mono font-semibold text-foreground">HMAC-SHA256</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Pipeline Tujuan:</span>
                  <span className="font-mono text-foreground">absensis → AbsensiRekap</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Deduplikasi:</span>
                  <span className="font-medium text-emerald-600">First-Scan (Masuk)</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </HrdLayout>
  );
}
