<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\Response;

class FaceEngineProxyController extends Controller
{
    public function proxy(Request $request, string $path = '')
    {
        $normalizedPath = trim($path, '/');
        $allowedRequests = [
            'GET' => ['health'],
            'POST' => ['api/v1/enroll', 'api/v1/recognize'],
        ];
        $method = strtoupper($request->method());

        if (! in_array($normalizedPath, $allowedRequests[$method] ?? [], true)) {
            abort(Response::HTTP_NOT_FOUND);
        }

        $engineUrl = rtrim((string) config('biometric.engine_url'), '/').'/'.$normalizedPath;

        try {
            $httpRequest = Http::withHeaders([
                'X-Biometric-Secret' => (string) config('biometric.shared_secret'),
            ])->connectTimeout(5)->timeout(30);

            if ($method === 'GET') {
                $response = $httpRequest->get($engineUrl, $request->query());
            } elseif (count($request->allFiles()) > 0) {
                foreach ($request->allFiles() as $name => $files) {
                    if (is_array($files)) {
                        foreach ($files as $file) {
                            $httpRequest->attach($name, file_get_contents($file->getRealPath()), $file->getClientOriginalName());
                        }
                    } else {
                        $httpRequest->attach($name, file_get_contents($files->getRealPath()), $files->getClientOriginalName());
                    }
                }
                $response = $httpRequest->post($engineUrl, $request->except(array_keys($request->allFiles())));
            } else {
                $payload = $request->json()->all();
                if (! empty($payload)) {
                    $response = $httpRequest->post($engineUrl, $payload);
                } else {
                    $raw = $request->getContent();
                    $response = $httpRequest
                        ->withBody($raw, $request->header('Content-Type', 'application/json'))
                        ->send($method, $engineUrl);
                }
            }

            return response($response->body(), $response->status())
                ->header('Content-Type', $response->header('Content-Type') ?? 'application/json');
        } catch (\Throwable $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Python Face Engine tidak dapat dihubungi di port 8005',
            ], Response::HTTP_SERVICE_UNAVAILABLE);
        }
    }
}
