/**
 * JOSEPAN 360 · OMNI · [1002] Albaranes de Compras
 * app.js  (v6.0 — Proxy PHP OmniCoreClient)
 *
 * Llama ÚNICAMENTE a api/omni.php (mismo servidor).
 * PHP hace las peticiones cURL al API CORE → cero CORS.
 *
 * Contratos del API CORE v6.2 (via proxy):
 *  Login        POST ?action=login         {username, password, interlocutor_id}
 *  Interlocutors GET  ?action=interlocutors[&type=distribuidor]
 *  SKUs          GET  ?action=skus
 *  Locations     GET  ?action=locations
 *  Crear lote    POST ?action=batch
 *  Recepción     POST ?action=receive
 */

'use strict';

/* ══════════════════════════════════════════════════════
   1. CLIENTE HTTP → api/omni.php
══════════════════════════════════════════════════════ */
const Api = {
  _base: 'api/omni.php',
  _token: localStorage.getItem('omni_token') || '',
  _interlocutorId: parseInt(localStorage.getItem('omni_iid') || '0', 10),

  setSession(token, interlocutorId) {
    this._token         = token;
    this._interlocutorId = interlocutorId;
    localStorage.setItem('omni_token', token);
    localStorage.setItem('omni_iid',   String(interlocutorId));
  },

  clearSession() {
    this._token = '';
    this._interlocutorId = 0;
    localStorage.removeItem('omni_token');
    localStorage.removeItem('omni_iid');
  },

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token)          h['Authorization']     = `Bearer ${this._token}`;
    if (this._interlocutorId) h['X-Interlocutor-Id'] = String(this._interlocutorId);
    return h;
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
      throw { error: 'Sin conexión con el servidor.', code: 'ERR_NETWORK' };
    }
    const data = await res.json().catch(() => ({ ok: false, error: `Error HTTP ${res.status}` }));
    if (data.ok === false || !res.ok) {
      throw { error: data.error || `Error ${res.status}`, code: data.code || `HTTP_${res.status}`, status: res.status };
    }
    return data;
  },

  login:         (username, password, interlocutor_id) =>
    Api._call('POST', { action: 'login' }, { username, password, interlocutor_id }),

  interlocutors: (type = '') =>
    Api._call('GET',  { action: 'interlocutors', ...(type ? { type } : {}) }),

  skus:          (q = '', limit = 500) =>
    Api._call('GET',  { action: 'skus', limit, offset: 0, ...(q ? { q } : {}) }),

  locations:     () =>
    Api._call('GET',  { action: 'locations' }),

  batch:         (body) => Api._call('POST', { action: 'batch' },   body),
  receive:       (body) => Api._call('POST', { action: 'receive' }, body),
};

/* ══════════════════════════════════════════════════════
   2. ESTADO
══════════════════════════════════════════════════════ */
const S = {
  /* Sesión */
  user:           null,
  interlocutorId: Api._interlocutorId,

  /* Catálogos */
  interlocutors: [],
  skus:          [],
  locations:     [],
  byEan:         {},
  byId:          {},

  /* Formulario en curso */
  docB64:    null,
  docNombre: null,
  numAlbaran:'',
  proveedorId:  0,
  proveedorNom: '',
  ubicacionId:  0,
  ubicacionNom: '',
  items:     [],   // [{ skuId, ean, nombre, unidadBase, quantity, batchRef, expDate, labelComercial }]

  step: 1,
};

