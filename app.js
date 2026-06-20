/**
 * JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 * app.js (v18.0 — OMNI API CORE v6.6.0)
 *
 * Cambios respecto a v9 según manual-desarrollador-subsistemas.md:
 *  - login: interlocutor_id = sede elegida por el operario (NO hardcoded a 1)
 *  - respuesta login normalizada con parseOmniResponse() conforme al envelope OMNI
 *  - contraseña inicial = username (ej: lesly.garcia), no DNI@Omni360
 *  - flujo de registro de albarán: purchasing_order → purchasing_order_line → receive inline
 *  - recepción con batch inline: UNA sola llamada (no dos como en v9)
 *  - campos SKU: sku_final_code (v6.6.0) con fallback a sku_code
 *  - error_codes OMNI propagados: ERR_AUTH, ERR_STOCK, ERR_KARDEX, ERR_DUPLICATE
 *  - selector de sede dinámico desde API CORE
 */

'use strict';

/* ══════════════════════════════════════════════════════
   1. CLIENTE HTTP → api/omni.php
      parseOmniResponse: normaliza el envelope del proxy PHP
      { ok, data, error, code } — idéntico al adaptador del manual
══════════════════════════════════════════════════════ */
const Api = {
  _base:  'api/omni.php',
  _token: sessionStorage.getItem('omni_token') || localStorage.getItem('omni_token') || '',
  _iid:   parseInt(sessionStorage.getItem('omni_iid') || localStorage.getItem('omni_iid') || '0', 10),

  setSession(token, iid) {
    this._token = token; this._iid = iid || 0;
    localStorage.setItem('omni_token', token);
    localStorage.setItem('omni_iid',   String(iid || 0));
    sessionStorage.setItem('omni_token', token);
    sessionStorage.setItem('omni_iid',   String(iid || 0));
  },
  clearSession() {
    this._token = ''; this._iid = 0;
    localStorage.removeItem('omni_token');
    localStorage.removeItem('omni_iid');
    sessionStorage.removeItem('omni_token');
    sessionStorage.removeItem('omni_iid');
  },
  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h['Authorization']     = `Bearer ${this._token}`;
    if (this._iid)   h['X-Interlocutor-Id'] = String(this._iid);
    return h;
  },

  /**
   * Parsea la respuesta del proxy PHP.
   * El proxy normaliza el envelope OMNI { status:'success'|'error', data, message, error_code }
   * a { ok:bool, data:{}, error:string|null, code:string|null }.
   */
  parseResponse(raw) {
    return {
      ok:    raw.ok === true,
      data:  raw.data   ?? null,
      error: raw.error  ?? null,
      code:  raw.code   ?? null,
    };
  },

  async _call(method, params, body) {
    const url = this._base + '?' + new URLSearchParams(params).toString();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: this._headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw { ok: false, error: 'Sin conexión con el servidor.', code: 'ERR_NETWORK' };
    }
    const raw = await res.json().catch(() => ({ ok: false, error: `Error HTTP ${res.status}`, code: `HTTP_${res.status}` }));
    const r   = this.parseResponse(raw);
    if (!r.ok) throw r;
    return r;
  },

  // ── Endpoints ──────────────────────────────────────────
  /** Login: interlocutor_id = sede seleccionada en el formulario */
  login:              (u, p, iid)   => Api._call('POST', { action:'login'  }, { username:u, password:p, interlocutor_id:iid }),
  me:                 ()            => Api._call('GET',  { action:'me' }),
  interlocutors:      (type='')     => Api._call('GET',  { action:'interlocutors', all:'1', ...(type?{type}:{}) }),
  interlocutorsPublic:()            => fetch('api/omni.php?action=interlocutors&all=1&public=1').then(r=>r.json()),
  createInterlocutor: (b)           => Api._call('POST', { action:'create_interlocutor' }, b),
  skus:               (q='',l=500)  => Api._call('GET',  { action:'skus', limit:l, offset:0, ...(q?{q}:{}) }),
  locations:          ()            => Api._call('GET',  { action:'locations' }),
  /** Crear cabecera del albarán en /purchasing/orders */
  /** Añadir línea al albarán en /purchasing/orders/{id}/details */
  /**
   * Recepción física con batch inline (una sola llamada).
   * body.batch = { batch_reference, expiration_date, cost_per_unit? }
   * body.batch_id = ID si el lote ya existe
   */
  receive:            (b)           => Api._call('POST', { action:'receive' }, b),
  ocrAlbaran:         (img)         => Api._call('POST', { action:'ocr_albaran' }, { image_b64:img }),
  createSku:          (b)           => Api._call('POST', { action:'create_sku' }, b),
  // ── Proveedores (/purchasing/suppliers) ─────────────
  suppliers:          (q='', isStd=null) => Api._call('GET',  { action:'suppliers', ...(q?{q}:{}), ...(isStd!==null?{is_standardized:isStd}:{}) }),
  createSupplier:     (b)           => Api._call('POST', { action:'suppliers' }, b),
  updateSupplier:     (id, b)       => Api._call('PUT',  { action:'suppliers', id }, b),
  deleteSupplier:     (id)          => Api._call('DELETE',{ action:'suppliers', id }),
  // ── Órdenes de compra (/purchasing/orders) ───────────
  // Crear con details[] inline (supplier_id + líneas en una sola llamada)
  purchasingOrder:    (b)           => Api._call('POST', { action:'purchasing_order' }, b),
  approvePurchasingOrder: (orderId) => Api._call('POST', { action:'purchasing_order' }, { _action:'approve', order_id:orderId }),
  receivePurchasingOrder: (orderId, details) => Api._call('POST', { action:'purchasing_order' }, { _action:'receive', order_id:orderId, details }),
  getPurchasingOrders:(params={})   => Api._call('GET',  { action:'purchasing_order', ...params }),
  // ── Facturas (/purchasing/invoices) ──────────────────
  createInvoice:      (b)           => Api._call('POST', { action:'invoices' }, b),
  reconcileInvoice:   (id)          => Api._call('POST', { action:'invoices' }, { _action:'reconcile', invoice_id:id }),
  /** RBAC de pantallas: determina qué secciones puede ver el usuario en [1002] */
  rbacScreens:        (subsystem=1002) => Api._call('GET', { action:'rbac_screens', subsystem }),
};

/* ══════════════════════════════════════════════════════
   2. ESTADO
══════════════════════════════════════════════════════ */
const S = {
  // Sesión
  user: null, interlocutorId: Api._iid, sedePrincipalId: 0,
  _pendingUsername: null, _pendingPassword: null,
  sedeName: '', role: '', permissions: [],

  // Catálogos
  suppliers: [], todosBodegas: [], skus: [], byEan: {}, byId: {},

  // Formulario
  docB64: null, docNombre: null, ocrData: null,
  ocrLineas: [],      // líneas del OCR pendientes de match con SKU
  numAlbaran: '', purchaseOrderId: null,
  proveedorId: 0, proveedorNom: '',
  bodegaId: 0,    bodegaNom: '',
  items: [],

  step: 1,
};

/* ══════════════════════════════════════════════════════
   3. CONVERSIÓN METROLÓGICA — §20 Manual OMNI v6.6.0
   ──────────────────────────────────────────────────
   REGLA FUNDAMENTAL:
   La cantidad enviada al API es SIEMPRE en unidades físicas.
   - unit_of_measure = 'g'  → se envían gramos
   - unit_of_measure = 'ml' → se envían mililitros
   - unit_of_measure = 'ud' → se envían unidades (bolsas, cajas…)
     Si el SKU tiene pack_size > 1 (ej: 7000 g/bolsa),
     el peso total = quantity × pack_size  (solo para mostrar)
     PERO al API se envía quantity en unidades físicas.
══════════════════════════════════════════════════════ */
const FACTORES = {
  g:  { g:1,'100g':100,'500g':500,kg:1000,'2kg':2000,'5kg':5000,'25kg':25000,'50kg':50000,t:1000000 },
  ml: { ml:1,cl:10,'200ml':200,'500ml':500,l:1000,'5l':5000,'20l':20000 },
  ud: { ud:1,cj6:6,cj12:12,cj24:24,cj48:48 },
};
const UC_OPTS = {
  g:  [{v:'g',l:'Gramos (g)'},{v:'100g',l:'Sobre 100 g'},{v:'500g',l:'Bolsa 500 g'},{v:'kg',l:'Kilogramo (1 kg)'},{v:'2kg',l:'Sobre 2 kg'},{v:'5kg',l:'Saco 5 kg'},{v:'25kg',l:'Saco 25 kg'},{v:'50kg',l:'Saco 50 kg'},{v:'t',l:'Tonelada'}],
  ml: [{v:'ml',l:'Mililitros'},{v:'cl',l:'Centilitros'},{v:'200ml',l:'Botella 200 ml'},{v:'500ml',l:'Botella 500 ml'},{v:'l',l:'Litro (L)'},{v:'5l',l:'Garrafa 5 L'},{v:'20l',l:'Bidón 20 L'}],
  ud: [{v:'ud',l:'Unidades (ud)'}],
};

