/* SMYL · Privacidad y derechos de los pacientes: solicitudes ARCO (acceso, rectificación, cancelación, oposición y revocación),
   decisiones de privacidad por finalidad y exportación de datos del paciente. Todo pasa por funciones de la base con permiso
   patients.manage (smyl_open_data_request, smyl_update_data_request, smyl_set_patient_privacy_choice, smyl_patient_privacy_status,
   smyl_export_patient_data). El texto que se muestra es de la base: aquí no se arma HTML con datos, solo textContent. */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylPrivacyRights = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var RIGHTS = { access: 'Acceso', rectification: 'Rectificación', cancellation: 'Cancelación', opposition: 'Oposición', revocation: 'Revocación del consentimiento' };
  var CHANNELS = { in_person: 'En persona', email: 'Correo', whatsapp: 'WhatsApp', phone: 'Teléfono', other: 'Otro' };
  var STATUS = { received: 'Recibida', in_review: 'En revisión', completed: 'Atendida', rejected: 'Rechazada' };
  var PURPOSES = {
    ai_processing: { label: 'Uso de IA con proveedores externos', help: 'Enviar sus fotos y datos a herramientas de inteligencia artificial para analizarlos o simularlos.' },
    whatsapp: { label: 'Mensajes por WhatsApp', help: 'Recordatorios, confirmaciones y seguimiento por WhatsApp.' },
    marketing: { label: 'Promociones y mercadotecnia', help: 'Promociones, campañas y comunicaciones comerciales.' }
  };
  var STATE_LABEL = { granted: 'Lo permite', revoked: 'Lo retiró', unknown: 'Sin registrar' };
  var state = { requests: [], names: {}, filter: 'open', tab: 'requests', loading: false, error: '', tenant: null, patient: null, patientQuery: '', results: [] };

  // ── Reglas puras ──
  function dayNumber(value) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN; }
  function todayText(now) { var d = now || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  // Estado del plazo: cerrada | vencida | por vencer (hasta 3 días) | en plazo.
  function dueInfo(request, today) {
    if (!request) return { kind: 'unknown', text: '' };
    if (request.status === 'completed' || request.status === 'rejected') return { kind: 'closed', text: STATUS[request.status] };
    var days = dayNumber(request.due_on) - dayNumber(today);
    if (!Number.isFinite(days)) return { kind: 'unknown', text: '' };
    if (days < 0) return { kind: 'overdue', days: days, text: 'Vencida hace ' + plural(-days, 'día', 'días') };
    if (days === 0) return { kind: 'soon', days: 0, text: 'Vence hoy' };
    if (days <= 3) return { kind: 'soon', days: days, text: 'Vence en ' + plural(days, 'día', 'días') };
    return { kind: 'ok', days: days, text: 'Vence en ' + plural(days, 'día', 'días') };
  }
  function isOpen(request) { return request && (request.status === 'received' || request.status === 'in_review'); }
  function counts(requests, today) {
    var open = 0, overdue = 0;
    (requests || []).forEach(function (r) { if (!isOpen(r)) return; open += 1; if (dueInfo(r, today).kind === 'overdue') overdue += 1; });
    return { open: open, overdue: overdue };
  }
  function visible(requests, filter) {
    return (requests || []).filter(function (r) { return filter === 'all' ? true : filter === 'closed' ? !isOpen(r) : isOpen(r); });
  }
  // Finalidades que una oposición o revocación puede retirar: las que no están ya retiradas.
  function revocablePurposes(status) {
    return Object.keys(PURPOSES).filter(function (key) { return !status || !status[key] || status[key].state !== 'revoked'; });
  }
  function fileName(patient, today) {
    var base = [patient && patient.nombre, patient && patient.apellido].filter(Boolean).join('-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return 'datos-' + (base || 'paciente') + '-' + (today || todayText()) + '.json';
  }
  function friendly(error) {
    var code = error && error.code || ''; var message = String(error && error.message || '');
    if (code === '42501') return 'Tu rol no permite gestionar privacidad ni derechos de pacientes.';
    if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist|schema cache/i.test(message)) return 'Esta función todavía no está activada en tu clínica.';
    if (code === '55000') return 'Esa solicitud ya está cerrada y no se puede modificar.';
    if (code === '22023' || code === 'P0002') return message.replace(/^.*?:\s*/, '') || 'Revisa los datos.';
    return 'No se pudo completar la acción. Intenta de nuevo.';
  }

  // ── DOM ──
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; }
  function fullName(p) { return [p && p.nombre, p && p.apellido].filter(Boolean).join(' ') || 'Paciente'; }
  function field(label, control, hint) {
    var wrap = el('label', 'priv-field'); wrap.append(el('span', '', label), control); if (hint) wrap.append(el('small', '', hint)); return wrap;
  }
  function select(options, value) {
    var s = el('select'); Object.keys(options).forEach(function (k) { var o = el('option', '', options[k]); o.value = k; s.append(o); }); if (value) s.value = value; return s;
  }
  function message(text, tone) { var host = document.getElementById('priv-feedback'); if (!host) return; host.textContent = text || ''; host.dataset.tone = tone || ''; }
  function dialog(title) {
    var old = document.getElementById('priv-dialog'); if (old) old.remove();
    var d = el('dialog', 'priv-dialog'); d.id = 'priv-dialog';
    var form = el('form'); form.method = 'dialog'; form.append(el('h2', '', title)); d.append(form);
    var close = function () { d.close(); d.remove(); };
    d.addEventListener('cancel', function () { d.remove(); });
    document.body.append(d); return { d: d, form: form, close: close };
  }
  function actions(form, close, primaryLabel) {
    var row = el('div', 'priv-actions'); var cancel = el('button', 'btn btn-secondary', 'Cancelar'); cancel.type = 'button'; cancel.onclick = close;
    var ok = el('button', 'btn btn-primary', primaryLabel); ok.type = 'submit'; row.append(cancel, ok); form.append(row); return ok;
  }
  async function rpc(name, args) {
    var result = await win.sb.rpc(name, args || {});
    if (result.error) throw result.error;
    return result.data;
  }

  async function loadRequests() {
    if (!win || !win.sb || !win.tenantId || state.loading) return;
    state.loading = true; state.tenant = win.tenantId; state.error = ''; render();
    try {
      var res = await win.sb.from('smyl_data_rights_requests').select('*').eq('tenant_id', win.tenantId).order('due_on', { ascending: true }).limit(300);
      if (res.error) throw res.error;
      state.requests = res.data || [];
      var ids = state.requests.map(function (r) { return r.patient_id; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      state.names = {};
      if (ids.length) {
        var pats = await win.sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id', win.tenantId).in('id', ids);
        (pats.data || []).forEach(function (p) { state.names[p.id] = fullName(p); });
      }
    } catch (error) { state.error = friendly(error); }
    finally { state.loading = false; render(); }
  }

  async function searchPatients(text) {
    var q = String(text || '').trim();
    if (q.length < 2) return [];
    var term = q.replace(/[%,()]/g, ' ').trim();
    var res = await win.sb.from('camila_pacientes').select('id,nombre,apellido,telefono').eq('tenant_id', win.tenantId)
      .or('nombre.ilike.%' + term + '%,apellido.ilike.%' + term + '%').order('nombre').limit(12);
    if (res.error) throw res.error;
    return res.data || [];
  }

  function patientPicker(onPick) {
    var wrap = el('div', 'priv-picker'); var input = el('input'); input.type = 'search'; input.placeholder = 'Buscar paciente por nombre'; input.autocomplete = 'off';
    var list = el('div', 'priv-picker-list'); var timer = null;
    input.oninput = function () {
      clearTimeout(timer);
      timer = setTimeout(async function () {
        list.replaceChildren();
        try {
          var rows = await searchPatients(input.value);
          rows.forEach(function (p) {
            var b = el('button', 'priv-picker-item', fullName(p) + (p.telefono ? ' · ' + p.telefono : '')); b.type = 'button';
            b.onclick = function () { list.replaceChildren(); input.value = fullName(p); onPick(p); }; list.append(b);
          });
          if (!rows.length && input.value.trim().length >= 2) list.append(el('p', 'priv-muted', 'Sin resultados.'));
        } catch (error) { list.append(el('p', 'priv-muted', friendly(error))); }
      }, 250);
    };
    wrap.append(input, list); return wrap;
  }

  // ── Nueva solicitud ──
  function openNewRequest(preset) {
    var box = dialog('Nueva solicitud de derechos'); var chosen = preset || null;
    var right = select(RIGHTS, 'access'), channel = select(CHANNELS, 'in_person');
    var who = el('input'); who.maxLength = 150; who.placeholder = 'Nombre de quien solicita'; who.value = chosen ? fullName(chosen) : '';
    var contact = el('input'); contact.maxLength = 200; contact.placeholder = 'Teléfono o correo (opcional)';
    var details = el('textarea'); details.maxLength = 2000; details.rows = 3; details.placeholder = 'Qué pide la persona, con sus palabras.';
    var received = el('input'); received.type = 'date'; received.max = todayText(); received.value = todayText();
    var picked = el('p', 'priv-muted', chosen ? 'Paciente: ' + fullName(chosen) : 'Sin paciente seleccionado (úsalo solo si no tiene ficha).');
    var picker = patientPicker(function (p) { chosen = p; if (!who.value.trim()) who.value = fullName(p); picked.textContent = 'Paciente: ' + fullName(p); });
    box.form.append(el('p', 'priv-muted', 'Tienes 20 días hábiles para responder desde que la recibes. El plazo se calcula solo.'), field('Paciente', picker), picked,
      field('Derecho que ejerce', right), field('Por dónde llegó', channel), field('Quién solicita', who), field('Contacto', contact), field('Fecha en que se recibió', received), field('Detalle', details));
    var ok = actions(box.form, box.close, 'Registrar solicitud');
    box.form.onsubmit = async function (event) {
      event.preventDefault(); ok.disabled = true;
      try {
        await rpc('smyl_open_data_request', { p_patient_id: chosen ? chosen.id : null, p_right: right.value, p_channel: channel.value, p_requester_name: who.value, p_requester_contact: contact.value, p_details: details.value, p_received_on: received.value || null });
        box.close(); message('Solicitud registrada. El plazo corre desde hoy.', 'ok'); await loadRequests();
      } catch (error) { ok.disabled = false; message(friendly(error), 'error'); }
    };
    box.d.showModal();
  }

  // ── Atender solicitud ──
  async function exportData(patient) {
    try {
      var data = await rpc('smyl_export_patient_data', { p_patient_id: patient.id });
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = fileName(patient);
      document.body.append(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      message('Datos descargados. La historia clínica, las fotos y los documentos se entregan aparte, desde el expediente.', 'ok');
    } catch (error) { message(friendly(error), 'error'); }
  }

  async function openAttend(request) {
    var box = dialog('Atender solicitud'); var info = dueInfo(request, todayText());
    var name = request.patient_id ? (state.names[request.patient_id] || 'Paciente') : 'Sin ficha';
    box.form.append(el('p', 'priv-summary', RIGHTS[request.right_type] + ' · ' + request.requester_name), el('p', 'priv-muted', 'Paciente: ' + name + ' · Recibida por ' + CHANNELS[request.channel] + ' el ' + request.received_on + ' · ' + info.text));
    if (request.details) box.form.append(el('p', 'priv-details', request.details));
    var verified = el('input'); verified.type = 'checkbox'; verified.checked = !!request.identity_verified;
    var verifiedRow = el('label', 'priv-check'); verifiedRow.append(verified, el('span', '', 'Verifiqué la identidad de quien solicita'));
    var resolution = el('textarea'); resolution.maxLength = 2000; resolution.rows = 3; resolution.placeholder = 'Qué se resolvió o por qué se rechaza (al cerrar es obligatorio).';
    var purposesHost = el('div', 'priv-purposes');
    var checks = {};
    if ((request.right_type === 'opposition' || request.right_type === 'revocation') && request.patient_id) {
      purposesHost.append(el('strong', '', 'Al atenderla, retirar:'));
      var status = null; try { status = await rpc('smyl_patient_privacy_status', { p_patient_id: request.patient_id }); } catch (e) { status = null; }
      revocablePurposes(status).forEach(function (key) {
        var c = el('input'); c.type = 'checkbox'; checks[key] = c; var row = el('label', 'priv-check'); row.append(c, el('span', '', PURPOSES[key].label)); purposesHost.append(row);
      });
    }
    box.form.append(verifiedRow, field('Resolución', resolution), purposesHost);
    if (request.right_type === 'access' && request.patient_id) {
      var exp = el('button', 'btn btn-secondary', 'Descargar copia de sus datos'); exp.type = 'button';
      exp.onclick = function () { exportData({ id: request.patient_id, nombre: name, apellido: '' }); }; box.form.append(exp);
    }
    var row = el('div', 'priv-actions');
    var cancel = el('button', 'btn btn-secondary', 'Cerrar'); cancel.type = 'button'; cancel.onclick = box.close;
    var review = el('button', 'btn btn-secondary', 'Marcar en revisión'); review.type = 'button';
    var reject = el('button', 'btn btn-secondary', 'Rechazar'); reject.type = 'button';
    var done = el('button', 'btn btn-primary', 'Dar por atendida'); done.type = 'button';
    row.append(cancel, review, reject, done); box.form.append(row);
    var act = async function (status, button) {
      button.disabled = true;
      try {
        var revoke = Object.keys(checks).filter(function (k) { return checks[k].checked; });
        await rpc('smyl_update_data_request', { p_id: request.id, p_status: status, p_resolution: resolution.value, p_identity_verified: verified.checked, p_revoke_purposes: status === 'completed' && revoke.length ? revoke : null });
        box.close(); message(status === 'in_review' ? 'Solicitud en revisión.' : status === 'completed' ? 'Solicitud atendida y cerrada.' : 'Solicitud rechazada y cerrada.', 'ok'); await loadRequests();
      } catch (error) { button.disabled = false; message(friendly(error), 'error'); }
    };
    review.onclick = function () { act('in_review', review); }; reject.onclick = function () { act('rejected', reject); }; done.onclick = function () { act('completed', done); };
    box.form.onsubmit = function (e) { e.preventDefault(); };
    box.d.showModal();
  }

  // ── Pestaña «Solicitudes» ──
  function renderRequests(host) {
    var today = todayText(), c = counts(state.requests, today);
    var bar = el('div', 'priv-bar');
    var f = select({ open: 'Abiertas', closed: 'Cerradas', all: 'Todas' }, state.filter); f.setAttribute('aria-label', 'Filtrar solicitudes'); f.onchange = function () { state.filter = f.value; render(); };
    var summary = el('p', 'priv-summary', c.open ? plural(c.open, 'solicitud abierta', 'solicitudes abiertas') + (c.overdue ? ' · ' + plural(c.overdue, 'vencida', 'vencidas') : '') : 'No hay solicitudes abiertas.');
    if (c.overdue) summary.dataset.tone = 'error';
    var add = el('button', 'btn btn-primary', 'Nueva solicitud'); add.type = 'button'; add.onclick = function () { openNewRequest(null); };
    bar.append(summary, f, add); host.append(bar);
    var rows = visible(state.requests, state.filter);
    if (!rows.length) { host.append(el('div', 'priv-empty', state.filter === 'open' ? 'Cuando un paciente pida acceso, corrección, cancelación u oposición, regístralo aquí para llevar el plazo.' : 'No hay solicitudes en esta vista.')); return; }
    var list = el('div', 'priv-list');
    rows.forEach(function (r) {
      var info = dueInfo(r, today); var row = el('article', 'priv-row'); row.dataset.kind = info.kind;
      var main = el('div', 'priv-row-main'); main.append(el('strong', '', r.requester_name), el('span', '', RIGHTS[r.right_type] + ' · ' + CHANNELS[r.channel]), el('small', '', 'Recibida el ' + r.received_on + (r.patient_id ? ' · ' + (state.names[r.patient_id] || 'Paciente') : '')));
      var chip = el('span', 'priv-chip', info.text); chip.dataset.kind = info.kind;
      var open = el('button', 'btn btn-secondary', isOpen(r) ? 'Atender' : 'Ver'); open.type = 'button'; open.onclick = function () { openAttend(r); };
      row.append(main, chip, open); list.append(row);
    });
    host.append(list);
  }

  // ── Pestaña «Pacientes» ──
  async function selectPatient(p) {
    state.patient = { patient: p, privacy: null, notice: null, error: '' }; render();
    try {
      var results = await Promise.all([rpc('smyl_patient_privacy_status', { p_patient_id: p.id }), rpc('smyl_patient_consent_status', { p_patient_id: p.id }).catch(function () { return null; })]);
      state.patient.privacy = results[0]; state.patient.notice = results[1];
    } catch (error) { state.patient.error = friendly(error); }
    render();
  }
  async function setChoice(p, purpose, action) {
    try { await rpc('smyl_set_patient_privacy_choice', { p_patient_id: p.id, p_purpose: purpose, p_action: action, p_note: '' }); message('Decisión registrada.', 'ok'); await selectPatient(p); }
    catch (error) { message(friendly(error), 'error'); }
  }
  function renderPatients(host) {
    var picker = patientPicker(function (p) { selectPatient(p); }); host.append(el('p', 'priv-muted', 'Busca a un paciente para ver y registrar lo que permite.'), picker);
    var cur = state.patient; if (!cur) return;
    var card = el('section', 'priv-card'); var p = cur.patient;
    card.append(el('h3', '', fullName(p)));
    if (cur.error) { card.append(el('p', 'priv-muted', cur.error)); host.append(card); return; }
    var notice = cur.notice && cur.notice.signed ? 'Aviso de privacidad firmado el ' + String(cur.notice.signed_at || '').slice(0, 10) + (cur.notice.signer_name ? ' por ' + cur.notice.signer_name : '') + '.' : 'Aviso de privacidad sin firmar.';
    var noticeLine = el('p', 'priv-notice', notice); noticeLine.dataset.state = cur.notice && cur.notice.signed ? 'ok' : 'pending'; card.append(noticeLine);
    Object.keys(PURPOSES).forEach(function (key) {
      var s = cur.privacy && cur.privacy[key] || { state: 'unknown' }; var row = el('div', 'priv-purpose'); row.dataset.state = s.state;
      var copy = el('div'); copy.append(el('strong', '', PURPOSES[key].label), el('small', '', PURPOSES[key].help));
      var chip = el('span', 'priv-chip', STATE_LABEL[s.state] + (s.at ? ' · ' + String(s.at).slice(0, 10) : '')); chip.dataset.state = s.state;
      var grant = el('button', 'btn btn-secondary', 'Registrar que lo permite'); grant.type = 'button'; grant.disabled = s.state === 'granted'; grant.onclick = function () { setChoice(p, key, 'granted'); };
      var revoke = el('button', 'btn btn-secondary', 'Registrar que lo retira'); revoke.type = 'button'; revoke.disabled = s.state === 'revoked'; revoke.onclick = function () { setChoice(p, key, 'revoked'); };
      var btns = el('div', 'priv-purpose-actions'); btns.append(grant, revoke); row.append(copy, chip, btns); card.append(row);
    });
    var more = el('div', 'priv-actions');
    var req = el('button', 'btn btn-secondary', 'Registrar solicitud de derechos'); req.type = 'button'; req.onclick = function () { openNewRequest(p); };
    var exp = el('button', 'btn btn-secondary', 'Descargar copia de sus datos'); exp.type = 'button'; exp.onclick = function () { exportData(p); };
    more.append(req, exp); card.append(more); host.append(card);
  }

  /* ── Aviso automático por WhatsApp a pacientes nuevos ── */
  var autoState = { loaded: false, loading: false, error: '', settings: null, template: null, saving: false };
  function autoText(reason, ready) {
    if (ready === false) return 'La plantilla «aviso_privacidad_v1» todavía no está aprobada por WhatsApp. Solicítala en Mensajería → Plantillas y, cuando Meta la apruebe, el envío empezará solo.';
    if (ready === true) return 'La plantilla está aprobada.';
    return 'No se pudo comprobar el estado de la plantilla.';
  }
  async function loadAuto(force) {
    if (autoState.loading || (autoState.loaded && !force)) return;
    autoState.loading = true; autoState.error = ''; render();
    try {
      autoState.settings = await rpc('smyl_get_privacy_settings', {});
      autoState.template = null;
      try { var st = await win.sb.functions.invoke('privacy-notice-dispatch', { body: { action: 'status' } }); autoState.template = st && st.data && !st.error ? st.data : null; } catch (e) { autoState.template = null; }
      autoState.loaded = true;
    } catch (e) { autoState.error = friendly(e); }
    autoState.loading = false; render();
  }
  async function saveAuto(on) {
    if (autoState.saving) return; autoState.saving = true; render();
    try { autoState.settings = await rpc('smyl_set_privacy_settings', { p_auto_send: on }); message(on ? 'Listo: el aviso se enviará solo a pacientes nuevos.' : 'Listo: ya no se envía solo.', 'ok'); if (win.SmylPrivacyDispatch) win.SmylPrivacyDispatch.reset(); }
    catch (e) { message(friendly(e), 'error'); }
    autoState.saving = false; render();
  }
  function renderAuto(host) {
    if (!autoState.loaded && !autoState.loading && !autoState.error) { loadAuto(false); host.append(el('div', 'priv-empty', 'Cargando…')); return; }
    if (autoState.loading) { host.append(el('div', 'priv-empty', 'Cargando…')); return; }
    if (autoState.error) { host.append(el('div', 'priv-empty', autoState.error)); return; }
    var st = autoState.settings || {}, on = st.auto_send_notice === true, tpl = autoState.template;
    var card = el('div', 'priv-card');
    card.append(el('h2', '', 'Mandar el aviso de privacidad a pacientes nuevos'),
      el('p', 'priv-muted', 'Cuando alguien se registra por WhatsApp, SMYL le manda por ese mismo chat un enlace para leer el aviso, elegir sobre IA, WhatsApp y promociones, y firmar desde su celular. Se manda una sola vez por paciente y solo a quien se creó en los últimos 14 días y aún no firmó. Quien ya dijo que no a WhatsApp no recibe nada.'));
    var row = el('label', 'priv-switch'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on; cb.disabled = autoState.saving; cb.onchange = function () { saveAuto(cb.checked); };
    row.append(cb, el('span', '', on ? 'Activado' : 'Apagado')); card.append(row);
    var ready = tpl ? tpl.template_ready : null;
    var note = el('p', 'priv-note', autoText('', tpl && tpl.lana_available === false ? null : ready)); note.dataset.state = ready === true ? 'ok' : 'warn'; card.append(note);
    var stats = el('p', 'priv-muted', 'Enviados en los últimos 30 días: ' + (Number(st.sent_30d) || 0) + (st.last_sent_at ? ' · el último, el ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(new Date(st.last_sent_at)) : '') + '.');
    card.append(stats); host.append(card);
  }

  function render() {
    var content = document.getElementById('priv-content'); if (!content) return;
    content.replaceChildren();
    document.querySelectorAll('[data-priv-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.privTab === state.tab)); });
    if (state.loading) { content.append(el('div', 'priv-empty', 'Cargando…')); return; }
    if (state.error) { content.append(el('div', 'priv-empty', state.error)); return; }
    if (state.tab === 'patients') renderPatients(content); else if (state.tab === 'auto') renderAuto(content); else renderRequests(content);
  }

  function build() {
    var page = el('section', 'pantalla priv-page'); page.id = 'p-privacidad';
    var head = el('header', 'priv-head'); var copy = el('div');
    copy.append(el('span', 'pro-eyebrow', 'CONFIGURACIÓN · PROTECCIÓN'), el('h1', '', 'Privacidad y derechos'), el('p', '', 'Solicitudes de acceso, rectificación, cancelación y oposición (ARCO) y lo que cada paciente permite sobre sus datos.'));
    var refresh = el('button', 'btn btn-secondary', 'Actualizar'); refresh.type = 'button'; refresh.onclick = function () { loadRequests(); };
    head.append(copy, refresh); page.append(head);
    var tabs = el('div', 'priv-tabs'); tabs.setAttribute('role', 'tablist');
    [['requests', 'Solicitudes'], ['patients', 'Pacientes'], ['auto', 'Aviso automático']].forEach(function (t) {
      var b = el('button', '', t[1]); b.type = 'button'; b.dataset.privTab = t[0]; b.setAttribute('role', 'tab'); b.onclick = function () { state.tab = t[0]; render(); }; tabs.append(b);
    });
    var feedback = el('p', 'priv-feedback'); feedback.id = 'priv-feedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    var content = el('div', 'priv-content'); content.id = 'priv-content';
    page.append(tabs, feedback, content);
    var host = document.querySelector('.contenido'); if (host) host.append(page);
  }

  function init() {
    if (!win || !win.ir || document.getElementById('p-privacidad')) return;
    if (win.TITULOS) win.TITULOS.privacidad = 'Privacidad y derechos';
    build();
    var previous = win.ir;
    win.ir = function (route) { var result = previous(route); if (route === 'privacidad') { if (!state.requests.length || state.tenant !== win.tenantId) loadRequests(); else render(); } return result; };
  }

  if (win && win.document) { if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init(); }
  return { RIGHTS: RIGHTS, CHANNELS: CHANNELS, STATUS: STATUS, PURPOSES: PURPOSES, dueInfo: dueInfo, counts: counts, visible: visible, isOpen: isOpen, revocablePurposes: revocablePurposes, fileName: fileName, friendly: friendly, todayText: todayText };
});