/* ══════════════════════════════════════════════════════
   3. CONVERSIÓN METROLÓGICA
══════════════════════════════════════════════════════ */
const FACTORES = {
  g:  { g:1, '100g':100, '500g':500, kg:1000, '5kg':5000, '25kg':25000, '50kg':50000, t:1000000 },
  ml: { ml:1, cl:10, '200ml':200, '500ml':500, l:1000, '5l':5000, '20l':20000 },
  ud: { ud:1, cj6:6, cj12:12, cj24:24, cj48:48 },
};
const UC_OPTS = {
  g:  [{v:'g',l:'Gramos (g)'},{v:'100g',l:'Sobre 100 g'},{v:'500g',l:'Bolsa 500 g'},{v:'kg',l:'Kilogramo (1 kg)'},{v:'5kg',l:'Saco 5 kg'},{v:'25kg',l:'Saco 25 kg'},{v:'50kg',l:'Saco 50 kg'},{v:'t',l:'Tonelada'}],
  ml: [{v:'ml',l:'Mililitros (ml)'},{v:'cl',l:'Centilitros'},{v:'200ml',l:'Botella 200 ml'},{v:'500ml',l:'Botella 500 ml'},{v:'l',l:'Litro (L)'},{v:'5l',l:'Garrafa 5 L'},{v:'20l',l:'Bidón 20 L'}],
  ud: [{v:'ud',l:'Unidad suelta'},{v:'cj6',l:'Caja × 6'},{v:'cj12',l:'Caja × 12'},{v:'cj24',l:'Caja × 24'},{v:'cj48',l:'Caja × 48'}],
};
const convertir = (val, ub, uc) =>
  Math.round((parseFloat(val) || 0) * (FACTORES[ub]?.[uc] ?? 1));

/* ══════════════════════════════════════════════════════
   4. UTILIDADES
══════════════════════════════════════════════════════ */
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const $  = id => document.getElementById(id);
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-ES') : '—';
const genLote = () => {
  const d = new Date();
  return `LOT-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
};

/* ══════════════════════════════════════════════════════
   5. TOAST
══════════════════════════════════════════════════════ */
let _toastTimer;
function toast(msg, type = 'ok') {
  const el  = $('toast');
  const colors = { ok: 'bg-ok', error: 'bg-danger', warn: 'bg-warn' };
  const icons  = { ok: '✓', error: '✕', warn: '⚠' };
  el.className = el.className.replace(/bg-\w+/g, '');
  el.classList.add(colors[type] ?? 'bg-ok');
  $('toast-icon').textContent = icons[type] ?? '✓';
  $('toast-msg').textContent  = msg;
  el.classList.remove('hide');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hide'), 3000);
}

/* ══════════════════════════════════════════════════════
   6. NAVEGACIÓN ENTRE VISTAS Y PASOS
══════════════════════════════════════════════════════ */
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(id).classList.add('active');
}

function goStep(n) {
  S.step = n;
  [1,2,3,4].forEach(i => {
    const c = $(`step-${i}`);
    const circle = $(`step${i}-circle`);
    const label  = $(`step${i}-label`);
    if (!c) return;

    // Mostrar/ocultar paneles
    if (i === n) c.classList.remove('hidden');
    else         c.classList.add('hidden');

    // Step indicator
    if (i < n) {
      circle.className = circle.className.replace('bg-ink-200 text-ink-500','').replace('bg-brand text-white','');
      circle.classList.add('bg-ok','text-white');
      circle.innerHTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>`;
      label?.classList.remove('text-ink-400'); label?.classList.add('text-ok');
      $(`line-${i}-${i+1}`)?.classList.add('done');
    } else if (i === n) {
      circle.className = circle.className.replace('bg-ink-200 text-ink-500','').replace('bg-ok text-white','');
      circle.classList.add('bg-brand','text-white');
      circle.textContent = i;
      label?.classList.remove('text-ink-400','text-ok'); label?.classList.add('text-ink-900');
    } else {
      circle.className = circle.className.replace('bg-brand text-white','').replace('bg-ok text-white','');
      circle.classList.add('bg-ink-200','text-ink-500');
      circle.textContent = i;
      label?.classList.remove('text-ink-900','text-ok'); label?.classList.add('text-ink-400');
      if (i > 1) $(`line-${i-1}-${i}`)?.classList.remove('done');
    }
  });

  // Ocultar success si aparece
  $('step-success')?.classList.add('hidden');
}

