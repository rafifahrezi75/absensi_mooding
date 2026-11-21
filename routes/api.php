<?php

use App\Http\Controllers\Api\FaceEngineProxyController;
use App\Http\Controllers\Api\HrdController;
use App\Http\Controllers\Api\IntegrationController;
use App\Http\Controllers\Api\KioskController;
use Illuminate\Support\Facades\Route;

Route::any('/face-engine/{path?}', [FaceEngineProxyController::class, 'proxy'])->where('path', '.*');

Route::prefix('integrations/face-attendance')->group(function () {
    Route::get('/heartbeat', [IntegrationController::class, 'heartbeat']);
    Route::get('/master-sync', [IntegrationController::class, 'masterSync']);
    Route::post('/events', [IntegrationController::class, 'events']);
});

Route::prefix('kiosk')->group(function () {
    Route::get('/config', [KioskController::class, 'config']);
    Route::post('/auth-verify', [KioskController::class, 'verifyHrdPin']);
    Route::get('/employees-cache', [KioskController::class, 'employeesCache']);
    Route::post('/attendance-tap', [KioskController::class, 'recordTap']);
    Route::post('/fallback-tap', [KioskController::class, 'recordFallbackTap']);
});

Route::prefix('hrd')->group(function () {
    Route::post('/login', [HrdController::class, 'login']);
    Route::post('/logout', [HrdController::class, 'logout']);
    Route::get('/me', [HrdController::class, 'me']);
    Route::get('/dashboard', [HrdController::class, 'dashboard']);
    Route::get('/employees', [HrdController::class, 'employees']);
    Route::get('/employees/{id}', [HrdController::class, 'showEmployee']);
    Route::post('/employees/{id}/upload-profile-photo', [HrdController::class, 'uploadProfilePhoto']);
    Route::delete('/employees/{id}/profile-photo', [HrdController::class, 'deleteProfilePhoto']);
    Route::post('/employees/{id}/enroll-face', [HrdController::class, 'enrollFace']);
    Route::post('/employees/{id}/reset-pin', [HrdController::class, 'resetPin']);
    Route::get('/logs', [HrdController::class, 'logs']);
    Route::get('/logs/{id}', [HrdController::class, 'showLog']);
    Route::post('/logs/{id}/retry', [HrdController::class, 'retrySync']);
    Route::post('/sync-queue', [HrdController::class, 'syncQueue']);
    Route::post('/sync-master', [HrdController::class, 'syncMaster']);
    Route::get('/settings', [HrdController::class, 'settings']);
    Route::match(['put', 'post'], '/settings', [HrdController::class, 'settings']);
});
