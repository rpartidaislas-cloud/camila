/* SMYL · Consultorio: la mesa de trabajo cuando el paciente está presente.
 * Etapa 1: dar de alta a quien llega (solo con teléfono), buscar pacientes, ver quién está hoy en el consultorio y
 * llegar al simulador. Solo junta lo que ya existe (expediente, enlace de registro, simulador); no duplica lógica clínica.
 * Se abre con ir('consultorio'), con ?ir=consultorio y, en la app instalada, es la pantalla de arranque. */
(function () {
  'use strict';
  var Q = window.SmylPatientQuick, V = window.SmylVisitModel, I = window.SmylHistoryInterview;
  if (!Q || !V) { console.error('[SMYL] consultorio: faltan smyl-patient-quick.js o smyl-visit-model.js'); return; }

  var STATUS = { in_progress: 'En consulta', arrived: 'En sala', confirmed: 'Por llegar' };
  var ORDER = ['in_progress', 'arrived', 'confirmed'];
  var state = { tenant: null, loaded: false, loading: false, error: '', rows: [], names: {}, services: {}, access: null, accessTenant: null, done: 0, seq: 0, timer: null, visit: null };
  var MEMORY_KEY = 'smyl_visit', MEMORY_HOURS = 6;
  state.interview = null; state.notice = '';

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
  /* Abre el expediente y salta a una de sus secciones (history, files, ...). Usa los mismos accesos que el expediente
   * («Más del expediente», data-p360-domain); como se arman al terminar de cargar, se espera hasta ~8 s. Si no aparecen,
   * la persona se queda en el expediente. Un clic por código funciona aunque ese bloque esté plegado. */
  async function openSection(id, key) {
    if (typeof window.verPaciente !== 'function') return openPatient(id);
    try { await window.verPaciente(id); } catch (e) { return; }
    var selector = '#p-paciente-detalle [data-p360-domain="' + key + '"], #p-paciente-detalle [data-record-tab="' + key + '"]';
    for (var i = 0; i < 80; i++) {
      var tab = document.querySelector(selector);
      if (tab) { tab.click(); return; }
      await new Promise(function (r) { setTimeout(r, 100); });
    }
  }
  function remember(id, name) { try { sessionStorage.setItem(MEMORY_KEY, JSON.stringify({ id: id, name: name, at: Date.now() })); } catch (e) {} }
  function forget() { try { sessionStorage.removeItem(MEMORY_KEY); } catch (e) {} }
  function remembered() {
    try { var m = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || 'null'); if (m && m.id && Date.now() - m.at < MEMORY_HOURS * 3600000) return m; } catch (e) {}
    return null;
  }
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
    renderResume();
    renderFlash();
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
      var btn = el('button', 'co-person'); btn.type = 'button'; btn.dataset.status = r.status; btn.setAttribute('aria-label', 'Empezar la visita de ' + name + ', ' + STATUS[r.status]);
      var info = el('span', 'co-q'); info.append(el('b', '', name), el('small', '', fmtTime(r.starts_at) + (p && Q.isPending(p) && p.telefono ? ', ' + p.telefono : state.services[r.service_id] ? ', ' + state.services[r.service_id] : '')));
      btn.append(el('span', 'co-av', Q.initials(p && Q.isPending(p) ? '' : name)), info, el('span', 'co-chip', STATUS[r.status]));
      btn.onclick = function () { openVisit(r.patient_id); };
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
      b.onclick = function () { openVisit(p.id); };
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
      var use = el('button', 'co-link-btn', 'Empezar su visita'); use.type = 'button'; use.onclick = function () { closeDialog(); openVisit(h.id); };
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
    act('Empezar la visita', 'co-submit', function () { closeDialog(); openVisit(row.id); });
    if (pending && typeof window.enviarEnlaceRegistro === 'function') act('Enviar enlace para que llene sus datos', 'co-secondary', function (e) { window.enviarEnlaceRegistro({ id: row.id, telefono: row.telefono }, e.currentTarget); });
    act('Listo', 'co-ghost', closeDialog);
  }


  /* ── Recorrido de la visita ── */
  var STEP_MARK = { done: '✓', todo: '', unknown: '', optional: '' };
  function showView(which) {
    var home = $('[data-co-home]'), visit = $('[data-co-visit]'), iv = $('[data-co-interview]'), cl = $('[data-co-close]');
    if (home) home.hidden = which !== 'home';
    if (visit) visit.hidden = which !== 'visit';
    if (iv) iv.hidden = which !== 'interview';
    if (cl) cl.hidden = which !== 'close';
    var r = root(); if (r && r.scrollIntoView) { try { r.scrollIntoView({ block: 'start' }); } catch (e) {} }
  }
  function appointmentOf(patientId) { return state.rows.filter(function (r) { return r.patient_id === patientId && ORDER.indexOf(r.status) >= 0; })[0] || null; }
  async function loadVisit(id) {
    var v = state.visit = { id: id, loading: true, error: '', patient: null, history: undefined, files: undefined, revision: 0, rawDoc: null, next: undefined };
    renderVisit();
    try {
      var res = await Promise.all([
        query(window.sb.from('camila_pacientes').select('*').eq('tenant_id', state.tenant).eq('id', id).maybeSingle()),
        query(window.sb.from('smyl_patient_histories').select('revision,document').eq('tenant_id', state.tenant).eq('patient_id', id).maybeSingle()).then(function (row) { v.revision = row ? Number(row.revision) || 0 : 0; v.rawDoc = row ? row.document : null; return row ? Object.assign(window.SmylHistoryModel ? window.SmylHistoryModel.defaultHistory() : {}, row.document) : null; }).catch(function () { return undefined; }),
        query(window.sb.from('smyl_patient_files').select('category').eq('tenant_id', state.tenant).eq('patient_id', id).eq('status', 'active').limit(300)).catch(function () { return undefined; }),
        query(window.sb.from('smyl_appointments').select('starts_at').eq('tenant_id', state.tenant).eq('patient_id', id).eq('status', 'confirmed').gt('starts_at', new Date().toISOString()).order('starts_at').limit(1)).then(function (rows) { return rows && rows[0] ? rows[0].starts_at : null; }).catch(function () { return undefined; })
      ]);
      if (state.visit !== v) return;
      if (!res[0]) throw new Error('No encontré a este paciente.');
      if (!state.access || state.accessTenant !== state.tenant) await loadAccess();
      v.patient = res[0]; v.history = res[1]; v.files = res[2]; v.next = res[3]; v.loading = false;
      remember(id, Q.listName(v.patient) === 'Por registrar' ? (v.patient.telefono || 'Por registrar') : Q.displayName(v.patient));
    } catch (e) { if (state.visit !== v) return; v.loading = false; v.error = errorText(e); }
    renderVisit();
  }
  function openVisit(id) { showView('visit'); loadVisit(id); }
  function closeVisit() { state.visit = null; state.interview = null; showView('home'); renderResume(); }
  function endVisit() { forget(); state.visit = null; state.interview = null; state.flash = 'Visita terminada.'; showView('home'); renderResume(); renderFlash(); renderPill('consultorio'); }
  function renderFlash() { var f = $('[data-co-flash]'); if (!f) return; f.textContent = state.flash || ''; f.hidden = !state.flash; state.flash = ''; }
  function visitAction(id, step, button) {
    var v = state.visit, patient = v && v.patient; if (!patient) return;
    if (id === 'complete') { if (typeof window.abrirModalPaciente === 'function') { window.abrirModalPaciente(patient.id); watchModal(patient.id); } }
    else if (id === 'qr') openQr(patient);
    else if (id === 'link') { if (typeof window.enviarEnlaceRegistro === 'function') window.enviarEnlaceRegistro({ id: patient.id, telefono: patient.telefono }, button); }
    else if (id === 'confirm') confirmData(patient, button);
    else if (id === 'interview') startInterview(step.state === 'done');
    else if (id === 'history') openSection(patient.id, 'history');
    else if (id === 'files') openSection(patient.id, 'files');
    else if (id === 'simulator') location.href = simulatorUrl(patient.id);
  }
  async function confirmData(patient, button) {
    button.disabled = true;
    try {
      var row = await query(window.sb.from('camila_pacientes').update({ registro_estado: 'completo', updated_at: new Date().toISOString() }).eq('id', patient.id).eq('tenant_id', state.tenant).eq('registro_estado', 'por_verificar').select('id').single());
      if (!row) throw new Error('La confirmación no fue registrada.');
      loadVisit(patient.id);
    } catch (e) { button.disabled = false; var note = $('[data-co-visit-note]'); if (note) note.textContent = 'No se pudo confirmar. Puede que otra persona ya lo hiciera o que tu rol no lo permita; actualiza e inténtalo de nuevo.'; }
  }
  /* El formulario de datos es el del panel: al cerrarse, se vuelve a leer al paciente. */
  function watchModal(id) {
    var modal = document.getElementById('modal-paciente'), seen = false, ticks = 0;
    if (!modal) return;
    var timer = setInterval(function () {
      var open = modal.classList.contains('visible'); // así abre y cierra el formulario del panel (abrirModalPaciente / cerrarModalPaciente)
      ticks++;
      if (open) seen = true;
      if ((seen && !open) || ticks > 900) { clearInterval(timer); if (seen && state.visit && state.visit.id === id) loadVisit(id); }
    }, 800);
  }
  function renderVisit() {
    var host = $('[data-co-visit]'), v = state.visit; if (!host || !v) return;
    host.replaceChildren();
    var back = el('button', 'co-link-btn co-back', '‹ Consultorio'); back.type = 'button'; back.onclick = closeVisit; host.append(back);
    if (v.loading) { host.append(el('p', 'co-note', 'Cargando al paciente…')); return; }
    if (v.error) { var retry = el('button', 'co-retry', 'Intentar de nuevo'); retry.type = 'button'; retry.onclick = function () { loadVisit(v.id); }; host.append(el('p', 'co-note', v.error), retry); return; }
    var p = v.patient, appt = appointmentOf(p.id), label = Q.listName(p), model = V.build({ patient: p, history: v.history, files: v.files, historyModel: window.SmylHistoryModel, canManage: can('patients.manage'), canWriteClinical: !!I && can('clinical.write') });
    var head = el('div', 'co-vhead'), who = el('div', 'co-q');
    who.append(el('h1', 'co-vname', label), el('small', '', [p.telefono, appt ? STATUS[appt.status] + ', ' + fmtTime(appt.starts_at) : ''].filter(Boolean).join('. ')));
    head.append(el('span', 'co-av co-av-lg', Q.initials(Q.isPending(p) ? '' : Q.displayName(p))), who); host.append(head);
    var bar = el('div', 'co-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(model.total)); bar.setAttribute('aria-valuenow', String(model.done)); bar.setAttribute('aria-label', 'Avance de la visita');
    var fill = el('i'); fill.style.width = Math.round(model.done / model.total * 100) + '%'; bar.append(fill);
    host.append(bar, el('p', 'co-vprogress', model.done === model.total ? 'Todo listo para esta visita.' : model.done + ' de ' + model.total + ' pasos listos.'));
    if (state.notice) { var ok = el('p', 'co-success', state.notice); ok.setAttribute('role', 'status'); host.append(ok); state.notice = ''; }
    var list = el('ol', 'co-steps');
    model.steps.forEach(function (step, i) {
      var li = el('li', 'co-step'); li.dataset.state = step.state; li.dataset.key = step.key; if (step.current) li.dataset.current = 'true';
      var mark = el('span', 'co-mark', step.state === 'done' ? STEP_MARK.done : String(i + 1)); mark.setAttribute('aria-hidden', 'true');
      var body = el('div', 'co-sbody'), t = el('b', '', step.title); body.append(t, el('small', '', step.text));
      var acts = el('div', 'co-sacts');
      step.actions.forEach(function (a) { var b = el('button', a.primary ? 'co-sgo' : 'co-sec', a.label); b.type = 'button'; b.onclick = function () { visitAction(a.id, step, b); }; acts.append(b); });
      body.append(acts); li.append(mark, body); list.append(li);
    });
    host.append(list);
    host.append(el('p', 'co-note', ''));
    host.lastChild.dataset.coVisitNote = '';
    var full = el('button', 'co-tile co-full', 'Abrir expediente completo'); full.type = 'button'; full.onclick = function () { openPatient(p.id); };
    var close = el('button', 'co-sgo co-close', 'Cerrar la visita'); close.type = 'button'; close.onclick = openClose;
    host.append(full, close);
  }

  /* ── Historia por preguntas ──
   * Una pregunta a la vez, con el mismo documento y el mismo guardado que el editor del expediente (SmylHistoryInterview arma el
   * documento con SmylHistoryModel). El borrador vive solo en memoria; lo único que guarda es «Guardar historia» al final. */
  var ROW_FIELDS = {
    allergy: [['substance', 'Alergia a', 'Ej. penicilina'], ['reaction', 'Reacción (opcional)', 'Ej. urticaria']],
    alert: [['text', 'Qué debe saberse', 'Ej. toma anticoagulantes']],
    condition: [['name', 'Condición', 'Ej. hipertensión']],
    medication: [['name', 'Medicamento', 'Ej. losartán'], ['dose', 'Dosis (opcional)', 'Ej. 50 mg'], ['frequency', 'Frecuencia (opcional)', 'Ej. cada 24 horas']],
    surgery: [['procedure', 'Cirugía u hospitalización', 'Ej. apendicectomía']]
  };
  var SEVERITY = [['low', 'Baja'], ['moderate', 'Moderada'], ['high', 'Alta']];
  function startInterview(all) {
    var v = state.visit, H = window.SmylHistoryModel;
    if (!I || !H || !v || !v.patient || v.history === undefined) return;
    var keys = all ? I.QUESTIONS.map(function (q) { return q.key; }) : I.pendingKeys(v.rawDoc, H);
    if (!keys.length) keys = I.QUESTIONS.map(function (q) { return q.key; });
    state.interview = { patientId: v.patient.id, draft: I.create(v.rawDoc, H), keys: keys, index: 0, phase: 'question', saving: false, error: '' };
    showView('interview'); renderInterview();
  }
  function interviewDirty() { var iv = state.interview, v = state.visit; return !!(iv && I.isDirty(iv.draft, v && v.rawDoc)); }
  function leaveInterview() {
    if (interviewDirty() && !window.confirm('¿Salir sin guardar? Las respuestas de esta entrevista se perderán.')) return;
    state.interview = null; showView('visit'); renderVisit();
  }
  function questionIndex(key) { return I.QUESTIONS.map(function (q) { return q.key; }).indexOf(key); }
  function syncInterviewNav() {
    var iv = state.interview; if (!iv || iv.phase !== 'question') return;
    var next = $('[data-co-next]'); if (next) next.disabled = !I.isAnswered(iv.draft, iv.keys[iv.index]);
  }
  function ivButton(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
  function renderInterview() {
    var iv = state.interview, host = $('[data-co-interview]'), v = state.visit; if (!host || !iv) return;
    host.replaceChildren();
    var name = v && v.patient ? (Q.isPending(v.patient) ? 'Por registrar' : Q.displayName(v.patient)) : '';
    var top = el('div', 'co-ivtop'); top.append(ivButton('‹ Salir', 'co-link-btn', leaveInterview), el('span', 'co-ivname', name)); host.append(top);
    if (iv.phase === 'review') { renderReview(host); return; }
    var key = iv.keys[iv.index], q = I.question(key), a = iv.draft.answers[key];
    var seg = el('div', 'co-seg'); seg.setAttribute('role', 'progressbar'); seg.setAttribute('aria-valuemin', '1'); seg.setAttribute('aria-valuemax', String(iv.keys.length)); seg.setAttribute('aria-valuenow', String(iv.index + 1)); seg.setAttribute('aria-label', 'Pregunta ' + (iv.index + 1) + ' de ' + iv.keys.length);
    iv.keys.forEach(function (k, i) { var s2 = el('i'); if (i <= iv.index) s2.dataset.on = 'true'; seg.append(s2); });
    host.append(seg, el('p', 'co-vprogress', 'Pregunta ' + (iv.index + 1) + ' de ' + iv.keys.length));
    var title = el('h1', 'co-qtitle', q.title); title.tabIndex = -1; host.append(title);
    if (q.hint) { var hint = el('p', 'co-hint', q.hint); if (q.safety) hint.dataset.safety = 'true'; host.append(hint); }
    var locked = q.kind === 'text' ? !!a.text.trim() : a.rows.some(function (r) { return Object.keys(r).some(function (f) { return String(r[f] || '').trim(); }); });
    var choice = el('div', 'co-choice'); choice.setAttribute('role', 'group'); choice.setAttribute('aria-label', q.label);
    [['no', 'No'], ['yes', 'Sí']].concat(q.safety ? [] : [['unknown', 'No lo sé']]).forEach(function (c) {
      var b = ivButton(c[1], 'co-ch', function () { iv.draft = I.setStatus(iv.draft, key, c[0]); renderInterview(); });
      b.setAttribute('aria-pressed', String(a.status === c[0])); b.dataset.value = c[0];
      if (locked && c[0] !== 'yes') { b.disabled = true; b.title = 'Quita primero lo que ya está registrado'; }
      choice.append(b);
    });
    host.append(choice);
    if (q.safety && !locked) host.append(ivButton('No lo sé, confirmarlo después', 'co-sec co-later', function () { iv.draft = I.setStatus(iv.draft, key, 'unknown'); renderInterview(); }));
    if (a.status === 'unknown' && !locked) host.append(el('p', 'co-note', 'Quedará como «no se sabe» y la historia seguirá pendiente de confirmar.'));
    if (a.status === 'yes' || locked) host.append(q.kind === 'text' ? textEditor(iv, q, a) : rowsEditor(iv, q, a));
    var nav = el('div', 'co-ivnav');
    nav.append(ivButton('Anterior', 'co-sec', function () { if (iv.index > 0) { iv.index--; renderInterview(); } else leaveInterview(); }));
    var next = ivButton(iv.index === iv.keys.length - 1 ? 'Revisar' : 'Siguiente', 'co-sgo', function () { if (iv.index < iv.keys.length - 1) iv.index++; else iv.phase = 'review'; renderInterview(); });
    next.dataset.coNext = ''; next.disabled = !I.isAnswered(iv.draft, key); nav.append(next); host.append(nav);
    title.focus({ preventScroll: false });
  }
  function labeledInput(label, placeholder, value, onInput, tag) {
    var wrap = el('label', 'co-field'), input = document.createElement(tag || 'input');
    if (!tag) input.type = 'text'; else input.rows = 3;
    input.value = value || ''; input.placeholder = placeholder || ''; input.maxLength = tag ? 600 : 150; input.autocomplete = 'off';
    input.addEventListener('input', function () { onInput(input.value); syncInterviewNav(); });
    wrap.append(el('span', '', label), input); return wrap;
  }
  function textEditor(iv, q, a) {
    var box = el('div', 'co-editor');
    box.append(labeledInput(q.primaryLabel, q.primaryHint, a.text, function (value) { iv.draft = I.setText(iv.draft, q.key, value); }, 'textarea'));
    return box;
  }
  function rowsEditor(iv, q, a) {
    var box = el('div', 'co-editor'), record = q.kind === 'alert' ? 'alert' : q.record;
    a.rows.forEach(function (row, i) {
      var card = el('fieldset', 'co-rowcard'); if (a.rows.length > 1) card.append(el('legend', '', q.primaryLabel + ' ' + (i + 1)));
      ROW_FIELDS[record].forEach(function (f) { card.append(labeledInput(f[1], f[2], row[f[0]], function (value) { iv.draft = I.setField(iv.draft, q.key, i, f[0], value); })); });
      if (record === 'allergy') {
        var sev = el('div', 'co-sev'); sev.setAttribute('role', 'group'); sev.setAttribute('aria-label', 'Gravedad');
        SEVERITY.forEach(function (c) { var b = ivButton(c[1], 'co-chipbtn', function () { iv.draft = I.setField(iv.draft, q.key, i, 'severity', row.severity === c[0] ? '' : c[0]); renderInterview(); }); b.setAttribute('aria-pressed', String(row.severity === c[0])); sev.append(b); });
        card.append(el('span', 'co-fieldlabel', 'Gravedad (opcional)'), sev);
      }
      var empty = !Object.keys(row).some(function (f) { return String(row[f] || '').trim(); });
      if (a.rows.length > 1 || !empty) card.append(ivButton('Quitar', 'co-link-btn co-remove', function () { iv.draft = I.removeRow(iv.draft, q.key, i); renderInterview(); }));
      box.append(card);
    });
    if (a.rows.length < (window.SmylHistoryModel.MAX_RECORDS || 20)) box.append(ivButton('+ ' + q.add, 'co-sec co-addrow', function () { iv.draft = I.addRow(iv.draft, q.key); renderInterview(); }));
    return box;
  }
  function renderReview(host) {
    var iv = state.interview, probs = I.problems(iv.draft), dirty = interviewDirty();
    var title = el('h1', 'co-qtitle', 'Revisa y guarda'); title.tabIndex = -1;
    host.append(title, el('p', 'co-hint', 'Esto es lo que quedará en la historia clínica. Puedes cambiar cualquier respuesta.'));
    var list = el('ul', 'co-review');
    I.QUESTIONS.forEach(function (q) {
      var li = el('li'), lines = I.summary(iv.draft, q.key), problem = probs.filter(function (p) { return p.key === q.key; })[0];
      var info = el('div', 'co-q'); info.append(el('b', '', q.label)); lines.forEach(function (l) { info.append(el('small', '', l)); });
      if (problem) { var pe = el('small', 'co-problem', problem.message); info.append(pe); }
      li.append(info, ivButton('Cambiar', 'co-link-btn', function () { iv.keys = I.QUESTIONS.map(function (x) { return x.key; }); iv.index = questionIndex(q.key); iv.phase = 'question'; renderInterview(); }));
      list.append(li);
    });
    host.append(list);
    var err = el('p', 'co-error-box', iv.error); err.setAttribute('role', 'alert'); err.hidden = !iv.error; host.append(err);
    if (!dirty) host.append(el('p', 'co-note', 'No hay cambios que guardar.'));
    var save = ivButton(iv.saving ? 'Guardando…' : 'Guardar historia', 'co-sgo co-save', saveInterview); save.disabled = iv.saving || !dirty || probs.length > 0; save.dataset.coSave = '';
    var back = ivButton('Volver', 'co-sec', function () { iv.phase = 'question'; iv.index = Math.min(iv.index, iv.keys.length - 1); renderInterview(); });
    var nav = el('div', 'co-ivnav'); nav.append(back, save); host.append(nav);
    title.focus({ preventScroll: false });
  }
  async function saveInterview() {
    var iv = state.interview, v = state.visit; if (!iv || iv.saving || !v) return;
    if (I.problems(iv.draft).length) return;
    iv.saving = true; iv.error = ''; renderInterview();
    try {
      await rpc('smyl_save_patient_history', { p_patient_id: iv.patientId, p_expected_revision: v.revision, p_document: I.toDocument(iv.draft) });
      state.interview = null; state.notice = 'Historia guardada.'; showView('visit'); loadVisit(iv.patientId);
    } catch (e) {
      iv.saving = false;
      iv.error = e && e.code === '40001' ? 'La historia cambió en otra sesión y tus respuestas no se guardaron. Sal y vuelve a empezar para ver lo último.'
        : e && e.code === '42501' ? 'Tu rol no permite guardar datos clínicos.' : errorText(e);
      renderInterview();
    }
  }


  /* ── Cierre de la visita ──
   * Resumen de lo que quedó hecho y lo que falta, y los pasos que suelen seguir: agendar, cobrar y despedirse. No bloquea nada:
   * se puede terminar con pasos pendientes (siguen en «Te falta resolver» del expediente). Cobros y la agenda se abren en sus
   * pantallas; el mensaje de WhatsApp solo lleva cortesía y la próxima cita. */
  function fmtLong(v) { return new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(v)) + ' a las ' + fmtTime(v); }
  function openClose() { if (!state.visit || !state.visit.patient) return; showView('close'); renderClose(); }
  function backToVisit() { showView('visit'); renderVisit(); }
  function renderClose() {
    var host = $('[data-co-close]'), v = state.visit; if (!host || !v || !v.patient) return;
    host.replaceChildren();
    var p = v.patient, name = Q.isPending(p) ? 'Por registrar' : Q.displayName(p);
    var top = el('div', 'co-ivtop'); top.append(ivButton('‹ Volver a la visita', 'co-link-btn', backToVisit), el('span', 'co-ivname', name)); host.append(top);
    var title = el('h1', 'co-qtitle', 'Cerrar la visita'); title.tabIndex = -1; host.append(title);
    var model = V.build({ patient: p, history: v.history, files: v.files, historyModel: window.SmylHistoryModel, canManage: can('patients.manage'), canWriteClinical: !!I && can('clinical.write') }), sum = V.closing(model);
    host.append(el('p', 'co-hint', sum.missing ? 'Quedó pendiente ' + (sum.missing === 1 ? '1 cosa' : sum.missing + ' cosas') + '. Puedes terminar la visita igual y retomarlo después.' : sum.unchecked ? 'No pude comprobar todo con tu rol, revisa lo que aparece como «sin comprobar».' : 'Todo lo de esta visita quedó listo.'));
    var list = el('ul', 'co-review co-closing');
    sum.items.forEach(function (it) {
      var li = el('li'), info = el('div', 'co-q'), mark = el('span', 'co-cmark', it.state === 'done' ? '✓' : it.state === 'todo' ? '!' : '?');
      mark.dataset.state = it.state; mark.setAttribute('aria-hidden', 'true');
      info.append(el('b', '', it.title), el('small', '', it.state === 'unknown' ? 'Sin comprobar.' : it.text));
      li.dataset.state = it.state; li.append(mark, info);
      if (it.state !== 'done') li.append(ivButton(it.state === 'todo' ? 'Completar' : 'Ver', 'co-link-btn', backToVisit));
      list.append(li);
    });
    host.append(list);
    /* Próxima cita */
    var next = v.next, nextText = next ? fmtLong(next) : '';
    var sec = el('div', 'co-csec');
    sec.append(el('b', '', 'Próxima cita'), el('small', '', next === undefined ? 'No se pudo comprobar.' : next ? nextText : 'Todavía no tiene una agendada.'));
    if (can('schedule.manage') && window.SmylSchedule && typeof window.SmylSchedule.bookFor === 'function') {
      var book = ivButton(next ? 'Agendar otra cita' : 'Agendar cita', next ? 'co-sec' : 'co-sgo', function () { window.SmylSchedule.bookFor({ id: p.id, nombre: p.nombre, apellido: p.apellido, telefono: p.telefono, email: p.email }); });
      book.dataset.coBook = ''; sec.append(book);
    }
    host.append(sec);
    /* Cobro */
    if (can('finance.read')) {
      var pay = el('div', 'co-csec'); pay.append(el('b', '', 'Cobro'), el('small', '', 'Abre Cobros, donde aparece el cargo pendiente de esta visita.'));
      var go = ivButton('Ir a Cobros', 'co-sec', function () { if (typeof window.ir === 'function') window.ir('caja'); }); go.dataset.coPay = ''; pay.append(go); host.append(pay);
    }
    /* Despedida por WhatsApp */
    var message = V.farewell({ name: Q.isPending(p) ? '' : Q.displayName(p), nextText: nextText }), url = Q.whatsappUrl(p.telefono, message);
    var wa = el('div', 'co-csec'); wa.append(el('b', '', 'Despedida'), el('small', '', 'Mensaje que se enviará (puedes editarlo en WhatsApp):'));
    var box = el('p', 'co-msg', message); box.dataset.coMsg = ''; wa.append(box);
    var send = ivButton('Enviar por WhatsApp', 'co-sec', function () { window.open(url, '_blank', 'noopener'); }); send.dataset.coSend = '';
    if (!url) { send.disabled = true; wa.append(send, el('small', '', 'Falta un teléfono válido para enviarlo.')); } else wa.append(send);
    host.append(wa);
    var end = ivButton('Terminar la visita', 'co-sgo co-end co-endfull', endVisit);
    host.append(end);
    title.focus({ preventScroll: false });
  }


  /* ── Código QR de registro ──
   * La persona escanea el código y llena sus datos en su propio celular (registro-paciente.html, enlace de un solo uso que
   * vence a los 7 días). Mientras el código está abierto, la pantalla revisa cada pocos segundos si ya terminó. */
  var QR_POLL_MS = Number(window.SMYL_QR_POLL_MS) || 4000, QR_MAX_POLLS = 150;
  state.qr = null;
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    try { var code = window.qrcode(0, 'M'); code.addData(text); code.make(); return code.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { return ''; }
  }
  function registrationUrl(token) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'registro-paciente.html?token=' + encodeURIComponent(token); }
  function stopQr() { if (state.qr) { clearInterval(state.qr.timer); state.qr = null; } }
  function qrError(err) {
    var code = err && err.code, msg = String(err && err.message || '');
    if (code === '42501') return 'Tu rol no permite crear enlaces de registro.';
    if (/PGRST202|42883|schema cache/i.test(code + ' ' + msg)) return 'Falta aplicar la migración de enlaces de registro en la base de datos.';
    if (code === '22023') return 'Este paciente ya tiene su registro completo.';
    return 'No se pudo crear el código. Revisa tu conexión e inténtalo de nuevo.';
  }
  async function readRegistration(id) {
    var row;
    try { row = await query(window.sb.from('camila_pacientes').select('registro_estado,nombre').eq('tenant_id', state.tenant).eq('id', id).maybeSingle()); }
    catch (e) { row = await query(window.sb.from('camila_pacientes').select('nombre').eq('tenant_id', state.tenant).eq('id', id).maybeSingle()); }   // sin la columna aún: se deduce del nombre
    return row;
  }
  async function openQr(patient) {
    var d = dialog(); if (!d) return;
    stopQr();
    var q = state.qr = { id: patient.id, timer: null, polls: 0 };
    d.innerHTML = '<div class="co-form co-qr"><header><h2>Que llene sus datos</h2><button type="button" class="co-x" data-co-cancel aria-label="Cerrar">×</button></header><div data-co-qr-body><p class="co-ok"><span>Preparando el código…</span></p></div></div>';
    d.querySelector('[data-co-cancel]').onclick = closeDialog;
    d.addEventListener('close', function () { if (state.qr === q) stopQr(); }, { once: true });
    if (!d.open) d.showModal();
    var body = d.querySelector('[data-co-qr-body]');
    try {
      var token = await rpc('smyl_create_registration_link', { p_patient_id: patient.id });
      if (state.qr !== q) return;
      if (!/^[0-9a-f]{64}$/.test(String(token || ''))) throw new Error('Respuesta inesperada.');
      var url = registrationUrl(token), svg = qrSvg(url);
      body.replaceChildren();
      var box = el('div', 'co-qrbox'); box.setAttribute('role', 'img'); box.setAttribute('aria-label', 'Código QR para que el paciente llene sus datos');
      if (svg) box.innerHTML = svg; else box.append(el('p', 'co-note-dark', 'No se pudo dibujar el código. Usa el enlace de abajo.'));
      var hint = el('p', 'co-qrhint', 'Que lo escanee con la cámara de su celular. El enlace sirve una sola vez y vence en 7 días.');
      var status = el('p', 'co-qrstatus'); status.setAttribute('role', 'status'); status.dataset.coQrStatus = '';
      var dot = el('i', 'co-pulse'); dot.setAttribute('aria-hidden', 'true'); status.append(dot, el('span', '', 'Esperando a que termine…'));
      var field = document.createElement('input'); field.className = 'co-qrlink'; field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Enlace de registro'); field.onfocus = function () { field.select(); };
      var acts = el('div', 'co-actions'), wa = Q.whatsappUrl(patient.telefono, 'Hola, para tener tu expediente listo antes de tu cita, completa tus datos aquí (vence en 7 días): ' + url);
      function act(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.onclick = fn; acts.append(b); return b; }
      if (wa) act('Enviarlo por WhatsApp', 'co-secondary', function () { window.open(wa, '_blank', 'noopener'); }).dataset.coQrWa = '';
      var copy = act('Copiar enlace', 'co-secondary', async function () { try { await navigator.clipboard.writeText(url); copy.textContent = 'Enlace copiado'; } catch (e) { field.focus(); field.select(); copy.textContent = 'Selecciona y copia el enlace'; } });
      act('Cerrar', 'co-ghost', closeDialog);
      body.append(box, hint, status, field, acts);
      q.timer = setInterval(async function () {
        if (state.qr !== q) return;
        q.polls++;
        if (q.polls > QR_MAX_POLLS) { clearInterval(q.timer); status.replaceChildren(el('span', '', 'Dejé de esperar. Cierra y vuelve a abrir el código si hace falta.')); return; }
        try {
          var row = await readRegistration(patient.id);
          if (state.qr !== q || !row) return;
          if (!Q.isPending(row)) {
            clearInterval(q.timer);
            status.replaceChildren(el('span', 'co-qrdone', '✓ Ya llenó sus datos.'), el('small', '', row.registro_estado === 'por_verificar' ? ' Falta que los confirmes.' : ''));
            acts.replaceChildren(); act('Ver sus datos', 'co-submit', function () { closeDialog(); loadVisit(patient.id); });
          }
        } catch (e) { /* sin conexión un momento: se sigue intentando */ }
      }, QR_POLL_MS);
    } catch (err) {
      if (state.qr !== q) return;
      body.replaceChildren(el('p', 'co-error', qrError(err)), (function () { var b = el('button', 'co-ghost', 'Cerrar'); b.type = 'button'; b.onclick = closeDialog; return b; })());
    }
  }

  /* Mientras haya una visita sin terminar y se esté en otra pantalla (p. ej. el expediente), un botón fijo permite regresar a ella. */
  function renderPill(route) {
    var pill = document.getElementById('smyl-co-pill'), m = remembered();
    if (!m || route === 'consultorio') { if (pill) pill.hidden = true; return; }
    if (!pill) {
      pill = el('button', 'smyl-co-pill'); pill.id = 'smyl-co-pill'; pill.type = 'button';
      pill.onclick = function () { var again = remembered(); if (!again) return; if (typeof window.ir === 'function') window.ir('consultorio'); openVisit(again.id); };
      document.body.append(pill);
    }
    pill.textContent = 'Volver a la visita de ' + m.name; pill.hidden = false;
  }
  /* Cuando se vuelve al Consultorio con una visita sin terminar, se ofrece retomarla (no se fuerza). */
  function renderResume() {
    var host = $('[data-co-resume]'); if (!host) return;
    host.replaceChildren();
    var m = remembered(); if (!m) { host.hidden = true; return; }
    host.hidden = false;
    var b = el('button', 'co-resume-btn'); b.type = 'button';
    var info = el('span', 'co-q'); info.append(el('small', '', 'Visita en curso'), el('b', '', m.name));
    b.append(info, el('span', 'co-chip', 'Continuar')); b.onclick = function () { openVisit(m.id); };
    host.append(b);
  }

  /* ── Montaje ── */
  function build() {
    var host = document.querySelector('.contenido');
    if (!host || root()) return;
    var page = el('section', 'pantalla consultorio'); page.id = 'p-consultorio'; page.setAttribute('aria-labelledby', 'co-title');
    page.innerHTML = '<div class="co-wrap"><header class="co-head"><span class="co-logo">SMYL</span><button type="button" class="co-link-btn" data-co-panel>Panel completo</button></header>'
      + '<div data-co-home><h1 id="co-title" data-co-greeting>Consultorio</h1><p class="co-sub" data-co-sub></p><p class="co-flash" data-co-flash role="status" hidden></p><div data-co-resume hidden></div>'
      + '<button type="button" class="co-primary" data-co-new><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.5 3-6 7-6M18 8v6M15 11h6"/></svg>Paciente nuevo</button>'
      + '<div class="co-pair"><a class="co-tile" data-co-sim href="' + esc(simulatorUrl()) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/></svg>Simulador</a>'
      + '<button type="button" class="co-tile" data-co-agenda><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>Agenda</button></div>'
      + '<div class="co-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" data-co-q placeholder="Buscar paciente" aria-label="Buscar paciente" autocomplete="off" spellcheck="false"></div>'
      + '<ul class="co-results" data-co-results hidden></ul>'
      + '<h2 class="co-heading">En el consultorio</h2><div data-co-list></div>'
      + '<footer class="co-foot"><button type="button" class="co-link-btn" data-co-logout>Cerrar sesión</button></footer></div>'
      + '<div data-co-visit hidden></div><div data-co-interview hidden></div><div data-co-close hidden></div></div>'
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
    if (typeof previous === 'function') window.ir = function (name) { var result = previous(name); if (name === 'consultorio') { var q = $('[data-co-q]'); if (q) { q.value = ''; renderResults(null); } state.visit = null; state.interview = null; stopQr(); showView('home'); renderResume(); load(true); } renderPill(name); return result; };
    window.addEventListener('smyl:appointments-changed', function () { if (state.loaded) load(true); });
  }
  window.SmylConsultorio = { reload: function () { return load(true); }, openVisit: openVisit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
