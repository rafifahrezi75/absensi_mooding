@echo off
title Face Kiosk Absensi Launcher

cd /d "%~dp0"

start "Face Engine Python (Port 8005)" cmd /k "python -m uvicorn app.main:app --app-dir face-engine --host 127.0.0.1 --port 8005"
start "Laravel Server (Port 8000)" cmd /k "php artisan serve --port=8000"

echo Mesin backend dan AI Face Engine telah aktif:
echo - Laravel Kiosk: http://127.0.0.1:8000/kiosk
echo - Panel HRD:     http://127.0.0.1:8000/hrd/dashboard
echo - Face Engine:   http://127.0.0.1:8005/health
echo.
pause
