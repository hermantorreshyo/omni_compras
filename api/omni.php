<?php
/**
 * JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 * api/omni.php (v13.0) — Proxy PHP centralizado
 *
 * Endpoints corregidos según Postman collection v6 actualizado:
 *   Proveedores : /purchasing/suppliers  (no /catalog/suppliers)
 *   Órdenes     : POST /purchasing/orders con details[] inline
 *   Flujo       : crear → approve → receive
 *   Facturas    : /purchasing/invoices
 *   Devoluciones: /purchasing/returns
 *
 * Constantes: api/config.php
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/OmniCoreClient.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Subsistema: ' . SUBSISTEMA_ID . ' v' . SUBSISTEMA_VERSION);

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Interlocutor-Id');
    header('Access-Control-Allow-Credentials: true');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ── Helpers ────────────────────────────────────────────────
function ok(array $data): void {
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE); exit;
}
function fail(string $message, int $status = 400, string $code = 'ERR'): void {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message, 'code' => $code], JSON_UNESCAPED_UNICODE); exit;
}
function body(): array {
    $raw = file_get_contents('php://input');
    $d   = $raw ? json_decode($raw, true) : null;
    return is_array($d) ? $d : [];
}
function apiCall(string $method, string $path, ?array $payload, string $token, int $iid = 0): array {
    $url     = OMNI_API_BASE . OMNI_API_PREFIX . '/' . ltrim($path, '/');
    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    if ($iid)   $headers[] = 'X-Interlocutor-Id: ' . $iid;
    $headers[] = 'X-Subsystem-Id: 1002';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($payload !== null)
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
    $raw    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err)
        return ['ok'=>false,'status'=>0,'error'=>'cURL: '.$err,'raw'=>[],'omni_code'=>'ERR_NETWORK'];
    $data = json_decode($raw, true);
    $isOk = $status >= 200 && $status < 300 && is_array($data) && ($data['status'] ?? '') === 'success';
    return ['ok'=>$isOk,'status'=>$status,'raw'=>is_array($data)?$data:[],'omni_code'=>is_array($data)?($data['error_code']??null):null];
}
function rowsOf(array $res): array {
    $r = $res['raw']['data']['rows'] ?? $res['raw']['data'] ?? $res['raw'] ?? [];
    if (is_array($r)) {
        $r = array_values(array_filter($r, fn($i) =>
            !is_array($i) || ((($i['status']??'') !== 'deleted') && empty($i['deleted_at']))
        ));
    }
    return is_array($r) ? $r : [];
}
function omniError(array $res, string $fb): string {
    return $res['raw']['message'] ?? $res['raw']['data']['message'] ?? $res['error'] ?? $fb;
}
function _normFecha(string $s): string {
    $s = trim($s);
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s;
    if (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/', $s, $m))
        return sprintf('%04d-%02d-%02d',(int)$m[3],(int)$m[2],(int)$m[1]);
    if (preg_match('/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/', $s, $m)) {
        $y=(int)$m[3]>=50?1900+(int)$m[3]:2000+(int)$m[3];
        return sprintf('%04d-%02d-%02d',$y,(int)$m[2],(int)$m[1]);
    }
    return $s;
}

// ── Credenciales entrantes ─────────────────────────────────
$token = '';
$iid   = 0;
// Apache puede bloquear Authorization — leer también de HTTP_AUTHORIZATION
$authHdr = $_SERVER['HTTP_AUTHORIZATION']
    ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
    ?? getallheaders()['Authorization']
    ?? '';
if (preg_match('/Bearer\s+(.+)/i', $authHdr, $m)) $token = trim($m[1]);
if (!empty($_SERVER['HTTP_X_INTERLOCUTOR_ID'])) $iid = (int)$_SERVER['HTTP_X_INTERLOCUTOR_ID'];

$action = strtolower(trim($_GET['action'] ?? ''));
$method = strtoupper($_SERVER['REQUEST_METHOD']);
// Túnel de método: ?_method=put|delete para compatibilidad Apache
if (isset($_GET['_method'])) $method = strtoupper($_GET['_method']);

switch ($action) {

    // ══════════════════════════════════════════════════════
    //  LOGIN — POST /auth/login
    //  interlocutor_id = sede elegida por el operario
    //  contraseña inicial = username
    // ══════════════════════════════════════════════════════
    case 'login':
        if ($method !== 'POST') fail('Solo POST.', 405);
        $b = body();
        $username   = trim($b['username']         ?? '');
        $password   = trim($b['password']         ?? '');
        $interlocId = (int)($b['interlocutor_id'] ?? 0);
        if (!$username || !$password) fail('Usuario y contraseña obligatorios.', 400, 'ERR_VALIDATION');
        // interlocutor_id=0 = paso 1 (obtener available_interlocutors)
        $res = apiCall('POST', '/auth/login', [
            'username'        => $username,
            'password'        => $password,
            'interlocutor_id' => $interlocId,
        ], '', 0);
        if (!$res['ok'])
            fail(omniError($res, 'Credenciales incorrectas.'), $res['status'] ?: 401, $res['omni_code'] ?? 'ERR_AUTH');
        $d   = $res['raw']['data'] ?? [];
        $tkn = $d['token'] ?? null;
        if (!$tkn) fail('El API no devolvió token.', 500, 'ERR_INTERNAL');
        ok(['token'=>$tkn,'user_id'=>$d['user_id']??null,'username'=>$d['username']??$username,
            'role'=>$d['role']??null,'interlocutor_id'=>$d['interlocutor_id']??$interlocId,
            'interlocutor_name'=>$d['interlocutor_name']??null,'permissions'=>$d['permissions']??[]]);
        break;

    // ══════════════════════════════════════════════════════
    //  PERFIL — GET /auth/me
    // ══════════════════════════════════════════════════════
    case 'me':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $res = apiCall('GET', '/auth/me', null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al obtener perfil.'), $res['status'] ?: 502);
        ok(['user' => $res['raw']['data'] ?? $res['raw']]);
        break;

    // ══════════════════════════════════════════════════════
    //  RBAC DE PANTALLAS — GET /rbac/subsystems/1002/my-screens
    // ══════════════════════════════════════════════════════
    case 'rbac_screens':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $sub = (int)($_GET['subsystem'] ?? SUBSISTEMA_ID);
        $res = apiCall('GET', "/rbac/subsystems/{$sub}/my-screens", null, $token, $iid);
        if (!$res['ok'] && $res['status'] === 404) ok(['screens' => '*', 'fallback' => true]);
        if (!$res['ok']) fail(omniError($res, 'Error al obtener permisos.'), $res['status'] ?: 502, 'ERR_RBAC');
        ok(['screens' => $res['raw']['data']['screens'] ?? '*']);
        break;

    // ══════════════════════════════════════════════════════
    //  INTERLOCUTORES — 17 sedes de la red
    //  ?public=1 → sin token (login), fallback lista estática
    // ══════════════════════════════════════════════════════
    case 'interlocutors':
        if ($method !== 'GET') fail('Solo GET.', 405);
        $isPublic = isset($_GET['public']) && $_GET['public'] === '1';
        $useToken = $token ?: ($isPublic ? OMNI_SERVICE_TOKEN : '');
        if (!$useToken && !$isPublic) fail('Token requerido.', 401, 'ERR_AUTH');
        if (!$useToken) {
            $sedes = [
                ['id'=>1,'commercial_name'=>'JOSEPAN 360','type'=>'empresa'],
                ['id'=>2,'commercial_name'=>'OBRADOR','type'=>'fabrica'],
                ['id'=>3,'commercial_name'=>'LA PASTELERÍA','type'=>'fabrica'],
                ['id'=>4,'commercial_name'=>'VIA 18','type'=>'punto_venta'],
                ['id'=>5,'commercial_name'=>'VIA 15','type'=>'punto_venta'],
                ['id'=>6,'commercial_name'=>'VAGUADA','type'=>'punto_venta'],
                ['id'=>7,'commercial_name'=>'CASTELLANA','type'=>'punto_venta'],
                ['id'=>8,'commercial_name'=>'CEDACEROS','type'=>'punto_venta'],
                ['id'=>9,'commercial_name'=>'XANADÚ','type'=>'punto_venta'],
                ['id'=>10,'commercial_name'=>'SAN BLAS','type'=>'punto_venta'],
                ['id'=>11,'commercial_name'=>'MADRID RIO','type'=>'punto_venta'],
                ['id'=>12,'commercial_name'=>'CARTAGENA','type'=>'punto_venta'],
                ['id'=>13,'commercial_name'=>'ISLAZUL','type'=>'punto_venta'],
                ['id'=>14,'commercial_name'=>'VALLECAS','type'=>'punto_venta'],
                ['id'=>15,'commercial_name'=>'LEGANÉS','type'=>'punto_venta'],
                ['id'=>16,'commercial_name'=>'TORREJÓN','type'=>'punto_venta'],
                ['id'=>17,'commercial_name'=>'MAJADAHONDA','type'=>'punto_venta'],
            ];
            if (!empty($_GET['type'])) {
                $t = $_GET['type'];
                $sedes = array_values(array_filter($sedes, fn($s) => $s['type'] === $t));
            }
            ok(['items' => $sedes, 'fallback' => true]);
        }
        $params = [];
        if (!empty($_GET['type'])) $params['type'] = $_GET['type'];
        $useIid = (isset($_GET['all']) && $_GET['all'] === '1') ? 0 : $iid;
        $res = apiCall('GET', '/catalog/interlocutors' . ($params ? '?' . http_build_query($params) : ''), null, $useToken, $useIid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar sedes.'), $res['status'] ?: 502);
        ok(['items' => rowsOf($res)]);
        break;

    // ══════════════════════════════════════════════════════
    //  SKUs — GET /catalog/skus
    //  Campo clave: sku_final_code (v6.6.0)
    // ══════════════════════════════════════════════════════
    case 'skus':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $p = ['limit' => (int)($_GET['limit'] ?? 500), 'offset' => (int)($_GET['offset'] ?? 0)];
        if (!empty($_GET['q']))         $p['q']         = $_GET['q'];
        if (!empty($_GET['item_type'])) $p['item_type'] = $_GET['item_type'];
        $res = apiCall('GET', '/catalog/skus?' . http_build_query($p), null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar SKUs.'), $res['status'] ?: 502);
        ok(['items' => rowsOf($res)]);
        break;

    // ══════════════════════════════════════════════════════
    //  UBICACIONES — GET /catalog/locations
    // ══════════════════════════════════════════════════════

    case 'system_params':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $res = apiCall('GET', '/system/params', null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar parámetros.'), $res['status'] ?: 502);
        ok($res['raw']['data'] ?? []);
        break;

    case 'locations':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $locParams = [];
        // Filtrar por interlocutor_id si se especifica (§9 del manual)
        if (!empty($_GET['interlocutor_id'])) {
            $locParams['interlocutor_id'] = (int)$_GET['interlocutor_id'];
        }
        $locQs = $locParams ? '?' . http_build_query($locParams) : '';
        $res = apiCall('GET', '/catalog/locations' . $locQs, null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar ubicaciones.'), $res['status'] ?: 502);
        ok(['items' => rowsOf($res)]);
        break;

    // ══════════════════════════════════════════════════════
    //  PROVEEDORES — /purchasing/suppliers  ← endpoint correcto v6
    //  GET    → listar (filtros: ?q= &is_standardized=0|1)
    //  POST   → crear
    //  PUT    → actualizar (?id=N)
    //  DELETE → borrado lógico (?id=N)
    // ══════════════════════════════════════════════════════
    case 'suppliers':
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');

        if ($method === 'GET') {
            $p = [];
            if (!empty($_GET['q']))               $p['q']               = $_GET['q'];
            if (isset($_GET['is_standardized']))  $p['is_standardized'] = (int)$_GET['is_standardized'];
            $res = apiCall('GET', '/purchasing/suppliers' . ($p ? '?' . http_build_query($p) : ''), null, $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al cargar proveedores.'), $res['status'] ?: 502);
            ok(['items' => rowsOf($res)]);

        } elseif ($method === 'POST') {
            $b = body();
            if (empty($b['fiscal_name'])) fail('fiscal_name es obligatorio.', 400, 'ERR_VALIDATION');
            $p = ['fiscal_name' => $b['fiscal_name'], 'commercial_name' => $b['commercial_name'] ?? $b['fiscal_name']];
            foreach (['fiscal_id','email','phone','address','city','province','postal_code','notes','is_standardized'] as $f)
                if (isset($b[$f]) && $b[$f] !== '') $p[$f] = $b[$f];
            $res = apiCall('POST', '/purchasing/suppliers', $p, $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al crear proveedor.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_VALIDATION');
            ok(['supplier' => $res['raw']['data'] ?? $res['raw']]);

        } elseif ($method === 'PUT') {
            $sid = (int)($_GET['id'] ?? 0);
            if (!$sid) fail('id es obligatorio.', 400, 'ERR_VALIDATION');
            $res = apiCall('PUT', "/purchasing/suppliers/{$sid}", body(), $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al actualizar proveedor.'), $res['status'] ?: 422);
            ok(['supplier' => $res['raw']['data'] ?? $res['raw']]);

        } elseif ($method === 'DELETE') {
            $sid = (int)($_GET['id'] ?? 0);
            if (!$sid) fail('id es obligatorio.', 400, 'ERR_VALIDATION');
            $res = apiCall('DELETE', "/purchasing/suppliers/{$sid}", null, $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al eliminar proveedor.'), $res['status'] ?: 422);
            ok(['deleted' => true]);

        } else { fail('Método no permitido.', 405); }
        break;

    // ══════════════════════════════════════════════════════
    //  ÓRDENES DE COMPRA — /purchasing/orders
    //
    //  POST  → crear orden con details[] inline:
    //    { supplier_id, details:[{supplier_item_id, quantity_requested, unit_price}] }
    //
    //  GET   → listar historial de albaranes
    //
    //  PUT approve → aprobar   (?id=N)
    //  PUT receive → recepcionar con cantidades reales (?id=N)
    //    { details:[{detail_id, quantity_received}] }
    // ══════════════════════════════════════════════════════
    case 'purchasing_order':
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');

        if ($method === 'GET') {
            $p = [];
            if (!empty($_GET['supplier_id']))   $p['supplier_id']   = (int)$_GET['supplier_id'];
            if (!empty($_GET['status']))         $p['status']        = $_GET['status'];
            if (!empty($_GET['date_from']))      $p['date_from']     = $_GET['date_from'];
            if (!empty($_GET['date_to']))        $p['date_to']       = $_GET['date_to'];
            if (!empty($_GET['reference']))      $p['reference']     = $_GET['reference'];
            $res = apiCall('GET', '/purchasing/orders' . ($p ? '?' . http_build_query($p) : ''), null, $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al cargar albaranes.'), $res['status'] ?: 502);
            // Pasar data cruda del API — el JS extrae rows/orders/items
            ok($res['raw']['data'] ?? ['rows' => []]);

        } elseif ($method === 'POST') {
            $b = body();
            $subAction = $b['_action'] ?? '';

            if ($subAction === 'approve') {
                // PUT /purchasing/orders/{id}/approve
                $oid = (int)($b['order_id'] ?? 0);
                if (!$oid) fail('order_id es obligatorio.', 400, 'ERR_VALIDATION');
                $approveBody = !empty($b['reception_date']) ? ['reception_date' => $b['reception_date']] : [];
                $res = apiCall('PUT', "/purchasing/orders/{$oid}/approve", $approveBody, $token, $iid);
                if (!$res['ok']) fail(omniError($res, 'Error al aprobar albarán.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_STATE');
                ok(['order' => $res['raw']['data'] ?? $res['raw']]);

            } elseif ($subAction === 'receive') {
                // PUT /purchasing/orders/{id}/receive
                $oid     = (int)($b['order_id'] ?? 0);
                $details = $b['details'] ?? [];
                if (!$oid) fail('order_id es obligatorio.', 400, 'ERR_VALIDATION');
                $res = apiCall('PUT', "/purchasing/orders/{$oid}/receive", ['details' => $details], $token, $iid);
                if (!$res['ok']) fail(omniError($res, 'Error al registrar recepción.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_KARDEX');
                ok(['order' => $res['raw']['data'] ?? $res['raw']]);

            } else {
                // POST /purchasing/orders — §21 Manual v6.6.0
                // details[]: supplier_item_name + item_id + item_type + unit_of_measure
                //            + quantity_requested + unit_price
                // El API reutiliza o crea el supplier_item e inserta la línea.
                if (empty($b['supplier_id'])) fail('supplier_id es obligatorio.', 400, 'ERR_VALIDATION');
                $payload = [
                    'supplier_id' => (int)$b['supplier_id'],
                    'details'     => $b['details'] ?? [],
                ];
                if (!empty($b['interlocutor_id'])) $payload['interlocutor_id'] = (int)$b['interlocutor_id'];
                if (!empty($b['reference']))       $payload['reference']       = $b['reference'];
                if (!empty($b['notes']))           $payload['notes']           = $b['notes'];
                $res = apiCall('POST', '/purchasing/orders', $payload, $token, $iid);
                if (!$res['ok']) fail(omniError($res, 'Error al crear albarán.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_VALIDATION');
                ok(['order' => $res['raw']['data'] ?? $res['raw']]);
            }

        } else { fail('Método no permitido.', 405); }
        break;

    // ══════════════════════════════════════════════════════
    //  RECEPCIÓN FÍSICA EN ALMACÉN — POST /inventory/reception
    //  Con batch inline (crea lote y registra en una llamada)
    //  Se usa tras confirmar el albarán en purchasing/orders
    // ══════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════
    //  MATCH DE ARTÍCULO — §21 Manual v6.6.0
    //  GET /inventory/reception/match?name=BRAUNGEL...&supplier_id=1
    //  Devuelve supplier_item_id si ya existe en el historial del proveedor
    // ══════════════════════════════════════════════════════
    case 'reception_match':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $p = [];
        if (!empty($_GET['name']))        $p['name']        = $_GET['name'];
        if (!empty($_GET['supplier_id'])) $p['supplier_id'] = (int)$_GET['supplier_id'];
        $res = apiCall('GET', '/inventory/reception/match?' . http_build_query($p), null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al buscar match.'), $res['status'] ?: 502, $res['omni_code'] ?? 'ERR_INTERNAL');
        ok(['matches' => $res['raw']['data']['matches'] ?? $res['raw']['data'] ?? []]);
        break;


    case 'system_params':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $res = apiCall('GET', '/system/params', null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar parámetros.'), $res['status'] ?: 502);
        ok($res['raw']['data'] ?? []);
        break;

    case 'locations':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $locParams = [];
        // Filtrar por interlocutor_id si se especifica (§9 del manual)
        if (!empty($_GET['interlocutor_id'])) {
            $locParams['interlocutor_id'] = (int)$_GET['interlocutor_id'];
        }
        $locQs = $locParams ? '?' . http_build_query($locParams) : '';
        $res = apiCall('GET', '/catalog/locations' . $locQs, null, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al cargar ubicaciones.'), $res['status'] ?: 502);
        ok(['items' => rowsOf($res)]);
        break;

    case 'batch':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $b = body();
        if (empty($b['batch_reference'])) fail('batch_reference es obligatorio.', 400, 'ERR_VALIDATION');
        if (empty($b['item_id']))         fail('item_id es obligatorio.', 400, 'ERR_VALIDATION');
        $batchPayload = [
            'batch_reference' => $b['batch_reference'],
            'item_id'         => (int)$b['item_id'],
            'item_type'       => $b['item_type'] ?? 'sku',
            'cost_per_unit'   => (float)($b['cost_per_unit'] ?? 0),
        ];
        // expiration_date: enviar si el usuario la introdujo.
        // Si no la introdujo (proveedor no la suministra), usar 2099-12-31
        // como placeholder hasta que el API CORE lo acepte como opcional.
        // REQ: ver solicitud REQ_BATCH_EXPDATE_OPCIONAL.md
        $batchPayload['expiration_date'] = !empty($b['expiration_date'])
            ? $b['expiration_date']
            : '2099-12-31';
        $res = apiCall('POST', '/inventory/batches', $batchPayload, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al crear lote.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_VALIDATION');
        ok(['batch' => $res['raw']['data'] ?? $res['raw']]);
        break;

    case 'receive':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $b = body();
        foreach (['location_id','item_id','quantity','reference_document'] as $f)
            if (!isset($b[$f]) || $b[$f] === '' || $b[$f] === null)
                fail("Campo obligatorio: {$f}", 400, 'ERR_VALIDATION');
        $p = [
            'location_id'        => (int)$b['location_id'],
            'item_id'            => (int)$b['item_id'],
            'item_type'          => $b['item_type']     ?? 'sku',
            'quantity'           => (int)$b['quantity'],
            'movement_type'      => $b['movement_type'] ?? 'Compra',
            'reference_document' => $b['reference_document'],
        ];
        if (!empty($b['batch_id'])) {
            $p['batch_id'] = (int)$b['batch_id'];
        } else {
            fail('batch_id es obligatorio. Crear primero el lote con action=batch.', 400, 'ERR_VALIDATION');
        }
        $res = apiCall('POST', '/inventory/reception', $p, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al registrar recepción.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_KARDEX');
        ok(['movement' => $res['raw']['data'] ?? $res['raw']]);
        break;

    // ══════════════════════════════════════════════════════
    //  FACTURAS — /purchasing/invoices
    //  POST → crear factura vinculada a orden
    //  PUT  → conciliar (?id=N)
    // ══════════════════════════════════════════════════════
    case 'invoices':
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');

        if ($method === 'GET') {
            $p = [];
            if (!empty($_GET['purchase_order_id'])) $p['purchase_order_id'] = (int)$_GET['purchase_order_id'];
            $res = apiCall('GET', '/purchasing/invoices' . ($p ? '?' . http_build_query($p) : ''), null, $token, $iid);
            if (!$res['ok']) fail(omniError($res, 'Error al cargar facturas.'), $res['status'] ?: 502);
            ok(['items' => rowsOf($res)]);

        } elseif ($method === 'POST') {
            $b = body();
            $subAction = $b['_action'] ?? '';
            if ($subAction === 'reconcile') {
                $fid = (int)($b['invoice_id'] ?? 0);
                if (!$fid) fail('invoice_id es obligatorio.', 400, 'ERR_VALIDATION');
                $res = apiCall('PUT', "/purchasing/invoices/{$fid}/reconcile",
                    ['status_reconciliation' => $b['status_reconciliation'] ?? 'conciliado'], $token, $iid);
                if (!$res['ok']) fail(omniError($res, 'Error al conciliar factura.'), $res['status'] ?: 422);
                ok(['invoice' => $res['raw']['data'] ?? $res['raw']]);
            } else {
                if (empty($b['purchase_order_id'])) fail('purchase_order_id es obligatorio.', 400, 'ERR_VALIDATION');
                $res = apiCall('POST', '/purchasing/invoices', [
                    'purchase_order_id' => (int)$b['purchase_order_id'],
                    'invoice_number'    => $b['invoice_number']    ?? $b['invoice_reference'] ?? '',
                    'total_invoice'     => (float)($b['total_invoice'] ?? 0),
                ], $token, $iid);
                if (!$res['ok']) fail(omniError($res, 'Error al crear factura.'), $res['status'] ?: 422);
                ok(['invoice' => $res['raw']['data'] ?? $res['raw']]);
            }
        } else { fail('Método no permitido.', 405); }
        break;

    // ══════════════════════════════════════════════════════
    //  DEVOLUCIONES — POST /purchasing/returns
    // ══════════════════════════════════════════════════════
    case 'returns':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $b = body();
        $res = apiCall('POST', '/purchasing/returns', $b, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al registrar devolución.'), $res['status'] ?: 422);
        ok(['return' => $res['raw']['data'] ?? $res['raw']]);
        break;

    // ══════════════════════════════════════════════════════
    //  OCR COMPLETO DEL ALBARÁN — Anthropic Claude Vision
    //  Requiere ANTHROPIC_API_KEY en api/config.php o .env.local
    // ══════════════════════════════════════════════════════
    case 'ocr_albaran':
        if ($method !== 'POST') fail('Solo POST.', 405);
        $b = body();
        if (empty($b['image_b64'])) fail('image_b64 es obligatorio.', 400, 'ERR_VALIDATION');
        if (!ANTHROPIC_API_KEY)     fail('ANTHROPIC_API_KEY no configurada.', 500, 'ERR_INTERNAL');

        $img = $b['image_b64']; $mt = 'image/jpeg'; $b64 = $img;
        if (preg_match('/^data:([^;]+);base64,(.+)$/s', $img, $m)) { $mt = $m[1]; $b64 = $m[2]; }

        $prompt = 'Eres un sistema experto en lectura de documentos comerciales (albaranes, notas de entrega, facturas de proveedor). Analiza la imagen y extrae toda la información estructurada. INSTRUCCIONES: Devuelve ÚNICAMENTE el JSON indicado. Sin texto previo. Sin backticks. Si un campo no aparece usa null. Extrae TODAS las líneas de producto. cantidad_recibida: número exacto con unidad. lote: código de lote. fecha_caducidad: fecha caducidad YYYY-MM-DD. confianza: legibilidad general. JSON exacto: {"numero_albaran":"string o null","fecha_albaran":"YYYY-MM-DD o null","proveedor":{"nombre_fiscal":"string o null","nombre_comercial":"string o null","nif":"string o null","direccion":"string o null","telefono":"string o null","email":"string o null"},"cliente":{"nombre":"string o null","nif":"string o null","codigo_cliente":"string o null"},"lineas":[{"articulo_proveedor":"string o null","descripcion":"string","cantidad_recibida":"string o null","precio_unitario":"string o null","importe":"string o null","lote":"string o null","fecha_caducidad":"YYYY-MM-DD o null"}],"total_importe":"string o null","condiciones_pago":"string o null","confianza":"alta|media|baja"}';

        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => 'POST',
            CURLOPT_POSTFIELDS     => json_encode([
                'model' => 'claude-opus-4-6', 'max_tokens' => 2500,
                'messages' => [['role' => 'user', 'content' => [
                    ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mt, 'data' => $b64]],
                    ['type' => 'text',  'text'   => $prompt],
                ]]],
            ], JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 45,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'x-api-key: ' . ANTHROPIC_API_KEY,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $rawR = curl_exec($ch); $st = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $ce = curl_error($ch); curl_close($ch);
        if ($rawR === false || $ce) fail('Error OCR: ' . $ce, 502, 'ERR_INTERNAL');
        $resp = json_decode($rawR, true);
        if ($st !== 200 || empty($resp['content'][0]['text'])) fail('El servicio OCR no respondió. HTTP ' . $st, 502, 'ERR_INTERNAL');
        $txt = trim(preg_replace(['/^```(?:json)?\s*/i', '/\s*```$/i'], '', $resp['content'][0]['text']));
        $ext = json_decode($txt, true);
        if (!is_array($ext)) fail('No se pudo parsear la respuesta del OCR.', 500, 'ERR_INTERNAL');
        if (!empty($ext['fecha_albaran'])) $ext['fecha_albaran'] = _normFecha($ext['fecha_albaran']);
        foreach (($ext['lineas'] ?? []) as $i => $l)
            if (!empty($l['fecha_caducidad'])) $ext['lineas'][$i]['fecha_caducidad'] = _normFecha($l['fecha_caducidad']);
        ok(['albaran' => $ext]);
        break;


    // ══════════════════════════════════════════════════════
    //  CREAR SKU — POST /catalog/skus
    //  Usado cuando el producto del albarán no existe en OMNI
    //  Body: { name, unit_of_measure, item_type, family_id? }
    // ══════════════════════════════════════════════════════
    case 'create_sku':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $b = body();
        if (empty($b['name']))             fail('name es obligatorio.', 400, 'ERR_VALIDATION');
        if (empty($b['unit_of_measure']))   fail('unit_of_measure es obligatorio (g|ml|ud).', 400, 'ERR_VALIDATION');
        if (empty($b['item_type']))         fail('item_type es obligatorio (MP|PT|SV...).', 400, 'ERR_VALIDATION');
        $p = [
            'name'             => $b['name'],
            'unit_of_measure'  => $b['unit_of_measure'],
            'item_type'        => $b['item_type'],
        ];
        if (!empty($b['family_id']))    $p['family_id']    = (int)$b['family_id'];
        if (!empty($b['description']))  $p['description']  = $b['description'];
        if (!empty($b['sku_ref']))      $p['sku_ref']      = $b['sku_ref'];
        $res = apiCall('POST', '/catalog/skus', $p, $token, $iid);
        if (!$res['ok']) fail(omniError($res, 'Error al crear SKU.'), $res['status'] ?: 422, $res['omni_code'] ?? 'ERR_VALIDATION');
        ok(['sku' => $res['raw']['data'] ?? $res['raw']]);
        break;


    // ══════════════════════════════════════════════════════
    //  GESTOR DE PERMISOS — Solo SuperAdmin
    //  GET  /rbac/roles?ambito=operativo
    //  GET  /rbac/subsystems/1002/screen-permissions
    //  PUT  /rbac/subsystems/1002/screen-permissions
    //  GET  /rbac/subsystems/1002/screens
    // ══════════════════════════════════════════════════════

    case 'rbac_screens_register':
        if ($method !== 'POST') fail('Solo POST.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $b = body();
        $res = apiCall('POST', '/rbac/subsystems/1002/screens', [
            'screen_key' => $b['screen_key'],
            'label'      => $b['label'],
            'sort_order' => (int)($b['sort_order'] ?? 0),
        ], $token, $iid);
        // Si ya existe (409) no es error
        if (!$res['ok'] && $res['status'] !== 409)
            fail(omniError($res,'Error al registrar pantalla.'), $res['status']?:422);
        ok(['registered' => true]);
        break;

    case 'rbac_roles':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $res = apiCall('GET', '/rbac/roles?ambito=operativo', null, $token, $iid);
        if (!$res['ok']) fail(omniError($res,'Error al cargar roles.'), $res['status']?:502);
        ok(['roles' => $res['raw']['data'] ?? $res['raw']]);
        break;

    case 'rbac_screens_catalog':
        if ($method !== 'GET') fail('Solo GET.', 405);
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        $res = apiCall('GET', '/rbac/subsystems/1002/screens', null, $token, $iid);
        if (!$res['ok']) ok(['screens' => []]); // fallback: catálogo vacío
        else ok(['screens' => $res['raw']['data'] ?? $res['raw']]);
        break;

    case 'rbac_perms':
        if (!$token) fail('Token requerido.', 401, 'ERR_AUTH');
        if ($method === 'GET') {
            $res = apiCall('GET', '/rbac/subsystems/1002/screen-permissions', null, $token, $iid);
            if (!$res['ok']) fail(omniError($res,'Error al cargar permisos.'), $res['status']?:502, $res['omni_code']??'ERR_NOT_FOUND');
            // v6.8: pasar data completa (screens + roles + permissions)
            ok($res['raw']['data'] ?? $res['raw']);
        } elseif ($method === 'PUT') {
            $b = body();
            $res = apiCall('PUT', '/rbac/subsystems/1002/screen-permissions', $b, $token, $iid);
            if (!$res['ok']) fail(omniError($res,'Error al guardar permisos.'), $res['status']?:422);
            ok(['saved' => true]);
        } else { fail('Método no permitido.', 405); }
        break;

    default:
        fail('Acción no reconocida: ' . htmlspecialchars($action), 404, 'ERR_NOT_FOUND');
}
