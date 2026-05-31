/* ============ Tienda Deportiva — lógica ============ */
const PRODUCTS = (window.PRODUCTS || []).slice();

/* ---- almacenamiento ---- */
const LS = {
  config: 'td_config', stock: 'td_stock', pedidos: 'td_pedidos', ventas: 'td_ventas'
};
const DEFAULT_CONFIG = { brand: 'Tienda Deportiva', whatsapp: '', password: 'admin123' };

function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; }
  catch (e) { return def; }
}
function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
  if (cloudReady && !applyingRemote) scheduleCloudPush();
}

/* ---- sincronización en la nube (Supabase) ---- */
const SUPA = window.SUPA || {};
const cloudEnabled = !!(SUPA.url && SUPA.anonKey && SUPA.email
  && !/TU_/.test(SUPA.url) && !/TU_/.test(SUPA.anonKey) && !/TU_/.test(SUPA.email));
const sb = (cloudEnabled && window.supabase) ? window.supabase.createClient(SUPA.url, SUPA.anonKey) : null;
const STATE_ID = 'main';
let cloudReady = false, applyingRemote = false, pushTimer = null;

function snapshot() {
  return { config, stock, pedidos, ventas, prices: Object.fromEntries(PRODUCTS.map(x => [x.id, x.priceCRC])) };
}
function applyState(d) {
  if (!d) return;
  applyingRemote = true;
  if (d.config) { config = Object.assign({}, DEFAULT_CONFIG, d.config); localStorage.setItem(LS.config, JSON.stringify(config)); }
  if (d.stock) { stock = d.stock; localStorage.setItem(LS.stock, JSON.stringify(stock)); }
  if (d.pedidos) { pedidos = d.pedidos; localStorage.setItem(LS.pedidos, JSON.stringify(pedidos)); }
  if (d.ventas) { ventas = d.ventas; localStorage.setItem(LS.ventas, JSON.stringify(ventas)); }
  if (d.prices) { PRODUCTS.forEach(p => { if (d.prices[p.id] != null) p.priceCRC = d.prices[p.id]; }); localStorage.setItem('td_prices', JSON.stringify(d.prices)); }
  applyingRemote = false;
}
function scheduleCloudPush() { clearTimeout(pushTimer); pushTimer = setTimeout(cloudPush, 600); }
async function cloudPush() {
  if (!sb || !cloudReady) return;
  try { await sb.from('store_state').upsert({ id: STATE_ID, data: snapshot(), updated_at: new Date().toISOString() }); }
  catch (e) { console.warn('No se pudo sincronizar:', e.message); }
}
async function startCloud() {
  const { data, error } = await sb.from('store_state').select('data').eq('id', STATE_ID).maybeSingle();
  if (!error && data && data.data) applyState(data.data);
  cloudReady = true;
  applyBrand(); renderFilters(); renderGrid();
  if (!data || !data.data) cloudPush(); // primera vez: sube lo que había en este dispositivo
  if (!window._tdSub) {
    window._tdSub = sb.channel('store')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_state', filter: 'id=eq.' + STATE_ID }, payload => {
        const d = payload.new && payload.new.data;
        if (!d) return;
        applyState(d); applyBrand(); renderGrid();
        if ($('#admin').classList.contains('show')) renderAdmin();
      })
      .subscribe();
  }
}

let config = Object.assign({}, DEFAULT_CONFIG, load(LS.config, {}));
let pedidos = load(LS.pedidos, []);
let ventas = load(LS.ventas, []);

/* stock: { [productId]: { [size]: qty } }  — sembrado desde el Excel la primera vez */
let stock = load(LS.stock, null);
if (!stock) {
  stock = {};
  PRODUCTS.forEach(p => {
    stock[p.id] = {};
    (p.sizes || []).forEach(s => { stock[p.id][s.t] = s.q; });
  });
  save(LS.stock, stock);
}

/* ---- utilidades ---- */
const colones = n => '₡' + Math.round(n || 0).toLocaleString('es-CR');
const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const prodById = id => PRODUCTS.find(p => p.id == id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function totalStock(id) { const s = stock[id] || {}; return Object.values(s).reduce((a, b) => a + (b || 0), 0); }
function availSizes(id) {
  const p = prodById(id); if (!p) return [];
  return (p.sizes || []).map(s => ({ t: s.t, q: (stock[id] || {})[s.t] || 0 }));
}
function today() { const d = new Date(); return d.toISOString().slice(0, 10); }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('T')[0].split('-'); return `${d}/${m}/${y}`; }