/**
 * convertir — para SKUs g/ml convierte el formato comercial a unidad base.
 * Para SKUs ud: devuelve las unidades físicas directamente (sin multiplicar por pack_size).
 */
const convertir = (val, ub, uc) => {
  if (ub === 'ud') return Math.round(parseFloat(val) || 0); // siempre unidades físicas
  return Math.round((parseFloat(val) || 0) * (FACTORES[ub]?.[uc] ?? 1));
};

/**
 * formatQuantity — §20 Manual OMNI v6.6.0
 * Muestra la cantidad de forma legible según la unidad y pack_size del SKU.
 * BRAUNGEL FRIO: formatQuantity(4, {unit_of_measure:'ud', pack_size:7000}) → "4 ud (28.00 kg)"
 */
function formatQuantity(quantity, sku) {
  const ub = (sku?.unit_of_measure || 'ud').toLowerCase();
  const ps = parseInt(sku?.pack_size || 1, 10);
  if (ub === 'ud' && ps > 1) {
    const totalG = quantity * ps;
    return `${quantity} ud (${totalG >= 1000 ? (totalG/1000).toFixed(2) + ' kg' : totalG + ' g'})`;
  }
  if (ub === 'g')  return quantity >= 1000 ? (quantity/1000).toFixed(2) + ' kg' : quantity + ' g';
  if (ub === 'ml') return quantity >= 1000 ? (quantity/1000).toFixed(2) + ' L'  : quantity + ' ml';
  return quantity + ' ud';
}

/* ══════════════════════════════════════════════════════
   4. UTILIDADES
══════════════════════════════════════════════════════ */
const esc     = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $       = id => document.getElementById(id);
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-ES') : '—';
const genLote = () => {
  const d = new Date();
  return `LOT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
};

/* ══════════════════════════════════════════════════════
   5. TOAST
══════════════════════════════════════════════════════ */
let _tt;
function toast(msg, type = 'ok') {
  const el = $('toast');
  el.className = el.className.replace(/bg-\S+/g, '');
  el.classList.add({ ok:'bg-ok', error:'bg-danger', warn:'bg-warn' }[type] ?? 'bg-ok');
  $('toast-icon').textContent = { ok:'✓', error:'✕', warn:'⚠' }[type] ?? '✓';
  $('toast-msg').textContent  = msg;
  el.classList.remove('hide');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hide'), 3500);
}

/* ══════════════════════════════════════════════════════
   6. NAVEGACIÓN SPA
══════════════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
}

function goStep(n) {
  S.step = n;
  [1,2,3,4].forEach(i => {
    $(`step-${i}`)?.classList.toggle('hidden', i !== n);
    const circle = $(`step${i}-circle`), label = $(`step${i}-label`);
    if (!circle) return;
    if (i < n) {
      circle.className = circle.className.replace(/bg-ink-200\s+text-ink-500|bg-brand\s+text-white/g,'');
      circle.classList.add('bg-ok','text-white');
      circle.innerHTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>`;
      label?.classList.remove('text-ink-400'); label?.classList.add('text-ok');
      $(`line-${i}-${i+1}`)?.classList.add('done');
    } else if (i === n) {
      circle.className = circle.className.replace(/bg-ok\s+text-white|bg-ink-200\s+text-ink-500/g,'');
      circle.classList.add('bg-brand','text-white');
      circle.textContent = i;
      label?.classList.remove('text-ink-400','text-ok'); label?.classList.add('text-ink-900');
    } else {
      circle.className = circle.className.replace(/bg-brand\s+text-white|bg-ok\s+text-white/g,'');
      circle.classList.add('bg-ink-200','text-ink-500');
      circle.textContent = i;
      label?.classList.remove('text-ink-900','text-ok'); label?.classList.add('text-ink-400');
      if (i > 1) $(`line-${i-1}-${i}`)?.classList.remove('done');
    }
  });
  $('step-success')?.classList.add('hidden');
}

/* ══════════════════════════════════════════════════════
   7. LOGIN — con interlocutor_id real de la sede elegida
══════════════════════════════════════════════════════ */
async function initLoginView() {
  $('btn-toggle-pass').addEventListener('click', () => {
    const i = $('inp-password'); i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('inp-username').addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();$('inp-password').focus();} });
  $('inp-password').addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault(); $('btn-login').click();} });

  $('btn-login').addEventListener('click', async e => {
    const username = $('inp-username').value.trim();
    const password = $('inp-password').value;
    const errEl    = $('login-error'), btn = $('btn-login');
    errEl.classList.add('hidden');

    if (!username || !password) {
      errEl.textContent = 'Usuario y contraseña obligatorios.';
      errEl.classList.remove('hidden'); return;
    }

    // Guardar credenciales temporalmente para usarlas tras elegir la sede
    S._pendingUsername = username;
    S._pendingPassword = password;

    // Mostrar pantalla de selección de sede con lista estática inmediata
    showView('view-sede');
    _cargarSedesVista();
  });
}

/** Muestra sedes estáticas inmediatamente, actualiza desde el API si es posible */
function _cargarSedesVista() {
  const sel = $('sel-sede');
  // Fallback estático SIEMPRE primero — visible instantáneamente
  _fallbackSedes(sel);
}

/** Inicializa la vista de selección de sede */
function initSedeView() {
  $('btn-sede-logout')?.addEventListener('click', () => {
    S._pendingUsername = null; S._pendingPassword = null;
    showView('view-login');
  });

  $('btn-confirmar-sede')?.addEventListener('click', async () => {
    const sel     = $('sel-sede');
    const sedeVal = sel.value;
    const errEl   = $('sede-error');
    const btn     = $('btn-confirmar-sede');
    errEl.classList.add('hidden');

    if (!sedeVal) {
      errEl.textContent = 'Selecciona la sede donde trabajas hoy.';
      errEl.classList.remove('hidden'); return;
    }

    const sedeId  = parseInt(sedeVal, 10);
    const sedeNom = sel.selectedOptions[0]?.text ?? '';

    btn.disabled = true;
    btn.innerHTML = '<svg class="spin w-4 h-4 mr-2 inline" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Entrando…';

    try {
      // Login real con la sede elegida por el operario
      const r = await Api.login(S._pendingUsername, S._pendingPassword, sedeId);
      const d = r.data;

      Api.setSession(d.token, d.interlocutor_id ?? sedeId);
      S.user            = d;
      S.interlocutorId  = d.interlocutor_id  ?? sedeId;
      S.sedePrincipalId = S.interlocutorId;
      S.sedeName        = d.interlocutor_name ?? sedeNom;
      S.role            = d.role        ?? '';
      S.permissions     = d.permissions ?? [];
      S._pendingUsername = null;
      S._pendingPassword = null;

      $('hdr-nombre').textContent = d.username ?? S.user?.username ?? '—';
      $('hdr-sede').textContent   = S.sedeName;
      $('lbl-fecha').textContent  = new Date().toLocaleString('es-ES',{
        day:'2-digit', month:'2-digit', year:'numeric',
        hour:'2-digit', minute:'2-digit'
      });

      await cargarCatalogos();
      await _cargarRbacScreens();
      showView('view-app'); goStep(1);

    } catch(err) {
      const msg =
        err.code === 'ERR_AUTH'    ? 'Credenciales incorrectas. Vuelve atrás e inténtalo de nuevo.' :
        err.code === 'ERR_NETWORK' ? 'Sin conexión con el servidor.' :
        (err.error || 'Error al autenticar.');
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Continuar';
    }
  });
}

function _fallbackSedes(sel) {
  const SEDES = [[1,'JOSEPAN 360'],[2,'OBRADOR'],[3,'LA PASTELERÍA'],[4,'VIA 18'],[5,'VIA 15'],
    [6,'VAGUADA'],[7,'CASTELLANA'],[8,'CEDACEROS'],[9,'XANADÚ'],[10,'SAN BLAS'],
    [11,'MADRID RIO'],[12,'CARTAGENA'],[13,'ISLAZUL'],[14,'VALLECAS'],[15,'LEGANÉS'],
    [16,'TORREJÓN'],[17,'MAJADAHONDA']];
  sel.innerHTML = '<option value="">— Seleccionar sede —</option>';
  SEDES.forEach(([id,nom]) => {
    const o = document.createElement('option'); o.value=id; o.textContent=nom; sel.appendChild(o);
  });
}



/* ══════════════════════════════════════════════════════
   7b. RBAC DE PANTALLAS (manual v6.6.0 §16)
   GET /rbac/subsystems/1002/my-screens
   screens = '*'  → SuperAdmin, todo visible
   screens = []   → sin acceso → logout
   screens = ['registro', ...] → solo esas secciones
══════════════════════════════════════════════════════ */
async function _cargarRbacScreens() {
  try {
    const r = await Api.rbacScreens(1002);
    S.screens = r.data?.screens ?? '*';

    // Sin ningún acceso → redirigir al login
    if (Array.isArray(S.screens) && S.screens.length === 0) {
      toast('Sin permisos de acceso a este módulo.', 'error');
      setTimeout(_logout, 2000);
    }
  } catch(_) {
    // Si el endpoint aún no está disponible: acceso total (compatibilidad)
    S.screens = '*';
  }
}