/* ══════════════════════════════════════════════════════
   7. LOGIN
══════════════════════════════════════════════════════ */
async function initLoginView() {
  // Cargar sedes (interlocutors tipo empresa/fabrica) sin token — petición pública
  // En el API v6 el login necesita interlocutor_id, así que primero cargamos las fábricas
  // usando una petición sin auth. Si el endpoint requiere auth, mostramos un campo manual.
  try {
    const res = await Api.interlocutors('fabrica');
    const items = res.data?.items ?? [];
    const sel = $('sel-sede');
    sel.innerHTML = '<option value="">— Seleccionar sede —</option>';
    items.forEach(i => {
      const o = document.createElement('option');
      o.value       = i.id;
      o.textContent = i.commercial_name || i.fiscal_name || `Sede ${i.id}`;
      sel.appendChild(o);
    });
  } catch(_) {
    // Si no carga sin auth, permitir entrada manual del ID
    const sel = $('sel-sede');
    sel.innerHTML = '';
    sel.insertAdjacentHTML('beforeend',
      '<option value="">— Sin conexión previa —</option>' +
      '<option value="1">Fábrica 1 - Majadahonda</option>'
    );
  }

  // Toggle password
  $('btn-toggle-pass').addEventListener('click', () => {
    const inp = $('inp-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Enter avanza campos
  $('inp-username').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('inp-password').focus(); }
  });
  $('inp-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('sel-sede').focus(); }
  });

  $('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const username      = $('inp-username').value.trim();
    const password      = $('inp-password').value;
    const interlocId    = parseInt($('sel-sede').value || '0', 10);
    const errEl         = $('login-error');
    const btn           = $('btn-login');

    errEl.classList.add('hidden');

    if (!username || !password) {
      errEl.textContent = 'Usuario y contraseña son obligatorios.';
      errEl.classList.remove('hidden'); return;
    }
    if (!interlocId) {
      errEl.textContent = 'Selecciona la sede antes de entrar.';
      errEl.classList.remove('hidden'); return;
    }

    btn.disabled = true;
    $('btn-login-label').textContent = 'Verificando…';
    $('btn-login-spin').classList.remove('hidden');

    try {
      const res = await Api.login(username, password, interlocId);
      const token = res.data?.token;
      const user  = res.data?.user ?? {};

      Api.setSession(token, interlocId);
      S.user           = user;
      S.interlocutorId = interlocId;

      // Header
      $('hdr-nombre').textContent = user.nombre || user.full_name || username;
      $('hdr-sede').textContent   = user.tienda  || user.sede      || `Sede ${interlocId}`;

      // Actualizar timestamp
      $('lbl-fecha').textContent = new Date().toLocaleString('es-ES', {
        day:'2-digit', month:'2-digit', year:'numeric',
        hour:'2-digit', minute:'2-digit'
      });

      await cargarCatalogos();
      showView('view-app');
      goStep(1);

    } catch (err) {
      errEl.textContent =
        err.code === 'ERR_NETWORK' ? 'Sin conexión con el servidor.' :
        err.status === 401         ? 'Usuario o contraseña incorrectos.' :
        err.error  || 'Error al iniciar sesión.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      $('btn-login-label').textContent = 'Entrar';
      $('btn-login-spin').classList.add('hidden');
    }
  });
}

/* ══════════════════════════════════════════════════════
   8. CATÁLOGOS
══════════════════════════════════════════════════════ */
async function cargarCatalogos() {
  try {
    const [skusRes, locsRes, intRes] = await Promise.all([
      Api.skus(), Api.locations(), Api.interlocutors('distribuidor'),
    ]);

    // SKUs
    S.skus  = skusRes.data?.items  ?? [];
    S.byEan = {};
    S.byId  = {};
    S.skus.forEach(s => {
      if (s.ean13)    S.byEan[s.ean13]      = s;
      if (s.ean)      S.byEan[s.ean]        = s;
      if (s.id)       S.byId[String(s.id)]  = s;
    });

    // Ubicaciones
    S.locations = locsRes.data?.items ?? [];
    const selUbic = $('sel-ubicacion');
    selUbic.innerHTML = '<option value="">— Sin asignar —</option>';
    S.locations.forEach(l => {
      const o = document.createElement('option');
      o.value       = l.id;
      o.textContent = `${l.area_type || ''} ${l.position || ''}`.trim() || `Ubicación ${l.id}`;
      selUbic.appendChild(o);
    });

    // Proveedores (distribuidores)
    S.interlocutors = intRes.data?.items ?? [];
    const selProv = $('sel-proveedor');
    selProv.innerHTML = '<option value="">— Seleccionar —</option>';
    S.interlocutors.forEach(i => {
      const o = document.createElement('option');
      o.value       = i.id;
      o.textContent = i.commercial_name || i.fiscal_name || `Proveedor ${i.id}`;
      selProv.appendChild(o);
    });

  } catch (err) {
    console.warn('[1002] Error cargando catálogos:', err.error ?? err);
  }
}