/* ============ CATÁLOGO PÚBLICO ============ */
let activeCat = 'todos';
function categoryOf(p) {
  const n = p.name.toLowerCase();
  if (/sock/.test(n)) return 'Accesorios';
  if (/\bf1\b|formula|polo/.test(n)) return 'F1';
  if (/nba|lakers/.test(n)) return 'NBA';
  if (/retro|199\d|200\d|0\d\/0\d|1\d\/1\d|80\/81/.test(n)) return 'Retro';
  return 'Selecciones y Clubes';
}
function renderFilters() {
  const cats = ['todos', ...Array.from(new Set(PRODUCTS.map(categoryOf)))];
  const f = $('#filters'); f.innerHTML = '';
  cats.forEach(c => {
    const b = el('button', 'chip' + (c === activeCat ? ' active' : ''), c === 'todos' ? 'Todas' : c);
    b.onclick = () => { activeCat = c; renderFilters(); renderGrid(); };
    f.appendChild(b);
  });
  const cnt = el('span', 'count'); cnt.id = 'catCount'; f.appendChild(cnt);
}
function coverHtml(p) {
  const src = p.cover || (p.photos && p.photos[0]);
  if (src) return `<img loading="lazy" decoding="async" src="${esc(src)}" alt="${esc(p.name)}" onerror="this.parentNode.innerHTML='<div class=ph>'+this.alt+'</div>'">`;
  return `<div class="ph">${esc(p.name)}</div>`;
}
function renderGrid() {
  const q = ($('#q').value || '').toLowerCase().trim();
  const grid = $('#grid'); grid.innerHTML = '';
  let list = PRODUCTS.filter(p => activeCat === 'todos' || categoryOf(p) === activeCat);
  if (q) list = list.filter(p => (p.name + ' ' + p.player + ' ' + p.patch).toLowerCase().includes(q));
  $('#noResults').classList.toggle('hidden', list.length > 0);
  const cc = $('#catCount'); if (cc) cc.textContent = list.length + ' modelo' + (list.length === 1 ? '' : 's');
  list.forEach(p => {
    const tot = totalStock(p.id);
    const sizes = availSizes(p.id);
    const card = el('div', 'card');
    const nph = p.photos ? p.photos.length : 0;
    card.innerHTML = `
      <div class="thumb" data-id="${p.id}">
        ${coverHtml(p)}
        ${tot <= 0 ? '<span class="badge out">Agotado</span>' : (p.player ? `<span class="badge">${esc(p.player)}</span>` : '')}
        ${nph > 1 ? `<span class="gallery-count">📷 ${nph}</span>` : ''}
      </div>
      <div class="cbody">
        <div class="cname">${esc(p.name)}</div>
        <div class="csub">
          ${p.patch ? `<span class="pill">${esc(p.patch)}</span>` : ''}
        </div>
        <div class="sizes">
          ${sizes.map(s => `<span class="sz ${s.q > 0 ? 'ok' : ''}">${esc(s.t)}</span>`).join('') || '<span class="note">Talla única</span>'}
        </div>
        <div class="cfoot">
          <span class="price">${colones(p.priceCRC)}</span>
          <button class="btn sm primary" data-id="${p.id}">Ver fotos</button>
        </div>
      </div>`;
    card.querySelector('.thumb').onclick = () => openProd(p.id);
    card.querySelector('.cfoot button').onclick = () => openProd(p.id);
    grid.appendChild(card);
  });
}