/* ══════════════════════════════════════════════════════
   8. CATÁLOGOS
══════════════════════════════════════════════════════ */
async function cargarCatalogos() {
  const [skusR, allR, suppR] = await Promise.all([
    Api.skus().catch(()=>({data:{items:[]}})),
    Api.interlocutors().catch(()=>({data:{items:[]}})),
    Api.suppliers().catch(()=>({data:{items:[]}})),
  ]);

  S.skus = skusR.data?.items ?? [];
  S.byEan = {}; S.byId = {};
  S.skus.forEach(s => {
    if (s.ean13) S.byEan[s.ean13] = s;
    if (s.ean)   S.byEan[s.ean]   = s;
    if (s.id)    S.byId[String(s.id)] = s;
  });

  // Bodega destino: todos los interlocutores de la red
  S.todosBodegas = allR.data?.items ?? [];
  // Proveedores: catalog/suppliers (endpoint dedicado)
  S.suppliers = suppR.data?.items ?? [];
  poblarSelectBodega();
  poblarSelectProveedor();
}

function poblarSelectBodega() {
  const sel = $('sel-ubicacion'); if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar —</option>';
  S.todosBodegas.forEach(i => {
    const o = document.createElement('option');
    o.value = i.id; o.textContent = i.commercial_name || i.fiscal_name || `Sede ${i.id}`;
    if (parseInt(i.id) === S.sedePrincipalId) o.selected = true;
    sel.appendChild(o);
  });
  if (sel.value) { S.bodegaId=parseInt(sel.value,10); S.bodegaNom=sel.selectedOptions[0]?.text??''; }
}

function poblarSelectProveedor() {
  const sel = $('sel-proveedor'); if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar proveedor —</option><option value="__new__">+ Crear nuevo proveedor…</option>';
  S.suppliers.forEach(i => {
    const o = document.createElement('option');
    o.value = i.id;
    o.textContent = i.commercial_name || i.fiscal_name || `Proveedor ${i.id}`;
    sel.appendChild(o);
  });
}


/* ══════════════════════════════════════════════════════
   AUTO-MATCH DE LÍNEAS OCR CON SKUs DEL CATÁLOGO
   Estrategia:
   1. Match por código de artículo del proveedor (articulo_proveedor)
      contra sku_final_code o sku_ref
   2. Match por palabras clave de la descripción (≥ 2 palabras coinciden)
   Devuelve el SKU encontrado o null
══════════════════════════════════════════════════════ */
function matchSkuFromOcr(linea) {
  if (!linea) return null;
  const codigo = (linea.articulo_proveedor || '').toLowerCase().trim();
  const desc   = (linea.descripcion        || '').toLowerCase().trim();

  // Match exacto por código de artículo del proveedor
  if (codigo) {
    const byCode = S.skus.find(s =>
      (s.sku_final_code || '').toLowerCase() === codigo ||
      (s.sku_ref        || '').toLowerCase() === codigo ||
      (s.ean13          || '').toLowerCase() === codigo
    );
    if (byCode) return byCode;
  }

  // Match por palabras de la descripción (mínimo 2 palabras clave coincidentes)
  if (desc.length > 3) {
    const words = desc.split(/\s+/).filter(w => w.length > 3);
    const scored = S.skus.map(s => {
      const sName = (s.name || '').toLowerCase();
      const hits  = words.filter(w => sName.includes(w)).length;
      return { sku: s, hits };
    }).filter(x => x.hits >= 2)
      .sort((a, b) => b.hits - a.hits);
    if (scored.length > 0) return scored[0].sku;
  }

  return null;
}

/**
 * Parsea la cantidad del OCR en unidad base.
 * La cantidad viene como string: "8,00 SCP 2KG", "6 AGP04", "4 C3P4", etc.
 * Extrae el número y lo convierte a la unidad base del SKU.
 */
/**
 * parseOcrQuantity — extrae la cantidad de una cadena OCR y la convierte
 * a la unidad que espera el API según §20 del manual.
 *
 * REGLA §20:
 *   - SKU con unit_of_measure='ud' (ej: BRAUNGEL FRIO bolsa 7 kg):
 *     el API espera UNIDADES FÍSICAS — devolver el número tal cual
 *   - SKU con unit_of_measure='g':
 *     el API espera GRAMOS — convertir si la cadena incluye "kg"
 *   - SKU con unit_of_measure='ml':
 *     el API espera ML — convertir si la cadena incluye "l" o "L"
 *
 * Ejemplos de cadenas OCR reales:
 *   "8,00 SCP 2KG"  → SKU en g  → 8 × 2000 = 16000 g
 *   "4 AGP05"       → SKU en ud → 4 ud
 *   "6 C3P4"        → SKU en ud → 6 ud
 *   "28,00 F.Cad"   → número bruto, usar solo el número
 */
function parseOcrQuantity(cantStr, sku) {
  if (!cantStr) return null;
  const str  = String(cantStr).replace(',', '.').trim();
  const match = str.match(/^([\d.]+)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num) || num <= 0) return null;

  const ub    = (sku?.unit_of_measure || typeof sku === 'string' ? (sku || 'ud') : 'ud').toLowerCase();
  const lower = str.toLowerCase();

  // SKU en UNIDADES FÍSICAS — devolver el número sin conversión
  if (ub === 'ud') return Math.round(num);

  // SKU en GRAMOS — convertir si la cadena indica kg
  if (ub === 'g') {
    // Detectar patrón "NUMkg" o "NUM kg" o "NUMKGN" del OCR
    if (/\d+\s*kg/i.test(str)) {
      // Extraer el kg que sigue al número principal ej: "8,00 SCP 2KG" → los 2KG son el pack
      const kgMatch = str.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
      if (kgMatch) {
        const kgPack = parseFloat(kgMatch[1].replace(',', '.'));
        // Si el KG es el pack (aparece DESPUÉS del número de unidades):
        // "8,00 SCP 2KG" → 8 bultos × 2 kg = 16000 g
        if (kgPack > 0 && kgPack !== num) return Math.round(num * kgPack * 1000);
        // Si KG es la cantidad directa: "2,5 KG" → 2500 g
        return Math.round(num * 1000);
      }
    }
    return Math.round(num); // ya en gramos
  }

  // SKU en ML — convertir si la cadena indica litros
  if (ub === 'ml') {
    if (/ l|litro/i.test(str)) return Math.round(num * 1000);
    if (/cl/i.test(str))       return Math.round(num * 10);
    return Math.round(num);
  }

  return Math.round(num);
}


