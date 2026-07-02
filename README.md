# [1002] Registro de Albaranes de Compras
### JOSEPAN 360 · Ecosistema OMNI · v10.0 — API CORE v6.6.0

> Micro-aplicación web SPA para el registro digital de albaranes de compras. Fotografía el albarán, extrae los datos con IA, registra cada línea en el Kardex y opera en modo offline con sincronización diferida.

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 · Tailwind CSS v3 (CDN) · JavaScript Vanilla ES6+ |
| Proxy backend | PHP 8.1+ · cURL · `OmniCoreClient.php` (SDK oficial) |
| OCR | Anthropic Claude Vision (`claude-opus-4-6`) |
| Servidor | Apache 2.4 — XAMPP (local) / LAMP (producción) |
| API CORE | `https://api.omni.josepan.app/api/v1` |

## Estructura

```
1002/
├── README.md
├── MANUAL_USUARIO.md
├── DOCUMENTACION_TECNICA.md
├── MANUAL_DESPLIEGUE.md
├── index.html
├── app.js
├── .htaccess
└── api/
    ├── OmniCoreClient.php   ← SDK oficial (no modificar)
    └── omni.php             ← Proxy PHP centralizado
```

## Funcionalidades

- **OCR automático** — Claude Vision extrae número, proveedor, fecha y líneas de cualquier albarán
- **Selector de sede dinámico** — carga los 17 interlocutores de la red desde el API CORE
- **RBAC de pantallas** — consulta `/rbac/subsystems/1002/my-screens` al hacer login
- **Flujo purchasing** — `POST /purchasing/orders` → `details` → `reception` inline (v6.6.0)
- **Crear proveedor** — si no existe, se crea desde el flujo con datos del OCR pre-rellenados
- **Conversión metrológica** — kg/L/cajas → g/ml/ud antes de enviar al Kardex
- **Outbox offline** — transacciones encoladas en localStorage, sincronización automática

## Variables de entorno

```apache
SetEnv ANTHROPIC_API_KEY   sk-ant-api03-...   # obligatorio para OCR
SetEnv OMNI_SERVICE_TOKEN  eyJ...             # opcional: carga sedes sin token de usuario
```

## Instalación rápida

```bash
# 1. Copiar archivos
cp -r 1002/ /var/www/omni/1002/

# 2. Permisos
chown -R www-data:www-data /var/www/omni/1002

# 3. Configurar VirtualHost (ver MANUAL_DESPLIEGUE.md)

# 4. SSL
certbot --apache -d albaranes.josepan.app

# 5. Verificar
curl "https://albaranes.josepan.app/api/omni.php?action=interlocutors&public=1"
```

## Credenciales de prueba

```
Usuario:    herman.torres
Contraseña: herman.torres   ← contraseña inicial = username (v6.6.0)
Sede:       OBRADOR (id: 2)
```

## Documentación

| Documento | Descripción |
|---|---|
| `MANUAL_USUARIO.md` | Guía de campo para operario y jefe de almacén |
| `DOCUMENTACION_TECNICA.md` | Arquitectura, contratos API v6.6.0, OCR, errores |
| `MANUAL_DESPLIEGUE.md` | LAMP, XAMPP, SSL, troubleshooting completo |

## Relación con otros subsistemas

```
[1001] API CORE ←── [1002] Albaranes  (purchasing/orders + inventory/reception)
                ←── [1003] Almacenes
                ←── [1004] Producción
```

---

*JOSEPAN 360 · Ecosistema OMNI · [1002] · v10.0 · Junio 2026*
