/* SMYL · Configuración → Avisos de cita.
   Para cada evento de una cita (confirmada, reprogramada, cancelada) y cada destinatario (paciente, dentista)
   muestra la plantilla de WhatsApp que SMYL ofrecerá enviar. Solo cuentan las aprobadas por Meta; si la clínica
   no elige nada, se usa la recomendada en cuanto esté aprobada. No envía mensajes: eso lo hace la persona
   desde la Agenda o el chat. Guarda solo el nombre de la plantilla (smyl_appointment_notice_defaults). */
(function (root, factory) {
  var api = factory(typeof window !== 'undefined' ? window : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmylNoticeSettings = api;
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var EVENTS = [
    { id: 'confirmed', label: 'Cita confirmada', hint: 'Se ofrece al confirmar una cita nueva.' },
    { id: 'rescheduled', label: 'Cita reprogramada', hint: 'Se ofrece al cambiar el día o la hora.' },
    { id: 'cancelled', label: 'Cita cancelada', hint: 'Se ofrece al cancelar una cita.' }
  ];
  var AUDIENCES = [
    { id: 'patient', label: 'Para el paciente', short: 'paciente' },
    { id: 'professional', label: 'Para el dentista', short: 'dentista' }
  ];
  // Plantilla que SMYL recomienda por cada lugar, con la razón en palabras simples.
  var RECOMMENDED = {
    'confirmed:patient': { id: 'cita_confirmada_v1', why: 'Confirma día, hora y clínica al instante, sin datos clínicos.' },
    'confirmed:professional': { id: 'agenda_cita_nueva_profesional_v1', why: 'Avisa al dentista de su nueva cita sin incluir datos del paciente.' },
    'rescheduled:patient': { id: 'cita_reprogramada_v1', why: 'Dice el nuevo día y hora y deja responder si no le acomoda.' },
    'rescheduled:professional': { id: 'agenda_cambio_profesional_v1', why: 'Muestra el horario anterior y el nuevo en su agenda.' },
    'cancelled:patient': { id: 'cita_cancelada_clinica_v1', why: 'Explica la cancelación y ofrece ayuda para elegir otra fecha.' },
    'cancelled:professional': { id: 'agenda_cancelacion_profesional_v1', why: 'Le avisa que la cita se retiró de su agenda.' }
  };
  // El aviso se arma solo con datos de la cita; únicamente «Horario anterior» lo completa el flujo de reprogramar.
  var KNOWN_TEXT_FIELDS = ['Horario anterior'];
  var STATE_COPY = {
    NONE: 'Aún no la has solicitado a Meta.',
    PENDING: 'En revisión de Meta. Normalmente tarda de unos minutos a un par de días.',
    REJECTED: 'Meta no la aprobó.',
    PAUSED: 'Meta la pausó.',
    DISABLED: 'Meta la deshabilitó.',
    PENDING_DELETION: 'Se está eliminando en Meta.'
  };
  var state = { defaults: {}, summary: null, catalog: null, loading: false, error: '', unavailable: false, saving: '', notice: null, tenant: null };

  function slotKey(event, audience) { return event + ':' + audience; }

  function isFillable(template) {
    return (template.variables || []).every(function (variable) { return variable.source !== 'text' || KNOWN_TEXT_FIELDS.indexOf(variable.label) >= 0; });
  }

  // Qué plantillas puede usar cada destinatario: utilidad, sin marketing, y que SMYL pueda rellenar sola.
  function allowedFor(template, audience) {
    if (!template || template.category !== 'UTILITY' || template.group === 'marketing' || !isFillable(template)) return false;
    return audience === 'professional' ? template.group === 'equipo' : template.group !== 'equipo';
  }

  function statusOf(summaryList, id) {
    var found = (summaryList || []).filter(function (item) { return item.id === id; })[0];
    return found ? found.status : 'NONE';
  }

  // Plantilla que se ofrecerá: la elegida si sigue aprobada; si no, la recomendada cuando ya está aprobada.
  function effectiveDefault(event, audience, defaults, summaryList) {
    var key = slotKey(event, audience);
    var chosen = defaults && defaults[key];
    if (chosen && statusOf(summaryList, chosen) === 'APPROVED') return { id: chosen, source: 'chosen' };
    var rec = RECOMMENDED[key];
    if (rec && statusOf(summaryList, rec.id) === 'APPROVED') return { id: rec.id, source: 'recommended' };
    return null;
  }

  // Aprobadas que se pueden elegir en ese lugar, agrupadas por categoría del catálogo y con la recomendada primero.
  function candidates(audience, catalog, summaryList, event) {
    var rec = RECOMMENDED[slotKey(event, audience)];
    var groups = {};
    (catalog.TEMPLATES || []).forEach(function (template) {
      if (!allowedFor(template, audience) || statusOf(summaryList, template.id) !== 'APPROVED') return;
      (groups[template.group] = groups[template.group] || []).push(template);
    });
    return catalog.GROUPS.filter(function (group) { return groups[group.id]; }).map(function (group) {
      var items = groups[group.id].slice().sort(function (a, b) {
        return (rec && b.id === rec.id ? 1 : 0) - (rec && a.id === rec.id ? 1 : 0) || a.title.localeCompare(b.title, 'es');
      });
      return { id: group.id, label: group.label, templates: items };
    });
  }

  function preview(template) {
    var text = String(template.body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, function (_, n) {
      var variable = template.variables[Number(n) - 1]; return variable ? variable.example : '…';
    });
    // «10:30 a.m.» + el punto de la frase no debe quedar «a.m..».
    return text.replace(/([ap]\.\s?m\.)\.(?!\.)/gi, '$1');
  }

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined && text !== null && text !== '') node.textContent = text; return node; }
  function templateById(id) { return ((state.catalog && state.catalog.TEMPLATES) || []).filter(function (item) { return item.id === id; })[0] || null; }
  function listOf() { return (state.summary && state.summary.templates) || []; }

  function statusChip(status) {
    var tone = status === 'APPROVED' ? 'ok' : status === 'PENDING' ? 'wait' : status === 'NONE' ? 'none' : 'bad';
    var label = status === 'APPROVED' ? 'Aprobada' : status === 'PENDING' ? 'En revisión' : status === 'NONE' ? 'Sin solicitar' : 'Con problema';
    return el('span', 'notice-chip is-' + tone, label);
  }

  function bubble(template) {
    var box = el('div', 'notice-bubble'); box.setAttribute('aria-label', 'Vista previa del mensaje');
    box.append(el('p', '', preview(template)));
    var buttons = template.buttons || [];
    if (buttons.length) { var row = el('div', 'notice-buttons'); buttons.forEach(function (b) { row.append(el('span', '', b.text)); }); box.append(row); }
    return box;
  }

  function recommendationBlock(event, audience, current) {
    var key = slotKey(event, audience), rec = RECOMMENDED[key], template = rec && templateById(rec.id);
    if (!rec || !template) return null;
    var status = statusOf(listOf(), rec.id);
    var box = el('div', 'notice-rec');
    var head = el('div', 'notice-rec-head'); head.append(el('strong', '', 'Recomendada por SMYL'), statusChip(status));
    box.append(head, el('p', 'notice-rec-title', template.title), el('p', 'notice-rec-why', rec.why));
    var actions = el('div', 'notice-rec-actions');
    if (status === 'APPROVED') {
      if (current && current.id === rec.id && current.source === 'chosen') box.append(el('p', 'notice-ok', 'Es la que tienes elegida.'));
      else if (current && current.id === rec.id) box.append(el('p', 'notice-ok', 'En uso hasta que elijas otra.'));
      else { var use = el('button', 'btn btn-primary btn-sm', 'Usar esta'); use.type = 'button'; use.disabled = Boolean(state.saving) || state.unavailable; use.onclick = function () { save(event, audience, rec.id); }; actions.append(use); }
    } else if (status === 'PENDING') {
      box.append(el('p', 'notice-wait', STATE_COPY.PENDING + ' Hasta entonces no se ofrecerá este aviso.'));
    } else if (status === 'NONE') {
      box.append(el('p', 'notice-wait', 'Para usarla, Meta debe aprobarla primero. SMYL la pide por ti con este texto.'));
      var canRequest = win && win.SmylTemplates && state.summary && state.summary.canRequest;
      var ask = el('button', 'btn btn-primary btn-sm', canRequest ? 'Crear y enviar a aprobación' : 'Ver plantilla');
      ask.type = 'button';
      ask.onclick = function () { if (canRequest) win.SmylTemplates.request(rec.id); else win.SmylTemplates.show('equipo' === template.group ? 'equipo' : template.group, template.title); };
      actions.append(ask);
      if (!canRequest) box.append(el('p', 'notice-fine', 'Solo el propietario puede solicitarla a Meta desde SMYL.'));
    } else {
      box.append(el('p', 'notice-bad', (STATE_COPY[status] || STATE_COPY.REJECTED) + ' Revisa el motivo en Plantillas y crea una versión corregida.'));
      var see = el('button', 'btn btn-secondary btn-sm', 'Ver en Plantillas'); see.type = 'button';
      see.onclick = function () { if (win && win.SmylTemplates) win.SmylTemplates.show(template.group, template.title); };
      actions.append(see);
    }
    if (actions.childNodes.length) box.append(actions);
    return box;
  }

  function slotCard(event, audience) {
    var key = slotKey(event.id, audience.id);
    var card = el('article', 'notice-card'); card.dataset.slot = key;
    card.append(el('h3', '', audience.label));
    var current = effectiveDefault(event.id, audience.id, state.defaults, listOf());
    var template = current && templateById(current.id);
    var now = el('div', 'notice-now');
    if (template) {
      var line = el('div', 'notice-now-head'); line.append(el('strong', '', template.title), statusChip('APPROVED'));
      now.append(line, bubble(template));
    } else {
      now.append(el('p', 'notice-empty', 'Todavía no hay una plantilla aprobada para este aviso. Cuando no la haya, SMYL no ofrecerá enviarlo.'));
    }
    card.append(now);
    var recommended = RECOMMENDED[key];
    if (current && recommended && current.id === recommended.id) {
      var same = el('div', 'notice-rec is-same');
      same.append(el('strong', '', current.source === 'chosen' ? 'Es la recomendada por SMYL y la tienes elegida' : 'Recomendada por SMYL · en uso'), el('p', 'notice-rec-why', recommended.why));
      card.append(same);
    } else {
      var rec = recommendationBlock(event.id, audience.id, current);
      if (rec) card.append(rec);
    }

    var groups = candidates(audience.id, state.catalog, listOf(), event.id);
    var total = groups.reduce(function (sum, group) { return sum + group.templates.length; }, 0);
    if (total) {
      var label = el('label', 'notice-pick'); label.append(el('span', '', 'Elegir otra aprobada'));
      var select = document.createElement('select'); select.disabled = Boolean(state.saving) || state.unavailable;
      select.setAttribute('aria-label', 'Plantilla para el aviso: ' + event.label + ' · ' + audience.short);
      var first = el('option', '', 'Elegir…'); first.value = ''; select.append(first);
      groups.forEach(function (group) {
        var optgroup = document.createElement('optgroup'); optgroup.label = group.label;
        group.templates.forEach(function (item) {
          var option = el('option', '', item.title + (RECOMMENDED[key] && RECOMMENDED[key].id === item.id ? ' (recomendada)' : '')); option.value = item.id;
          if (current && current.id === item.id) option.selected = true;
          optgroup.append(option);
        });
        select.append(optgroup);
      });
      if (current) first.textContent = 'Cambiar…';
      select.onchange = function () { if (select.value) save(event.id, audience.id, select.value); };
      label.append(select); card.append(label);
    }
    if (state.saving === key) card.append(el('p', 'notice-fine', 'Guardando…'));
    return card;
  }

  function render() {
    var host = typeof document !== 'undefined' && document.getElementById('notice-content'); if (!host) return;
    host.innerHTML = '';
    if (state.loading && !state.summary) { host.append(el('p', 'notice-note', 'Consultando tus plantillas…')); return; }
    if (state.error) {
      var box = el('div', 'notice-note is-warn'); box.setAttribute('role', 'alert'); box.append(el('p', '', state.error));
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { load(true); }; box.append(retry); host.append(box);
      if (!state.summary) return;
    }
    if (state.notice) { var note = el('div', 'notice-note ' + (state.notice.tone === 'error' ? 'is-warn' : 'is-ok')); note.setAttribute('role', state.notice.tone === 'error' ? 'alert' : 'status'); note.append(el('p', '', state.notice.text)); host.append(note); }
    if (state.unavailable) host.append(el('p', 'notice-note is-warn', 'Elegir una plantilla distinta todavía no está activado en esta clínica. Mientras tanto se usa la recomendada.'));
    if (state.summary && !state.summary.loaded) host.append(el('p', 'notice-note is-warn', 'No pudimos consultar el estado de tus plantillas en Meta. Intenta actualizar en un momento.'));
    EVENTS.forEach(function (event) {
      var section = el('section', 'notice-event');
      var head = el('div', 'notice-event-head'); head.append(el('h2', '', event.label), el('p', '', event.hint));
      var grid = el('div', 'notice-grid');
      AUDIENCES.forEach(function (audience) { grid.append(slotCard(event, audience)); });
      section.append(head, grid); host.append(section);
    });
    host.append(el('p', 'notice-fine', 'SMYL nunca envía un aviso por su cuenta: al confirmar, reprogramar o cancelar una cita te muestra el mensaje y tú decides si sale. Aquí solo eliges qué plantilla se ofrece.'));
  }

  function friendly(error) {
    var code = error && (error.code || ''); var message = String(error && error.message || '');
    if (code === '42501') return 'Solo quien administra la clínica puede cambiar los avisos de cita.';
    if (code === 'PGRST202' || code === '42883' || code === '42P01' || /could not find the function|does not exist|schema cache/i.test(message)) return 'Esta función todavía no está activada en esta clínica.';
    return 'No se pudo guardar el cambio. Intenta de nuevo.';
  }

  async function loadDefaults() {
    var result = await win.sb.from('smyl_appointment_notice_defaults').select('event,audience,template_name').eq('tenant_id', win.tenantId);
    if (result.error) {
      var text = friendly(result.error);
      if (/todavía no está activada/.test(text)) { state.unavailable = true; state.defaults = {}; return; }
      throw result.error;
    }
    state.unavailable = false; state.defaults = {};
    (result.data || []).forEach(function (row) { state.defaults[slotKey(row.event, row.audience)] = row.template_name; });
  }

  async function load(force) {
    if (!win || !win.sb || !win.tenantId || state.loading) return;
    if (!force && state.summary && state.tenant === win.tenantId) { render(); return; }
    state.loading = true; state.tenant = win.tenantId; state.error = ''; state.catalog = win.SmylTemplateCatalog; render();
    try {
      if (force && win.SmylTemplates && win.SmylTemplates.reload) await win.SmylTemplates.reload();
      state.summary = win.SmylTemplates ? await win.SmylTemplates.summary() : { templates: [], loaded: false };
      await loadDefaults();
    } catch (error) { state.error = 'No pudimos cargar tus avisos de cita. Intenta de nuevo.'; }
    finally { state.loading = false; render(); }
  }

  async function save(event, audience, templateName) {
    if (state.saving || !win || !win.sb) return;
    var key = slotKey(event, audience);
    state.saving = key; state.notice = null; render();
    try {
      var result = await win.sb.rpc('smyl_set_appointment_notice_default', { p_event: event, p_audience: audience, p_template_name: templateName });
      if (result.error) throw result.error;
      state.defaults[key] = templateName;
      var template = templateById(templateName);
      state.notice = { tone: 'ok', text: 'Listo: ' + (template ? template.title : 'plantilla') + ' se ofrecerá para este aviso.' };
    } catch (error) { state.notice = { tone: 'error', text: friendly(error) }; }
    finally { state.saving = ''; render(); }
  }

  function build() {
    var page = el('section', 'pantalla notice-page'); page.id = 'p-avisos-cita';
    var head = el('header', 'notice-page-head');
    var copy = el('div'); copy.append(el('span', 'pro-eyebrow', 'CONFIGURACIÓN · ATENCIÓN AUTOMÁTICA'), el('h1', '', 'Avisos de cita'),
      el('p', '', 'Elige qué plantilla de WhatsApp se ofrece al confirmar, reprogramar o cancelar una cita: una para el paciente y otra para el dentista.'));
    var refresh = el('button', 'btn btn-secondary', 'Actualizar'); refresh.type = 'button'; refresh.onclick = function () { load(true); };
    head.append(copy, refresh); page.append(head);
    var content = el('div', 'notice-content'); content.id = 'notice-content'; content.setAttribute('aria-live', 'polite'); page.append(content);
    var host = document.querySelector('.contenido'); if (host) host.append(page);
  }

  function init() {
    if (!win || !win.ir || document.getElementById('p-avisos-cita')) return;
    if (win.TITULOS) win.TITULOS['avisos-cita'] = 'Avisos de cita';
    build();
    if (win.SmylTemplates && win.SmylTemplates.onChange) win.SmylTemplates.onChange(function () {
      var page = document.getElementById('p-avisos-cita');
      if (page && page.offsetParent !== null && !state.loading) win.SmylTemplates.summary().then(function (summary) { state.summary = summary; render(); });
    });
    var previous = win.ir;
    win.ir = function (route) { var result = previous.apply(this, arguments); if (route === 'avisos-cita') load(false); return result; };
  }

  if (win && win.document) { if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', init); else init(); }
  return { EVENTS: EVENTS, AUDIENCES: AUDIENCES, RECOMMENDED: RECOMMENDED, slotKey: slotKey, isFillable: isFillable, allowedFor: allowedFor, effectiveDefault: effectiveDefault, candidates: candidates, preview: preview };
});
