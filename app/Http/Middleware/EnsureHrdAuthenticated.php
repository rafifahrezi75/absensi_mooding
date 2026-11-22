<?php

namespace App\Http\Middleware;

use App\Models\HrdUser;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class EnsureHrdAuthenticated
{
    public function handle(Request $request, Closure $next): Response
    {
        $userId = $request->session()->get('hrd_user_id');

        if (! $userId) {
            $token = $request->bearerToken() ?: $request->header('X-HRD-Token');
            if ($token) {
                $cachedId = Cache::get("hrd_token:{$token}");
                if ($cachedId) {
                    $userId = $cachedId;
                    $request->session()->put('hrd_user_id', $userId);
                }
            }
        }

        if (! $userId) {
            return response()->json([
                'success' => false,
                'message' => 'Akses ditolak: Autentikasi HRD diperlukan',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $user = HrdUser::find($userId);
        if (! $user || ! $user->is_active) {
            $request->session()->forget(['hrd_user_id', 'hrd_token']);

            return response()->json([
                'success' => false,
                'message' => 'Akun HRD tidak valid atau telah dinonaktifkan',
            ], Response::HTTP_UNAUTHORIZED);
        }

        return $next($request);
    }
}
