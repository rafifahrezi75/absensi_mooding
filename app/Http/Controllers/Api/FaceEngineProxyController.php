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
        $engineUrl = rtrim(env('PYTHON_FACE_ENGINE_URL', 'http://127.0.0.1:8005'), '/') . '/' . ltrim($path, '/');

        try {
            $method = strtoupper($request->method());

            if ($method === 'GET') {
                $response = Http::timeout(5)->get($engineUrl, $request->query());
            } elseif (count($request->allFiles()) > 0) {
                $httpRequest = Http::timeout(15);
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
                if (!empty($payload)) {
                    $response = Http::timeout(15)->post($engineUrl, $payload);
                } else {
                    $raw = $request->getContent();
                    $response = Http::timeout(15)
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
