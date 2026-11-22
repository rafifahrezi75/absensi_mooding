<?php

namespace App\Providers;

use Illuminate\Foundation\DevCommands;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        $isTunnel = false;
        if (isset($_SERVER['HTTP_HOST']) && (
            str_contains($_SERVER['HTTP_HOST'], 'trycloudflare.com') ||
            str_contains($_SERVER['HTTP_HOST'], 'localtunnel.me') ||
            str_contains($_SERVER['HTTP_HOST'], 'ngrok')
        )) {
            $isTunnel = true;
        }

        if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
            $isTunnel = true;
        }

        if ($isTunnel) {
            URL::forceScheme('https');
            Vite::useHotFile(storage_path('non_existent_hot'));
        }

        if ($this->app->runningInConsole() && class_exists(DevCommands::class)) {
            DevCommands::register(
                'python -m uvicorn app.main:app --app-dir face-engine --host 127.0.0.1 --port 8005',
                'face-engine'
            );
        }
    }
}
