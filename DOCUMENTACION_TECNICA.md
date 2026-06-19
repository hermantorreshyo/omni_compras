# DOCUMENTACIÓN TÉCNICA · [1002] Registro de Albaranes de Compras
## JOSEPAN 360 · Ecosistema OMNI · v10.0 — API CORE v6.6.0

---

## 1. Arquitectura y estructura de archivos

```
1002/
├── index.html              ← SPA maestra: vistas, estilos, modales
├── app.js                  ← Motor lógico JavaScript
├── .htaccess               ← SPA fallback, MIME types
└── api/
    ├── OmniCoreClient.php  ← SDK oficial OMNI (no modificar nunca)
    └── omni.php            ← Proxy PHP centralizado (resuelve CORS)
```

### Flujo de peticiones (sin CORS)

```
Navegador
  │
  ├── fetch("api/omni.php?action=login")       ← mismo origen: sin CORS
  │         │
  │    omni.php (PHP/cURL)
  │         ├── POST api.omni.josepan.app/api/v1/auth/login
  │         ├── GET  api.omni.josepan.app/api/v1/auth/me
  │         ├── POST api.omni.josepan.app/api/v1/purchasing/orders
  │         ├── POST api.omni.josepan.app/api/v1/purchasing/orders/{id}/details
  │         └── POST api.omni.josepan.app/api/v1/inventory/reception
  │
  └── fetch("https://api.anthropic.com/v1/messages")  ← OCR: también vía omni.php
```

### Responsabilidades por módulo

| Módulo | Hace | No hace |
|---|---|---|
| `index.html` | HTML semántico, CSS Tailwind, vistas y modales | JS propio |
| `app.js` | Routing SPA, OCR, conversión metrológica, RBAC, outbox | fetch() directo al API CORE |
| `omni.php` | Proxy HTTP: autentica, cabeceras, normaliza errores OMNI | Lógica de UI |
| `OmniCoreClient.php` | SDK: URLs, cabeceras, cURL | No modificar |

---

## 2. Contratos del API CORE v6.6.0

**Base URL:** `https://api.omni.josepan.app/api/v1`

**Headers obligatorios en toda petición autenticada:**
```
Authorization: Bearer {token}
X-Interlocutor-Id: {interlocutor_id}
Content-Type: application/json
```

**Envelope de respuesta OMNI (todas las respuestas):**
```json
{ "status": "success|error", "data": {}, "message": "...", "error_code": "ERR_*" }
```

El proxy PHP adapta este envelope al formato interno `{ ok, data, error, code }`.

### 2.1 Autenticación

```
POST /auth/login
Body: { "username": "lesly.garcia", "password": "lesly.garcia", "interlocutor_id": 7 }
```

> **Contraseña inicial = propio username** (ej: `lesly.garcia`).
> `interlocutor_id` fija la sede de trabajo de esa sesión.

**Respuesta:**
```json
{
  "status": "success",
  "data": {
    "token": "eyJ...",
    "user_id": 42,
    "username": "lesly.garcia",
    "role": "Encargado de Tienda",
    "interlocutor_id": 7,
    "interlocutor_name": "CASTELLANA",
    "permissions": ["inventory.read", "inventory.write"]
  }
}
```

El token expira en **8 horas**. Al recibir `401 ERR_AUTH`, redirigir a login.

### 2.2 RBAC de pantallas

```
GET /rbac/subsystems/1002/my-screens
```

Respuesta: `{ "screens": "*" }` (SuperAdmin) | `{ "screens": ["registro"] }` | `{ "screens": [] }` (sin acceso).

### 2.3 Interlocutores (17 sedes de la red)

```
GET /catalog/interlocutors[?type=fabrica|punto_venta|empresa|distribuidor]
```

Los 17 interlocutores están pre-cargados en BD. `X-Interlocutor-Id: 0` muestra toda la red (solo SuperAdmin).

### 2.4 SKUs — campos v6.6.0

```
GET /catalog/skus?limit=500&offset=0
```

| Campo API | Uso | ⚠️ |
|---|---|---|
| `id` | `item_id` en inventory_* | |
| `sku_final_code` | Código SKU para mostrar | Antes `sku_code` |
| `name` | Nombre del producto | |
| `unit_of_measure` | Base: `g` / `ml` / `ud` | |

### 2.5 Flujo completo de registro de un albarán — 3 pasos

```
PASO A: POST /purchasing/orders
Body: { "supplier_id": 2, "interlocutor_id": 2,
        "reference": "ALENDUO26018578", "expected_delivery": null }
→ Respuesta: { "data": { "id": 8 } }   ← order_id

PASO B: POST /purchasing/orders/8/details  (una por ítem)
Body: { "item_id": 7, "item_type": "sku",
        "quantity_ordered": 16000, "unit_price": 0 }

PASO C: POST /inventory/reception  (con batch inline — UNA sola llamada)
Body: {
  "location_id": 2,
  "item_id": 7,
  "item_type": "sku",
  "batch": {
    "batch_reference": "LOT-20260428-A3K9",
    "expiration_date": "2026-11-30",
    "cost_per_unit": 0
  },
  "quantity": 16000,
  "movement_type": "Compra",
  "reference_document": "ALENDUO26018578"
}
→ Respuesta incluye batch_id creado
```

