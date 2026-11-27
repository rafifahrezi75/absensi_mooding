import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HrdLayout } from '@/layouts/HrdLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  Eye,
} from 'lucide-react';
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
  const [syncingMaster, setSyncingMaster] = useState<boolean>(false);

  useEffect(() => {
    fetchEmployees();
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
    } catch {
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
    } catch {
      toast.error('Gagal sinkron master data');
    } finally {
      setSyncingMaster(false);
    }
  };

  return (
    <HrdLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Karyawan & Biometrik</h1>
            <p className="text-xs text-muted-foreground">
              Kelola profil, ubah wajah, dan atur PIN darurat melalui halaman detail karyawan.
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

        <Card className="shadow-xs border overflow-hidden">
          <CardHeader className="py-3 px-4 border-b bg-muted/20">
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
                            <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20">
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
                            <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                              <FileCheck2 className="h-3.5 w-3.5" />
                              <span>{new Date(emp.biometric_consent_at).toLocaleDateString('id-ID')}</span>
                            </div>
                          ) : (
                            <span className="text-[11px]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 px-3 gap-1.5 text-xs"
                              onClick={() => navigate(`/hrd/employees/${emp.id}`)}
                            >
                              <Eye className="h-3.5 w-3.5 text-primary" />
                              <span>Detail</span>
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
    </HrdLayout>
  );
}
