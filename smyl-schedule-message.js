/* SMYL · Agenda: escribirle al paciente desde la ficha de su cita.
   WhatsApp solo admite plantillas aprobadas por Meta; Instagram y Messenger, texto libre.
   El chat del paciente sale del vínculo que ya existe (camila_lana_handoffs) y el envío usa lana-inbox,
   igual que la bandeja de Mensajes: no hay backend nuevo ni tokens en el navegador. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.SmylScheduleMessage = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  // Qué plantillas conviene ofrecer primero según cómo va la cita (ids del catálogo de SMYL).
  var SUGGESTED = {
    confirmed: ['cita_confirmada_v1', 'recordatorio_cita_24h_v1', 'cita_indicaciones_previas_v1', 'cita_como_llegar_v1', 'cita_retraso_v1'],
    arrived: ['cita_retraso_v1'],
    in_progress: [],
    completed: ['seguimiento_postcita_v1'],
    no_show: ['cita_no_asistio_v1'],
    cancelled: ['cita_cancelada_clinica_v1']
  };
  var CHANNELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };
  var CACHE_MS = 5 * 60 * 1000;
  var cache = { at: 0, tenant: '', list: null };

  function text(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
  function zone(value) { try { new Intl.DateTimeFormat('es-MX', { timeZone: value }); return value || 'America/Mexico_City'; } catch (_) { return 'America/Mexico_City'; } }

  // Mismo formato que el recordatorio automático, para que el paciente lea lo mismo venga de donde venga.
  function render(source, ctx) {
    var start = new Date(ctx.appointment.starts_at);
    var tz = zone(ctx.branch && ctx.branch.timezone);
    var first = text(ctx.patient && ctx.patient.first, 120);
    switch (source) {
      case 'patient_first_name': return first || 'paciente';
      case 'patient_name': return [first, text(ctx.patient && ctx.patient.last, 120)].filter(Boolean).join(' ') || 'paciente';
      case 'date': return new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(start).replace(',', '');
      case 'time': return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz }).format(start);
      case 'service': return text(ctx.service, 120) || 'tu cita';
      case 'professional': return text(ctx.professional, 120) || text(ctx.clinic, 120);
      case 'branch': return text(ctx.branch && ctx.branch.name, 120) || text(ctx.clinic, 120);
      case 'branch_phone': return text(ctx.branch && ctx.branch.phone, 40);
      case 'clinic': return text(ctx.clinic, 120) || 'tu clínica';
      default: return '';
    }
  }

  function fill(body, values) {
    var copy = values.reduce(function (acc, value, index) { return acc.split('{{' + (index + 1) + '}}').join(value); }, String(body || ''));
    // «5:00 p.m.» + el punto de la frase no debe quedar «p.m..».
    return copy.replace(/([ap]\.\s?m\.)\.(?!\.)/gi, '$1');
  }

  // Une lo aprobado en LANA con el catálogo de SMYL (por nombre) para saber qué dato va en cada variable.
  function options(approved, catalog, status, ctx) {
    var byId = {};
    (catalog || []).forEach(function (item) { byId[item.id] = item; });
    var order = SUGGESTED[status] || [];
    return (approved || []).filter(function (item) { return item && item.id && item.name; }).map(function (item) {
      var known = byId[item.name] || null;
      var count = Number(item.variable_count || 0);
      var fields = [];
      for (var i = 0; i < count; i += 1) {
        var variable = known && known.variables && known.variables[i];
        var source = variable ? variable.source : 'text';
        var value = source === 'text' ? '' : render(source, ctx);
        fields.push({ label: variable ? variable.label : 'Dato ' + (i + 1), editable: source === 'text' || !value, value: value });
      }
      var rank = known ? order.indexOf(known.id) : -1;
      return { id: item.id, name: item.name, title: known ? known.title : String(item.name).replace(/_v\d+$/, '').replace(/_/g, ' '), body: item.body || (known && known.body) || '', fields: fields, suggested: rank >= 0, rank: rank, known: Boolean(known) };
    }).sort(function (a, b) { return (a.suggested === b.suggested ? 0 : a.suggested ? -1 : 1) || a.rank - b.rank || a.title.localeCompare(b.title, 'es'); });
  }

  function pickLinks(rows) {
    var seen = {};
    return (rows || []).filter(function (row) {
      var channel = row && row.lana_channel;
      if (!CHANNELS[channel] || seen[channel]) return false;
      seen[channel] = true; return true;
    }).sort(function (a, b) { return Object.keys(CHANNELS).indexOf(a.lana_channel) - Object.keys(CHANNELS).indexOf(b.lana_channel); });
  }

  function uuid() {
    if (win && win.crypto && typeof win.crypto.randomUUID === 'function') return win.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  async function call(method, payload, key) {
    var session = await win.sb.auth.getSession();
    var token = session && session.data && session.data.session && session.data.session.access_token;
    if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 30000);
    try {
      var headers = { Authorization: 'Bearer ' + token, apikey: win.SUPA_KEY, 'Content-Type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      var url = win.SUPA_URL + '/functions/v1/lana-inbox' + (method === 'GET' ? '?action=templates' : '');
      var response = await fetch(url, { method: method, headers: headers, body: method === 'POST' ? JSON.stringify(payload) : undefined, signal: controller.signal });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) { var error = new Error(typeof data.error === 'string' ? data.error : 'No se pudo completar el envío.'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('El servicio de mensajes tardó demasiado. Revisa en Mensajes antes de reenviar.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function approvedTemplates(tenant, force) {
    if (!force && cache.list && cache.tenant === tenant && Date.now() - cache.at < CACHE_MS) return cache.list;
    var data = await call('GET');
    cache = { at: Date.now(), tenant: tenant, list: Array.isArray(data.templates) ? data.templates : [] };
    return cache.list;
  }

  function friendly(error) {
    var status = error && error.status;
    var message = String(error && error.message || '');
    if (status === 403) return 'Tu rol no permite enviar mensajes a pacientes.';
    if (/window|ventana|24/i.test(message)) return 'Ya pasaron más de 24 horas desde su último mensaje. En WhatsApp usa una plantilla.';
    return message || 'No se pudo enviar el mensaje.';
  }

  function el(tag, cls, content) { var node = document.createElement(tag); if (cls) node.className = cls; if (content != null) node.textContent = content; return node; }

  function mount(host, ctx) {
    if (!host || !ctx || !ctx.canMessage) { if (host) host.hidden = true; return; }
    var state = { links: [], channel: '', templates: [], pick: null, sending: false };
    host.hidden = false; host.className = 'sched-msg';

    function frame(title) {
      host.replaceChildren();
      var head = el('div', 'sched-msg-head');
      head.append(el('h3', '', title || 'Escribirle al paciente'));
      host.append(head);
      return head;
    }
    function note(message, tone, action) {
      var box = el('div', 'sched-msg-note'); box.dataset.tone = tone || 'info';
      box.append(el('p', '', message));
      if (action) { var button = el('button', 'sched-msg-link', action.label); button.type = 'button'; button.onclick = action.run; box.append(button); }
      host.append(box); return box;
    }

    async function start() {
      frame(); host.append(el('p', 'sched-msg-loading', 'Buscando su chat…'));
      try {
        var query = win.sb.from('camila_lana_handoffs').select('lana_conversation_id,lana_channel,updated_at').eq('tenant_id', ctx.tenant).eq('patient_id', ctx.patient.id).order('updated_at', { ascending: false });
        var result = await Promise.resolve(typeof win.sbTimeout === 'function' ? win.sbTimeout(query) : query);
        if (result && result.error) throw result.error;
        state.links = pickLinks(result && result.data);
      } catch (_) {
        frame(); note('No pudimos revisar si este paciente tiene un chat.', 'warn', { label: 'Intentar de nuevo', run: start }); return;
      }
      if (!state.links.length) {
        frame();
        note('Este paciente aún no tiene un chat vinculado. Cuando te escriba, vincúlalo en Mensajes y podrás enviarle recordatorios desde aquí.', 'info', { label: 'Ir a Mensajes', run: function () { ctx.close(); win.ir('inbox'); } });
        return;
      }
      state.channel = state.links[0].lana_channel;
      await show();
    }

    function conversation() { return (state.links.filter(function (link) { return link.lana_channel === state.channel; })[0] || {}).lana_conversation_id; }

    function channelTabs(head) {
      if (state.links.length < 2) { head.append(el('span', 'sched-msg-channel', CHANNELS[state.channel])); return; }
      var tabs = el('div', 'sched-msg-tabs'); tabs.setAttribute('role', 'tablist');
      state.links.forEach(function (link) {
        var tab = el('button', '', CHANNELS[link.lana_channel]); tab.type = 'button'; tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(link.lana_channel === state.channel));
        tab.onclick = function () { state.channel = link.lana_channel; state.pick = null; show(); };
        tabs.append(tab);
      });
      head.append(tabs);
    }

    async function show() {
      var head = frame(); channelTabs(head);
      if (state.channel === 'whatsapp') await whatsapp(); else freeText();
    }

    async function whatsapp() {
      var loading = el('p', 'sched-msg-loading', 'Cargando plantillas…'); host.append(loading);
      try { state.templates = options(await approvedTemplates(ctx.tenant), win.SmylTemplateCatalog && win.SmylTemplateCatalog.TEMPLATES, ctx.appointment.status, ctx); }
      catch (error) { loading.remove(); note(friendly(error) === 'No se pudo enviar el mensaje.' ? 'No pudimos cargar las plantillas.' : friendly(error), 'warn', { label: 'Intentar de nuevo', run: function () { approvedTemplates(ctx.tenant, true).then(show, show); } }); return; }
      loading.remove();
      if (!state.templates.length) { note('Todavía no tienes plantillas aprobadas por Meta. Solicítalas en Plantillas y aquí aparecerán.', 'info', { label: 'Ver plantillas', run: function () { ctx.close(); win.ir('plantillas'); } }); return; }
      var chips = el('div', 'sched-msg-chips');
      var main = state.templates.filter(function (item) { return item.suggested; });
      var shown = main.length ? main : state.templates.slice(0, 3);
      shown.forEach(function (item) { chips.append(chip(item)); });
      host.append(chips);
      var others = state.templates.filter(function (item) { return shown.indexOf(item) < 0; });
      if (others.length) {
        var select = el('select', 'sched-msg-more'); select.setAttribute('aria-label', 'Más plantillas');
        var first = el('option', '', 'Más plantillas'); first.value = ''; select.append(first);
        others.forEach(function (item) { var o = el('option', '', item.title); o.value = item.id; select.append(o); });
        select.onchange = function () { var item = state.templates.filter(function (x) { return x.id === select.value; })[0]; if (item) choose(item); };
        host.append(select);
      }
      var panel = el('div', 'sched-msg-composer'); panel.hidden = true; host.append(panel);
      if (state.pick) choose(state.pick);
    }

    function chip(item) {
      var button = el('button', 'sched-msg-chip', item.title); button.type = 'button'; button.dataset.template = item.id;
      button.setAttribute('aria-pressed', String(Boolean(state.pick && state.pick.id === item.id)));
      button.onclick = function () { choose(item); };
      return button;
    }

    function panelNode() { return host.querySelector('.sched-msg-composer'); }

    function choose(item) {
      state.pick = item;
      host.querySelectorAll('.sched-msg-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.template === item.id)); });
      var box = panelNode(); if (!box) return;
      box.hidden = false; box.replaceChildren();
      var inputs = [];
      var bubble = el('div', 'sched-msg-bubble'); bubble.setAttribute('aria-live', 'polite');
      var values = item.fields.map(function (f) { return f.value; });
      var send = el('button', 'btn btn-primary sched-msg-send', 'Enviar por WhatsApp'); send.type = 'button';
      function refresh() {
        values = item.fields.map(function (field, index) { return inputs[index] ? inputs[index].value.trim() : field.value; });
        bubble.textContent = fill(item.body, values.map(function (value, index) { return value || '{{' + (index + 1) + '}}'; }));
        send.disabled = state.sending || values.some(function (value) { return !value; });
      }
      box.append(bubble);
      item.fields.forEach(function (field, index) {
        if (!field.editable) return;
        var label = el('label', 'sched-msg-field'); label.append(el('span', '', field.label));
        var input = document.createElement('input'); input.type = 'text'; input.maxLength = 300; input.value = field.value; input.required = true;
        input.addEventListener('input', refresh); inputs[index] = input; label.append(input); box.append(label);
      });
      var row = el('div', 'sched-msg-actions');
      row.append(el('small', '', 'Se envía por WhatsApp con la plantilla aprobada. Queda registrado en Mensajes.'), send);
      box.append(row);
      refresh();
      send.onclick = function () {
        if (state.sending) return;
        state.sending = true; send.disabled = true; send.textContent = 'Enviando…';
        call('POST', { action: 'send', conversation_id: conversation(), type: 'template', template_id: item.id, template_variables: values }, uuid()).then(function () {
          done('Mensaje enviado por WhatsApp.');
        }, function (error) { state.sending = false; send.textContent = 'Enviar por WhatsApp'; refresh(); fail(box, friendly(error)); });
      };
    }

    function fail(box, message) {
      var old = box.querySelector('.sched-msg-error'); if (old) old.remove();
      var node = el('p', 'sched-msg-error', message); node.setAttribute('role', 'alert'); box.append(node);
    }

    function done(message) {
      state.sending = false; state.pick = null;
      host.replaceChildren();
      var ok = el('div', 'sched-msg-sent'); ok.append(el('span', '', '✓'), el('p', '', message));
      var again = el('button', 'sched-msg-link', 'Enviar otro'); again.type = 'button'; again.onclick = show; ok.append(again);
      host.append(ok);
      if (typeof ctx.onSent === 'function') ctx.onSent(message);
    }

    function freeText() {
      host.append(el('p', 'sched-msg-hint', CHANNELS[state.channel] + ' solo deja escribir si el paciente te escribió en las últimas 24 horas.'));
      var catalog = (win.SmylTemplateCatalog && win.SmylTemplateCatalog.TEMPLATES) || [];
      var ideas = (SUGGESTED[ctx.appointment.status] || []).map(function (id) { return catalog.filter(function (t) { return t.id === id; })[0]; }).filter(Boolean).filter(function (t) { return t.variables.every(function (v) { return v.source !== 'text' && (v.source !== 'branch_phone' || render('branch_phone', ctx)); }); });
      var area = document.createElement('textarea'); area.className = 'sched-msg-text'; area.rows = 4; area.maxLength = 1000; area.placeholder = 'Escribe tu mensaje';
      var chips = el('div', 'sched-msg-chips');
      ideas.forEach(function (t) {
        var b = el('button', 'sched-msg-chip', t.title); b.type = 'button';
        b.onclick = function () { area.value = fill(t.body, t.variables.map(function (v) { return render(v.source, ctx); })); area.dispatchEvent(new Event('input')); area.focus(); };
        chips.append(b);
      });
      if (ideas.length) host.append(chips);
      var send = el('button', 'btn btn-primary sched-msg-send', 'Enviar por ' + CHANNELS[state.channel]); send.type = 'button'; send.disabled = true;
      area.addEventListener('input', function () { send.disabled = state.sending || !area.value.trim(); });
      var row = el('div', 'sched-msg-actions'); row.append(send);
      host.append(area, row);
      send.onclick = function () {
        if (state.sending || !area.value.trim()) return;
        state.sending = true; send.disabled = true; send.textContent = 'Enviando…';
        call('POST', { action: 'send', conversation_id: conversation(), type: 'text', content: area.value.trim() }, uuid()).then(function () {
          done('Mensaje enviado por ' + CHANNELS[state.channel] + '.');
        }, function (error) { state.sending = false; send.textContent = 'Enviar por ' + CHANNELS[state.channel]; send.disabled = false; fail(host, friendly(error)); });
      };
    }

    start();
  }

  return { mount: mount, options: options, render: render, fill: fill, pickLinks: pickLinks, SUGGESTED: SUGGESTED };
});