/* ══════════════════════════════════════════════════════
   PROCESAR LÍNEAS OCR EN EL PASO 3
   Para cada línea del albarán:
   - Si hay match con SKU → añadir al panel de revisión
   - Si no hay match → mostrar fila para buscar o crear SKU
══════════════════════════════════════════════════════ */
function _procesarLineasOcr(lineas) {
  if (!lineas || !lineas.length) { $('input-ean')?.focus(); return; }

  const panel = $('ocr-lineas-panel');
  if (!panel) { $('input-ean')?.focus(); return; }

  panel.classList.remove('hidden');
  const container = $('ocr-lineas-body');
  container.innerHTML = '';

  let totalMatch = 0, totalNoMatch = 0;
  const matchedItems = []; // para "añadir todos"

  lineas.forEach((linea, idx) => {
    const sku     = matchSkuFromOcr(linea);
    const cantRaw = (linea.cantidad_recibida || '').trim();
    const qty     = sku ? parseOcrQuantity(cantRaw, sku) : null;  // §20: pasa SKU completo para pack_size
    const lote    = linea.lote            || '';
    const vence   = linea.fecha_caducidad || '';
    const desc    = linea.descripcion     || '—';
    const codigo  = linea.articulo_proveedor || '';

    if (sku) totalMatch++; else totalNoMatch++;

    const card = document.createElement('div');
    card.className = 'ocr-line-card px-5 py-3.5 flex items-start gap-4' + (sku ? '' : ' bg-amber-50/40');
    card.dataset.idx = idx;

    if (sku) {
      // ── CARD CON MATCH ─────────────────────────────────
      if (qty && lote && vence) matchedItems.push({ sku, qty, lote, vence, cantRaw });

      card.innerHTML = `
        <div class="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 flex items-center justify-center mt-0.5">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#16a34a" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-ink-900 truncate">${esc(sku.name)}</p>
              <p class="text-[11px] text-ink-400 font-mono">
                ${esc(sku.sku_final_code || sku.sku_ref || '')} · ${esc(sku.unit_of_measure||'ud')}
                <span class="text-brand ml-1">← OCR: ${esc(desc)} ${codigo ? '('+esc(codigo)+')' : ''}</span>
              </p>
            </div>
            <button class="ocr-add-btn flex-shrink-0 text-[11px] font-semibold bg-ok hover:bg-emerald-600
              text-white px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              data-skuid="${esc(String(sku.id))}" data-skunom="${esc(sku.name)}" data-ub="${esc(sku.unit_of_measure||'ud')}">
              + Añadir
            </button>
          </div>
          <div class="mt-2 grid grid-cols-3 gap-2">
            <div>
              <label class="block text-[10px] font-medium text-ink-400 uppercase tracking-wide mb-1">
                Cantidad (${esc(sku.unit_of_measure||'ud')}) *
              </label>
              <input type="number" class="ocr-qty w-full px-2 py-1.5 text-sm border border-ink-300
                rounded-lg font-mono text-center focus:border-brand focus:outline-none"
                value="${qty || ''}" min="1" placeholder="0" />
              <p class="text-[10px] text-ink-400 mt-0.5">OCR: ${esc(cantRaw)}</p>
            </div>
            <div>
              <label class="block text-[10px] font-medium text-ink-400 uppercase tracking-wide mb-1">Lote *</label>
              <input type="text" class="ocr-lote w-full px-2 py-1.5 text-xs border border-ink-300
                rounded-lg font-mono focus:border-brand focus:outline-none"
                value="${esc(lote)}" placeholder="Código de lote" />
            </div>
            <div>
              <label class="block text-[10px] font-medium text-ink-400 uppercase tracking-wide mb-1">Vencimiento *</label>
              <input type="date" class="ocr-vence w-full px-2 py-1.5 text-xs border border-ink-300
                rounded-lg focus:border-brand focus:outline-none"
                value="${esc(vence)}" />
            </div>
          </div>
        </div>`;
    } else {
      // ── CARD SIN MATCH ──────────────────────────────────
      card.innerHTML = `
        <div class="flex-shrink-0 w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center mt-0.5">
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#d97706" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-semibold text-ink-700 truncate">${esc(desc)}</p>
              <p class="text-[11px] text-ink-400 font-mono">
                ${codigo ? 'Ref. proveedor: ' + esc(codigo) + ' · ' : ''}OCR cant: ${esc(cantRaw)}
                ${lote ? '· Lote: ' + esc(lote) : ''}
              </p>
              <p class="text-[11px] text-amber-700 mt-0.5">
                ⚠ No encontrado en el catálogo OMNI
              </p>
            </div>
            <div class="flex flex-col gap-1.5 flex-shrink-0">
              <button class="ocr-buscar-btn text-[11px] font-medium bg-brand/10 hover:bg-brand/20
                text-brand px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                data-desc="${esc(desc)}" data-cant="${esc(cantRaw)}"
                data-lote="${esc(lote)}" data-vence="${esc(vence)}">
                🔍 Buscar en catálogo
              </button>
              <button class="ocr-crear-btn text-[11px] font-medium bg-ink-100 hover:bg-ink-200
                text-ink-700 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                data-desc="${esc(desc)}" data-ref="${esc(codigo)}">
                ✚ Crear SKU nuevo
              </button>
            </div>
          </div>
        </div>`;
    }

    container.appendChild(card);
  });

  // Actualizar contadores
  $('ocr-stat-match').querySelector('.ocr-num').textContent  = totalMatch;
  $('ocr-stat-nomatch').querySelector('.ocr-num').textContent = totalNoMatch;
  $('ocr-stat-added').querySelector('.ocr-num').textContent  = '0';

  // Botón añadir todos
  const btnAll = $('btn-ocr-add-all');
  if (btnAll) {
    btnAll.disabled = matchedItems.length === 0;
    btnAll.textContent = `Añadir todos con match (${matchedItems.length})`;
    btnAll.onclick = () => _añadirTodosOcr();
  }

  _bindOcrCardListeners();
}

function _bindOcrCardListeners() {
  const container = $('ocr-lineas-body');

  container.querySelectorAll('.ocr-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card  = btn.closest('.ocr-line-card');
      const qty   = parseInt(card.querySelector('.ocr-qty')?.value  || '0', 10);
      const lote  = card.querySelector('.ocr-lote')?.value.trim()  || '';
      const vence = card.querySelector('.ocr-vence')?.value         || '';
      const ub    = btn.dataset.ub   || 'ud';
      const skuId = parseInt(btn.dataset.skuid, 10);
      const nom   = btn.dataset.skunom;

      if (!qty || qty <= 0)            { toast('La cantidad debe ser mayor que cero.', 'warn'); return; }
      if (!lote)                        { toast('El código de lote es obligatorio.', 'warn'); return; }
      if (!vence)                       { toast('La fecha de vencimiento es obligatoria.', 'warn'); return; }
      if (new Date(vence) <= new Date()){ toast('Fecha de vencimiento inválida.', 'warn'); return; }

      S.items.push({ skuId, ean:'', nombre:nom, unidadBase:ub, quantity:qty,
        batchRef:lote, expDate:vence, labelComercial:`${qty} ${ub}` });
      renderItemsTable();

      // Marcar card como añadida
      card.style.opacity = '0.45';
      btn.textContent = '✓ Añadido';
      btn.disabled = true;
      btn.classList.replace('bg-ok','bg-green-200');

      // Actualizar contador
      const num = $('ocr-stat-added').querySelector('.ocr-num');
      num.textContent = parseInt(num.textContent) + 1;

      // Habilitar siguiente paso
      $('btn-step3-next').disabled = false;
      toast(`"${nom}" añadido.`, 'ok');
    });
  });

  container.querySelectorAll('.ocr-buscar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const desc = btn.dataset.desc || '';
      // Buscar en el catálogo y mostrar dropdown
      $('input-ean').value = desc.split(' ').slice(0,4).join(' ');
      $('input-ean').dataset.ocrLote  = btn.dataset.lote;
      $('input-ean').dataset.ocrVence = btn.dataset.vence;
      $('input-ean').dataset.ocrCant  = btn.dataset.cant;
      $('input-ean').focus();
      renderDD($('input-ean').value);
    });
  });

  container.querySelectorAll('.ocr-crear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('inp-sku-nombre').value = btn.dataset.desc || '';
      $('inp-sku-ref').value    = btn.dataset.ref  || '';
      $('modal-crear-sku').classList.remove('hidden');
      setTimeout(() => $('inp-sku-nombre').focus(), 80);
    });
  });
}

function _añadirTodosOcr() {
  const cards = $('ocr-lineas-body').querySelectorAll('.ocr-add-btn:not([disabled])');
  let added = 0;
  cards.forEach(btn => {
    const card  = btn.closest('.ocr-line-card');
    const qty   = parseInt(card.querySelector('.ocr-qty')?.value  || '0', 10);
    const lote  = card.querySelector('.ocr-lote')?.value.trim()  || '';
    const vence = card.querySelector('.ocr-vence')?.value         || '';
    const ub    = btn.dataset.ub   || 'ud';
    const skuId = parseInt(btn.dataset.skuid, 10);
    const nom   = btn.dataset.skunom;

    if (qty > 0 && lote && vence && new Date(vence) > new Date()) {
      S.items.push({ skuId, ean:'', nombre:nom, unidadBase:ub, quantity:qty,
        batchRef:lote, expDate:vence, labelComercial:`${qty} ${ub}` });
      card.style.opacity = '0.45';
      btn.textContent = '✓ Añadido';
      btn.disabled = true;
      added++;
    }
  });
  renderItemsTable();
  const num = $('ocr-stat-added').querySelector('.ocr-num');
  num.textContent = parseInt(num.textContent) + added;
  if (added > 0) {
    $('btn-step3-next').disabled = false;
    toast(`${added} producto${added!==1?'s':''} añadido${added!==1?'s':''} al albarán.`, 'ok');
  }
}


/** Busca proveedor en la lista por NIF o nombre parcial */
function matchProveedor(ocrProv) {
  if (!ocrProv) return null;
  const nom = (ocrProv.nombre_comercial || ocrProv.nombre_fiscal || '').toLowerCase();
  const nif = (ocrProv.nif || '').replace(/\s/g,'').toLowerCase();
  return S.suppliers.find(p => {
    const pNom = (p.commercial_name || p.fiscal_name || '').toLowerCase();
    const pNif = (p.fiscal_id || '').replace(/\s/g,'').toLowerCase();
    if (nif && pNif && pNif === nif) return true;
    if (nom && pNom && (pNom.includes(nom) || nom.includes(pNom))) return true;
    return false;
  }) ?? null;
}