> La recepción inline crea el lote y registra la entrada en el Kardex en una sola llamada. No son necesarias dos llamadas separadas (como en versiones anteriores de esta app).

---

## 3. Acciones del proxy omni.php

| `?action=` | Método | Auth | Descripción |
|---|---|---|---|
| `login` | POST | No | Autenticación. Envía `interlocutor_id` real del operario |
| `me` | GET | Sí | Perfil del usuario autenticado |
| `interlocutors` | GET | Opcional | Sedes de la red (pública con `?public=1` y fallback estático) |
| `skus` | GET | Sí | Catálogo de SKUs |
| `locations` | GET | Sí | Ubicaciones físicas |
| `create_interlocutor` | POST | Sí | Crear nuevo proveedor/distribuidor |
| `purchasing_order` | POST | Sí | Crear cabecera del albarán |
| `purchasing_order_line` | POST | Sí | Añadir línea al albarán |
| `receive` | POST | Sí | Recepción física con batch inline |
| `rbac_screens` | GET | Sí | Pantallas accesibles para el usuario en [1002] |
| `ocr_albaran` | POST | No* | OCR completo con Claude Vision |

*El OCR usa `ANTHROPIC_API_KEY` del servidor, no token OMNI.

---

## 4. Sistema de diseño

| Token | Valor | Uso |
|---|---|---|
| `brand` | `#642a72` | Color primario JOSEPAN |
| `ok` | `#10b981` | Éxito, confirmación |
| `danger` | `#ef4444` | Error crítico |
| `warn` | `#f59e0b` | Advertencia, modo offline |

Tipografía: **Inter** (Google Fonts). Tailwind CSS v3 CDN.

---

## 5. OCR — Extracción de datos del albarán

Funciona con cualquier formato de albarán (agnóstico al proveedor).

```
Usuario carga imagen
    → app.js: Api.ocrAlbaran(base64)
    → omni.php: POST api.anthropic.com/v1/messages (claude-opus-4-6)
    → JSON estructurado: numero_albaran, proveedor{nif,nombre,email}, lineas[]
    → app.js: pre-rellena formulario + panel de revisión
```

**Auto-match de proveedor:** busca por NIF exacto o nombre parcial en `S.proveedores`. Si no encuentra → botón "Crear proveedor" con datos del OCR pre-rellenados.

---

## 6. Conversión metrológica

`quantity` en el API CORE **siempre en unidad base** (g / ml / ud). Entero sin decimales.

```javascript
const convertir = (val, ub, uc) =>
  Math.round((parseFloat(val) || 0) * (FACTORES[ub]?.[uc] ?? 1));
// Math.round() elimina errores de coma flotante
```

| Base | Comercial | Factor |
|---|---|---|
| g | kg | 1.000 |
| g | 25kg | 25.000 |
| ml | l | 1.000 |
| ud | cj12 | 12 |

---

## 7. Manejo de errores OMNI

| `error_code` | HTTP | Tratamiento en la app |
|---|---|---|
| `ERR_AUTH` | 401 | `_logout()` → redirigir a login |
| `ERR_RBAC` | 403 | Toast "Sin permisos para esta sede" |
| `ERR_VALIDATION` | 400 | Modal con el mensaje del API |
| `ERR_STOCK` | 409 | "Stock insuficiente" |
| `ERR_KARDEX` | 422 | "Tipo de movimiento no permitido" |
| `ERR_DUPLICATE` | 409 | "Este albarán ya fue registrado" |
| `ERR_INTERNAL` | 500 | Encolar en outbox o mostrar error |
| `ERR_NETWORK` | — | Franja naranja, modo offline |

---

## 8. Outbox offline

Cuando no hay red, las transacciones se guardan en `localStorage['omni_1002_outbox']` y se sincronizan automáticamente al recuperar la conexión mediante `window.addEventListener('online', ...)`.

| Clave localStorage | Contenido |
|---|---|
| `omni_token` | JWT activo |
| `omni_iid` | interlocutor_id (sede activa) |

---

## 9. Notas de versión

| Versión | Cambio principal |
|---|---|
| v10.0 | Login con `interlocutor_id` real de la sede. Contraseña inicial = username. Flujo `purchasing/orders` → `details` → `reception` inline. Campo `sku_final_code`. RBAC de pantallas. Error codes OMNI propagados. |
| v9.0 | Selector de sede dinámico. Borrado lógico v6.4.0. 17 interlocutores pre-cargados. |
| v8.0 | OCR completo agnóstico al formato. Auto-match proveedor. |

---

*JOSEPAN 360 · Ecosistema OMNI · [1002] Albaranes · v10.0 · Junio 2026*
