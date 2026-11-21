@echo off
start /b "" "C:\Users\rafi0\AppData\Local\Programs\Python\Python311\python.exe" -m uvicorn app.main:app --app-dir face-engine --host 127.0.0.1 --port 8005
php artisan serve --port=8000