/* ══════════════════════════════════════════════════════
   9. PASO 1 — Documento + OCR
══════════════════════════════════════════════════════ */
function initStep1() {
  const fi=$('file-input'), dz=$('drop-zone'), btn=$('btn-step1-next');
  fi.addEventListener('change',  e => { const f=e.target.files?.[0]; if(f) cargarDoc(f); });
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('border-brand','bg-brand/5'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('border-brand','bg-brand/5'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('border-brand','bg-brand/5');
    const f=e.dataTransfer?.files?.[0]; if(f) cargarDoc(f);
  });
  $('btn-clear-doc').addEventListener('click', () => {
    S.docB64=null; S.docNombre=null; S.ocrData=null;
    fi.value=''; btn.disabled=true;
    $('dz-idle').classList.remove('hidden'); $('dz-preview').classList.add('hidden');
    $('btn-clear-doc').classList.add('hidden');
    $('ocr-panel').classList.add('hidden');
  $('ocr-lineas-panel')?.classList.add('hidden');
  if ($('ocr-lineas-body')) $('ocr-lineas-body').innerHTML = '';
  });
  btn.addEventListener('click', () => goStep(2));
}

function cargarDoc(file) {
  const r = new FileReader();
  r.onload = async e => {
    S.docB64=e.target.result; S.docNombre=file.name;
    $('dz-idle').classList.add('hidden'); $('dz-preview').classList.remove('hidden');
    if (file.type.startsWith('image/')) {
      $('prev-img').src=S.docB64; $('prev-img').classList.remove('hidden'); $('prev-pdf').classList.add('hidden');
    } else {
      $('prev-nom').textContent=file.name; $('prev-pdf').classList.remove('hidden'); $('prev-img').classList.add('hidden');
    }
    $('btn-clear-doc').classList.remove('hidden');
    $('btn-step1-next').disabled=false;
    if (file.type.startsWith('image/')) await _ejecutarOcr();
  };
  r.readAsDataURL(file);
}

async function _ejecutarOcr() {
  const panel = $('ocr-panel');
  panel.className = 'mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4';
  panel.innerHTML = `<div class="flex items-center gap-2.5 text-blue-700"><svg class="spin w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg><p class="text-sm font-medium">Analizando documento con IA…</p></div>`;
  panel.classList.remove('hidden');

  try {
    const res = await Api.ocrAlbaran(S.docB64);
    const ocr = res.data?.albaran;
    S.ocrData = ocr;
    if (!ocr) { _ocrFallback(panel); return; }

    if (ocr.numero_albaran) { $('inp-num-albaran').value=ocr.numero_albaran; S.numAlbaran=ocr.numero_albaran; }
    const pm = matchProveedor(ocr.proveedor);
    if (pm) { $('sel-proveedor').value=pm.id; S.proveedorId=parseInt(pm.id,10); S.proveedorNom=pm.commercial_name||pm.fiscal_name; }

    _ocrRenderPanel(panel, ocr, !!pm);
  } catch(err) {
    panel.className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4';
    panel.innerHTML=`<p class="text-sm font-medium text-amber-700">⚠ No se pudo analizar el documento: ${esc(err.error||'Error desconocido')}. Rellena los datos manualmente.</p>`;
  }
}

function _ocrFallback(panel) {
  panel.className='mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4';
  panel.innerHTML=`<p class="text-sm font-medium text-amber-700">⚠ No se detectaron datos. Rellena los campos manualmente.</p>`;
}

function _ocrRenderPanel(panel, ocr, pmFound) {
  const cf={'alta':'text-green-700 bg-green-100','media':'text-amber-700 bg-amber-100','baja':'text-red-700 bg-red-100'};
  const cn={'alta':'Alta','media':'Media','baja':'Baja'};
  const c=ocr.confianza||'media', nl=(ocr.lineas||[]).length;
  const pn=ocr.proveedor?.nombre_comercial||ocr.proveedor?.nombre_fiscal||'—';
  const nif=ocr.proveedor?.nif||'—';

  panel.className='mt-4 rounded-xl border border-brand/20 bg-brand/5 p-4 space-y-3';
  panel.innerHTML=`
    <div class="flex items-start justify-between gap-3">
      <div><p class="text-sm font-semibold text-brand">✓ Documento analizado</p>
           <p class="text-xs text-ink-500 mt-0.5">Confianza: <span class="inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cf[c]}">${cn[c]}</span></p></div>
      <button id="btn-ocr-raw" class="text-xs text-brand underline whitespace-nowrap">Ver datos completos</button>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="bg-white rounded-lg p-2.5 border border-ink-200"><p class="text-ink-400 font-medium uppercase tracking-wide text-[10px]">N.º Albarán</p><p class="font-semibold text-ink-900 mt-0.5 font-mono">${esc(ocr.numero_albaran||'—')}</p></div>
      <div class="bg-white rounded-lg p-2.5 border border-ink-200"><p class="text-ink-400 font-medium uppercase tracking-wide text-[10px]">Fecha</p><p class="font-semibold text-ink-900 mt-0.5">${esc(ocr.fecha_albaran?fmtDate(ocr.fecha_albaran):'—')}</p></div>
      <div class="bg-white rounded-lg p-2.5 border border-ink-200 col-span-2">
        <p class="text-ink-400 font-medium uppercase tracking-wide text-[10px]">Proveedor detectado</p>
        <p class="font-semibold text-ink-900 mt-0.5">${esc(pn)}</p>
        <p class="text-ink-400 font-mono text-[11px]">${nif!=='—'?'NIF: '+esc(nif):''}</p>
        ${!pmFound?`<p class="text-amber-600 text-[11px] mt-1">⚠ No encontrado. <button id="btn-ocr-crear-prov" class="underline font-medium">Crear proveedor</button></p>`:'<p class="text-green-600 text-[11px] mt-1">✓ Encontrado en el sistema</p>'}
      </div>
    </div>
    <div class="bg-white rounded-lg p-2.5 border border-ink-200">
      <p class="text-ink-400 font-medium uppercase tracking-wide text-[10px] mb-1.5">Líneas detectadas (${nl})</p>
      <div class="space-y-1 max-h-40 overflow-y-auto">
        ${(ocr.lineas||[]).map((l,i)=>`
          <div class="flex items-start gap-2 text-xs py-1 border-b border-ink-100 last:border-0">
            <span class="text-ink-400 font-mono flex-shrink-0 w-4">${i+1}.</span>
            <div class="min-w-0">
              <p class="text-ink-800 font-medium truncate">${esc(l.descripcion||'—')}</p>
              <p class="text-ink-400 font-mono">${esc(l.cantidad_recibida||'')} ${l.lote?'· Lote: '+esc(l.lote):''} ${l.fecha_caducidad?'· Cad: '+esc(fmtDate(l.fecha_caducidad)):''}</p>
            </div>
          </div>`).join('')}
      </div>
    </div>
    <p class="text-xs text-ink-400">Revisa y corrige los datos en el paso siguiente.</p>`;

  document.getElementById('btn-ocr-raw')?.addEventListener('click', () => {
    $('modal-ocr-raw').classList.remove('hidden');
    $('ocr-raw-content').textContent = JSON.stringify(ocr, null, 2);
  });
  document.getElementById('btn-ocr-crear-prov')?.addEventListener('click', () => {
    if (ocr.proveedor) {
      $('inp-prov-nombre').value    = ocr.proveedor.nombre_fiscal    || '';
      $('inp-prov-comercial').value = ocr.proveedor.nombre_comercial || '';
      $('inp-prov-nif').value       = ocr.proveedor.nif              || '';
      $('inp-prov-telefono').value  = ocr.proveedor.telefono         || '';
      $('inp-prov-email').value     = ocr.proveedor.email            || '';
      $('inp-prov-direccion').value = ocr.proveedor.direccion        || '';
    }
    abrirModalProveedor();
  });
}

/* ══════════════════════════════════════════════════════
   10. PASO 2 — Cabecera + proveedor
══════════════════════════════════════════════════════ */
function initStep2() {
  $('btn-step2-back').addEventListener('click', () => goStep(1));
  $('sel-proveedor').addEventListener('change', e => {
    if (e.target.value === '__new__') { e.target.value=''; abrirModalProveedor(); }
  });
  $('sel-ubicacion').addEventListener('change', e => {
    S.bodegaId=parseInt(e.target.value||'0',10);
    S.bodegaNom=e.target.selectedOptions[0]?.text??'';
  });
  $('btn-step2-next').addEventListener('click', () => {
    const num  = $('inp-num-albaran').value.trim();
    const prov = $('sel-proveedor').value;
    if (!num)  { toast('Introduce el número de albarán.','warn'); return; }
    if (!prov) { toast('Selecciona o crea el proveedor.','warn'); return; }
    S.numAlbaran   = num;
    S.proveedorId  = parseInt(prov,10);
    S.proveedorNom = $('sel-proveedor').selectedOptions[0]?.text??'';
    S.bodegaId     = parseInt($('sel-ubicacion').value||'0',10);
    S.bodegaNom    = $('sel-ubicacion').selectedOptions[0]?.text??'Sin asignar';
    goStep(3);
    // Auto-procesar líneas del OCR: match con SKUs del catálogo
    if (S.ocrData?.lineas?.length > 0) {
      setTimeout(() => _procesarLineasOcr(S.ocrData.lineas), 300);
    } else {
      setTimeout(()=>$('input-ean')?.focus(),200);
    }
  });
  $('btn-modal-prov-cancel').addEventListener('click', cerrarModalProveedor);
  document.getElementById('btn-modal-prov-cancel2')?.addEventListener('click', cerrarModalProveedor);
  $('btn-modal-prov-save').addEventListener('click', guardarProveedor);
  $('modal-proveedor').addEventListener('click', e => { if(e.target===$('modal-proveedor')) cerrarModalProveedor(); });
  document.getElementById('btn-modal-ocr-close')?.addEventListener('click', () => $('modal-ocr-raw').classList.add('hidden'));
  $('modal-ocr-raw')?.addEventListener('click', e => { if(e.target===$('modal-ocr-raw')) $('modal-ocr-raw').classList.add('hidden'); });
}