/* ---- modal producto / galería ---- */
let galleryIndex = 0, galleryProd = null;
function openProd(id) {
  const p = prodById(id); if (!p) return;
  galleryProd = p; galleryIndex = 0;
  const photos = (p.photos && p.photos.length) ? p.photos : [];
  const sizes = availSizes(id);
  const tot = totalStock(id);
  const thumbsArr = (p.thumbs && p.thumbs.length === photos.length) ? p.thumbs : photos;
  const main = photos.length ? `<img id="gmainImg" loading="lazy" decoding="async" src="${esc(photos[0])}" alt="${esc(p.name)}">` : `<div class="ph" style="display:grid;place-items:center;height:100%;color:#46566a">Sin fotos</div>`;
  const thumbs = photos.map((src, i) => `<img loading="lazy" src="${esc(thumbsArr[i])}" class="${i === 0 ? 'sel' : ''}" onclick="setGallery(${i})">`).join('');
  const waHtml = config.whatsapp ? `<a class="btn wa" style="justify-content:center;width:100%;margin-top:14px" target="_blank"
      href="https://wa.me/${esc(config.whatsapp)}?text=${encodeURIComponent('Hola! Me interesa la camiseta: ' + p.name + (p.player ? ' (' + p.player + ')' : '') + ' — ' + colones(p.priceCRC))}">
      Consultar por WhatsApp</a>` : '';
  $('#prodDetail').innerHTML = `
    <div>
      <div class="gmain">${main}</div>
      <div class="gthumbs">${thumbs}</div>
    </div>
    <div class="pinfo">
      <h2>${esc(p.name)}</h2>
      <div class="csub" style="margin-bottom:10px">${categoryOf(p)}</div>
      ${p.player ? `<div class="kv"><b>Dorsal</b> <span>${esc(p.player)}</span></div>` : ''}
      ${p.patch ? `<div class="kv"><b>Parche</b> <span>${esc(p.patch)}</span></div>` : ''}
      <div class="kv"><b>Tallas</b> <span class="sizes">${sizes.map(s => `<span class="sz ${s.q > 0 ? 'ok' : ''}" title="${s.q} disp.">${esc(s.t)}</span>`).join('') || 'Talla única'}</span></div>
      <div class="price-lg">${colones(p.priceCRC)}</div>
      <div class="note">${tot > 0 ? 'Disponible' : 'Agotado por ahora'} · ${photos.length} foto${photos.length === 1 ? '' : 's'}</div>
      ${waHtml}
    </div>`;
  $('#prodOverlay').classList.add('open');
}
function setGallery(i) {
  if (!galleryProd) return;
  galleryIndex = i;
  $('#gmainImg').src = galleryProd.photos[i];
  document.querySelectorAll('.gthumbs img').forEach((t, k) => t.classList.toggle('sel', k === i));
}
function closeProd() { $('#prodOverlay').classList.remove('open'); }

/* ============ LOGIN / NAV ============ */
function openLogin() { $('#pwd').value = ''; $('#loginErr').textContent = ''; $('#loginOverlay').classList.add('open'); setTimeout(() => $('#pwd').focus(), 50); }
function closeLogin() { $('#loginOverlay').classList.remove('open'); }
async function doLogin() {
  const pwd = $('#pwd').value;
  if (cloudEnabled) {
    $('#loginErr').textContent = 'Conectando…';
    try {
      const { error } = await sb.auth.signInWithPassword({ email: SUPA.email, password: pwd });
      if (error) { $('#loginErr').textContent = 'Contraseña incorrecta.'; return; }
      await startCloud();
      closeLogin(); showAdmin();
    } catch (e) { $('#loginErr').textContent = 'Sin conexión. Revisá tu internet.'; }
    return;
  }
  if (pwd === config.password) { closeLogin(); showAdmin(); }
  else $('#loginErr').textContent = 'Contraseña incorrecta.';
}
function showAdmin() {
  $('#catalogwrap').classList.add('hide');
  $('#admin').classList.add('show');
  sessionStorage.setItem('td_session', '1');
  renderAdmin();
  window.scrollTo(0, 0);
}
function showCatalog() {
  $('#admin').classList.remove('show');
  $('#catalogwrap').classList.remove('hide');
  window.scrollTo(0, 0);
}
function logout() {
  sessionStorage.removeItem('td_session');
  if (cloudEnabled && sb) { cloudReady = false; sb.auth.signOut(); }
  showCatalog();
}

/* ============ ADMIN ============ */
let adminTab = 'pedidos';
function renderAdmin() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === adminTab));
  ['pedidos', 'ventas', 'inventario', 'config'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== adminTab));
  if (adminTab === 'pedidos') renderPedidos();
  if (adminTab === 'ventas') renderVentas();
  if (adminTab === 'inventario') renderInventario();
  if (adminTab === 'config') renderConfig();
}

