import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, Lock, Mail, MonitorCheck } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>('admin@facekiosk.local');
  const [password, setPassword] = useState<string>('password123');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await axios.post('/api/hrd/login', {
        email,
        password,
      });

      if (res.data.success) {
        if (res.data.token) {
          localStorage.setItem('hrd_token', res.data.token);
          axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
        }
        localStorage.setItem('hrd_session_user', JSON.stringify(res.data.user));
        toast.success('Login berhasil');
        navigate('/hrd/dashboard');
      } else {
        setErrorMsg(res.data.message || 'Login gagal');
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || 'Email atau kata sandi tidak sesuai');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md shadow-xl border bg-card">
        <CardHeader className="space-y-2 text-center pb-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Shield className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight">Login Panel HRD</CardTitle>
          <CardDescription>
            Masukkan kredensial administrator atau HRD untuk mengelola perangkat Kiosk dan pendaftaran biometrik.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold">
                Alamat Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="admin@facekiosk.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold">
                Kata Sandi
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-10"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 rounded-lg bg-destructive/10 text-destructive text-xs font-medium text-center">
                {errorMsg}
              </div>
            )}

            <Button type="submit" className="w-full h-10 font-semibold" disabled={isLoading}>
              {isLoading ? 'Memverifikasi...' : 'Masuk ke Panel'}
            </Button>
          </form>

          <div className="pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 text-xs"
              onClick={() => navigate('/kiosk')}
            >
              <MonitorCheck className="h-4 w-4 text-primary" />
              <span>Kembali ke Mode Kiosk</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