/* ══════════════════════════════════════════════════════
   9. PASO 1 — Documento
══════════════════════════════════════════════════════ */
function initStep1() {
  const fi  = $('file-input');
  const dz  = $('drop-zone');
  const btn = $('btn-step1-next');

  fi.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) cargarDoc(f); });
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('border-brand','bg-brand/5'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('border-brand','bg-brand/5'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('border-brand','bg-brand/5');
    const f = e.dataTransfer?.files?.[0]; if (f) cargarDoc(f);
  });

  $('btn-clear-doc').addEventListener('click', () => {
    S.docB64 = null; S.docNombre = null;
    fi.value = '';
    $('dz-idle').classList.remove('hidden');
    $('dz-preview').classList.add('hidden');
    $('btn-clear-doc').classList.add('hidden');
    btn.disabled = true;
  });

  btn.addEventListener('click', () => goStep(2));
}

function cargarDoc(file) {
  const r = new FileReader();
  r.onload = e => {
    S.docB64    = e.target.result;
    S.docNombre = file.name;
    $('dz-idle').classList.add('hidden');
    $('dz-preview').classList.remove('hidden');
    if (file.type.startsWith('image/')) {
      $('prev-img').src = S.docB64; $('prev-img').classList.remove('hidden'); $('prev-pdf').classList.add('hidden');
    } else {
      $('prev-nom').textContent = file.name; $('prev-pdf').classList.remove('hidden'); $('prev-img').classList.add('hidden');
    }
    $('btn-clear-doc').classList.remove('hidden');
    $('btn-step1-next').disabled = false;
  };
  r.readAsDataURL(file);
}

/* ══════════════════════════════════════════════════════
   10. PASO 2 — Cabecera del albarán
══════════════════════════════════════════════════════ */
function initStep2() {
  $('btn-step2-back').addEventListener('click', () => goStep(1));

  $('btn-step2-next').addEventListener('click', () => {
    const num  = $('inp-num-albaran').value.trim();
    const prov = $('sel-proveedor').value;
    if (!num)  { toast('Introduce el número de albarán.', 'warn'); return; }
    if (!prov) { toast('Selecciona el proveedor.', 'warn'); return; }

    S.numAlbaran  = num;
    S.proveedorId = parseInt(prov, 10);
    S.proveedorNom = $('sel-proveedor').selectedOptions[0]?.text ?? '';
    S.ubicacionId  = parseInt($('sel-ubicacion').value || '0', 10);
    S.ubicacionNom = $('sel-ubicacion').selectedOptions[0]?.text ?? 'Sin asignar';

    goStep(3);
    setTimeout(() => $('input-ean')?.focus(), 200);
  });
}

/* ══════════════════════════════════════════════════════
   11. PASO 3 — Escanear productos
══════════════════════════════════════════════════════ */
function initStep3() {
  $('btn-step3-back').addEventListener('click', () => goStep(2));
  $('btn-step3-next').addEventListener('click', () => {
    if (!S.items.length) { toast('Añade al menos un producto.', 'warn'); return; }
    rellenarResumen();
    goStep(4);
  });

  const ean = $('input-ean');
  ean.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); resolverEan(ean.value.trim()); }
  });
  $('btn-scan').addEventListener('click', () => resolverEan(ean.value.trim()));

  let _dt = null;
  ean.addEventListener('input', e => {
    clearTimeout(_dt);
    const q = e.target.value.trim();
    if (q.length < 2) { cerrarDD(); return; }
    _dt = setTimeout(() => renderDD(q), 200);
  });

  $('inp-qty').addEventListener('input', actualizarConv);
  $('sel-uc').addEventListener('change',  actualizarConv);
  $('btn-add-item').addEventListener('click', añadirItem);
  $('btn-conv-cancel').addEventListener('click', cerrarConv);

  document.addEventListener('click', e => {
    if (!$('ean-wrap')?.contains(e.target)) cerrarDD();
  });
}

