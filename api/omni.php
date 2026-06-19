<?php
/**
 * JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 * api/omni.php (v12.0) — Proxy PHP centralizado
 * Constantes: ver api/config.php
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
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE));
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
            is_array($i) && ($i['status']??'') !== 'deleted' && empty($i['deleted_at'])
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

$token = '';
$iid   = 0;
if (preg_match('/Bearer\s+(.+)/i', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) $token = trim($m[1]);
if (!empty($_SERVER['HTTP_X_INTERLOCUTOR_ID'])) $iid = (int)$_SERVER['HTTP_X_INTERLOCUTOR_ID'];

$action = strtolower(trim($_GET['action'] ?? ''));
$method = strtoupper($_SERVER['REQUEST_METHOD']);

switch ($action) {

    case 'login':
        if ($method!=='POST') fail('Solo POST.',405);
        $b=$b=body(); $username=trim($b['username']??''); $password=trim($b['password']??''); $iid2=(int)($b['interlocutor_id']??0);
        if (!$username||!$password) fail('Usuario y contraseña obligatorios.',400,'ERR_VALIDATION');
        if ($iid2<1) fail('interlocutor_id es obligatorio.',400,'ERR_VALIDATION');
        $res=apiCall('POST','/auth/login',['username'=>$username,'password'=>$password,'interlocutor_id'=>$iid2],'',0);
        if (!$res['ok']) fail(omniError($res,'Credenciales incorrectas.'),$res['status']?:401,$res['omni_code']??'ERR_AUTH');
        $d=$res['raw']['data']??[]; $tkn=$d['token']??null;
        if (!$tkn) fail('El API no devolvió token.',500,'ERR_INTERNAL');
        ok(['token'=>$tkn,'user_id'=>$d['user_id']??null,'username'=>$d['username']??$username,
            'role'=>$d['role']??null,'interlocutor_id'=>$d['interlocutor_id']??$iid2,
            'interlocutor_name'=>$d['interlocutor_name']??null,'permissions'=>$d['permissions']??[]]);
        break;

    case 'me':
        if ($method!=='GET') fail('Solo GET.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $res=apiCall('GET','/auth/me',null,$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al obtener perfil.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
        ok(['user'=>$res['raw']['data']??$res['raw']]);
        break;

    case 'rbac_screens':
        if ($method!=='GET') fail('Solo GET.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $sub=(int)($_GET['subsystem']??SUBSISTEMA_ID);
        $res=apiCall('GET',"/rbac/subsystems/{$sub}/my-screens",null,$token,$iid);
        if (!$res['ok']&&$res['status']===404) ok(['screens'=>'*','fallback'=>true]);
        if (!$res['ok']) fail(omniError($res,'Error al obtener permisos.'),$res['status']?:502,$res['omni_code']??'ERR_RBAC');
        ok(['screens'=>$res['raw']['data']['screens']??'*']);
        break;

    case 'interlocutors':
        if ($method!=='GET') fail('Solo GET.',405);
        $isPublic=isset($_GET['public'])&&$_GET['public']==='1';
        $useToken=$token?:($isPublic?OMNI_SERVICE_TOKEN:'');
        if (!$useToken&&!$isPublic) fail('Token requerido.',401,'ERR_AUTH');
        if (!$useToken) {
            $sedes=[
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
            if (!empty($_GET['type'])) { $t=$_GET['type']; $sedes=array_values(array_filter($sedes,fn($s)=>$s['type']===$t)); }
            ok(['items'=>$sedes,'fallback'=>true]);
        }
        $params=[];
        if (!empty($_GET['type'])) $params['type']=$_GET['type'];
        $useIid=(isset($_GET['all'])&&$_GET['all']==='1')?0:$iid;
        $res=apiCall('GET','/catalog/interlocutors'.($params?'?'.http_build_query($params):''),null,$useToken,$useIid);
        if (!$res['ok']) fail(omniError($res,'Error al cargar sedes.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
        ok(['items'=>rowsOf($res)]);
        break;

    case 'skus':
        if ($method!=='GET') fail('Solo GET.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $p=['limit'=>(int)($_GET['limit']??500),'offset'=>(int)($_GET['offset']??0)];
        if (!empty($_GET['q'])) $p['q']=$_GET['q'];
        if (!empty($_GET['item_type'])) $p['item_type']=$_GET['item_type'];
        $res=apiCall('GET','/catalog/skus?'.http_build_query($p),null,$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al cargar SKUs.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
        ok(['items'=>rowsOf($res)]);
        break;

    case 'locations':
        if ($method!=='GET') fail('Solo GET.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $res=apiCall('GET','/catalog/locations',null,$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al cargar ubicaciones.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
        ok(['items'=>rowsOf($res)]);
        break;

    case 'suppliers':
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        if ($method==='GET') {
            $p=[]; if(!empty($_GET['q'])) $p['q']=$_GET['q']; if(isset($_GET['is_standardized'])) $p['is_standardized']=(int)$_GET['is_standardized'];
            $res=apiCall('GET','/catalog/suppliers'.($p?'?'.http_build_query($p):''),null,$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al cargar proveedores.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
            ok(['items'=>rowsOf($res)]);
        } elseif ($method==='POST') {
            $b=body(); if(empty($b['fiscal_name'])) fail('fiscal_name es obligatorio.',400,'ERR_VALIDATION');
            $p=['fiscal_name'=>$b['fiscal_name'],'commercial_name'=>$b['commercial_name']??$b['fiscal_name']];
            foreach(['fiscal_id','email','phone','address','notes','is_standardized'] as $f) if(isset($b[$f])&&$b[$f]!==''&&$b[$f]!==null) $p[$f]=$b[$f];
            $res=apiCall('POST','/catalog/suppliers',$p,$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al crear proveedor.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
            ok(['supplier'=>$res['raw']['data']??$res['raw']]);
        } elseif ($method==='PUT') {
            $sid=(int)($_GET['id']??0); if(!$sid) fail('id es obligatorio.',400,'ERR_VALIDATION');
            $res=apiCall('PUT',"/catalog/suppliers/{$sid}",body(),$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al actualizar proveedor.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
            ok(['supplier'=>$res['raw']['data']??$res['raw']]);
        } elseif ($method==='DELETE') {
            $sid=(int)($_GET['id']??0); if(!$sid) fail('id es obligatorio.',400,'ERR_VALIDATION');
            $res=apiCall('DELETE',"/catalog/suppliers/{$sid}",null,$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al eliminar proveedor.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
            ok(['deleted'=>true]);
        } else { fail('Método no permitido.',405); }
        break;

    case 'supplier_items':
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        if ($method==='GET') {
            $p=[]; if(!empty($_GET['supplier_id'])) $p['supplier_id']=(int)$_GET['supplier_id'];
            $res=apiCall('GET','/catalog/supplier-items'.($p?'?'.http_build_query($p):''),null,$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al cargar artículos.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
            ok(['items'=>rowsOf($res)]);
        } elseif ($method==='POST') {
            $res=apiCall('POST','/catalog/supplier-items',body(),$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al añadir artículo.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
            ok(['item'=>$res['raw']['data']??$res['raw']]);
        } else { fail('Método no permitido.',405); }
        break;

    case 'supplier_prices':
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        if ($method==='GET') {
            $p=[];
            if(!empty($_GET['supplier_id'])) $p['supplier_id']=(int)$_GET['supplier_id'];
            if(!empty($_GET['item_id']))     $p['item_id']=(int)$_GET['item_id'];
            $res=apiCall('GET','/catalog/supplier-prices'.($p?'?'.http_build_query($p):''),null,$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al cargar precios.'),$res['status']?:502,$res['omni_code']??'ERR_INTERNAL');
            ok(['items'=>rowsOf($res)]);
        } elseif ($method==='POST') {
            $res=apiCall('POST','/catalog/supplier-prices',body(),$token,$iid);
            if (!$res['ok']) fail(omniError($res,'Error al registrar precio.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
            ok(['price'=>$res['raw']['data']??$res['raw']]);
        } else { fail('Método no permitido.',405); }
        break;

    case 'purchasing_order':
        if ($method!=='POST') fail('Solo POST.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $b=body();
        if(empty($b['supplier_id'])) fail('supplier_id es obligatorio.',400,'ERR_VALIDATION');
        if(empty($b['reference']))   fail('reference es obligatorio.',400,'ERR_VALIDATION');
        $res=apiCall('POST','/purchasing/orders',['supplier_id'=>(int)$b['supplier_id'],
            'interlocutor_id'=>(int)($b['interlocutor_id']??$iid),
            'reference'=>$b['reference'],'expected_delivery'=>$b['expected_delivery']??null],$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al crear albarán.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
        ok(['order'=>$res['raw']['data']??$res['raw']]);
        break;

    case 'purchasing_order_line':
        if ($method!=='POST') fail('Solo POST.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $b=body(); $oid=(int)($b['order_id']??0);
        if(!$oid) fail('order_id es obligatorio.',400,'ERR_VALIDATION');
        if(empty($b['item_id'])) fail('item_id es obligatorio.',400,'ERR_VALIDATION');
        $res=apiCall('POST',"/purchasing/orders/{$oid}/details",[
            'item_id'=>(int)$b['item_id'],'item_type'=>$b['item_type']??'sku',
            'quantity_ordered'=>(int)$b['quantity_ordered'],'unit_price'=>(float)($b['unit_price']??0)],$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al añadir línea.'),$res['status']?:422,$res['omni_code']??'ERR_VALIDATION');
        ok(['detail'=>$res['raw']['data']??$res['raw']]);
        break;

    case 'receive':
        if ($method!=='POST') fail('Solo POST.',405);
        if (!$token) fail('Token requerido.',401,'ERR_AUTH');
        $b=body();
        foreach(['location_id','item_id','quantity','reference_document'] as $f)
            if(!isset($b[$f])||$b[$f]===''||$b[$f]===null) fail("Campo obligatorio: {$f}",400,'ERR_VALIDATION');
        $p=['location_id'=>(int)$b['location_id'],'item_id'=>(int)$b['item_id'],
            'item_type'=>$b['item_type']??'sku','quantity'=>(int)$b['quantity'],
            'movement_type'=>$b['movement_type']??'Compra','reference_document'=>$b['reference_document']];
        if(!empty($b['batch'])&&is_array($b['batch'])) {
            $p['batch']=['batch_reference'=>$b['batch']['batch_reference'],
                         'expiration_date'=>$b['batch']['expiration_date'],
                         'cost_per_unit'=>(float)($b['batch']['cost_per_unit']??0)];
        } elseif(!empty($b['batch_id'])) {
            $p['batch_id']=(int)$b['batch_id'];
        } else { fail('Se requiere batch{batch_reference,expiration_date} o batch_id.',400,'ERR_VALIDATION'); }
        $res=apiCall('POST','/inventory/reception',$p,$token,$iid);
        if (!$res['ok']) fail(omniError($res,'Error al registrar recepción.'),$res['status']?:422,$res['omni_code']??'ERR_KARDEX');
        ok(['movement'=>$res['raw']['data']??$res['raw']]);
        break;

    case 'ocr_albaran':
        if ($method!=='POST') fail('Solo POST.',405);
        $b=body();
        if(empty($b['image_b64'])) fail('image_b64 es obligatorio.',400,'ERR_VALIDATION');
        if(!ANTHROPIC_API_KEY) fail('ANTHROPIC_API_KEY no configurada en api/config.php.',500,'ERR_INTERNAL');
        $img=$b['image_b64']; $mt='image/jpeg'; $b64=$img;
        if(preg_match('/^data:([^;]+);base64,(.+)$/s',$img,$m)){$mt=$m[1];$b64=$m[2];}
        $prompt='Eres un sistema experto en lectura de documentos comerciales (albaranes, notas de entrega, facturas de proveedor). Analiza la imagen y extrae toda la información estructurada. INSTRUCCIONES: Devuelve ÚNICAMENTE el JSON indicado. Sin texto previo. Sin backticks. Si un campo no aparece usa null. Extrae TODAS las líneas de producto. "cantidad_recibida": número exacto con unidad. "lote": código de lote. "fecha_caducidad": fecha caducidad (YYYY-MM-DD). "confianza": legibilidad general. JSON: {"numero_albaran":"string o null","fecha_albaran":"YYYY-MM-DD o null","proveedor":{"nombre_fiscal":"string o null","nombre_comercial":"string o null","nif":"string o null","direccion":"string o null","telefono":"string o null","email":"string o null"},"cliente":{"nombre":"string o null","nif":"string o null","codigo_cliente":"string o null"},"lineas":[{"articulo_proveedor":"string o null","descripcion":"string","cantidad_recibida":"string o null","precio_unitario":"string o null","importe":"string o null","lote":"string o null","fecha_caducidad":"YYYY-MM-DD o null"}],"total_importe":"string o null","condiciones_pago":"string o null","confianza":"alta|media|baja"}';
        $ch=curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch,[CURLOPT_CUSTOMREQUEST=>'POST',
            CURLOPT_POSTFIELDS=>json_encode(['model'=>'claude-opus-4-6','max_tokens'=>2500,
                'messages'=>[['role'=>'user','content'=>[
                    ['type'=>'image','source'=>['type'=>'base64','media_type'=>$mt,'data'=>$b64]],
                    ['type'=>'text','text'=>$prompt]]]]],JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>45,
            CURLOPT_HTTPHEADER=>['Content-Type: application/json',
                'x-api-key: '.ANTHROPIC_API_KEY,   // ← constante de config.php
                'anthropic-version: 2023-06-01'],
            CURLOPT_SSL_VERIFYPEER=>true]);
        $rawR=curl_exec($ch); $st=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE); $ce=curl_error($ch); curl_close($ch);
        if($rawR===false||$ce) fail('Error OCR: '.$ce,502,'ERR_INTERNAL');
        $resp=json_decode($rawR,true);
        if($st!==200||empty($resp['content'][0]['text'])) fail('El servicio OCR no respondió. HTTP '.$st,502,'ERR_INTERNAL');
        $txt=trim(preg_replace(['/^```(?:json)?\s*/i','/\s*```$/i'],'',$resp['content'][0]['text']));
        $ext=json_decode($txt,true);
        if(!is_array($ext)) fail('No se pudo parsear la respuesta del OCR.',500,'ERR_INTERNAL');
        if(!empty($ext['fecha_albaran'])) $ext['fecha_albaran']=_normFecha($ext['fecha_albaran']);
        foreach(($ext['lineas']??[]) as $i=>$l)
            if(!empty($l['fecha_caducidad'])) $ext['lineas'][$i]['fecha_caducidad']=_normFecha($l['fecha_caducidad']);
        ok(['albaran'=>$ext]);
        break;

    default:
        fail('Acción no reconocida: '.htmlspecialchars($action),404,'ERR_NOT_FOUND');
}
