import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Settings,
  MonitorCheck,
  LogOut,
  Moon,
  Sun,
  Timer,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTheme } from '@/context/theme-provider';
import axios from 'axios';
import { toast } from 'sonner';

interface HrdLayoutProps {
  children: React.ReactNode;
}

export function HrdLayout({ children }: HrdLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(120);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const rawUser = localStorage.getItem('hrd_session_user');
    if (rawUser) {
      try {
        setCurrentUser(JSON.parse(rawUser));
      } catch (e) {}
    } else {
      axios
        .get('/api/hrd/me')
        .then((res) => {
          setCurrentUser(res.data.user);
          localStorage.setItem('hrd_session_user', JSON.stringify(res.data.user));
        })
        .catch(() => {
          navigate('/hrd/login');
        });
    }
  }, [navigate]);

  useEffect(() => {
    let timeoutSec = 120;
    setRemainingSeconds(timeoutSec);

    const resetTimer = () => {
      setRemainingSeconds(timeoutSec);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));

    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          toast.info('Sesi tidak aktif — Kiosk dikunci kembali');
          navigate('/kiosk');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await axios.post('/api/hrd/logout');
    } catch (e) {}
    localStorage.removeItem('hrd_session_user');
    toast.success('Keluar dari panel HRD');
    navigate('/kiosk');
  };

  const navItems = [
    {
      title: 'Dashboard',
      icon: LayoutDashboard,
      path: '/hrd/dashboard',
    },
    {
      title: 'Karyawan & Biometrik',
      icon: Users,
      path: '/hrd/employees',
    },
    {
      title: 'Log & Audit Foto',
      icon: ClipboardList,
      path: '/hrd/logs',
    },
    {
      title: 'Pengaturan Kiosk',
      icon: Settings,
      path: '/hrd/settings',
    },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r bg-card transition-transform duration-200 md:static md:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b px-4">
            <Link to="/hrd/dashboard" className="flex items-center gap-2.5 font-bold text-base">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <Shield className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <div>Panel HRD</div>
                <div className="text-[10px] font-normal text-muted-foreground">Absensi Biometrik Kiosk</div>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
            <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Menu Utama
            </div>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </div>

          <div className="border-t p-3 space-y-2 bg-muted/30">
            <Button
              variant="default"
              className="w-full gap-2 justify-start font-medium"
              onClick={() => navigate('/kiosk')}
            >
              <MonitorCheck className="h-4 w-4" />
              <span>Kembali ke Kiosk</span>
            </Button>

            <div className="flex items-center justify-between pt-1 px-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-amber-500" />
                <span>Auto-lock: {remainingSeconds}d</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
                onClick={handleLogout}
              >
                <LogOut className="h-3.5 w-3.5 mr-1" />
                Keluar
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card/90 px-4 md:px-6 backdrop-blur-md shadow-xs">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <div className="text-sm font-semibold tracking-tight">Sistem Presensi Kiosk</div>
              <div className="text-xs text-muted-foreground hidden sm:block">
                Master Data & Sinkronisasi Aplikasi Utama
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex gap-1.5 font-normal py-1 px-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{currentUser?.name || 'Administrator'}</span>
            </Badge>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Ganti Tema"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-medium"
              onClick={() => navigate('/kiosk')}
            >
              <MonitorCheck className="h-3.5 w-3.5 text-primary" />
              <span>Mode Kiosk</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
