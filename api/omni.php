<?php
/**
 * JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 * api/omni.php — Proxy PHP centralizado
 *
 * Resuelve CORS delegando todas las llamadas al API CORE en PHP/cURL.
 * El front nunca llama a api.omni.josepan.app directamente.
 *
 * Rutas:
 *   POST   ?action=login
 *   GET    ?action=interlocutors[&type=distribuidor]
 *   GET    ?action=skus[&q=&limit=500&offset=0]
 *   GET    ?action=locations
 *   POST   ?action=batch
 *   POST   ?action=receive
 */

declare(strict_types=1);

require_once __DIR__ . '/OmniCoreClient.php';

const API_BASE   = 'https://api.omni.josepan.app';
const API_PREFIX = '/api/v1';

// ── Cabeceras de respuesta ─────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
// CORS mismo origen (las peticiones vienen del mismo dominio/localhost)
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Interlocutor-Id');
    header('Access-Control-Allow-Credentials: true');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Helpers ────────────────────────────────────────────────────
function ok(array $data): void {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400, string $code = 'ERR'): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message, 'code' => $code], JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

/**
 * Petición cURL genérica al API CORE.
 * Añade automáticamente las cabeceras de autorización cuando hay token.
 */
function apiCall(string $method, string $path, ?array $payload = null, string $token = '', int $interlocutorId = 0): array {
    $url     = API_BASE . API_PREFIX . '/' . ltrim($path, '/');
    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    if ($token)         $headers[] = 'Authorization: Bearer ' . $token;
    if ($interlocutorId > 0) $headers[] = 'X-Interlocutor-Id: ' . $interlocutorId;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($payload !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    }

    $raw    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $curlErr) {
        return ['ok' => false, 'status' => 0, 'error' => 'Error de red cURL: ' . $curlErr, 'raw' => []];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) $data = [];

    return ['ok' => ($status >= 200 && $status < 300), 'status' => $status, 'raw' => $data];
}

// ── Extraer token e interlocutor_id del request entrante ───────
$bearerToken    = '';
$interlocutorId = 0;

$authHdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (preg_match('/Bearer\s+(.+)/i', $authHdr, $m)) {
    $bearerToken = trim($m[1]);
}
$xId = $_SERVER['HTTP_X_INTERLOCUTOR_ID'] ?? '';
if ($xId !== '') $interlocutorId = (int)$xId;

// ── Router ─────────────────────────────────────────────────────
$action = strtolower(trim($_GET['action'] ?? ''));
$method = strtoupper($_SERVER['REQUEST_METHOD']);

