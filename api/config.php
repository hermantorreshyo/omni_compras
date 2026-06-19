<?php
/**
 * ═══════════════════════════════════════════════════════════
 *  JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 *  api/config.php — Configuración centralizada del subsistema
 *
 *  CÓMO CONFIGURAR EN PRODUCCIÓN (Apache VirtualHost):
 *    SetEnv OMNI_API_BASE        https://api.omni.josepan.app
 *    SetEnv ANTHROPIC_API_KEY    sk-ant-api03-...
 *    SetEnv OMNI_SERVICE_TOKEN   eyJ...
 *
 *  CÓMO CONFIGURAR EN LOCAL (XAMPP):
 *    Opción A: Añadir los SetEnv en httpd.conf o el VirtualHost local.
 *    Opción B: Crear api/.env.local (nunca subir al repositorio):
 *              OMNI_API_BASE=https://api.omni.josepan.app
 *              ANTHROPIC_API_KEY=sk-ant-api03-...
 *              OMNI_SERVICE_TOKEN=eyJ...
 *
 *  Este archivo NO contiene credenciales. Solo lee variables de entorno.
 *  Incluirlo al inicio de omni.php con: require_once __DIR__ . '/config.php';
 * ═══════════════════════════════════════════════════════════
 */

declare(strict_types=1);

// ── Cargar .env.local si existe (desarrollo local sin VirtualHost) ──
$_envLocal = __DIR__ . '/.env.local';
if (file_exists($_envLocal)) {
    foreach (file($_envLocal, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$key, $val] = explode('=', $line, 2);
        $key = trim($key); $val = trim($val);
        if ($key && !getenv($key)) putenv("{$key}={$val}");
    }
}

// ── Constantes del subsistema ───────────────────────────────────────

/** URL base del API CORE (sin trailing slash, sin /api/v1) */
define('OMNI_API_BASE',   rtrim(getenv('OMNI_API_BASE') ?: 'https://api.omni.josepan.app', '/'));

/** Prefijo de versión del API CORE */
define('OMNI_API_PREFIX', '/api/v1');

/**
 * Clave de la API de Anthropic para el OCR con Claude Vision.
 * Obligatoria para la acción ocr_albaran.
 * Sin ella, el OCR falla con ERR_INTERNAL pero la app sigue funcionando.
 */
define('ANTHROPIC_API_KEY', getenv('ANTHROPIC_API_KEY') ?: '');

/**
 * Token de servicio del API CORE.
 * Permite cargar el listado de sedes (interlocutores) en la pantalla
 * de login sin que el usuario esté autenticado.
 * Opcional: si no se define, se usa la lista estática de 17 sedes.
 */
define('OMNI_SERVICE_TOKEN', getenv('OMNI_SERVICE_TOKEN') ?: '');

/**
 * Versión del subsistema — para cabeceras de diagnóstico.
 */
define('SUBSISTEMA_VERSION', '11.0');
define('SUBSISTEMA_ID',      '1002');
