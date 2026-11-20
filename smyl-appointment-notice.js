/* SMYL · Agenda: «¿Avisar?» después de confirmar, reprogramar o cancelar una cita.
   Muestra, ya con los datos reales, el mensaje de WhatsApp para el paciente y para el dentista usando la plantilla
   por defecto de Configuración → Avisos de cita. NUNCA envía solo: cada aviso sale con un clic en «Enviar avisos».
   El envío usa lana-inbox (igual que Mensajes) con una llave de idempotencia por aviso, así reintentar no duplica. */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylAppointmentNotice = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var EVENTS = {
    confirmed: { title: 'Avisar de la cita confirmada', lead: 'La cita quedó guardada. Elige a quién avisar por WhatsApp.' },
    rescheduled: { title: 'Avisar del cambio de horario', lead: 'La cita ya se movió. Elige a quién avisar por WhatsApp.' },
    cancelled: { title: 'Avisar de la cancelación', lead: 'La cita ya se canceló. Elige a quién avisar por WhatsApp.' }
  };
  // Fuentes de cita que ya reciben la confirmación automática (ajuste de Automatizaciones), para no duplicar el aviso.
  var AUTO_SOURCES = ['manual', 'patient_portal'];

  function dep(name, file) {
    if (win && win[name]) return win[name];
    try { return typeof require === 'function' ? require(file) : null; } catch (_) { return null; }
  }
  function sms() { return dep('SmylScheduleMessage', './smyl-schedule-message.js'); }
  function settingsApi() { return dep('SmylNoticeSettings', './smyl-notice-settings.js'); }
  function catalogApi() { return dep('SmylTemplateCatalog', './smyl-template-catalog.js'); }

  function sentKey(a, event, audience) { return 'smyl-notice:' + a.id + ':' + event + ':' + audience + ':' + a.starts_at; }
  function wasSent(key) { try { return win.sessionStorage.getItem(key) === '1'; } catch (_) { return false; } }
  function markSent(key) { try { win.sessionStorage.setItem(key, '1'); } catch (_) {} }

  // ¿Ya se avisó de este evento? Mira el historial guardado: para un cambio de horario solo cuenta lo enviado
  // después de la última modificación de la cita (si se movió otra vez, el aviso anterior ya no vale).
  function lastSent(log, appointment, event, audience) {
    var floor = event === 'rescheduled' && appointment.updated_at ? new Date(appointment.updated_at).getTime() - 60000 : 0;
    var found = (log || []).filter(function (row) {
      return row.status === 'sent' && row.event === event && row.audience === audience && new Date(row.created_at).getTime() >= floor;
    }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
    return found ? found.created_at : '';
  }

  function previousWhen(previous, ctx) {
    if (!previous || !previous.starts_at) return '';
    var fake = { appointment: { starts_at: previous.starts_at }, branch: ctx.branch, patient: ctx.patient, clinic: ctx.clinic };
    return sms().render('date', fake) + ' a las ' + sms().render('time', fake);
  }

  function valuesFor(template, ctx, previous) {
    var prev = previousWhen(previous, ctx);
    return template.variables.map(function (variable) {
      if (variable.source !== 'text') return sms().render(variable.source, ctx);
      return variable.label === 'Horario anterior' ? prev : '';
    });
  }

  // Decide qué se puede avisar y por qué no. Función pura: la pantalla solo la dibuja.
  function planRows(input) {
    var catalog = catalogApi(), settings = settingsApi();
    var approved = input.approved || [];
    var approvedList = approved.map(function (item) { return { id: item.name, status: 'APPROVED' }; });
    var rows = [];
    var audiences = [{ id: 'patient', label: 'Al paciente' }];
    if (input.appointment.professional_id) audiences.push({ id: 'professional', label: input.ctx.professional ? 'A ' + input.ctx.professional : 'Al dentista' });

    audiences.forEach(function (audience) {
      var row = { audience: audience.id, label: audience.label, state: 'blocked', reason: '', action: null, checked: false, preview: '', values: [], templateId: '', lanaId: '', conversationId: '', title: '', buttons: [] };
      var chosen = settings.effectiveDefault(input.event, audience.id, input.defaults || {}, approvedList);
      var conversation = audience.id === 'patient' ? input.patientConversation : input.professionalConversation;
      var key = sentKey(input.appointment, input.event, audience.id);

      if (audience.id === 'patient' && input.autoConfirmation && input.event !== 'cancelled' && AUTO_SOURCES.indexOf(input.appointment.source) >= 0) {
        row.state = 'auto'; row.reason = 'La confirmación automática ya se la envía; no hace falta mandarla otra vez.';
        rows.push(row); return;
      }
      if (!chosen) {
        row.reason = 'Aún no hay una plantilla aprobada para este aviso.';
        row.action = { id: 'settings', label: 'Configurar avisos' };
        rows.push(row); return;
      }
      var template = catalog.TEMPLATES.filter(function (item) { return item.id === chosen.id; })[0];
      var lana = approved.filter(function (item) { return item.name === chosen.id; })[0];
      if (!template || !lana) { row.reason = 'La plantilla elegida ya no está disponible.'; row.action = { id: 'settings', label: 'Configurar avisos' }; rows.push(row); return; }
      row.templateId = template.id; row.lanaId = lana.id; row.title = template.title; row.buttons = (template.buttons || []).map(function (b) { return b.text; });
      if (!conversation) {
        row.reason = audience.id === 'patient' ? 'Este paciente no tiene un chat de WhatsApp con la clínica.' : 'El dentista todavía no vinculó su WhatsApp. Pídele que lo vincule desde Mensajes.';
        row.action = audience.id === 'patient' ? { id: 'inbox', label: 'Ir a Mensajes' } : null;
        rows.push(row); return;
      }
      var values = valuesFor(template, Object.assign({}, input.ctx, { appointment: input.appointment }), input.previous);
      var missing = template.variables.filter(function (variable, index) { return !values[index]; }).map(function (variable) { return variable.label.toLowerCase(); });
      if (missing.length) { row.reason = 'Falta un dato para armar el mensaje: ' + missing.join(', ') + '.'; rows.push(row); return; }
      row.conversationId = conversation; row.values = values; row.preview = sms().fill(template.body, values); row.key = key;
      row.state = 'ready';
      row.sentAt = lastSent(input.log, input.appointment, input.event, audience.id);
      row.already = Boolean(row.sentAt) || wasSent(key);
      row.checked = !row.already;
      rows.push(row);
    });
    return rows;
  }

  // ── Pantalla ──
  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; }

  function ensureDialog() {
    var dialog = document.getElementById('notice-offer-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'notice-offer-dialog'; dialog.className = 'notice-offer';
      dialog.setAttribute('aria-labelledby', 'notice-offer-title'); document.body.append(dialog);
    }
    return dialog;
  }

  function when(iso) {
    try { return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/\s*([ap])\.?\s?m\.?/i, function (m, x) { return ' ' + x.toLowerCase() + 'm'; }); } catch (_) { return ''; }
  }

  function summaryLine(opts, ctx) {
    var when = sms().render('date', { appointment: opts.appointment, branch: ctx.branch }) + ' · ' + sms().render('time', { appointment: opts.appointment, branch: ctx.branch });
    var parts = [[ctx.patient && ctx.patient.first, ctx.patient && ctx.patient.last].filter(Boolean).join(' ') || 'Paciente', when];
    if (ctx.service) parts.push(ctx.service);
    return parts.join(' · ');
  }

  async function gather(opts, ctx) {
    var sb = win.sb, a = opts.appointment, tenant = opts.tenant;
    function safe(promise, fallback) { return Promise.resolve(promise).then(function (result) { return result && result.error ? fallback : (result ? result.data : fallback); }, function () { return fallback; }); }
    var results = await Promise.all([
      safe(sb.from('smyl_appointment_notice_defaults').select('event,audience,template_name').eq('tenant_id', tenant), []),
      sms().approvedTemplates(tenant).catch(function () { return null; }),
      safe(sb.from('camila_lana_handoffs').select('lana_conversation_id').eq('tenant_id', tenant).eq('patient_id', a.patient_id).eq('lana_channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1), []),
      a.professional_id ? safe(sb.from('smyl_professional_whatsapp_links').select('lana_conversation_id').eq('tenant_id', tenant).eq('professional_id', a.professional_id).eq('active', true).limit(1), []) : Promise.resolve([]),
      safe(sb.from('smyl_reminder_settings').select('confirmation_enabled').eq('tenant_id', tenant).limit(1), []),
      safe(sb.from('smyl_appointment_notice_log').select('event,audience,status,created_at').eq('tenant_id', tenant).eq('appointment_id', a.id).order('created_at', { ascending: false }).limit(30), [])
    ]);
    if (!results[1]) throw new Error('No pudimos consultar las plantillas de WhatsApp.');
    var defaults = {}; (results[0] || []).forEach(function (row) { defaults[row.event + ':' + row.audience] = row.template_name; });
    return {
      event: opts.event, appointment: a, previous: opts.previous, ctx: ctx, defaults: defaults, approved: results[1],
      patientConversation: results[2] && results[2][0] ? results[2][0].lana_conversation_id : '',
      professionalConversation: results[3] && results[3][0] ? results[3][0].lana_conversation_id : '',
      autoConfirmation: Boolean(results[4] && results[4][0] && results[4][0].confirmation_enabled),
      log: results[5] || []
    };
  }

  // Guarda el resultado en el historial de la cita. Si falla no afecta al envío: es solo el registro.
  function record(opts, row, status, error) {
    try {
      Promise.resolve(win.sb.rpc('smyl_log_appointment_notice', { p_appointment_id: opts.appointment.id, p_event: opts.event, p_audience: row.audience, p_template_name: row.templateId, p_status: status, p_error: String(error || '').slice(0, 300) })).catch(function () {});
    } catch (_) {}
  }

  // Versión para otras pantallas (chat): recibe solo el id de la cita y arma el contexto desde la base.
  async function offerById(opts) {
    if (!win || !win.sb || !opts || !opts.appointmentId) return false;
    var tenant = opts.tenant || win.tenantId, sb = win.sb;
    function first(promise) { return Promise.resolve(promise).then(function (r) { return r && !r.error && r.data && r.data[0] ? r.data[0] : null; }, function () { return null; }); }
    var a = await first(sb.from('smyl_appointments').select('*').eq('tenant_id', tenant).eq('id', opts.appointmentId).limit(1));
    if (!a || !a.patient_id) return false;
    var found = await Promise.all([
      first(sb.from('camila_pacientes').select('nombre,apellido').eq('tenant_id', tenant).eq('id', a.patient_id).limit(1)),
      first(sb.from('smyl_services').select('name').eq('tenant_id', tenant).eq('id', a.service_id).limit(1)),
      first(sb.from('smyl_professionals').select('display_name').eq('tenant_id', tenant).eq('id', a.professional_id).limit(1)),
      first(sb.from('smyl_branches').select('id,name,timezone').eq('tenant_id', tenant).eq('id', a.branch_id).limit(1))
    ]);
    var label = win.document && win.document.getElementById('sb-consultorio');
    var clinic = label && label.textContent.trim(); if (clinic === 'Mi Consultorio') clinic = '';
    return offer({
      event: opts.event, tenant: tenant, appointment: a, previous: opts.previous || null,
      patient: { id: a.patient_id, first: found[0] && found[0].nombre, last: found[0] && found[0].apellido },
      service: found[1] && found[1].name, professional: found[2] && found[2].display_name, branch: found[3], clinic: clinic || '', onSent: opts.onSent
    });
  }

  function offer(opts) {
    if (!win || !win.document || !win.sb || !opts || !opts.appointment || !EVENTS[opts.event] || !sms()) return Promise.resolve(false);
    var ctx = {
      tenant: opts.tenant, appointment: opts.appointment, patient: opts.patient, service: opts.service, professional: opts.professional,
      branch: opts.branch, clinic: opts.clinic
    };
    return gather(opts, ctx).then(function (input) {
      var rows = planRows(input);
      var offerable = rows.some(function (row) { return row.state === 'ready'; });
      var actionable = rows.some(function (row) { return row.action; });
      if (!offerable && !rows.some(function (row) { return row.state === 'auto'; })) {
        // Sin nada que enviar: solo se molesta una vez por sesión, y únicamente si hay algo que configurar.
        var hintKey = 'smyl-notice-hint';
        var shown = false; try { shown = win.sessionStorage.getItem(hintKey) === '1'; } catch (_) {}
        if (!actionable || shown) return false;
        try { win.sessionStorage.setItem(hintKey, '1'); } catch (_) {}
      }
      return show(opts, ctx, rows);
    }, function () { return false; });
  }

  function show(opts, ctx, rows) {
    return new Promise(function (resolve) {
      var dialog = ensureDialog(), meta = EVENTS[opts.event], busy = false;
      var sentAny = false;

      function finish() { try { dialog.close(); } catch (_) {} resolve(sentAny); }
      function runAction(action) {
        finish();
        if (action.id === 'settings' && win.ir) win.ir('avisos-cita');
        if (action.id === 'inbox' && win.ir) win.ir('inbox');
      }

      function draw() {
        dialog.replaceChildren();
        var box = el('div', 'notice-offer-box');
        var title = el('h2', '', meta.title); title.id = 'notice-offer-title';
        box.append(title, el('p', 'notice-offer-lead', meta.lead), el('p', 'notice-offer-who', summaryLine(opts, ctx)));
        if (opts.event === 'rescheduled' && opts.previous && opts.previous.starts_at) box.append(el('p', 'notice-offer-prev', 'Antes: ' + previousWhen(opts.previous, ctx)));

        rows.forEach(function (row) {
          var card = el('section', 'notice-offer-row is-' + row.state + (row.status ? ' is-' + row.status : ''));
          var head = el('label', 'notice-offer-head');
          if (row.state === 'ready') {
            var input = document.createElement('input'); input.type = 'checkbox'; input.checked = row.checked; input.disabled = busy || row.status === 'ok';
            input.onchange = function () { row.checked = input.checked; sync(); };
            head.append(input);
          }
          head.append(el('strong', '', row.label));
          if (row.state === 'ready') head.append(el('span', 'notice-offer-tpl', row.title));
          card.append(head);
          if (row.state === 'ready') {
            var bubble = el('div', 'notice-offer-bubble'); bubble.append(el('p', '', row.preview));
            if (row.buttons.length) { var strip = el('div', 'notice-offer-buttons'); row.buttons.forEach(function (text) { strip.append(el('span', '', text)); }); bubble.append(strip); }
            card.append(bubble);
            if (row.already && row.status !== 'ok') card.append(el('p', 'notice-offer-note', 'Ya se avisó' + (row.sentAt ? ' el ' + when(row.sentAt) : ' antes') + '. Márcalo solo si quieres reenviarlo.'));
            if (row.status === 'sending') card.append(el('p', 'notice-offer-note', 'Enviando…'));
            if (row.status === 'ok') card.append(el('p', 'notice-offer-ok', '✓ Enviado por WhatsApp'));
            if (row.status === 'error') { var err = el('p', 'notice-offer-error', row.error); err.setAttribute('role', 'alert'); card.append(err); }
          } else {
            card.append(el('p', 'notice-offer-note', row.reason));
            if (row.action) { var go = el('button', 'btn btn-secondary btn-sm', row.action.label); go.type = 'button'; go.onclick = function () { runAction(row.action); }; card.append(go); }
          }
          box.append(card);
        });

        var actions = el('div', 'notice-offer-actions');
        var skip = el('button', 'btn btn-secondary', sentAny && !pending().length ? 'Cerrar' : 'Ahora no'); skip.type = 'button'; skip.disabled = busy; skip.onclick = finish;
        var send = el('button', 'btn btn-primary', ''); send.type = 'button'; send.dataset.noticeSend = '';
        send.onclick = sendAll;
        actions.append(skip);
        if (rows.some(function (row) { return row.state === 'ready' && row.status !== 'ok'; })) { actions.append(send); }
        box.append(actions); dialog.append(box);
        function label() { var n = pending().length; send.textContent = busy ? 'Enviando…' : (n === 1 ? 'Enviar aviso' : 'Enviar avisos' + (n ? ' (' + n + ')' : '')); send.disabled = busy || n === 0; }
        draw.sync = label; label();
        if (!rows.some(function (row) { return row.state === 'ready'; })) skip.className = 'btn btn-primary';
      }
      function pending() { return rows.filter(function (row) { return row.state === 'ready' && row.checked && row.status !== 'ok'; }); }
      function sync() { if (draw.sync) draw.sync(); }

      async function sendAll() {
        if (busy) return;
        var queue = pending(); if (!queue.length) return;
        busy = true; queue.forEach(function (row) { row.status = 'sending'; row.error = ''; }); draw();
        for (var i = 0; i < queue.length; i += 1) {
          var row = queue[i];
          try {
            await sms().sendTemplate(row.conversationId, row.lanaId, row.values, row.idempotency || (row.idempotency = sms().uuid()));
            row.status = 'ok'; row.checked = false; sentAny = true; markSent(row.key);
            record(opts, row, 'sent', '');
          } catch (error) { row.status = 'error'; row.error = sms().friendly(error) + ' Puedes reintentar: no se enviará dos veces.'; record(opts, row, 'failed', row.error); }
          draw();
        }
        busy = false; draw();
        if (opts.onSent && sentAny) { try { opts.onSent(rows.filter(function (r) { return r.status === 'ok'; }).length); } catch (_) {} }
      }

      dialog.oncancel = function (event) { if (busy) event.preventDefault(); };
      dialog.onclose = function () { resolve(sentAny); };
      draw();
      if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    });
  }

  return { offer: offer, offerById: offerById, lastSent: lastSent, planRows: planRows, valuesFor: valuesFor, previousWhen: previousWhen, EVENTS: EVENTS, sentKey: sentKey };
});