switch ($action) {

    // ── LOGIN ──────────────────────────────────────────────────
    case 'login':
        if ($method !== 'POST') fail('Solo POST.', 405);

        $b = body();
        $username      = trim($b['username']      ?? '');
        $password      = trim($b['password']      ?? '');
        $interlocId    = (int)($b['interlocutor_id'] ?? 0);

        if (!$username || !$password) fail('Usuario y contraseña son obligatorios.', 400, 'MISSING_FIELDS');
        if ($interlocId < 1)          fail('interlocutor_id es obligatorio.', 400, 'MISSING_INTERLOCUTOR');

        $res = apiCall('POST', '/auth/login', [
            'username'        => $username,
            'password'        => $password,
            'interlocutor_id' => $interlocId,
        ]);

        if (!$res['ok']) {
            $msg = $res['raw']['data']['message']
                ?? $res['raw']['message']
                ?? $res['error']
                ?? 'Credenciales incorrectas.';
            fail($msg, $res['status'] ?: 401, 'AUTH_FAILED');
        }

        // Respuesta OMNI: { data: { token, user, permissions } }
        $payload     = $res['raw']['data'] ?? $res['raw'];
        $token       = $payload['token']       ?? $payload['accessToken'] ?? $payload['access_token'] ?? null;
        $user        = $payload['user']        ?? $payload['profile']     ?? [];
        $permissions = $payload['permissions'] ?? [];

        if (!$token) fail('El API no devolvió token.', 500, 'NO_TOKEN');

        ok(['token' => $token, 'user' => $user, 'permissions' => $permissions]);
        break;

    // ── INTERLOCUTORES ─────────────────────────────────────────
    case 'interlocutors':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$bearerToken) fail('Token requerido.', 401, 'NO_TOKEN');

        $qs = '';
        $type = trim($_GET['type'] ?? '');
        if ($type) $qs = '?' . http_build_query(['type' => $type]);

        $res = apiCall('GET', '/catalog/interlocutors' . $qs, null, $bearerToken, $interlocutorId);
        if (!$res['ok']) fail($res['raw']['message'] ?? 'Error al cargar interlocutores.', $res['status'] ?: 502);

        $rows = $res['raw']['data']['rows'] ?? $res['raw']['data'] ?? $res['raw'] ?? [];
        ok(['items' => array_values(is_array($rows) ? $rows : [])]);
        break;

    // ── SKUs ───────────────────────────────────────────────────
    case 'skus':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$bearerToken) fail('Token requerido.', 401, 'NO_TOKEN');

        $params = ['limit' => (int)($_GET['limit'] ?? 500), 'offset' => (int)($_GET['offset'] ?? 0)];
        if (!empty($_GET['q']))         $params['q']         = $_GET['q'];
        if (!empty($_GET['item_type'])) $params['item_type'] = $_GET['item_type'];

        $res = apiCall('GET', '/catalog/skus?' . http_build_query($params), null, $bearerToken, $interlocutorId);
        if (!$res['ok']) fail($res['raw']['message'] ?? 'Error al cargar SKUs.', $res['status'] ?: 502);

        $rows = $res['raw']['data']['rows'] ?? $res['raw']['data'] ?? $res['raw'] ?? [];
        ok(['items' => array_values(is_array($rows) ? $rows : [])]);
        break;

    // ── UBICACIONES ────────────────────────────────────────────
    case 'locations':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$bearerToken) fail('Token requerido.', 401, 'NO_TOKEN');

        $qs = '';
        if (!empty($_GET['interlocutor_id'])) $qs = '?' . http_build_query(['interlocutor_id' => $_GET['interlocutor_id']]);

        $res = apiCall('GET', '/catalog/locations' . $qs, null, $bearerToken, $interlocutorId);
        if (!$res['ok']) fail($res['raw']['message'] ?? 'Error al cargar ubicaciones.', $res['status'] ?: 502);

        $rows = $res['raw']['data']['rows'] ?? $res['raw']['data'] ?? $res['raw'] ?? [];
        ok(['items' => array_values(is_array($rows) ? $rows : [])]);
        break;

    // ── CREAR LOTE ─────────────────────────────────────────────
    case 'batch':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$bearerToken) fail('Token requerido.', 401, 'NO_TOKEN');

        $b = body();
        if (empty($b['batch_reference']) || empty($b['item_id']) || empty($b['expiration_date'])) {
            fail('batch_reference, item_id y expiration_date son obligatorios.', 400, 'MISSING_FIELDS');
        }

        $res = apiCall('POST', '/inventory/batches', [
            'batch_reference' => $b['batch_reference'],
            'item_id'         => (int)$b['item_id'],
            'item_type'       => $b['item_type'] ?? 'sku',
            'expiration_date' => $b['expiration_date'],
            'cost_per_unit'   => (float)($b['cost_per_unit'] ?? 0),
        ], $bearerToken, $interlocutorId);

        if (!$res['ok']) {
            $msg = $res['raw']['data']['message'] ?? $res['raw']['message'] ?? 'Error al crear lote.';
            fail($msg, $res['status'] ?: 422, 'BATCH_ERROR');
        }

        $data = $res['raw']['data'] ?? $res['raw'];
        ok(['batch' => $data]);
        break;

    // ── RECEPCIÓN DE MERCANCÍA ─────────────────────────────────
    case 'receive':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$bearerToken) fail('Token requerido.', 401, 'NO_TOKEN');

        $b = body();
        $required = ['location_id', 'batch_id', 'item_id', 'quantity', 'reference_document'];
        foreach ($required as $field) {
            if (!isset($b[$field]) || $b[$field] === '' || $b[$field] === null) {
                fail("Campo obligatorio faltante: {$field}", 400, 'MISSING_FIELDS');
            }
        }

        $res = apiCall('POST', '/inventory/reception', [
            'location_id'        => (int)$b['location_id'],
            'batch_id'           => (int)$b['batch_id'],
            'item_id'            => (int)$b['item_id'],
            'item_type'          => $b['item_type']      ?? 'sku',
            'quantity'           => (int)$b['quantity'],
            'movement_type'      => $b['movement_type']  ?? 'Compra',
            'reference_document' => $b['reference_document'],
        ], $bearerToken, $interlocutorId);

        if (!$res['ok']) {
            $msg = $res['raw']['data']['message'] ?? $res['raw']['message'] ?? 'Error al registrar recepción.';
            fail($msg, $res['status'] ?: 422, 'RECEIVE_ERROR');
        }

        ok(['movement' => $res['raw']['data'] ?? $res['raw']]);
        break;

    // ── ACCIÓN NO RECONOCIDA ───────────────────────────────────
    default:
        fail('Acción no reconocida: ' . htmlspecialchars($action), 404, 'UNKNOWN_ACTION');
}
