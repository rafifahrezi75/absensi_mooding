import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Wifi, WifiOff, Clock, Shield, Moon, Sun, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/context/theme-provider';
import { getOfflineQueueCount, syncOfflineQueue } from '@/lib/offlineQueue';
import axios from 'axios';
import { toast } from 'sonner';

interface KioskLayoutProps {
  children: React.ReactNode;
  locationInfo?: any;
}

export function KioskLayout({ children, locationInfo }: KioskLayoutProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [queueCount, setQueueCount] = useState<number>(0);
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [hrdPin, setHrdPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
      setCurrentDate(
        now.toLocaleDateString('id-ID', {
          weekday: 'long',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      );
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Koneksi terhubung kembali');
      triggerSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('Mode Offline aktif — data absensi disimpan lokal');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const checkQueue = async () => {
      try {
        const count = await getOfflineQueueCount();
        setQueueCount(count);
      } catch (e) {}
    };

    checkQueue();
    const queueInterval = setInterval(checkQueue, 4000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(queueInterval);
    };
  }, []);

  const triggerSync = async () => {
    if (!navigator.onLine || isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await syncOfflineQueue();
      if (res.synced > 0) {
        toast.success(`${res.synced} data tersimpan offline berhasil disinkronkan`);
      }
      const count = await getOfflineQueueCount();
      setQueueCount(count);
    } catch (err) {
    } finally {
      setIsSyncing(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hrdPin) return;

    setIsVerifying(true);
    setPinError('');

    try {
      const res = await axios.post('/api/kiosk/auth-verify', { pin: hrdPin });
      if (res.data.success) {
        localStorage.setItem('hrd_session_user', JSON.stringify(res.data.user));
        toast.success('Kunci Kiosk terbuka');
        setIsPinModalOpen(false);
        setHrdPin('');
        navigate('/hrd/dashboard');
      }
    } catch (err: any) {
      setPinError(err.response?.data?.message || 'PIN HRD tidak sesuai');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground select-none">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-card/90 px-4 py-2.5 backdrop-blur-md shadow-xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPinModalOpen(true)}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-left focus:outline-none"
            title="Klik untuk membuka panel HRD"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold shadow-xs">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                {locationInfo?.location_name || 'Terminal Kiosk Absensi'}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span>{locationInfo?.kota || 'Cabang Utama'}</span>
                <span>•</span>
                <span className="capitalize">{locationInfo?.location_type || 'Kiosk'}</span>
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end">
            <div className="flex items-center gap-1.5 font-mono text-base font-bold tabular-nums">
              <Clock className="h-4 w-4 text-primary" />
              <span>{currentTime}</span>
            </div>
            <div className="text-xs text-muted-foreground">{currentDate}</div>
          </div>

          <div className="flex items-center gap-2">
            {isOnline ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Wifi className="h-3 w-3" />
                <span>Online</span>
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <WifiOff className="h-3 w-3" />
                <span>Offline</span>
              </Badge>
            )}

            {queueCount > 0 && (
              <button
                onClick={triggerSync}
                disabled={isSyncing || !isOnline}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                title="Klik untuk sinkronisasi antrean"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{queueCount} Antrean</span>
              </button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Ganti Tema"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-medium h-8"
              onClick={() => setIsPinModalOpen(true)}
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Panel HRD</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>

      <Dialog open={isPinModalOpen} onOpenChange={setIsPinModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <span>Buka Kunci Panel HRD</span>
            </DialogTitle>
            <DialogDescription>
              Masukkan PIN Admin atau HRD untuk mengakses pengaturan perangkat dan data biometrik.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleVerifyPin} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Input
                type="password"
                maxLength={8}
                placeholder="Masukkan 6-digit PIN"
                value={hrdPin}
                onChange={(e) => setHrdPin(e.target.value)}
                className="text-center text-2xl tracking-widest font-mono h-12"
                autoFocus
              />
              {pinError && <div className="text-xs text-destructive text-center font-medium">{pinError}</div>}
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  className="h-11 text-base font-semibold"
                  onClick={() => {
                    if (k === 'C') setHrdPin('');
                    else if (k === '⌫') setHrdPin((prev) => prev.slice(0, -1));
                    else if (hrdPin.length < 8) setHrdPin((prev) => prev + k);
                  }}
                >
                  {k}
                </Button>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                className="w-1/2"
                onClick={() => {
                  setIsPinModalOpen(false);
                  setHrdPin('');
                  setPinError('');
                }}
              >
                Batal
              </Button>
              <Button type="submit" className="w-1/2" disabled={isVerifying || hrdPin.length < 4}>
                {isVerifying ? 'Memeriksa...' : 'Buka Kunci'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
