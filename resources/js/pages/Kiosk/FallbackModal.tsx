import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, Camera, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { compressProofPhoto } from '@/lib/biometricEngine';
import { saveOfflineEvent } from '@/lib/offlineQueue';
import axios from 'axios';
import { toast } from 'sonner';
import { formatLateLabel } from '@/lib/utils';

interface FallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  selectedType: string;
  locationInfo?: any;
  deviceInfo?: any;
  onSuccess: (result: any) => void;
}

export function FallbackModal({
  isOpen,
  onClose,
  videoRef,
  selectedType,
  locationInfo,
  deviceInfo,
  onSuccess,
}: FallbackModalProps) {
  const [idKaryawan, setIdKaryawan] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [activeField, setActiveField] = useState<'id' | 'pin'>('id');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const generateUuid = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!idKaryawan || !pin) {
      setErrorMessage('Lengkapi ID Karyawan dan PIN');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    let photoBase64 = '';
    if (videoRef.current) {
      try {
        photoBase64 = compressProofPhoto(videoRef.current, 640, 0.7);
      } catch (err) {}
    }

    const idempotencyKey = generateUuid();
    const now = new Date();
    const recordedAt = now.toISOString();
    const workDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

    const payload = {
      idempotency_key: idempotencyKey,
      id_karyawan: idKaryawan.trim().toUpperCase(),
      pin: pin.trim(),
      kiosk_device_id: deviceInfo?.id || null,
      kiosk_location_id: locationInfo?.id || null,
      work_date: workDate,
      attendance_type: selectedType,
      recorded_at: recordedAt,
      proof_photo_base64: photoBase64 || null,
    };

    if (!navigator.onLine) {
      try {
        await saveOfflineEvent({
          ...payload,
          auth_method: 'fallback_pin',
        });
        toast.info('Tersimpan di antrean offline (koneksi terputus)');
        onSuccess({
          employee: {
            id_karyawan: idKaryawan,
            nama_karyawan: 'Karyawan (Mode Offline)',
          },
          status_label: 'Tersimpan Offline — Akan Disinkronkan Otomatis',
          recorded_time: now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        });
        handleClose();
      } catch (err: any) {
        setErrorMessage('Gagal menyimpan ke penyimpanan lokal');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      const res = await axios.post('/api/kiosk/fallback-tap', payload);
      if (res.data.success) {
        toast.success(formatLateLabel(res.data.status_label) || 'Absensi berhasil');
        onSuccess(res.data);
        handleClose();
      } else {
        setErrorMessage(res.data.message || 'Verifikasi gagal');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Gagal memproses absensi darurat';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIdKaryawan('');
    setPin('');
    setActiveField('id');
    setErrorMessage('');
    onClose();
  };

  const handleKeypadPress = (val: string) => {
    if (activeField === 'id') {
      if (val === 'C') setIdKaryawan('');
      else if (val === '⌫') setIdKaryawan((prev) => prev.slice(0, -1));
      else setIdKaryawan((prev) => prev + val);
    } else {
      if (val === 'C') setPin('');
      else if (val === '⌫') setPin((prev) => prev.slice(0, -1));
      else if (pin.length < 8) setPin((prev) => prev + val);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            <span>Jalur Darurat (ID & PIN)</span>
          </DialogTitle>
          <DialogDescription>
            Gunakan jalur ini bila scan wajah gagal atau ruangan berpencahayaan rendah. Kamera dinonaktifkan selama memasukkan PIN.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              ID Karyawan
            </label>
            <Input
              type="text"
              placeholder="Contoh: EMP001"
              value={idKaryawan}
              onFocus={() => setActiveField('id')}
              onChange={(e) => setIdKaryawan(e.target.value)}
              className={`h-11 font-mono text-lg uppercase ${
                activeField === 'id' ? 'ring-2 ring-primary border-primary' : ''
              }`}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              PIN Karyawan
            </label>
            <Input
              type="password"
              placeholder="Masukkan PIN"
              maxLength={8}
              value={pin}
              onFocus={() => setActiveField('pin')}
              onChange={(e) => setPin(e.target.value)}
              className={`h-11 text-center font-mono text-2xl tracking-widest ${
                activeField === 'pin' ? 'ring-2 ring-primary border-primary' : ''
              }`}
            />
          </div>

          {errorMessage && (
            <div className="flex items-center gap-1.5 p-2 rounded-md bg-destructive/10 text-destructive text-xs font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>Kamera dimatikan selama memasukkan ID & PIN demi privasi dan keamanan Anda.</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <Button
                key={k}
                type="button"
                variant="outline"
                className="h-10 text-base font-semibold"
                onClick={() => handleKeypadPress(k)}
              >
                {k}
              </Button>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="ghost" className="w-1/2" onClick={handleClose}>
              Batal
            </Button>
            <Button
              type="submit"
              className="w-1/2"
              disabled={isSubmitting || !idKaryawan || !pin}
            >
              {isSubmitting ? 'Memproses...' : 'Kirim Absensi'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