function resolverEan(code) {
  cerrarDD();
  if (!code) return;
  const sku = S.byEan[code] ?? S.skus.find(s =>
    (s.sku_code ?? '').toLowerCase() === code.toLowerCase() ||
    (s.name     ?? '').toLowerCase().includes(code.toLowerCase())
  );
  if (sku) { abrirConv(sku); $('input-ean').value = ''; }
  else     toast(`"${code}" no encontrado en el catálogo.`, 'error');
}

function renderDD(q) {
  const ql  = q.toLowerCase();
  const res = S.skus.filter(s =>
    (s.name     ?? '').toLowerCase().includes(ql) ||
    (s.ean13    ?? '').startsWith(q) ||
    (s.sku_code ?? '').toLowerCase().startsWith(ql)
  ).slice(0, 8);

  const dd = $('ean-dropdown');
  if (!res.length) { cerrarDD(); return; }
  dd.innerHTML = res.map(s => `
    <div class="dd-row flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-ink-50 border-b border-ink-100 last:border-0"
         data-id="${esc(s.id)}">
      <div class="min-w-0">
        <p class="text-sm font-medium text-ink-900 truncate">${esc(s.name ?? '—')}</p>
        <p class="text-xs text-ink-500 font-mono">${esc(s.sku_code ?? '')} · EAN ${esc(s.ean13 ?? '—')} · ${esc(s.unit_of_measure ?? '—')}</p>
      </div>
    </div>`).join('');
  dd.classList.remove('hidden');
  dd.querySelectorAll('.dd-row').forEach(el => {
    el.addEventListener('click', () => {
      const s = S.byId[el.dataset.id];
      if (s) { abrirConv(s); $('input-ean').value = ''; }
      cerrarDD();
    });
  });
}

const cerrarDD  = () => $('ean-dropdown').classList.add('hidden');
const cerrarConv = () => {
  $('conv-panel').classList.add('hidden');
  $('input-ean').value = '';
  $('input-ean').focus();
};

function abrirConv(sku) {
  const ub = (sku.unit_of_measure ?? 'ud').toLowerCase();
  $('conv-nombre').textContent = sku.name ?? '—';
  $('conv-meta').textContent   = `SKU: ${sku.sku_code ?? '—'} · EAN: ${sku.ean13 ?? '—'} · Base: ${ub}`;
  $('hid-sku-id').value   = sku.id ?? '';
  $('hid-sku-ean').value  = sku.ean13 ?? '';
  $('hid-sku-ub').value   = ub;
  $('hid-sku-name').value = sku.name ?? '';

  const sel  = $('sel-uc');
  sel.innerHTML = (UC_OPTS[ub] ?? UC_OPTS.ud).map(o => `<option value="${o.v}">${o.l}</option>`).join('');
  sel.value = ub;

  $('inp-lote').value  = genLote();
  $('inp-vence').value = '';
  $('inp-qty').value   = '';
  $('conv-res').textContent    = '—';
  $('conv-res-ub').textContent = ub;
  $('conv-panel').classList.remove('hidden');
  setTimeout(() => $('inp-qty').focus(), 80);
}

function actualizarConv() {
  const qty  = $('inp-qty').value;
  const uc   = $('sel-uc').value;
  const ub   = $('hid-sku-ub').value;
  const base = convertir(qty, ub, uc);
  $('conv-res').textContent = (qty && parseFloat(qty) > 0) ? base.toLocaleString('es-ES') : '—';
}