function abrirModalProveedor() { $('modal-prov-error').classList.add('hidden'); $('modal-proveedor').classList.remove('hidden'); setTimeout(()=>$('inp-prov-nombre').focus(),80); }
function cerrarModalProveedor() { $('modal-proveedor').classList.add('hidden'); $('sel-proveedor').value=''; }

async function guardarProveedor() {
  const nombre=$('inp-prov-nombre').value.trim();
  const errEl=$('modal-prov-error'), btn=$('btn-modal-prov-save');
  errEl.classList.add('hidden');
  if (!nombre) { errEl.textContent='La razón social es obligatoria.'; errEl.classList.remove('hidden'); return; }
  btn.disabled=true; btn.textContent='Guardando…';
  try {
    const res = await Api.createSupplier({
      fiscal_name:     nombre,
      commercial_name: $('inp-prov-comercial').value.trim() || nombre,
      fiscal_id:       $('inp-prov-nif').value.trim()       || undefined,
      email:           $('inp-prov-email').value.trim()     || undefined,
      phone:           $('inp-prov-telefono').value.trim()  || undefined,
      address:         $('inp-prov-direccion').value.trim() || undefined,
    });
    const nuevo = res.data?.interlocutor??{};
    const nuevoId = nuevo.id??nuevo.interlocutor_id;
    const nuevoNom = nuevo.commercial_name||nuevo.fiscal_name||nombre;
    S.suppliers.push({id:nuevoId, commercial_name:nuevoNom});
    const opt = document.createElement('option');
    opt.value=nuevoId; opt.textContent=nuevoNom; opt.selected=true;
    $('sel-proveedor').appendChild(opt);
    cerrarModalProveedor();
    toast(`Proveedor "${nuevoNom}" creado.`,'ok');
  } catch(err) {
    errEl.textContent = err.error||'Error al crear proveedor.';
    errEl.classList.remove('hidden');
  } finally { btn.disabled=false; btn.textContent='Crear proveedor'; }
}


async function _guardarNuevoSku() {
  const nombre  = $('inp-sku-nombre')?.value.trim();
  const ub      = $('sel-sku-ub')?.value      || 'g';
  const tipo    = $('sel-sku-tipo')?.value     || 'MP';
  const ref     = $('inp-sku-ref')?.value.trim() || '';
  const errEl   = $('modal-sku-error');
  const btn     = $('btn-crear-sku-save');

  errEl?.classList.add('hidden');
  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl?.classList.remove('hidden'); return; }

  btn.disabled = true; btn.textContent = 'Creando…';
  try {
    const res = await Api.createSku({ name:nombre, unit_of_measure:ub, item_type:tipo, ...(ref?{sku_ref:ref}:{}) });
    const sku  = res.data?.sku ?? {};
    const newId = sku.id ?? sku.sku_id;
    if (!newId) throw { error: 'SKU creado sin ID.' };

    // Añadir al catálogo local
    S.skus.push(sku);
    S.byId[String(newId)] = sku;

    // Añadir directamente como ítem con datos del OCR
    S.items.push({
      skuId: newId, ean: '', nombre: nombre, unidadBase: ub,
      quantity: 0, batchRef: genLote(), expDate: '',
      labelComercial: '(nuevo SKU — completar cantidad)',
    });
    renderItemsTable();
    $('modal-crear-sku').classList.add('hidden');
    toast(`SKU "${nombre}" creado. Completa la cantidad y caducidad.`, 'ok');
    // Abrir el panel de conversión con el nuevo SKU
    abrirConv(sku);
  } catch(err) {
    errEl.textContent = err.error || 'Error al crear el SKU.';
    errEl?.classList.remove('hidden');
  } finally {
    btn.disabled=false; btn.textContent='Crear SKU';
  }
}

/* ══════════════════════════════════════════════════════
   11. PASO 3 — Escanear productos
   Campo SKU v6.6.0: sku_final_code (con fallback a sku_code)
══════════════════════════════════════════════════════ */
function initStep3() {
  $('btn-step3-back').addEventListener('click', () => goStep(2));
  $('btn-step3-next').addEventListener('click', () => {
    if (!S.items.length) { toast('Añade al menos un producto.','warn'); return; }
    rellenarResumen(); goStep(4);
  });
  const ean=$('input-ean');
  ean.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();resolverEan(ean.value.trim());} });
  $('btn-scan').addEventListener('click', ()=>resolverEan(ean.value.trim()));
  // renderDD ya tiene su propio debounce de 400ms para el API — no añadir uno extra
  ean.addEventListener('input', e => {
    const q=e.target.value.trim();
    if (q.length<2){cerrarDD();return;}
    renderDD(q);
  });
  $('inp-qty').addEventListener('input', actualizarConv);
  $('sel-uc').addEventListener('change',  actualizarConv);
  $('btn-add-item').addEventListener('click', añadirItem);
  $('btn-conv-cancel').addEventListener('click', cerrarConv);
  document.addEventListener('click', e=>{ if(!$('ean-wrap')?.contains(e.target)) cerrarDD(); });

  // Panel OCR — skip al escáner manual
  document.getElementById('btn-ocr-lineas-skip')?.addEventListener('click', () => {
    document.getElementById('ocr-lineas-panel')?.classList.add('hidden');
    document.getElementById('input-ean')?.focus();
  });

  // Panel OCR — añadir todos con match
  document.getElementById('btn-ocr-add-all')?.addEventListener('click', _añadirTodosOcr);

  // Modal crear SKU
  document.getElementById('btn-crear-sku-cancel')?.addEventListener('click',
    () => document.getElementById('modal-crear-sku').classList.add('hidden'));
  document.getElementById('btn-crear-sku-cancel2')?.addEventListener('click',
    () => document.getElementById('modal-crear-sku').classList.add('hidden'));
  document.getElementById('btn-crear-sku-save')?.addEventListener('click', _guardarNuevoSku);
}

/**
 * resolverEan — busca primero en caché local, luego en el API si no hay resultado.
 * Acepta: EAN-13, sku_final_code exacto, o nombre parcial.
 */
async function resolverEan(code) {
  cerrarDD();
  if (!code) return;

  // 1. Búsqueda local inmediata (EAN exacto o código exacto)
  const skuLocal = S.byEan[code]
    ?? S.skus.find(s =>
        (s.sku_final_code||s.sku_code||'').toLowerCase() === code.toLowerCase()
      );

  if (skuLocal) { abrirConv(skuLocal); $('input-ean').value = ''; return; }

  // 2. No hay match local → buscar en el API
  const dd = $('ean-dropdown');
  dd.innerHTML = `<div class="px-4 py-3 text-xs text-ink-500 flex items-center gap-2">
    <svg class="spin w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    Buscando en catálogo OMNI…
  </div>`;
  dd.classList.remove('hidden');

  try {
    const res   = await Api.skus(code, 20);
    const items = res.data?.items ?? [];

    // Añadir al caché local los resultados nuevos
    items.forEach(s => {
      S.byId[String(s.id)] = s;
      if (s.ean13) S.byEan[s.ean13] = s;
    });

    if (!items.length) {
      dd.innerHTML = `<div class="px-4 py-3 text-xs text-ink-500">
        No encontrado en el catálogo OMNI.
        <button class="ml-2 text-brand underline font-medium ocr-crear-inline"
          data-desc="${esc(code)}">Crear SKU</button>
      </div>`;
      dd.querySelector('.ocr-crear-inline')?.addEventListener('click', () => {
        $('inp-sku-nombre').value = code;
        $('inp-sku-ref').value    = '';
        $('modal-crear-sku').classList.remove('hidden');
        cerrarDD();
      });
      return;
    }

    _renderDDItems(items);

  } catch(_) {
    cerrarDD();
    toast(`Error al buscar "${code}" en el catálogo.`, 'error');
  }
}

/**
 * renderDD — muestra dropdown con resultados locales.
 * Si hay menos de 3 resultados locales, complementa con búsqueda en el API.
 */
