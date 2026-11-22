<?php

namespace App\Http\Middleware;

use App\Models\SystemSetting;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyHmacSignature
{
    public function handle(Request $request, Closure $next): Response
    {
        $expectedKey = env('INTEGRATION_KEY', SystemSetting::get('main_app_integration_key', 'absensi-kiosk-secret-key-2026'));
        $sharedSecret = env('INTEGRATION_SECRET', SystemSetting::get('main_app_shared_secret', 'kiosk-attendance-hmac-secret-signature-key-2026'));

        $providedKey = $request->header('X-Integration-Key');
        $providedTimestamp = (int) $request->header('X-Timestamp');
        $providedSignature = $request->header('X-Signature');

        if (! $providedKey || ! $providedTimestamp || ! $providedSignature) {
            return response()->json([
                'error' => 'Missing required HMAC security headers',
            ], Response::HTTP_UNAUTHORIZED);
        }

        if ($providedKey !== $expectedKey) {
            return response()->json([
                'error' => 'Invalid integration key',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $currentTime = time();
        if (abs($currentTime - $providedTimestamp) > 300) {
            return response()->json([
                'error' => 'Timestamp drift exceeded 300 seconds window',
            ], Response::HTTP_UNAUTHORIZED);
        }

        $method = strtoupper($request->method());
        $path = '/'.ltrim($request->path(), '/');
        $rawBody = in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) ? '' : $request->getContent();

        $payloadToSign = $method."\n".$path."\n".$providedTimestamp."\n".$rawBody;
        $calculatedSignature = hash_hmac('sha256', $payloadToSign, $sharedSecret);

        if (! hash_equals($calculatedSignature, $providedSignature)) {
            return response()->json([
                'error' => 'Invalid HMAC signature',
            ], Response::HTTP_FORBIDDEN);
        }

        return $next($request);
    }
}