function añadirItem() {
  const qty   = parseFloat($('inp-qty').value);
  const uc    = $('sel-uc').value;
  const ub    = $('hid-sku-ub').value;
  const lote  = $('inp-lote').value.trim();
  const vence = $('inp-vence').value;

  if (!qty || qty <= 0)         { toast('La cantidad debe ser mayor que cero.', 'warn'); return; }
  if (!lote)                    { toast('El código de lote es obligatorio.', 'warn'); return; }
  if (!vence)                   { toast('La fecha de vencimiento es obligatoria.', 'warn'); return; }
  if (new Date(vence) <= new Date()) { toast('La fecha de vencimiento no puede ser anterior o igual a hoy.', 'warn'); return; }

  const quantity = convertir(qty, ub, uc);
  S.items.push({
    skuId:         parseInt($('hid-sku-id').value, 10),
    ean:           $('hid-sku-ean').value,
    nombre:        $('hid-sku-name').value,
    unidadBase:    ub,
    quantity,
    batchRef:      lote,
    expDate:       vence,
    labelComercial: `${qty} ${uc}`,
  });

  renderItemsTable();
  cerrarConv();
  toast(`"${$('hid-sku-name').value}" añadido.`, 'ok');
}

function renderItemsTable() {
  const tbody = $('items-tbody');
  const wrap  = $('items-table-wrap');
  const badge = $('item-count-badge');
  const btnNext = $('btn-step3-next');

  badge.textContent = S.items.length;
  badge.classList.toggle('hidden', S.items.length === 0);
  btnNext.disabled  = S.items.length === 0;

  if (!S.items.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  $('items-count').textContent = S.items.length;

  tbody.innerHTML = '';
  S.items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <p class="font-medium text-ink-900">${esc(it.nombre)}</p>
        <p class="text-xs text-ink-400 font-mono mt-0.5">${esc(it.labelComercial)}</p>
      </td>
      <td class="text-right font-mono font-semibold text-ink-900">
        ${it.quantity.toLocaleString('es-ES')} ${esc(it.unidadBase)}
      </td>
      <td class="font-mono text-xs text-ink-600">${esc(it.batchRef)}</td>
      <td class="text-ink-600">${fmtDate(it.expDate)}</td>
      <td>
        <button class="del-item text-ink-400 hover:text-danger transition-colors p-1" data-idx="${idx}">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/>
          </svg>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.del-item').forEach(btn => {
    btn.addEventListener('click', () => {
      S.items.splice(parseInt(btn.dataset.idx), 1);
      renderItemsTable();
    });
  });
}