let _ddTimer = null;
function renderDD(q) {
  clearTimeout(_ddTimer);
  if (!q || q.length < 2) { cerrarDD(); return; }

  const ql  = q.toLowerCase();
  const local = S.skus.filter(s =>
    (s.name||'').toLowerCase().includes(ql) ||
    (s.ean13||'').startsWith(q) ||
    (s.sku_final_code||s.sku_code||'').toLowerCase().startsWith(ql)
  ).slice(0, 8);

  const dd = $('ean-dropdown');

  if (local.length >= 3) {
    // Suficientes resultados locales — mostrar sin llamar al API
    _renderDDItems(local);
    return;
  }

  // Pocos o ningún resultado local → mostrar los que hay + spinner + buscar en API
  if (local.length > 0) _renderDDItems(local);
  else {
    dd.innerHTML = `<div class="px-4 py-2.5 text-xs text-ink-500 flex items-center gap-2">
      <svg class="spin w-3 h-3" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      Buscando en catálogo OMNI…
    </div>`;
    _posicionarDD();
    dd.classList.remove('hidden');
  }

  // Debounce 400ms para la llamada al API
  _ddTimer = setTimeout(async () => {
    try {
      const res   = await Api.skus(q, 10);
      const items = res.data?.items ?? [];

      // Añadir al caché local
      items.forEach(s => {
        S.byId[String(s.id)] = s;
        if (s.ean13) S.byEan[s.ean13] = s;
      });

      // Combinar con resultados locales (deduplicar por id)
      const ids    = new Set(local.map(s => String(s.id)));
      const extra  = items.filter(s => !ids.has(String(s.id)));
      const merged = [...local, ...extra].slice(0, 10);

      if (!merged.length) {
        dd.innerHTML = `<div class="px-4 py-3 text-xs text-ink-500">
          No encontrado. <button class="ml-1 text-brand underline font-medium ocr-crear-inline"
            data-desc="${esc(q)}">Crear SKU nuevo</button>
        </div>`;
        dd.classList.remove('hidden');
        dd.querySelector('.ocr-crear-inline')?.addEventListener('click', () => {
          $('inp-sku-nombre').value = q;
          $('modal-crear-sku').classList.remove('hidden');
          cerrarDD();
        });
        return;
      }

      _renderDDItems(merged);

    } catch(_) { /* silencioso: mantener lo que hay */ }
  }, 400);
}

/** Renderiza los items en el dropdown y conecta los click listeners */
function _renderDDItems(items) {
  const dd = $('ean-dropdown');
  dd.innerHTML = items.map(s => `
    <div class="dd-row flex items-center gap-3 px-4 py-2.5 cursor-pointer
      hover:bg-ink-50 border-b border-ink-100 last:border-0" data-id="${esc(String(s.id))}">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-ink-900 truncate">${esc(s.name||'—')}</p>
        <p class="text-xs text-ink-500 font-mono">
          ${esc(s.sku_final_code||s.sku_code||'—')} · ${esc(s.unit_of_measure||'—')}
          ${s.ean13 ? '· EAN ' + esc(s.ean13) : ''}
        </p>
      </div>
    </div>`).join('');
  _posicionarDD();
  dd.classList.remove('hidden');
  dd.querySelectorAll('.dd-row').forEach(el => {
    el.addEventListener('click', () => {
      const s = S.byId[el.dataset.id];
      if (s) { abrirConv(s); $('input-ean').value = ''; }
      cerrarDD();
    });
  });
}

const cerrarDD = () => $('ean-dropdown').classList.add('hidden');

/** Posiciona el dropdown fixed exactamente bajo el input EAN */
function _posicionarDD() {
  const inp  = $('input-ean');
  const dd   = $('ean-dropdown');
  if (!inp || !dd) return;
  const rect = inp.getBoundingClientRect();
  dd.style.top    = (rect.bottom + 4) + 'px';
  dd.style.left   = rect.left + 'px';
  dd.style.width  = rect.width + 'px';
}
const cerrarConv = () => { $('conv-panel').classList.add('hidden'); $('input-ean').value=''; $('input-ean').focus(); };

function abrirConv(sku) {
  const ub=(sku.unit_of_measure||'ud').toLowerCase();
  // v6.6.0: campo correcto es sku_final_code
  const skuCode = sku.sku_final_code || sku.sku_code || '—';
  const ps = parseInt(sku.pack_size || 1, 10);
  $('conv-nombre').textContent = sku.name||'—';
  // §20: mostrar unidad + pack_size si aplica
  const ubLabel = (ub === 'ud' && ps > 1)
    ? `ud (${ps >= 1000 ? (ps/1000).toFixed(0)+' kg' : ps+' g'} / unidad)`
    : ub;
  $('conv-meta').textContent   = `SKU: ${skuCode} · ${esc(ubLabel)} · EAN: ${sku.ean13||'—'}`;
  $('hid-sku-id').value   = sku.id||'';
  $('hid-sku-ean').value  = sku.ean13||'';
  $('hid-sku-ub').value   = ub;
  $('hid-sku-name').value = sku.name||'';
  if ($('hid-sku-ps')) $('hid-sku-ps').value = String(ps);
  // sel-uc está oculto pero necesita valor para compatibilidad con convertir()
  const sel = $('sel-uc');
  sel.innerHTML = `<option value="${ub}">${ub}</option>`;
  sel.value = ub;

  // Etiqueta y hint según §20
  const qtyLabel = $('conv-qty-label');
  const qtyHint  = $('conv-qty-hint');
  if (qtyLabel) {
    if (ub === 'ud' && ps > 1) {
      const pkLabel = ps >= 1000 ? (ps/1000).toFixed(0) + ' kg' : ps + ' g';
      qtyLabel.textContent = `(bolsas/unidades de ${pkLabel})`;
      if (qtyHint) qtyHint.innerHTML =
        `<span class="font-medium text-ink-700">Introduce cuántas unidades físicas.</span><br>` +
        `Cada unidad pesa <strong>${pkLabel}</strong>. El peso total se calcula automáticamente.`;
    } else if (ub === 'g') {
      qtyLabel.textContent = '(gramos)';
      if (qtyHint) qtyHint.innerHTML =
        `Introduce la cantidad en <strong>gramos</strong>.<br>` +
        `Puedes escribir 1000 para 1 kg, 25000 para 25 kg, etc.`;
    } else if (ub === 'ml') {
      qtyLabel.textContent = '(mililitros)';
      if (qtyHint) qtyHint.innerHTML =
        `Introduce la cantidad en <strong>mililitros</strong>.<br>` +
        `1 litro = 1000 ml.`;
    } else {
      qtyLabel.textContent = '(unidades)';
      if (qtyHint) qtyHint.textContent = 'Introduce el número de unidades.';
    }
  }

  // Pre-rellenar desde OCR si viene de "Buscar"
  const eanInp = $('input-ean');
  $('inp-lote').value  = eanInp?.dataset.ocrLote  || genLote();
  $('inp-vence').value = eanInp?.dataset.ocrVence || '';
  $('inp-qty').value   = '';
  if (eanInp) { delete eanInp.dataset.ocrLote; delete eanInp.dataset.ocrVence; delete eanInp.dataset.ocrCant; }

  // Ocultar resultado hasta que el usuario escriba
  $('conv-peso-total')?.classList.add('hidden');
  $('conv-panel').classList.remove('hidden');
  setTimeout(() => $('inp-qty').focus(), 80);
}

function actualizarConv() {
  const val = $('inp-qty').value;
  const ub  = $('hid-sku-ub').value || 'ud';
  const ps  = parseInt($('hid-sku-ps')?.value || '1', 10);
  const qty = parseFloat(val);
  const pesoEl = $('conv-peso-total');

  if (!pesoEl) return;

  // Solo mostrar el peso total cuando es ud con pack_size > 1 (§20 BRAUNGEL FRIO)
  if (qty > 0 && ub === 'ud' && ps > 1) {
    const totalG = Math.round(qty) * ps;
    const kgStr  = totalG >= 1000 ? (totalG/1000).toFixed(2) + ' kg' : totalG + ' g';
    const psStr  = ps >= 1000 ? (ps/1000) + ' kg' : ps + ' g';
    pesoEl.textContent = `Total: ${kgStr} (${Math.round(qty)} × ${psStr})`;
    pesoEl.classList.remove('hidden');
  } else {
    pesoEl.classList.add('hidden');
  }
}

