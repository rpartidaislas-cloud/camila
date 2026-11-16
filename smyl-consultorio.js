/* SMYL · Consultorio: la mesa de trabajo cuando el paciente está presente.
 * Etapa 1: dar de alta a quien llega (solo con teléfono), buscar pacientes, ver quién está hoy en el consultorio y
 * llegar al simulador. Solo junta lo que ya existe (expediente, enlace de registro, simulador); no duplica lógica clínica.
 * Se abre con ir('consultorio'), con ?ir=consultorio y, en la app instalada, es la pantalla de arranque. */
(function () {
  'use strict';
  var Q = window.SmylPatientQuick;
  if (!Q) { console.error('[SMYL] consultorio: falta smyl-patient-quick.js'); return; }

  var STATUS = { in_progress: 'En consulta', arrived: 'En sala', confirmed: 'Por llegar' };
  var ORDER = ['in_progress', 'arrived', 'confirmed'];
  var state = { tenant: null, loaded: false, loading: false, error: '', rows: [], names: {}, services: {}, access: null, accessTenant: null, done: 0, seq: 0, timer: null };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function startDay(v) { var d = new Date(v); d.setHours(0, 0, 0, 0); return d; }
  function fmtTime(v) { return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(v)).replace(/\s*([ap])\.?\s?m\.?/i, function (m, x) { return ' ' + x.toLowerCase() + 'm'; }); }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }
  async function query(builder) { var r = await (typeof window.sbTimeout === 'function' ? window.sbTimeout(builder) : builder); if (r && r.error) throw r.error; return r ? r.data : null; }
  async function rpc(name, args) { return query(window.sb.rpc(name, args)); }
  function root() { return document.getElementById('p-consultorio'); }
  function $(sel) { var r = root(); return r ? r.querySelector(sel) : null; }
  function can(key) { var a = state.access; return !a || a.owner || a.perms.indexOf(key) !== -1; }
  function isOwner() { return window.miRolEquipo === 'dueño'; }
  function simulatorUrl(patientId) {
    var url = 'simulacion-rapida.html?workspace=professional';
    // Igual que la ficha del paciente: solo la cuenta dueña lanza la simulación ya ligada al paciente.
    if (patientId && state.tenant && isOwner()) url += '&patient=' + encodeURIComponent(patientId) + '&clinic=' + encodeURIComponent(state.tenant);
    return url;
  }
  function openPatient(id) { if (typeof window.verPaciente === 'function') window.verPaciente(id); else if (typeof window.ir === 'function') window.ir('pacientes'); }
  function errorText(err) {
    var code = err && err.code, msg = String(err && err.message || '');
    if (code === '42501' || /permission|row-level security/i.test(msg)) return 'Tu rol no permite registrar pacientes. Pide al propietario que active «Pacientes · gestionar».';
    if (code === 'PGRST301') return 'Tu sesión expiró. Vuelve a iniciar sesión y repite la acción.';
    return msg || 'No se pudo completar la operación. Revisa tu conexión e inténtalo de nuevo.';
  }

  /* ── Datos ── */
  async function loadAccess() {
    state.accessTenant = state.tenant;
    try {
      var user = await window.sb.auth.getUser(), uid = user && user.data && user.data.user && user.data.user.id;
      if (!uid) { state.access = null; return; }
      var roles = await query(window.sb.from('smyl_member_roles').select('role_id').eq('tenant_id', state.tenant).eq('user_id', uid));
      var ids = (roles || []).map(function (r) { return r.role_id; }), perms = [];
      if (ids.length) perms = (await query(window.sb.from('smyl_role_permissions').select('permission_key').eq('tenant_id', state.tenant).in('role_id', ids))).map(function (r) { return r.permission_key; });
      state.access = { owner: isOwner(), perms: perms };
    } catch (e) { state.access = null; }
  }
  async function namesFor(ids) {
    var unique = Array.from(new Set(ids.filter(Boolean))), out = [];
    for (var i = 0; i < unique.length; i += 100) out = out.concat((await query(window.sb.from('camila_pacientes').select('id,nombre,apellido,telefono').eq('tenant_id', state.tenant).in('id', unique.slice(i, i + 100)))) || []);
    return out;
  }
  async function load(force) {
    if (!window.tenantId || !window.sb || state.loading) return;
    if (state.loaded && state.tenant === window.tenantId && !force) return;
    state.loading = true; state.error = ''; state.tenant = window.tenantId;
    if (!state.loaded) renderList();
    var start = startDay(new Date()), end = new Date(start); end.setDate(end.getDate() + 1);
    try {
      var res = await Promise.all([
        query(window.sb.from('smyl_appointments').select('id,patient_id,service_id,starts_at,status').eq('tenant_id', state.tenant).gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at')),
        query(window.sb.from('smyl_services').select('id,name').eq('tenant_id', state.tenant)).catch(function () { return []; })
      ]);
      state.rows = (res[0] || []).filter(function (r) { return r.status !== 'cancelled'; });
      state.services = {}; (res[1] || []).forEach(function (s) { state.services[s.id] = s.name; });
      state.done = state.rows.filter(function (r) { return r.status === 'completed'; }).length;
      if (!state.access || state.accessTenant !== state.tenant) await loadAccess();
      state.names = {}; (await namesFor(state.rows.map(function (r) { return r.patient_id; }))).forEach(function (p) { state.names[p.id] = p; });
      state.loaded = true;
    } catch (e) { state.error = errorText(e); }
    finally { state.loading = false; }
    renderAll();
  }

  /* ── Pantalla ── */
  function renderAll() {
    var title = $('[data-co-greeting]'), sub = $('[data-co-sub]');
    if (title) title.textContent = greeting();
    var live = state.rows.filter(function (r) { return ORDER.indexOf(r.status) >= 0; });
    var inRoom = live.filter(function (r) { return r.status === 'in_progress'; }).length;
    if (sub) sub.textContent = state.loaded ? (state.rows.length ? 'Hoy: ' + state.rows.length + (state.rows.length === 1 ? ' cita' : ' citas') + (inRoom ? ', ' + inRoom + ' en consulta.' : '.') : 'Hoy no hay citas en la agenda.') : '';
    var newBtn = $('[data-co-new]'); if (newBtn) newBtn.hidden = !can('patients.manage');
    renderList();
  }
  function renderList() {
    var host = $('[data-co-list]'); if (!host) return;
    host.replaceChildren();
    if (state.loading && !state.loaded) { host.append(el('p', 'co-note', 'Cargando la jornada…')); return; }
    if (state.error) { var b = el('button', 'co-retry', 'Intentar de nuevo'); b.type = 'button'; b.onclick = function () { load(true); }; host.append(el('p', 'co-note', state.error), b); return; }
    var live = state.rows.filter(function (r) { return ORDER.indexOf(r.status) >= 0; }).sort(function (a, b) { return ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || new Date(a.starts_at) - new Date(b.starts_at); });
    if (!live.length) { host.append(el('p', 'co-note', state.done ? 'Ya terminaste las ' + state.rows.length + ' citas de hoy.' : 'Nadie por atender ahora. Da de alta a quien llegue con el botón de arriba.')); return; }
    var list = el('ul', 'co-people');
    live.forEach(function (r) {
      var p = state.names[r.patient_id], name = p ? Q.listName(p) : 'Paciente', li = el('li');
      var btn = el('button', 'co-person'); btn.type = 'button'; btn.dataset.status = r.status; btn.setAttribute('aria-label', 'Abrir expediente de ' + name + ', ' + STATUS[r.status]);
      var info = el('span', 'co-q'); info.append(el('b', '', name), el('small', '', fmtTime(r.starts_at) + (p && Q.isPending(p) && p.telefono ? ', ' + p.telefono : state.services[r.service_id] ? ', ' + state.services[r.service_id] : '')));
      btn.append(el('span', 'co-av', Q.initials(p && Q.isPending(p) ? '' : name)), info, el('span', 'co-chip', STATUS[r.status]));
      btn.onclick = function () { openPatient(r.patient_id); };
      li.append(btn); list.append(li);
    });
    host.append(list);
    if (state.done) host.append(el('p', 'co-note co-muted', state.done + (state.done === 1 ? ' cita terminada hoy.' : ' citas terminadas hoy.')));
  }

  /* ── Búsqueda ── */
  function renderResults(rows, q) {
    var host = $('[data-co-results]'); if (!host) return;
    host.replaceChildren();
    if (rows == null) { host.hidden = true; return; }
    host.hidden = false;
    rows.forEach(function (p) {
      var li = el('li'), b = el('button', 'co-hit'); b.type = 'button';
      var info = el('span', 'co-q'); info.append(el('b', '', Q.listName(p)), el('small', '', p.telefono || p.email || 'Sin teléfono ni correo'));
      b.append(el('span', 'co-av', Q.initials(Q.isPending(p) ? '' : Q.displayName(p))), info);
      b.onclick = function () { openPatient(p.id); };
      li.append(b); host.append(li);
    });
    if (!rows.length) {
      var li2 = el('li', 'co-none'); li2.append(el('span', '', 'No encontré a nadie con «' + q + '».'));
      if (can('patients.manage')) { var c = el('button', 'co-link-btn', 'Crear paciente nuevo'); c.type = 'button'; c.onclick = function () { openNew(q); }; li2.append(c); }
      host.append(li2);
    }
  }
  function onSearch(e) {
    var q = e.target.value.trim(), mine = ++state.seq; clearTimeout(state.timer);
    if (q.length < 2) { renderResults(null); return; }
    state.timer = setTimeout(async function () {
      try { var rows = await rpc('smyl_search_patients', { p_tenant_id: state.tenant, p_query: q, p_limit: 6 }); if (mine === state.seq) renderResults(rows || [], q); }
      catch (err) { if (mine !== state.seq) return; var host = $('[data-co-results]'); host.hidden = false; host.replaceChildren(el('li', 'co-none', 'No se pudo buscar. Revisa tu conexión.')); }
    }, 250);
  }

  /* ── Paciente nuevo ── */
  function dialog() { return document.getElementById('co-dialog'); }
  function closeDialog() { var d = dialog(); if (d && d.open) d.close(); }
  function setError(text) { var box = document.querySelector('#co-dialog [data-co-error]'); if (box) { box.textContent = text || ''; box.hidden = !text; } }
  function openNew(seed) {
    var d = dialog(); if (!d) return;
    var digits = Q.digits(seed || ''), tel = digits.length >= 8 && /^[\d\s()+.-]+$/.test(seed) ? seed : '', name = seed && !tel ? seed : '';
    d.innerHTML = '<form class="co-form" novalidate><header><h2>Paciente nuevo</h2><button type="button" class="co-x" data-co-cancel aria-label="Cerrar">×</button></header>'
      + '<label>Teléfono (WhatsApp)<input name="tel" type="tel" inputmode="tel" autocomplete="off" maxlength="40" placeholder="33 1234 5678" value="' + esc(tel) + '"></label>'
      + '<label>Nombre <small>(opcional ahora)</small><input name="nombre" autocomplete="off" maxlength="150" placeholder="Si no lo tienes, queda por registrar" value="' + esc(name) + '"></label>'
      + '<p class="co-error" role="alert" data-co-error hidden></p><div data-co-dups></div>'
      + '<button type="submit" class="co-submit">Crear paciente</button></form>';
    var form = d.querySelector('form'), acknowledged = false, saving = false;
    d.querySelector('[data-co-cancel]').onclick = closeDialog;
    form.onsubmit = async function (e) {
      e.preventDefault(); if (saving) return;
      var out = Q.prepare({ tel: form.tel.value, nombre: form.nombre.value });
      if (!out.ok) { setError(out.error); form[out.field].focus(); return; }
      saving = true; setError(''); form.querySelector('.co-submit').disabled = true;
      try {
        if (!acknowledged && out.row.telefono) {
          var hits = await rpc('smyl_patient_duplicates', { p_tenant_id: state.tenant, p_email: '', p_telefono: out.row.telefono, p_exclude_id: null }).catch(function () { return []; });
          if (hits && hits.length) { showDuplicates(d.querySelector('[data-co-dups]'), hits, function () { acknowledged = true; form.requestSubmit(); }); return; }
        }
        var fields = Object.assign({ tenant_id: state.tenant }, out.row);
        if (out.pending) fields.registro_estado = 'pendiente';
        var row;
        try { row = await query(window.sb.from('camila_pacientes').insert([fields]).select('id,nombre,apellido,telefono,email').single()); }
        catch (first) {
          // Si la columna registro_estado aún no existe en la base, se reintenta sin ella (la marca se deduce del nombre).
          if (!out.pending || !/registro_estado|schema cache|42703|PGRST204/i.test(String((first && first.code) || '') + ' ' + String((first && first.message) || ''))) throw first;
          delete fields.registro_estado;
          row = await query(window.sb.from('camila_pacientes').insert([fields]).select('id,nombre,apellido,telefono,email').single());
        }
        if (!row || !row.id) throw new Error('No se confirmó el alta del paciente.');
        showCreated(row, out.pending);
      } catch (err) { setError(errorText(err)); }
      finally { saving = false; var s = form.querySelector('.co-submit'); if (s) s.disabled = false; }
    };
    if (!d.open) d.showModal();
    (tel ? form.nombre : form.tel).focus();
  }
  function showDuplicates(host, hits, other) {
    host.replaceChildren();
    var box = el('div', 'co-dups'); box.setAttribute('role', 'alert'); box.append(el('strong', '', 'Ya existe alguien con ese teléfono'));
    hits.slice(0, 3).forEach(function (h) {
      var row = el('div', 'co-dup'); row.append(el('span', '', (h.name || 'Paciente') + (h.phone ? ', ' + h.phone : '')));
      var use = el('button', 'co-link-btn', 'Abrir expediente'); use.type = 'button'; use.onclick = function () { closeDialog(); openPatient(h.id); };
      row.append(use); box.append(row);
    });
    var again = el('button', 'co-link-btn', 'Es otra persona, crear de todos modos'); again.type = 'button'; again.onclick = other; box.append(again);
    host.append(box);
  }
  function showCreated(row, pending) {
    var d = dialog(), name = Q.listName(Object.assign({ registro_estado: pending ? 'pendiente' : '' }, row));
    d.innerHTML = '<div class="co-form co-created"><header><h2>Paciente creado</h2><button type="button" class="co-x" data-co-cancel aria-label="Cerrar">×</button></header>'
      + '<p class="co-ok"><b>' + esc(name) + '</b>' + (row.telefono ? '<span>' + esc(row.telefono) + '</span>' : '') + (pending ? '<span> Queda por registrar hasta que complete sus datos.</span>' : '') + '</p><div class="co-actions"></div></div>';
    d.querySelector('[data-co-cancel]').onclick = closeDialog;
    var actions = d.querySelector('.co-actions');
    function act(text, cls, fn) { var b = el('button', cls || 'co-secondary', text); b.type = 'button'; b.onclick = fn; actions.append(b); return b; }
    act('Abrir expediente', 'co-submit', function () { closeDialog(); openPatient(row.id); });
    if (pending && typeof window.enviarEnlaceRegistro === 'function') act('Enviar enlace para que llene sus datos', 'co-secondary', function (e) { window.enviarEnlaceRegistro({ id: row.id, telefono: row.telefono }, e.currentTarget); });
    act('Abrir el simulador', 'co-secondary', function () { location.href = simulatorUrl(row.id); });
    act('Listo', 'co-ghost', closeDialog);
  }

  /* ── Montaje ── */
  function build() {
    var host = document.querySelector('.contenido');
    if (!host || root()) return;
    var page = el('section', 'pantalla consultorio'); page.id = 'p-consultorio'; page.setAttribute('aria-labelledby', 'co-title');
    page.innerHTML = '<div class="co-wrap"><header class="co-head"><span class="co-logo">SMYL</span><button type="button" class="co-link-btn" data-co-panel>Panel completo</button></header>'
      + '<h1 id="co-title" data-co-greeting>Consultorio</h1><p class="co-sub" data-co-sub></p>'
      + '<button type="button" class="co-primary" data-co-new><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.5 3-6 7-6M18 8v6M15 11h6"/></svg>Paciente nuevo</button>'
      + '<div class="co-pair"><a class="co-tile" data-co-sim href="' + esc(simulatorUrl()) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/></svg>Simulador</a>'
      + '<button type="button" class="co-tile" data-co-agenda><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>Agenda</button></div>'
      + '<div class="co-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" data-co-q placeholder="Buscar paciente" aria-label="Buscar paciente" autocomplete="off" spellcheck="false"></div>'
      + '<ul class="co-results" data-co-results hidden></ul>'
      + '<h2 class="co-sec">En el consultorio</h2><div data-co-list></div>'
      + '<footer class="co-foot"><button type="button" class="co-link-btn" data-co-logout>Cerrar sesión</button></footer></div>'
      + '<dialog id="co-dialog" class="co-dialog"></dialog>';
    host.append(page);
    page.querySelector('[data-co-new]').onclick = function () { openNew(); };
    page.querySelector('[data-co-panel]').onclick = function () { if (typeof window.ir === 'function') window.ir('dashboard'); };
    page.querySelector('[data-co-agenda]').onclick = function () { if (typeof window.ir === 'function') window.ir('agenda'); };
    page.querySelector('[data-co-logout]').onclick = function () { if (typeof window.cerrarSesion === 'function') window.cerrarSesion(); };
    page.querySelector('[data-co-q]').addEventListener('input', onSearch);
    page.querySelector('#co-dialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeDialog(); });
  }
  function init() {
    build();
    if (window.TITULOS) window.TITULOS.consultorio = 'Consultorio';
    var previous = window.ir;
    if (typeof previous === 'function') window.ir = function (name) { var result = previous(name); if (name === 'consultorio') { var q = $('[data-co-q]'); if (q) { q.value = ''; renderResults(null); } load(true); } return result; };
    window.addEventListener('smyl:appointments-changed', function () { if (state.loaded) load(true); });
  }
  window.SmylConsultorio = { reload: function () { return load(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