function productOptions(selId) {
  return PRODUCTS.map(p => `<option value="${p.id}" ${p.id == selId ? 'selected' : ''}>${esc(p.name)}${p.player ? ' — ' + esc(p.player) : ''}</option>`).join('');
}
function sizeOptions(pid) {
  const s = availSizes(pid);
  if (!s.length) return '<option value="Única">Única</option>';
  return s.map(x => `<option value="${esc(x.t)}">${esc(x.t)} (${x.q} disp.)</option>`).join('');
}

/* ---------- PEDIDOS (apartados) ---------- */
function renderPedidos() {
  const activos = pedidos.filter(p => p.estado === 'apartado');
  const totalApartado = activos.reduce((a, x) => a + x.precio * x.cant, 0);
  const totalAbonos = activos.reduce((a, x) => a + (x.abono || 0), 0);
  const saldo = totalApartado - totalAbonos;
  $('#tab-pedidos').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Apartados activos</div><div class="v warn">${activos.length}</div></div>
      <div class="stat"><div class="l">Valor apartado</div><div class="v">${colones(totalApartado)}</div></div>
      <div class="stat"><div class="l">Abonos recibidos</div><div class="v green">${colones(totalAbonos)}</div></div>
      <div class="stat"><div class="l">Saldo por cobrar</div><div class="v info">${colones(saldo)}</div></div>
    </div>
    <div class="panel">
      <h3>Registrar nuevo apartado</h3>
      <div class="form-row">
        <div style="grid-column:span 2"><label>Camiseta</label><select id="pe_prod" onchange="onPeProd()">${productOptions()}</select></div>
        <div><label>Talla</label><select id="pe_size"></select></div>
        <div><label>Cantidad</label><input id="pe_cant" type="number" min="1" value="1"></div>
        <div><label>Precio unitario</label><input id="pe_precio" type="number" min="0"></div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div><label>Cliente</label><input id="pe_cliente" placeholder="Nombre"></div>
        <div><label>Teléfono</label><input id="pe_tel" placeholder="8888-8888"></div>
        <div><label>Abono (adelanto)</label><input id="pe_abono" type="number" min="0" value="0"></div>
        <div><label>Fecha</label><input id="pe_fecha" type="date" value="${today()}"></div>
        <div style="grid-column:span 2"><label>Nota</label><input id="pe_nota" placeholder="Opcional"></div>
      </div>
      <div style="margin-top:12px"><button class="btn primary" onclick="addPedido()">+ Apartar</button></div>
    </div>
    <div class="panel">
      <div class="toolbar"><h3 style="margin:0">Apartados</h3><div class="grow"></div>
        <select id="pe_filter" onchange="renderPedidosTable()" style="max-width:200px">
          <option value="apartado">Activos</option><option value="entregado">Entregados</option>
          <option value="cancelado">Cancelados</option><option value="todos">Todos</option>
        </select></div>
      <div class="scroll-x"><table id="pe_table"></table></div>
    </div>`;
  onPeProd(); renderPedidosTable();
}
function onPeProd() {
  const pid = $('#pe_prod').value;
  $('#pe_size').innerHTML = sizeOptions(pid);
  const p = prodById(pid); if (p) $('#pe_precio').value = p.priceCRC;
}
function renderPedidosTable() {
  const filter = ($('#pe_filter') && $('#pe_filter').value) || 'apartado';
  const rows = pedidos.filter(p => filter === 'todos' ? true : p.estado === filter).sort((a, b) => b.id - a.id);
  const t = $('#pe_table');
  if (!rows.length) { t.innerHTML = `<tr><td><div class="empty">No hay apartados aquí.</div></td></tr>`; return; }
  t.innerHTML = `<thead><tr><th>Fecha</th><th>Cliente</th><th>Camiseta</th><th>Talla</th><th>Cant</th><th>Total</th><th>Abono</th><th>Saldo</th><th>Estado</th><th></th></tr></thead><tbody>` +
    rows.map(r => {
      const p = prodById(r.prod); const total = r.precio * r.cant; const saldo = total - (r.abono || 0);
      return `<tr>
        <td>${fmtDate(r.fecha)}</td>
        <td>${esc(r.cliente || '-')}${r.tel ? `<div class="note">${esc(r.tel)}</div>` : ''}</td>
        <td>${esc(p ? p.name : '?')}${p && p.player ? `<div class="note">${esc(p.player)}</div>` : ''}${r.nota ? `<div class="note">📝 ${esc(r.nota)}</div>` : ''}</td>
        <td>${esc(r.size)}</td><td>${r.cant}</td>
        <td>${colones(total)}</td><td>${colones(r.abono || 0)}</td><td>${colones(saldo)}</td>
        <td><span class="tag ${r.estado}">${r.estado}</span></td>
        <td style="white-space:nowrap">${r.estado === 'apartado'
          ? `<button class="btn sm primary" onclick="entregar(${r.id})">Entregar→Venta</button>
             <button class="btn sm" onclick="cancelarPedido(${r.id})">Cancelar</button>`
          : `<button class="btn sm danger" onclick="delPedido(${r.id})">Eliminar</button>`}</td>
      </tr>`;
    }).join('') + '</tbody>';
}
function addPedido() {
  const pid = $('#pe_prod').value, size = $('#pe_size').value;
  const cant = parseInt($('#pe_cant').value) || 0;
  const precio = parseFloat($('#pe_precio').value) || 0;
  if (cant < 1) return alert('Cantidad inválida.');
  const disp = (stock[pid] || {})[size];
  if (disp != null && cant > disp) return alert('Solo hay ' + disp + ' disponibles en talla ' + size + '.');
  pedidos.push({
    id: Date.now(), prod: pid, size, cant, precio,
    cliente: $('#pe_cliente').value.trim(), tel: $('#pe_tel').value.trim(),
    abono: parseFloat($('#pe_abono').value) || 0, nota: $('#pe_nota').value.trim(),
    fecha: $('#pe_fecha').value || today(), estado: 'apartado'
  });
  if (stock[pid] && stock[pid][size] != null) stock[pid][size] -= cant;
  save(LS.pedidos, pedidos); save(LS.stock, stock);
  renderPedidos();
}
function cancelarPedido(id) {
  const r = pedidos.find(p => p.id === id); if (!r) return;
  if (!confirm('¿Cancelar este apartado? Las unidades vuelven al inventario.')) return;
  if (stock[r.prod] && stock[r.prod][r.size] != null) stock[r.prod][r.size] += r.cant;
  r.estado = 'cancelado';
  save(LS.pedidos, pedidos); save(LS.stock, stock); renderPedidos();
}
function delPedido(id) {
  if (!confirm('¿Eliminar definitivamente este registro?')) return;
  pedidos = pedidos.filter(p => p.id !== id); save(LS.pedidos, pedidos); renderPedidos();
}
function entregar(id) {
  const r = pedidos.find(p => p.id === id); if (!r) return;
  if (!confirm('¿Marcar como entregado y registrar la venta en caja?')) return;
  r.estado = 'entregado';
  // el stock ya se descontó al apartar; la venta NO vuelve a descontar
  ventas.push({
    id: Date.now(), prod: r.prod, size: r.size, cant: r.cant, precio: r.precio,
    metodo: 'efectivo', cliente: r.cliente, fecha: today(), origen: 'apartado'
  });
  save(LS.pedidos, pedidos); save(LS.ventas, ventas);
  alert('Venta registrada en caja.'); renderPedidos();
}

/* ---------- VENTAS (caja) ---------- */
function renderVentas() {
  $('#tab-ventas').innerHTML = `
    <div class="panel">
      <h3>Registrar venta directa</h3>
      <div class="form-row">
        <div style="grid-column:span 2"><label>Camiseta</label><select id="ve_prod" onchange="onVeProd()">${productOptions()}</select></div>
        <div><label>Talla</label><select id="ve_size"></select></div>
        <div><label>Cantidad</label><input id="ve_cant" type="number" min="1" value="1"></div>
        <div><label>Precio unitario</label><input id="ve_precio" type="number" min="0"></div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div><label>Método de pago</label><select id="ve_metodo"><option value="efectivo">Efectivo</option><option value="sinpe">SINPE</option><option value="tarjeta">Tarjeta</option></select></div>
        <div><label>Cliente (opcional)</label><input id="ve_cliente" placeholder="Nombre"></div>
        <div><label>Fecha</label><input id="ve_fecha" type="date" value="${today()}"></div>
        <div style="display:flex;align-items:end"><button class="btn primary" style="width:100%;justify-content:center" onclick="addVenta()">+ Registrar venta</button></div>
      </div>
    </div>
    <div class="panel">
      <div class="toolbar">
        <h3 style="margin:0">Caja</h3><div class="grow"></div>
        <label style="margin:0">Desde</label><input id="ve_from" type="date" onchange="renderVentasTable()" style="max-width:160px">
        <label style="margin:0">Hasta</label><input id="ve_to" type="date" onchange="renderVentasTable()" style="max-width:160px">
        <button class="btn sm" onclick="setHoy()">Hoy</button>
        <button class="btn sm" onclick="setMes()">Este mes</button>
        <button class="btn sm" onclick="clearRange()">Todo</button>
      </div>
      <div class="stats" id="ve_stats"></div>
      <div class="scroll-x"><table id="ve_table"></table></div>
    </div>`;
  onVeProd();
  $('#ve_from').value = today(); $('#ve_to').value = today();
  renderVentasTable();
}
function onVeProd() { const pid = $('#ve_prod').value; $('#ve_size').innerHTML = sizeOptions(pid); const p = prodById(pid); if (p) $('#ve_precio').value = p.priceCRC; }
function setHoy() { $('#ve_from').value = today(); $('#ve_to').value = today(); renderVentasTable(); }
function setMes() { const d = new Date(); $('#ve_from').value = d.toISOString().slice(0, 8) + '01'; $('#ve_to').value = today(); renderVentasTable(); }
function clearRange() { $('#ve_from').value = ''; $('#ve_to').value = ''; renderVentasTable(); }
function inRange(f) {
  const from = $('#ve_from').value, to = $('#ve_to').value;
  if (from && f < from) return false; if (to && f > to) return false; return true;
}
function renderVentasTable() {
  const rows = ventas.filter(v => inRange(v.fecha)).sort((a, b) => b.id - a.id);
  const total = rows.reduce((a, v) => a + v.precio * v.cant, 0);
  const units = rows.reduce((a, v) => a + v.cant, 0);
  const byM = { efectivo: 0, sinpe: 0, tarjeta: 0 };
  rows.forEach(v => byM[v.metodo] = (byM[v.metodo] || 0) + v.precio * v.cant);
  $('#ve_stats').innerHTML = `
    <div class="stat"><div class="l">Total en caja</div><div class="v green">${colones(total)}</div></div>
    <div class="stat"><div class="l">Ventas</div><div class="v">${rows.length} (${units} u.)</div></div>
    <div class="stat"><div class="l">Efectivo</div><div class="v">${colones(byM.efectivo)}</div></div>
    <div class="stat"><div class="l">SINPE</div><div class="v info">${colones(byM.sinpe)}</div></div>
    <div class="stat"><div class="l">Tarjeta</div><div class="v">${colones(byM.tarjeta)}</div></div>`;
  const t = $('#ve_table');
  if (!rows.length) { t.innerHTML = `<tr><td><div class="empty">No hay ventas en este período.</div></td></tr>`; return; }
  t.innerHTML = `<thead><tr><th>Fecha</th><th>Camiseta</th><th>Talla</th><th>Cant</th><th>P. unit</th><th>Total</th><th>Método</th><th>Cliente</th><th></th></tr></thead><tbody>` +
    rows.map(v => {
      const p = prodById(v.prod);
      return `<tr>
        <td>${fmtDate(v.fecha)}</td>
        <td>${esc(p ? p.name : '?')}${v.origen === 'apartado' ? '<div class="note">de apartado</div>' : ''}</td>
        <td>${esc(v.size)}</td><td>${v.cant}</td><td>${colones(v.precio)}</td><td><b>${colones(v.precio * v.cant)}</b></td>
        <td><span class="tag ${v.metodo}">${v.metodo}</span></td><td>${esc(v.cliente || '-')}</td>
        <td><button class="btn sm danger" onclick="delVenta(${v.id})">✕</button></td>
      </tr>`;
    }).join('') + '</tbody>';
}
function addVenta() {
  const pid = $('#ve_prod').value, size = $('#ve_size').value;
  const cant = parseInt($('#ve_cant').value) || 0, precio = parseFloat($('#ve_precio').value) || 0;
  if (cant < 1) return alert('Cantidad inválida.');
  const disp = (stock[pid] || {})[size];
  if (disp != null && cant > disp) return alert('Solo hay ' + disp + ' disponibles en talla ' + size + '.');
  ventas.push({ id: Date.now(), prod: pid, size, cant, precio, metodo: $('#ve_metodo').value, cliente: $('#ve_cliente').value.trim(), fecha: $('#ve_fecha').value || today(), origen: 'directa' });
  if (stock[pid] && stock[pid][size] != null) stock[pid][size] -= cant;
  save(LS.ventas, ventas); save(LS.stock, stock);
  renderVentas();
}
function delVenta(id) {
  const v = ventas.find(x => x.id === id); if (!v) return;
  if (!confirm('¿Eliminar esta venta? Las unidades vuelven al inventario.')) return;
  if (v.origen === 'directa' && stock[v.prod] && stock[v.prod][v.size] != null) stock[v.prod][v.size] += v.cant;
  ventas = ventas.filter(x => x.id !== id); save(LS.ventas, ventas); save(LS.stock, stock); renderVentas();
}

/* ---------- INVENTARIO ---------- */
function renderInventario() {
  const totU = PRODUCTS.reduce((a, p) => a + totalStock(p.id), 0);
  $('#tab-inventario').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="l">Modelos</div><div class="v">${PRODUCTS.length}</div></div>
      <div class="stat"><div class="l">Unidades en stock</div><div class="v green">${totU}</div></div>
      <div class="stat"><div class="l">Precio venta base</div><div class="v">${colones(25000)}</div></div>
    </div>
    <div class="panel">
      <div class="toolbar"><h3 style="margin:0">Inventario y precios</h3><div class="grow"></div>
        <button class="btn sm danger" onclick="resetStock()">Restaurar stock del Excel</button></div>
      <p class="note">Editá las cantidades por talla o el precio y se guarda solo. El catálogo público se actualiza al instante.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Camiseta</th><th>Tallas (cantidad editable)</th><th>Total</th><th>Precio ₡</th></tr></thead>
        <tbody>${PRODUCTS.map(p => `
          <tr>
            <td>${esc(p.name)}${p.player ? `<div class="note">${esc(p.player)}</div>` : ''}</td>
            <td><div class="sizes">${(p.sizes || []).map(s => `
              <span class="sz ok" style="display:inline-flex;gap:4px;align-items:center;padding:4px 6px">
                ${esc(s.t)} <input type="number" min="0" value="${(stock[p.id] || {})[s.t] || 0}" style="width:52px;padding:4px 6px"
                  onchange="setStock('${p.id}','${esc(s.t)}',this.value)"></span>`).join('') || '<span class="note">Talla única</span>'}</div></td>
            <td id="tot-${p.id}"><b>${totalStock(p.id)}</b></td>
            <td><input type="number" min="0" value="${p.priceCRC}" style="width:90px" onchange="setPrice('${p.id}',this.value)"></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}
