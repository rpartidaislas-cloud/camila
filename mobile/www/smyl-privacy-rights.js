/* SMYL · Derechos de los pacientes sobre sus datos (ARCO: acceso, rectificación, cancelación, oposición y revocación), dentro de CADA paciente
   (sección «Consentimiento de privacidad» del expediente). Ya no hay una pantalla aparte en Configuración. Incluye el interruptor del aviso
   automático, que vive en Mensajería → Plantillas, junto a la plantilla del aviso. Registra solicitudes, decisiones por finalidad y exportación de datos. Todo pasa por funciones de la base con permiso
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
  var state = { names: {} };
  var ctx = { after: null, notify: null };

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
  /* Los avisos van a la línea de estado de la sección del paciente que esté abierta. */
  function message(text, tone) {
    if (ctx.notify) { ctx.notify(text || '', tone || ''); return; }
    var host = document.querySelector('.pp-feedback'); if (!host) return; host.textContent = text || ''; host.dataset.tone = tone || '';
  }
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
  function done() { if (typeof ctx.after === 'function') return ctx.after(); }

  /* Nueva solicitud de ESTE paciente (el paciente ya viene elegido). */
  function openNewRequest(patient) {
    var box = dialog('Registrar solicitud de derechos'), name = fullName(patient);
    var right = select(RIGHTS, 'access'), channel = select(CHANNELS, 'in_person');
    var who = el('input'); who.maxLength = 150; who.placeholder = 'Nombre de quien solicita'; who.value = name;
    var contact = el('input'); contact.maxLength = 200; contact.placeholder = 'Teléfono o correo (opcional)'; contact.value = patient.telefono || '';
    var details = el('textarea'); details.maxLength = 2000; details.rows = 3; details.placeholder = 'Qué pide la persona, con sus palabras.';
    var received = el('input'); received.type = 'date'; received.max = todayText(); received.value = (patient && patient.receivedOn) || todayText();
    if (patient && patient.details) details.value = patient.details;
    if (patient && patient.right && RIGHTS[patient.right]) right.value = patient.right;
    if (patient && patient.channel && CHANNELS[patient.channel]) channel.value = patient.channel;
    box.form.append(el('p', 'priv-muted', 'Paciente: ' + name + '. Tienes 20 días hábiles para responder desde que la recibes; el plazo se calcula solo.'),
      field('Derecho que ejerce', right), field('Por dónde llegó', channel), field('Quién solicita', who), field('Contacto', contact), field('Fecha en que se recibió', received), field('Detalle', details));
    var ok = actions(box.form, box.close, 'Registrar solicitud');
    box.form.onsubmit = async function (event) {
      event.preventDefault(); ok.disabled = true;
      try {
        await rpc('smyl_open_data_request', { p_patient_id: patient.id, p_right: right.value, p_channel: channel.value, p_requester_name: who.value, p_requester_contact: contact.value, p_details: details.value, p_received_on: received.value || null });
        box.close(); message('Solicitud registrada. El plazo corre desde la fecha en que se recibió.', 'ok'); await done();
      } catch (error) { ok.disabled = false; message(friendly(error), 'error'); }
    };
    box.d.showModal();
  }

  async function exportData(patient) {
    try {
      var data = await rpc('smyl_export_patient_data', { p_patient_id: patient.id });
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = fileName(patient);
      document.body.append(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      message('Datos descargados. La historia clínica, las fotos y los documentos se entregan aparte, desde el expediente.', 'ok');
    } catch (error) { message(friendly(error), 'error'); }
  }

  async function setChoice(patient, purpose, action) {
    try { await rpc('smyl_set_patient_privacy_choice', { p_patient_id: patient.id, p_purpose: purpose, p_action: action, p_note: '' }); message('Decisión registrada.', 'ok'); await done(); }
    catch (error) { message(friendly(error), 'error'); }
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
    var finish = el('button', 'btn btn-primary', 'Dar por atendida'); finish.type = 'button';
    row.append(cancel, review, reject, finish); box.form.append(row);
    var act = async function (status, button) {
      button.disabled = true;
      try {
        var revoke = Object.keys(checks).filter(function (k) { return checks[k].checked; });
        await rpc('smyl_update_data_request', { p_id: request.id, p_status: status, p_resolution: resolution.value, p_identity_verified: verified.checked, p_revoke_purposes: status === 'completed' && revoke.length ? revoke : null });
        box.close(); message(status === 'in_review' ? 'Solicitud en revisión.' : status === 'completed' ? 'Solicitud atendida y cerrada.' : 'Solicitud rechazada y cerrada.', 'ok'); await done();
      } catch (error) { button.disabled = false; message(friendly(error), 'error'); }
    };
    review.onclick = function () { act('in_review', review); }; reject.onclick = function () { act('rejected', reject); }; finish.onclick = function () { act('completed', finish); };
    box.form.onsubmit = function (e) { e.preventDefault(); };
    box.d.showModal();
  }

  /* Solicitudes de un paciente: lista (abiertas primero) con «Atender» y el botón para registrar una nueva. */
  async function loadPatientRequests(patientId) {
    var res = await win.sb.from('smyl_data_rights_requests').select('*').eq('tenant_id', win.tenantId).eq('patient_id', patientId).order('received_on', { ascending: false }).limit(50);
    if (res.error) throw res.error;
    return res.data || [];
  }
  function renderPatientRequests(host, patient, requests) {
    host.replaceChildren();
    var today = todayText(), c = counts(requests, today);
    state.names[patient.id] = fullName(patient);
    var head = el('div', 'pp-arco-head');
    head.append(el('strong', '', 'Si el paciente pide algo sobre sus datos'));
    var open = el('p', 'priv-muted', c.open ? plural(c.open, 'solicitud abierta', 'solicitudes abiertas') + (c.overdue ? ' · ' + plural(c.overdue, 'vencida', 'vencidas') : '') + '.' : 'Sin solicitudes abiertas.');
    if (c.overdue) open.dataset.tone = 'error';
    head.append(open); host.append(head);
    var list = el('div', 'priv-list');
    requests.slice().sort(function (a, b) { return (isOpen(b) ? 1 : 0) - (isOpen(a) ? 1 : 0); }).slice(0, 8).forEach(function (r) {
      var info = dueInfo(r, today), row = el('article', 'priv-row'); row.dataset.kind = info.kind;
      var main = el('div', 'priv-row-main'); main.append(el('strong', '', RIGHTS[r.right_type]), el('small', '', 'Recibida el ' + r.received_on + ' · ' + CHANNELS[r.channel]));
      var chip = el('span', 'priv-chip', info.text); chip.dataset.kind = info.kind;
      var btn = el('button', 'btn btn-secondary', isOpen(r) ? 'Atender' : 'Ver'); btn.type = 'button'; btn.onclick = function () { openAttend(r); };
      row.append(main, chip, btn); list.append(row);
    });
    if (requests.length) host.append(list);
    var acts = el('div', 'priv-actions');
    var add = el('button', 'btn btn-secondary', 'Registrar solicitud'); add.type = 'button'; add.onclick = function () { openNewRequest(patient); };
    var exp = el('button', 'btn btn-secondary', 'Descargar copia de sus datos'); exp.type = 'button'; exp.onclick = function () { exportData(patient); };
    acts.append(add, exp); host.append(acts);
  }
  /* host: contenedor dentro de la sección del paciente. patient: { id, nombre, apellido, telefono }. after: se llama al cambiar algo. */
  async function mountPatient(host, patient, o) {
    o = o || {};
    ctx.after = async function () { try { renderPatientRequests(host, patient, await loadPatientRequests(patient.id)); } catch (e) { /* la lista queda como estaba */ } if (o.onChange) o.onChange(); };
    ctx.notify = o.notify || null;
    try { renderPatientRequests(host, patient, await loadPatientRequests(patient.id)); }
    catch (error) { host.replaceChildren(el('p', 'priv-muted', friendly(error))); }
  }

  /* ── Aviso automático por WhatsApp a pacientes nuevos: interruptor para Mensajería → Plantillas ── */
  async function autoControl(opts) {
    opts = opts || {};
    var box = el('div', 'priv-auto');
    box.append(el('p', 'priv-muted', 'Cargando…'));
    var settings = null;
    try { settings = await rpc('smyl_get_privacy_settings', {}); }
    catch (error) { box.replaceChildren(el('p', 'priv-muted', error && error.code === '42501' ? 'Solo quien gestiona pacientes puede activar el envío automático.' : friendly(error))); return box; }
    function paint() {
      box.replaceChildren();
      var on = settings && settings.auto_send_notice === true;
      box.append(el('strong', '', 'Enviarla sola a pacientes nuevos'),
        el('p', 'priv-muted', 'Cuando alguien se registra por WhatsApp, SMYL le manda por ese mismo chat el enlace para firmar su consentimiento de privacidad. Una sola vez por paciente, solo a quien se creó en los últimos 14 días y aún no firmó. Quien ya dijo que no a WhatsApp no recibe nada.'));
      var row = el('label', 'priv-switch'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
      cb.onchange = async function () {
        cb.disabled = true;
        try { settings = await rpc('smyl_set_privacy_settings', { p_auto_send: cb.checked }); if (win.SmylPrivacyDispatch) win.SmylPrivacyDispatch.reset(); }
        catch (error) { cb.checked = !cb.checked; var err = el('p', 'priv-note', friendly(error)); box.append(err); }
        paint();
      };
      row.append(cb, el('span', '', on ? 'Activado' : 'Apagado')); box.append(row);
      if (opts.approved === false) { var note = el('p', 'priv-note', 'Primero solicita esta plantilla a WhatsApp. Hasta que Meta la apruebe, el envío automático no manda nada.'); box.append(note); }
      box.append(el('p', 'priv-muted', 'Enviados en los últimos 30 días: ' + (Number(settings && settings.sent_30d) || 0) + (settings && settings.last_sent_at ? ' · el último, el ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(new Date(settings.last_sent_at)) : '') + '.'));
    }
    paint();
    return box;
  }

  return { RIGHTS: RIGHTS, CHANNELS: CHANNELS, STATUS: STATUS, PURPOSES: PURPOSES, dueInfo: dueInfo, counts: counts, visible: visible, isOpen: isOpen, revocablePurposes: revocablePurposes, fileName: fileName, friendly: friendly, todayText: todayText,
    mountPatient: mountPatient, openNewRequest: openNewRequest, openAttend: openAttend, exportData: exportData, setChoice: setChoice, autoControl: autoControl };
});
