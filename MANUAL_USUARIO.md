# MANUAL DE USUARIO · [1002] Registro de Albaranes de Compras
## JOSEPAN 360 · Ecosistema OMNI · v10.0
### Guía operativa de campo — Operario de Almacén · Jefe de Almacén

---

## 1. Inicio de sesión

| Campo | Qué introducir |
|---|---|
| **Usuario** | Tu nombre de usuario (ej: `jose.perez`) |
| **Contraseña** | Tu propio nombre de usuario (contraseña inicial igual al usuario) |
| **Sede de trabajo** | La sede donde trabajas hoy — se carga automáticamente del sistema |

Pulsa **Entrar**. La aplicación carga tus datos y catálogos.

> 💡 Si el sistema te ha asignado una contraseña diferente, usa esa. La contraseña inicial es tu nombre de usuario.

### Problemas de acceso

| Mensaje | Solución |
|---|---|
| *"Usuario o contraseña incorrectos"* | Verifica usuario y contraseña. La contraseña inicial = tu usuario. |
| *"Selecciona la sede donde trabajas hoy"* | Elige tu sede antes de pulsar Entrar. |
| *"Sin permisos de acceso a este módulo"* | Contacta con tu supervisor para que te asigne permisos en [1002]. |
| *"Sin conexión con el servidor"* | Verifica la red. Si persiste, avisa a soporte técnico. |

---

## 2. Flujo diario de trabajo

### PASO 1 — Fotografiar el albarán del proveedor

1. Cuando llegue el camión, toma el **albarán impreso** del conductor.
2. En la pantalla, toca la zona de cámara (icono 📷).
3. Encuadra **todo el documento** y captura la foto.
4. El sistema analiza la imagen automáticamente y extrae:
   - Número de albarán
   - Datos del proveedor (nombre, NIF, dirección)
   - Líneas de producto con lotes y fechas de caducidad

Verás un panel con los datos detectados. Pulsa **"Continuar"**.

> Si la foto es mala, toca **"Eliminar documento"** y repite.
> El sistema funciona con cualquier formato de albarán de cualquier proveedor.

---

### PASO 2 — Verificar datos del albarán

| Campo | Qué verificar |
|---|---|
| **N.º Albarán** | Debe coincidir con el impreso (ej: `ALENDUO26018578`) |
| **Proveedor** | Si el OCR lo detectó y existe en el sistema, ya estará seleccionado |
| **Bodega destino** | Selecciona dónde va a almacenarse la mercancía |

#### Si el proveedor no está en el sistema

1. El panel OCR mostrará: *"No encontrado. Crear proveedor"*
2. Pulsa ese enlace → se abre el formulario con datos ya rellenados del albarán
3. Verifica los datos y pulsa **"Crear proveedor"**

---

### PASO 3 — Escanear los productos

Para cada producto del albarán:

**A) Con pistola lectora** — apunta al código de barras y dispara

**B) Sin pistola** — escribe el nombre en el buscador y selecciona de la lista

Una vez reconocido el producto, completa:

| Campo | Qué introducir |
|---|---|
| **Formato recibido** | Cómo viene embalado (ej: Saco 25 kg, Caja × 12) |
| **Cantidad** | Cuántos empaques han llegado (ej: `8`) |
| **Código de Lote** | El lote del proveedor (si el OCR lo detectó, ya estará) |
| **Fecha Vencimiento** | La fecha de caducidad del embalaje |

El sistema muestra la cantidad en unidad base que entrará al inventario.
Pulsa **"+ Añadir al albarán"**. Repite para cada producto.

---

### PASO 4 — Confirmar y registrar

1. Revisa el resumen completo.
2. Si algo es incorrecto → **"Corregir"** para volver.
3. Pulsa **"Registrar albarán"** → mensaje verde de éxito.

---

## 3. Modo offline

Si el Wi-Fi cae, aparece una franja naranja:
> **MODO OFFLINE — X TRANSACCIONES RETENIDAS LOCALMENTE**

**Puedes seguir registrando albaranes.** Se guardan en el dispositivo y se sincronizan solos cuando vuelva la conexión.

- ❌ No apagues el dispositivo con transacciones pendientes
- ❌ No borres el historial del navegador
- ✅ Sí puedes seguir trabajando normalmente

---

## 4. Resolución de problemas

| Problema | Solución |
|---|---|
| El escáner no reconoce el código | Toca el campo de búsqueda para activarlo y vuelve a disparar |
| *"No encontrado en catálogo"* | Busca por nombre. Si no aparece, el artículo no está dado de alta: avisa al responsable |
| Fecha de vencimiento da error | La fecha no puede ser igual o anterior a hoy. Si el producto está caducado, apártalo físicamente |
| Botón "Registrar albarán" en gris | Faltan datos: N.º albarán, proveedor y al menos un producto |
| El OCR no detecta bien los datos | Mejora la foto (superficie plana, buena luz, sin reflejos). Puedes rellenar los datos a mano |
| Franja roja ⛔ PARADA DE EMERGENCIA | Para inmediatamente y llama al responsable con el mensaje exacto que aparece |

---

## 5. Indicadores visuales

| Elemento | Significado |
|---|---|
| Panel verde con ✓ (tras cargar documento) | OCR detectó los datos correctamente |
| Panel ámbar con ⚠ | Datos detectados con baja confianza — revisa antes de continuar |
| Toast verde inferior | Operación completada con éxito |
| Modal con borde rojo | Error de validación — revisa el dato indicado |
| Franja naranja superior | Sin conexión — modo offline activo |
| Franja roja ⛔ | Error crítico — contactar con soporte |

---

*JOSEPAN 360 · Ecosistema OMNI · [1002] Albaranes · v10.0 · Junio 2026*