function setStock(pid, size, val) {
  stock[pid] = stock[pid] || {}; stock[pid][size] = Math.max(0, parseInt(val) || 0);
  save(LS.stock, stock);
  const c = $('#tot-' + pid); if (c) c.innerHTML = '<b>' + totalStock(pid) + '</b>';
}
function setPrice(pid, val) {
  const p = prodById(pid); if (!p) return; p.priceCRC = Math.max(0, parseInt(val) || 0);
  save('td_prices', Object.fromEntries(PRODUCTS.map(x => [x.id, x.priceCRC])));
}
function resetStock() {
  if (!confirm('¿Restaurar las cantidades originales del Excel? Se perderán los ajustes manuales de stock.')) return;
  stock = {}; PRODUCTS.forEach(p => { stock[p.id] = {}; (p.sizes || []).forEach(s => stock[p.id][s.t] = s.q); });
  save(LS.stock, stock); renderInventario();
}

/* ---------- AJUSTES ---------- */
function renderConfig() {
  $('#tab-config').innerHTML = `
    <div class="panel" style="max-width:560px">
      <h3>Ajustes de la tienda</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div><label>Nombre de la tienda</label><input id="cf_brand" value="${esc(config.brand)}"></div>
        <div><label>WhatsApp (con código país, ej. 50688887777)</label><input id="cf_wa" value="${esc(config.whatsapp)}" placeholder="Dejar vacío para ocultar el botón"></div>
        ${cloudEnabled
          ? `<div><label>Contraseña de administración</label><input type="password" value="********" disabled><p class="note">En modo nube, la contraseña es la de tu cuenta Supabase (${esc(SUPA.email)}). Cambiala desde Supabase → Authentication.</p></div>`
          : `<div><label>Contraseña de administración</label><input id="cf_pwd" type="text" value="${esc(config.password)}"></div>`}
        <div><button class="btn primary" onclick="saveConfig()">Guardar ajustes</button></div>
      </div>
    </div>
    <div class="panel" style="max-width:560px">
      <h3>Datos</h3>
      <p class="note">${cloudEnabled
        ? '☁️ Sincronización en la nube ACTIVA: apartados, ventas e inventario se comparten en tiempo real entre todos tus dispositivos. Aun así podés bajar respaldos.'
        : 'Los apartados y ventas se guardan solo en este navegador/dispositivo. Hacé respaldos con regularidad.'}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" onclick="exportData()">⬇ Exportar respaldo (JSON)</button>
        <label class="btn" style="margin:0">⬆ Importar respaldo<input type="file" accept="application/json" style="display:none" onchange="importData(this)"></label>
        <button class="btn" onclick="exportVentasCSV()">⬇ Ventas a CSV</button>
      </div>
    </div>`;
}
function saveConfig() {
  config.brand = $('#cf_brand').value.trim() || 'Tienda Deportiva';
  config.whatsapp = $('#cf_wa').value.replace(/[^0-9]/g, '');
  if ($('#cf_pwd')) config.password = $('#cf_pwd').value || 'admin123';
  save(LS.config, config); applyBrand(); alert('Ajustes guardados.');
}
function applyBrand() {
  $('#brandName').textContent = config.brand;
  document.title = config.brand + ' — Camisetas de Fútbol';
  $('#pubFooter').textContent = config.brand + ' · Catálogo de camisetas · Precios en colones';
}
function exportData() {
  const data = { config, stock, pedidos, ventas, prices: Object.fromEntries(PRODUCTS.map(x => [x.id, x.priceCRC])), at: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'respaldo-tienda-' + today() + '.json'; a.click();
}
function importData(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.config) { config = Object.assign({}, DEFAULT_CONFIG, d.config); save(LS.config, config); }
      if (d.stock) { stock = d.stock; save(LS.stock, stock); }
      if (d.pedidos) { pedidos = d.pedidos; save(LS.pedidos, pedidos); }
      if (d.ventas) { ventas = d.ventas; save(LS.ventas, ventas); }
      if (d.prices) { PRODUCTS.forEach(p => { if (d.prices[p.id] != null) p.priceCRC = d.prices[p.id]; }); save('td_prices', d.prices); }
      applyBrand(); renderAdmin(); alert('Respaldo importado.');
    } catch (e) { alert('Archivo inválido.'); }
  };
  r.readAsText(f);
}
function exportVentasCSV() {
  const rows = [['Fecha', 'Camiseta', 'Dorsal', 'Talla', 'Cantidad', 'Precio', 'Total', 'Metodo', 'Cliente', 'Origen']];
  ventas.forEach(v => { const p = prodById(v.prod); rows.push([v.fecha, p ? p.name : '', p ? p.player : '', v.size, v.cant, v.precio, v.precio * v.cant, v.metodo, v.cliente || '', v.origen]); });
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ventas-' + today() + '.csv'; a.click();
}

/* ============ INIT ============ */
// aplicar precios guardados
const savedPrices = load('td_prices', null);
if (savedPrices) PRODUCTS.forEach(p => { if (savedPrices[p.id] != null) p.priceCRC = savedPrices[p.id]; });

applyBrand();
renderFilters();
renderGrid();

$('#q').addEventListener('input', renderGrid);
$('#adminBtn').onclick = openLogin;
$('#logoutBtn').onclick = logout;
$('#backCatalog').onclick = showCatalog;
document.querySelectorAll('.tab').forEach(t => t.onclick = () => { adminTab = t.dataset.tab; renderAdmin(); });
$('#prodOverlay').addEventListener('click', e => { if (e.target.id === 'prodOverlay') closeProd(); });
$('#loginOverlay').addEventListener('click', e => { if (e.target.id === 'loginOverlay') closeLogin(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeProd(); closeLogin(); } });

if (cloudEnabled && sb) {
  sb.auth.getSession().then(({ data }) => {
    if (data && data.session) { startCloud().then(showAdmin); }
  });
} else if (sessionStorage.getItem('td_session') === '1') {
  showAdmin();
}