function añadirItem() {
  const qty=parseFloat($('inp-qty').value), ub=$('hid-sku-ub').value, uc=ub; // §20: uc=ub (sin selector de formato)
  const lote=$('inp-lote').value.trim(), vence=$('inp-vence').value;
  if (!qty||qty<=0)              {toast('Cantidad > 0','warn');return;}
  if (!lote)                     {toast('Código de lote obligatorio.','warn');return;}
  if (!vence)                    {toast('Fecha de vencimiento obligatoria.','warn');return;}
  if (new Date(vence)<=new Date()){toast('Fecha de vencimiento inválida.','warn');return;}

  const ps2 = parseInt($('hid-sku-ps')?.value || '1', 10);
  const quantityFinal = convertir(qty, ub, uc);
  S.items.push({
    skuId:         parseInt($('hid-sku-id').value,10),
    ean:           $('hid-sku-ean').value,
    nombre:        $('hid-sku-name').value,
    unidadBase:    ub,
    packSize:      ps2,
    quantity:      quantityFinal,
    batchRef:      lote,
    expDate:       vence,
    // §20: labelComercial muestra cantidad legible con peso total si pack_size > 1
    labelComercial: formatQuantity(quantityFinal, { unit_of_measure: ub, pack_size: ps2 }),
  });
  renderItemsTable(); cerrarConv();
  toast(`"${$('hid-sku-name').value}" añadido.`,'ok');
}

function renderItemsTable() {
  const tbody=$('items-tbody'), wrap=$('items-table-wrap');
  const badge=$('item-count-badge'), btnNext=$('btn-step3-next');
  badge.textContent=S.items.length; badge.classList.toggle('hidden',S.items.length===0);
  btnNext.disabled=S.items.length===0;
  if (!S.items.length){wrap.classList.add('hidden');return;}
  wrap.classList.remove('hidden'); $('items-count').textContent=S.items.length;
  tbody.innerHTML='';
  S.items.forEach((it,idx)=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><p class="font-medium text-ink-900">${esc(it.nombre)}</p><p class="text-xs text-ink-400 font-mono mt-0.5">${esc(it.labelComercial)}</p></td><td class="text-right font-mono font-semibold text-ink-900">${formatQuantity(it.quantity, {unit_of_measure:it.unidadBase, pack_size:it.packSize||1})}</td><td class="font-mono text-xs text-ink-600">${esc(it.batchRef)}</td><td class="text-ink-600">${fmtDate(it.expDate)}</td><td><button class="del-item text-ink-400 hover:text-danger transition-colors p-1" data-idx="${idx}"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.del-item').forEach(b=>b.addEventListener('click',()=>{
    S.items.splice(parseInt(b.dataset.idx),1);renderItemsTable();
  }));
}

/* ══════════════════════════════════════════════════════
   12. PASO 4 — Resumen y confirmación
   Flujo v6.6.0: purchasing_order → purchasing_order_line → receive (batch inline)
══════════════════════════════════════════════════════ */
function rellenarResumen() {
  $('sum-num-albaran').textContent=S.numAlbaran;
  $('sum-proveedor').textContent=S.proveedorNom||`ID ${S.proveedorId}`;
  $('sum-ubicacion').textContent=S.bodegaNom||'Sin asignar';
  const tbody=$('summary-tbody'); tbody.innerHTML='';
  S.items.forEach(it=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td><p class="font-medium text-ink-900">${esc(it.nombre)}</p><p class="text-xs text-ink-400 font-mono">${esc(it.labelComercial)} → ${it.quantity.toLocaleString('es-ES')} ${esc(it.unidadBase)}</p></td><td class="text-right font-mono font-semibold">${formatQuantity(it.quantity, {unit_of_measure:it.unidadBase, pack_size:it.packSize||1})}</td><td class="text-ink-600">${fmtDate(it.expDate)}</td>`;
    tbody.appendChild(tr);
  });
  if (S.docB64) {
    $('sum-doc-wrap').classList.remove('hidden');
    if (S.docB64.startsWith('data:image')) {
      $('sum-doc-img').src=S.docB64; $('sum-doc-img').classList.remove('hidden'); $('sum-doc-pdf').classList.add('hidden');
    } else {
      $('sum-doc-nom').textContent=S.docNombre??'documento.pdf';
      $('sum-doc-pdf').classList.remove('hidden'); $('sum-doc-img').classList.add('hidden');
    }
  } else $('sum-doc-wrap').classList.add('hidden');
  $('confirm-error').classList.add('hidden');
}

function initStep4() {
  $('btn-step4-back').addEventListener('click',()=>goStep(3));

  $('btn-confirm').addEventListener('click', async () => {
    const btn=$('btn-confirm'), label=$('btn-confirm-label'), spin=$('btn-confirm-spin');
    const errEl=$('confirm-error');
    btn.disabled=true; label.textContent='Registrando…'; spin.classList.remove('hidden');
    errEl.classList.add('hidden');

    try {
      // ── PASO A: Crear orden de compra con todas las líneas inline
      // POST /purchasing/orders { supplier_id, details:[{supplier_item_id, quantity_requested, unit_price}] }
      // Nota: supplier_item_id = SKU id del catálogo; si no existe en supplier-items se pasa item_id
      const orderRes = await Api.purchasingOrder({
        supplier_id: S.proveedorId,
        details: S.items.map(item => ({
          supplier_item_id:    item.skuId,
          quantity_requested:  item.quantity,
          unit_price:          0,
        })),
        notes: S.numAlbaran,
      });
      const orderId = orderRes.data?.order?.id ?? orderRes.data?.id;
      S.purchaseOrderId = orderId;

      // ── PASO B: Aprobar la orden
      if (orderId) {
        await Api.approvePurchasingOrder(orderId).catch(() => {});
      }

      // ── PASO C: Recepción física en almacén por cada ítem (batch inline)
      for (const item of S.items) {
        await Api.receive({
          location_id:        S.bodegaId || 1,
          item_id:            item.skuId,
          item_type:          'sku',
          batch: {
            batch_reference: item.batchRef,
            expiration_date: item.expDate,
            cost_per_unit:   0,
          },
          quantity:           item.quantity,
          movement_type:      'Compra',
          reference_document: S.numAlbaran,
        });
      }

      // Éxito
      $('success-msg').textContent=`Albarán ${S.numAlbaran} — ${S.items.length} producto${S.items.length!==1?'s':''} ingresado${S.items.length!==1?'s':''} en el kardex.`;
      [1,2,3,4].forEach(i=>$(`step-${i}`)?.classList.add('hidden'));
      $('step-success').classList.remove('hidden');

    } catch (err) {
      // Propagar error_code OMNI con mensaje útil
      let msg = err.error ?? 'Error al registrar.';
      if (err.code === 'ERR_STOCK')     msg = 'Stock insuficiente para esta operación.';
      if (err.code === 'ERR_KARDEX')    msg = 'Tipo de movimiento no permitido en el Kardex.';
      if (err.code === 'ERR_DUPLICATE') msg = 'Este albarán ya fue registrado anteriormente.';
      if (err.code === 'ERR_AUTH')      { _logout(); return; }
      errEl.classList.remove('hidden');
      $('confirm-error-msg').textContent = msg;
    } finally {
      btn.disabled=false; label.textContent='Registrar albarán'; spin.classList.add('hidden');
    }
  });
}

/* ══════════════════════════════════════════════════════
   13. RESET + LOGOUT
══════════════════════════════════════════════════════ */
function resetFormulario() {
  S.docB64=null; S.docNombre=null; S.ocrData=null; S.purchaseOrderId=null;
  S.numAlbaran=''; S.proveedorId=0; S.bodegaId=0; S.items=[];
  $('file-input').value=''; $('inp-num-albaran').value=''; $('sel-proveedor').value='';
  $('input-ean').value='';
  $('dz-idle').classList.remove('hidden'); $('dz-preview').classList.add('hidden');
  $('btn-clear-doc').classList.add('hidden'); $('btn-step1-next').disabled=true;
  $('conv-panel').classList.add('hidden'); $('items-table-wrap').classList.add('hidden');
  $('items-tbody').innerHTML=''; $('btn-step3-next').disabled=true;
  $('item-count-badge').classList.add('hidden');
  $('ocr-panel').classList.add('hidden');
  poblarSelectBodega();
  goStep(1);
}

function _logout() {
  Api.clearSession(); S.user=null; S.interlocutorId=0; S.sedePrincipalId=0;
  resetFormulario(); showView('view-login');
}

/* ══════════════════════════════════════════════════════
   14. BOOTSTRAP
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  $('btn-logout').addEventListener('click', _logout);
  $('btn-nuevo').addEventListener('click',  resetFormulario);
  initSedeView();
  initStep1(); initStep2(); initStep3(); initStep4();

  if (Api._token) {  // iid puede ser 0 si el API devuelve interlocutor_id: null
    S.interlocutorId=Api._iid; S.sedePrincipalId=Api._iid;
    try {
      const pay=JSON.parse(atob(Api._token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      $('hdr-nombre').textContent = pay.username||pay.nombre||'—';
      $('hdr-sede').textContent   = pay.interlocutor_name||pay.sede||`Sede ${S.interlocutorId}`;
    } catch(_) {}
    cargarCatalogos().then(()=>{
      showView('view-app'); goStep(1);
      $('lbl-fecha').textContent=new Date().toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    });
  } else {
    showView('view-login');
    initLoginView();
    return;
  }
  // (initLoginView se llama solo en el else — no duplicar)
});
