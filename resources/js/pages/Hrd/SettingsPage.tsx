import React, { useState, useEffect } from 'react';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Settings,
  Sliders,
  ShieldCheck,
  Server,
  Save,
  CheckCircle2,
  RefreshCw,
  Clock,
  Layers,
  BrainCircuit,
  AlertCircle,
  MapPin,
  Monitor,
  Sparkles,
} from 'lucide-react';
import { checkPythonEngineHealth } from '@/lib/biometricEngine';
import axios from 'axios';
import { toast } from 'sonner';

export function SettingsPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testingHeartbeat, setTestingHeartbeat] = useState<boolean>(false);
  const [heartbeatStatus, setHeartbeatStatus] = useState<any>(null);
  const [pyEngineStatus, setPyEngineStatus] = useState<any>(null);
  const [syncingPy, setSyncingPy] = useState<boolean>(false);

  const [settings, setSettings] = useState<any>({
    similarity_threshold: 0.75,
    ambiguity_margin: 0.08,
    max_failed_scans: 3,
    auto_lock_seconds: 120,
    main_app_api_url: 'http://localhost:8000/api/integrations/face-attendance',
    main_app_integration_key: 'absensi-kiosk-secret-key-2026',
  });

  const [buttons, setButtons] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/hrd/settings');
      if (res.data.settings) setSettings(res.data.settings);
      if (res.data.buttons) setButtons(res.data.buttons);
      if (res.data.locations) setLocations(res.data.locations);
      if (res.data.devices) setDevices(res.data.devices);

      const pyStatus = await checkPythonEngineHealth();
      setPyEngineStatus(pyStatus);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal memuat pengaturan sistem');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncPythonCache = async () => {
    setSyncingPy(true);
    try {
      const res = await axios.get('/api/kiosk/employees-cache');
      if (res.data.employees) {
        const pyStatus = await checkPythonEngineHealth();
        if (pyStatus.available) {
          toast.success(`${res.data.employees.length} data wajah berhasil disinkronkan ke mesin Python`);
          setPyEngineStatus(pyStatus);
        } else {
          toast.error('Mesin Python belum dapat dihubungi');
        }
      }
    } catch (err: any) {
      toast.error('Gagal memuat data karyawan untuk sinkronisasi');
    } finally {
      setSyncingPy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formattedButtons = buttons.map((b) => ({
        ...b,
        auto_highlight_start: b.auto_highlight_start
          ? (b.auto_highlight_start.length === 5 ? `${b.auto_highlight_start}:00` : b.auto_highlight_start)
          : null,
        auto_highlight_end: b.auto_highlight_end
          ? (b.auto_highlight_end.length === 5 ? `${b.auto_highlight_end}:00` : b.auto_highlight_end)
          : null,
      }));

      const res = await axios.put('/api/hrd/settings', {
        ...settings,
        buttons: formattedButtons,
      });
      if (res.data.success) {
        toast.success(res.data.message || 'Pengaturan berhasil disimpan');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan pengaturan');
    } finally {
      setSaving(false);
    }
  };

  const handleTestHeartbeat = async () => {
    setTestingHeartbeat(true);
    setHeartbeatStatus(null);
    try {
      const res = await axios.get('/api/integrations/face-attendance/heartbeat');
      setHeartbeatStatus({
        success: true,
        data: res.data,
      });
      toast.success('Koneksi heartbeat aplikasi utama berhasil');
    } catch (err: any) {
      setHeartbeatStatus({
        success: false,
      });
      toast.error('Gagal menghubungi endpoint heartbeat aplikasi utama');
    } finally {
      setTestingHeartbeat(false);
    }
  };

  const handleButtonChange = (index: number, field: string, value: any) => {
    setButtons((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pengaturan Sistem Kiosk</h1>
            <p className="text-xs text-muted-foreground">
              Konfigurasi ambang biometrik AI, mesin pengenalan wajah Python, tombol presensi, dan integrasi API.
            </p>
          </div>

          <Button
            type="button"
            onClick={handleSaveSettings}
            disabled={saving || loading}
            className="gap-2 h-9 text-xs"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
          </Button>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-6">
          <Card className="shadow-xs border">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                <span>Parameter Biometrik & Keamanan</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Penyesuaian akurasi pencocokan wajah dan aturan toleransi edge case.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="threshold" className="font-semibold">
                    Similarity Threshold (Ambang Kemiripan)
                  </Label>
                  <span className="font-mono font-bold text-primary">
                    {Math.round((settings.similarity_threshold ?? 0.75) * 100)}%
                  </span>
                </div>
                <input
                  id="threshold"
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.01"
                  value={settings.similarity_threshold ?? 0.75}
                  onChange={(e) =>
                    setSettings({ ...settings, similarity_threshold: parseFloat(e.target.value) })
                  }
                  className="w-full accent-primary"
                />
                <p className="text-[11px] text-muted-foreground">
                  Skor minimal kemiripan vektor agar wajah dikenali sebagai karyawan aktif.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="ambiguity" className="font-semibold">
                    Ambiguity Margin (Margin Anti-Wajah-Mirip)
                  </Label>
                  <span className="font-mono font-bold text-primary">
                    {Math.round((settings.ambiguity_margin ?? 0.08) * 100)}%
                  </span>
                </div>
                <input
                  id="ambiguity"
                  type="range"
                  min="0.02"
                  max="0.20"
                  step="0.01"
                  value={settings.ambiguity_margin ?? 0.08}
                  onChange={(e) =>
                    setSettings({ ...settings, ambiguity_margin: parseFloat(e.target.value) })
                  }
                  className="w-full accent-primary"
                />
                <p className="text-[11px] text-muted-foreground">
                  Jika selisih skor kandidat 1 dan 2 di bawah batas ini, sistem mewajibkan verifikasi 4 digit ID.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_failed" className="font-semibold">
                  Maksimal Gagal Scan Sebelum Jalur Darurat
                </Label>
                <Input
                  id="max_failed"
                  type="number"
                  min="1"
                  max="5"
                  value={settings.max_failed_scans ?? 3}
                  onChange={(e) =>
                    setSettings({ ...settings, max_failed_scans: parseInt(e.target.value) || 3 })
                  }
                  className="h-9 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Jumlah kegagalan sebelum jendela modal ID + PIN darurat otomatis terbuka.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="autolock" className="font-semibold">
                  Durasi Auto-Lock Panel HRD (Detik)
                </Label>
                <Input
                  id="autolock"
                  type="number"
                  min="30"
                  max="600"
                  value={settings.auto_lock_seconds ?? 120}
                  onChange={(e) =>
                    setSettings({ ...settings, auto_lock_seconds: parseInt(e.target.value) || 120 })
                  }
                  className="h-9 font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Panel HRD otomatis terkunci kembali ke mode Kiosk jika tidak ada aktivitas.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-primary" />
                  <span>Mesin Biometrik Wajah Python (InsightFace ArcFace)</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Status layanan microservice pengenalan wajah offline dan ekstraksi 512-dimensi.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSyncPythonCache}
                disabled={syncingPy}
                className="gap-1.5 text-xs h-8"
              >
                <RefreshCw className={`h-3 w-3 ${syncingPy ? 'animate-spin' : ''}`} />
                <span>{syncingPy ? 'Menyinkronkan...' : 'Sinkronkan Cache Vektor'}</span>
              </Button>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <div className="text-muted-foreground text-[11px]">Status Layanan</div>
                <div className="flex items-center gap-1.5 font-semibold">
                  {pyEngineStatus?.available ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-emerald-600 dark:text-emerald-400">Aktif (Port 8005)</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2 w-2 rounded-full bg-destructive" />
                      <span className="text-destructive">Tidak Terhubung</span>
                    </>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <div className="text-muted-foreground text-[11px]">Model Deep Learning</div>
                <div className="font-semibold font-mono text-foreground">
                  {pyEngineStatus?.version || 'buffalo_s'} (ArcFace 512D)
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <div className="text-muted-foreground text-[11px]">Anti-Spoofing Liveness</div>
                <div className="flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Gerakan Kepala + Deteksi Server</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <span>Pengaturan Tombol Tipe Absen & Auto-Highlight</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Atur label tombol di layar Kiosk dan rentang jam penyorotan otomatis (format 24 jam WIB).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-muted-foreground border-y bg-muted/30 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="py-2.5 px-4">Tipe Absen</th>
                      <th className="py-2.5 px-4">Label Tampilan</th>
                      <th className="py-2.5 px-4">Status Aktif</th>
                      <th className="py-2.5 px-4">Jam Mulai Highlight</th>
                      <th className="py-2.5 px-4">Jam Akhir Highlight</th>
                      <th className="py-2.5 px-4 text-right">Urutan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {buttons.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-muted-foreground">
                          Tidak ada konfigurasi tombol absen
                        </td>
                      </tr>
                    ) : (
                      buttons.map((btn: any, idx: number) => (
                        <tr key={btn.id || btn.attendance_type} className="hover:bg-muted/20">
                          <td className="py-3 px-4 font-mono font-medium">{btn.attendance_type}</td>
                          <td className="py-3 px-4">
                            <Input
                              type="text"
                              value={btn.label || ''}
                              onChange={(e) => handleButtonChange(idx, 'label', e.target.value)}
                              className="h-8 text-xs max-w-[140px]"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Switch
                              checked={!!btn.is_enabled}
                              onCheckedChange={(val) => handleButtonChange(idx, 'is_enabled', val)}
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Input
                              type="time"
                              step="60"
                              value={btn.auto_highlight_start ? String(btn.auto_highlight_start).slice(0, 5) : ''}
                              onChange={(e) => handleButtonChange(idx, 'auto_highlight_start', e.target.value)}
                              className="h-8 text-xs w-28 font-mono"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <Input
                              type="time"
                              step="60"
                              value={btn.auto_highlight_end ? String(btn.auto_highlight_end).slice(0, 5) : ''}
                              onChange={(e) => handleButtonChange(idx, 'auto_highlight_end', e.target.value)}
                              className="h-8 text-xs w-28 font-mono"
                            />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Input
                              type="number"
                              min="1"
                              max="10"
                              value={btn.sort_order || 0}
                              onChange={(e) => handleButtonChange(idx, 'sort_order', parseInt(e.target.value) || 0)}
                              className="h-8 text-xs w-16 text-right font-mono inline-block"
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <span>Koneksi Integrasi Aplikasi Utama</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Konfigurasi endpoint integrasi dua arah (master sync & push event ke tabel absensis).
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestHeartbeat}
                disabled={testingHeartbeat}
                className="gap-1.5 text-xs h-8"
              >
                <RefreshCw className={`h-3 w-3 ${testingHeartbeat ? 'animate-spin' : ''}`} />
                <span>Tes Heartbeat</span>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="space-y-2">
                <Label htmlFor="api_url" className="font-semibold">
                  URL Endpoint Integrasi Face Attendance
                </Label>
                <Input
                  id="api_url"
                  type="text"
                  value={settings.main_app_api_url ?? ''}
                  onChange={(e) => setSettings({ ...settings, main_app_api_url: e.target.value })}
                  className="h-9 font-mono text-xs"
                />
              </div>

              {heartbeatStatus && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                    heartbeatStatus.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-destructive/10 border-destructive/30 text-destructive'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {heartbeatStatus.success ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <Server className="h-4 w-4 shrink-0" />
                    )}
                    <span>
                      {heartbeatStatus.success
                        ? `Server Terhubung: ${heartbeatStatus.data?.server_time}`
                        : 'Gagal terhubung ke endpoint integrasi'}
                    </span>
                  </div>
                  {heartbeatStatus.data?.locked_periods && (
                    <Badge variant="outline" className="text-[10px]">
                      {heartbeatStatus.data.locked_periods.length} Periode Dikunci
                    </Badge>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-xs border">
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Monitor className="h-4 w-4 text-primary" />
                <span>Perangkat & Lokasi Kiosk Terdaftar</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Daftar terminal fisik Kiosk dan lokasi operasional yang aktif.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Monitor className="h-3.5 w-3.5" />
                    <span>Perangkat Kiosk ({devices.length})</span>
                  </div>
                  <div className="space-y-2">
                    {devices.map((d: any) => (
                      <div key={d.id} className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-foreground">{d.device_name}</div>
                          <div className="text-[11px] font-mono text-muted-foreground">Token: {d.device_token}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {d.location?.location_name || 'Lokasi Terdaftar'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-semibold text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>Lokasi Operasional ({locations.length})</span>
                  </div>
                  <div className="space-y-2">
                    {locations.map((loc: any) => (
                      <div key={loc.id} className="p-3 rounded-lg border bg-muted/20 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-foreground">{loc.location_name}</div>
                          <div className="text-[11px] text-muted-foreground">{loc.kota || 'Kota Pusat'} • Tipe: {loc.location_type}</div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          ID: {loc.id}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={saving || loading}
              className="gap-2 px-6 h-10 font-medium"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Menyimpan Perubahan...' : 'Simpan Semua Pengaturan'}</span>
            </Button>
          </div>
        </form>
      </div>
    </HrdLayout>
  );
}
