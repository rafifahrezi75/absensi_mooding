<?php

namespace App\Providers;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
    }

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
    }
}