/* ══════════════════════════════════════════════════════
   12. PASO 4 — Resumen y confirmación
══════════════════════════════════════════════════════ */
function rellenarResumen() {
  $('sum-num-albaran').textContent = S.numAlbaran;
  $('sum-proveedor').textContent   = S.proveedorNom || `ID ${S.proveedorId}`;
  $('sum-ubicacion').textContent   = S.ubicacionNom;

  // Tabla resumen
  const tbody = $('summary-tbody');
  tbody.innerHTML = '';
  S.items.forEach(it => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <p class="font-medium text-ink-900">${esc(it.nombre)}</p>
        <p class="text-xs text-ink-400 font-mono">${esc(it.labelComercial)} → ${it.quantity.toLocaleString('es-ES')} ${esc(it.unidadBase)}</p>
      </td>
      <td class="text-right font-mono font-semibold">${it.quantity.toLocaleString('es-ES')} ${esc(it.unidadBase)}</td>
      <td class="text-ink-600">${fmtDate(it.expDate)}</td>`;
    tbody.appendChild(tr);
  });

  // Documento adjunto
  if (S.docB64) {
    $('sum-doc-wrap').classList.remove('hidden');
    if (S.docB64.startsWith('data:image')) {
      $('sum-doc-img').src = S.docB64; $('sum-doc-img').classList.remove('hidden'); $('sum-doc-pdf').classList.add('hidden');
    } else {
      $('sum-doc-nom').textContent = S.docNombre ?? 'documento.pdf';
      $('sum-doc-pdf').classList.remove('hidden'); $('sum-doc-img').classList.add('hidden');
    }
  } else {
    $('sum-doc-wrap').classList.add('hidden');
  }

  $('confirm-error').classList.add('hidden');
}

function initStep4() {
  $('btn-step4-back').addEventListener('click', () => goStep(3));

  $('btn-confirm').addEventListener('click', async () => {
    const btn   = $('btn-confirm');
    const label = $('btn-confirm-label');
    const spin  = $('btn-confirm-spin');
    const errEl = $('confirm-error');

    btn.disabled = true;
    label.textContent = 'Registrando…';
    spin.classList.remove('hidden');
    errEl.classList.add('hidden');

    try {
      // Por cada ítem: crear lote → recepción
      for (const item of S.items) {

        // 1. Crear lote
        const batchRes = await Api.batch({
          batch_reference: item.batchRef,
          item_id:         item.skuId,
          item_type:       'sku',
          expiration_date: item.expDate,
          cost_per_unit:   0,
        });

        const batchId = batchRes.data?.batch?.id
          ?? batchRes.data?.batch?.batch_id
          ?? batchRes.data?.id;

        if (!batchId) throw { error: `Lote creado sin ID para "${item.nombre}".` };

        // 2. Registrar recepción
        await Api.receive({
          location_id:        S.ubicacionId || 1,
          batch_id:           batchId,
          item_id:            item.skuId,
          item_type:          'sku',
          quantity:           item.quantity,
          movement_type:      'Compra',
          reference_document: S.numAlbaran,
        });
      }

      // Todo OK → éxito
      $('success-msg').textContent =
        `Albarán ${S.numAlbaran} — ${S.items.length} producto${S.items.length !== 1 ? 's' : ''} ingresado${S.items.length !== 1 ? 's' : ''} en el kardex.`;
      [1,2,3,4].forEach(i => $(`step-${i}`)?.classList.add('hidden'));
      $('step-success').classList.remove('hidden');

    } catch (err) {
      errEl.classList.remove('hidden');
      $('confirm-error-msg').textContent = err.error ?? 'Error al registrar. Inténtalo de nuevo.';
    } finally {
      btn.disabled = false;
      label.textContent = 'Registrar albarán';
      spin.classList.add('hidden');
    }
  });
}

/* ══════════════════════════════════════════════════════
   13. LOGOUT + RESET
══════════════════════════════════════════════════════ */
function resetFormulario() {
  S.docB64 = null; S.docNombre = null;
  S.numAlbaran = ''; S.proveedorId = 0; S.ubicacionId = 0; S.items = [];
  $('file-input').value     = '';
  $('inp-num-albaran').value = '';
  $('sel-proveedor').value  = '';
  $('sel-ubicacion').value  = '';
  $('input-ean').value      = '';
  $('dz-idle').classList.remove('hidden');
  $('dz-preview').classList.add('hidden');
  $('btn-clear-doc').classList.add('hidden');
  $('btn-step1-next').disabled = true;
  $('conv-panel').classList.add('hidden');
  $('items-table-wrap').classList.add('hidden');
  $('items-tbody').innerHTML = '';
  $('btn-step3-next').disabled = true;
  $('item-count-badge').classList.add('hidden');
  goStep(1);
}

/* ══════════════════════════════════════════════════════
   14. BOOTSTRAP
══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  // Botón logout
  $('btn-logout').addEventListener('click', () => {
    Api.clearSession();
    S.user = null; S.interlocutorId = 0;
    resetFormulario();
    showView('view-login');
  });

  // Botón "Nuevo albarán" en pantalla de éxito
  $('btn-nuevo').addEventListener('click', () => {
    resetFormulario();
  });

  // Inicializar listeners de cada paso
  initStep1();
  initStep2();
  initStep3();
  initStep4();

  // ¿Hay sesión guardada? → entrar directo
  if (Api._token && Api._interlocutorId) {
    S.interlocutorId = Api._interlocutorId;

    // Intentar recuperar datos de usuario del JWT (solo display)
    try {
      const pay = JSON.parse(atob(Api._token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      S.user = pay;
      $('hdr-nombre').textContent = pay.nombre || pay.full_name || pay.username || '—';
      $('hdr-sede').textContent   = pay.sede || pay.interlocutor_name || `Sede ${S.interlocutorId}`;
    } catch(_) {}

    cargarCatalogos().then(() => {
      showView('view-app');
      goStep(1);
      // Actualizar fecha
      $('lbl-fecha').textContent = new Date().toLocaleString('es-ES', {
        day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
    });
  } else {
    showView('view-login');
    initLoginView();
    return;
  }

  // Si no hay sesión, la vista login necesita inicializarse
  initLoginView();
});
