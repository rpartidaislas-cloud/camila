/* SMYL · Mensajería → Plantillas de WhatsApp.
   Muestra el catálogo de plantillas para clínicas dentales (smyl-template-catalog.js), cómo va cada una
   en Meta y deja al propietario solicitarlas. Todo pasa por la función whatsapp-templates, que le pide
   a LANA que las cree: SMYL nunca guarda tokens de Meta y solo Meta las aprueba. */
(function () {
  'use strict';

  var catalog = window.SmylTemplateCatalog;
  if (!catalog) return;

  var CATEGORY = { UTILITY: 'Utilidad', MARKETING: 'Marketing' };
  var FUNCTION_NAME = 'whatsapp-templates';
  var STATUS = {
    NONE: ['Por solicitar', 'missing'], PENDING: ['En revisión de Meta', 'pending'], APPROVED: ['Aprobada', 'approved'],
    REJECTED: ['Rechazada', 'rejected'], PAUSED: ['Pausada por Meta', 'rejected'], DISABLED: ['Deshabilitada por Meta', 'rejected'],
    PENDING_DELETION: ['En eliminación', 'rejected']
  };
  var REASONS = {
    INVALID_FORMAT: 'El formato no es válido para Meta (revisa variables y saltos de línea).',
    ABUSIVE_CONTENT: 'Meta la consideró contenido abusivo o inapropiado.',
    SCAM: 'Meta la confundió con un posible fraude o estafa.',
    TAG_CONTENT_MISMATCH: 'El contenido no corresponde a la categoría elegida.',
    PROMOTIONAL: 'Meta la consideró promocional, no de utilidad.',
    NONE: ''
  };
  var state = { category: 'all', group: 'all', query: '', remote: null, canRequest: false, loading: false, error: '', loadedAt: 0, requesting: '', notice: null };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('es-MX').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  async function copy(value) {
    try { await navigator.clipboard.writeText(value); return true; }
    catch (_) {
      var area = document.createElement('textarea');
      area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (__) {}
      area.remove();
      return done;
    }
  }

  async function invoke(body) {
    if (!window.sb || !window.sb.functions) throw new Error('La sesión todavía no está lista.');
    var result = await window.sb.functions.invoke(FUNCTION_NAME, { body: body });
    if (result.error) {
      var detail = '';
      try { detail = result.error.context && typeof result.error.context.json === 'function' ? ((await result.error.context.json()) || {}).error : ''; } catch (_) {}
      throw new Error(detail || 'El servicio de plantillas no está disponible todavía.');
    }
    return result.data || {};
  }

  async function loadApproved(force) {
    if (state.loading || (!force && state.loadedAt && Date.now() - state.loadedAt < 60 * 1000)) return;
    state.loading = true; state.error = ''; renderStatus();
    try {
      var data = await invoke({ action: 'list' });
      var map = {};
      (data.templates || []).forEach(function (item) { if (item && item.name && item.language === catalog.LANGUAGE.code) map[String(item.name)] = item; });
      state.remote = map; state.canRequest = data.can_request === true;
      state.loadedAt = Date.now();
    } catch (error) {
      state.remote = null; state.canRequest = false; state.error = error.message || 'No pudimos consultar LANA.';
    } finally {
      state.loading = false; renderStatus(); renderGrid();
    }
  }

  function remoteOf(template) { return state.remote ? state.remote[template.id] || null : null; }
  function statusKey(template) {
    var remote = remoteOf(template);
    if (!remote) return 'NONE';
    return STATUS[remote.status] ? remote.status : 'PENDING';
  }
  function reasonText(remote) {
    var code = String(remote.rejection_reason || '').trim();
    if (!code) return 'Meta no indicó el motivo.';
    return Object.prototype.hasOwnProperty.call(REASONS, code.toUpperCase()) ? REASONS[code.toUpperCase()] || 'Meta no indicó el motivo.' : code;
  }

  function visibleTemplates() {
    var query = normalize(state.query);
    return catalog.TEMPLATES.filter(function (template) {
      if (state.category !== 'all' && template.category !== state.category) return false;
      if (state.group !== 'all' && template.group !== state.group) return false;
      if (query && normalize([template.title, template.body, template.id, template.when].join(' ')).indexOf(query) === -1) return false;
      return true;
    });
  }

  function bodyNodes(template) {
    var fragment = document.createDocumentFragment();
    template.body.split(/(\{\{\s*\d+\s*\}\})/).forEach(function (part) {
      var match = part.match(/^\{\{\s*(\d+)\s*\}\}$/);
      if (!match) { fragment.append(document.createTextNode(part)); return; }
      var variable = template.variables[Number(match[1]) - 1];
      var mark = el('mark', 'tpl-var', variable ? variable.example : part);
      mark.title = '{{' + match[1] + '}} · ' + (variable ? variable.label : '');
      fragment.append(mark);
    });
    return fragment;
  }

  function copyButton(label, getValue, primary) {
    var button = el('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary') + ' btn-sm', label);
    button.type = 'button';
    button.onclick = async function () {
      var ok = await copy(getValue());
      button.textContent = ok ? 'Copiada ✓' : 'No se pudo copiar';
      setTimeout(function () { button.textContent = label; }, 1800);
    };
    return button;
  }

  function statusChip(template) {
    if (!state.remote) return null;
    var key = statusKey(template);
    var chip = el('span', 'tpl-chip tpl-chip-status', STATUS[key][0]);
    chip.dataset.state = STATUS[key][1];
    return chip;
  }

  // Meta puede reclasificar una plantilla de Utilidad como Marketing; entonces no sirve para recordatorios.
  function reclassified(template) {
    var remote = remoteOf(template);
    return remote && remote.category && remote.category !== template.category ? remote.category : '';
  }

  function requestButton(template) {
    var button = el('button', 'btn btn-primary btn-sm', state.requesting === template.id ? 'Enviando…' : 'Solicitar a Meta');
    button.type = 'button';
    button.dataset.tplRequest = template.id;
    var blocked = !state.canRequest || Boolean(state.requesting);
    button.disabled = blocked;
    if (!state.canRequest) button.title = 'Solo el propietario de la clínica puede solicitar plantillas.';
    button.onclick = function () { confirmRequest(template); };
    return button;
  }

  function confirmRequest(template) {
    var dialog = el('dialog', 'tpl-dialog');
    var form = el('div', 'tpl-dialog-body');
    form.append(el('h3', '', 'Solicitar «' + template.title + '» a Meta'));
    form.append(el('p', '', 'Se enviará tal cual a tu cuenta de WhatsApp Business. Meta decide si la aprueba y suele tardar de unos minutos a 48 horas.'));
    if (template.category === 'MARKETING') form.append(el('p', 'tpl-dialog-warn', 'Es de Marketing: solo envíala a pacientes que aceptaron recibir promociones, y la plantilla ya incluye cómo darse de baja.'));
    form.append(el('p', 'tpl-dialog-warn', 'Si Meta la rechaza muchas veces, tu cuenta puede perder reputación. Por eso solo se envía una a la vez.'));
    var actions = el('div', 'tpl-dialog-actions');
    var cancel = el('button', 'btn btn-secondary btn-sm', 'Cancelar'); cancel.type = 'button';
    var ok = el('button', 'btn btn-primary btn-sm', 'Solicitar'); ok.type = 'button';
    cancel.onclick = function () { dialog.close(); };
    ok.onclick = function () { dialog.close(); submitRequest(template); };
    actions.append(cancel, ok); form.append(actions); dialog.append(form);
    dialog.addEventListener('close', function () { dialog.remove(); });
    document.body.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }

  async function submitRequest(template) {
    if (state.requesting) return;
    state.requesting = template.id; state.notice = null; renderGrid();
    try {
      var data = await invoke({ action: 'request', template_id: template.id });
      state.notice = { kind: 'ok', text: data.existing ? 'Esa plantilla ya estaba en Meta; mostramos su estado actual.' : '«' + template.title + '» se envió a Meta. Te mostraremos aquí si la aprueba.' };
      state.loadedAt = 0;
    } catch (error) {
      state.notice = { kind: 'error', text: error.message || 'No se pudo solicitar la plantilla.' };
    } finally {
      state.requesting = ''; renderStatus();
      await loadApproved(true);
    }
  }

  function card(template) {
    var article = el('article', 'tpl-card'); article.dataset.category = template.category;
    var head = el('header', 'tpl-card-head');
    var chips = el('div', 'tpl-chips');
    var category = el('span', 'tpl-chip', CATEGORY[template.category]); category.dataset.category = template.category;
    chips.append(category);
    var status = statusChip(template); if (status) chips.append(status);
    if (template.automatic) chips.append(el('span', 'tpl-chip tpl-chip-auto', 'Recordatorio automático'));
    head.append(chips, el('h3', '', template.title), el('p', 'tpl-when', template.when));
    article.append(head);

    var bubble = el('div', 'tpl-bubble');
    if (template.header) bubble.append(el('strong', 'tpl-bubble-header', template.header));
    var body = el('p', 'tpl-bubble-body'); body.append(bodyNodes(template)); bubble.append(body);
    if (template.footer) bubble.append(el('small', 'tpl-bubble-footer', template.footer));
    article.append(bubble);
    if (template.buttons.length) {
      var buttons = el('div', 'tpl-buttons');
      template.buttons.forEach(function (button) { buttons.append(el('span', '', button.text)); });
      article.append(buttons);
    }
    if (template.note) article.append(el('p', 'tpl-note', template.note));
    var remote = remoteOf(template);
    if (remote && remote.status === 'REJECTED') article.append(el('p', 'tpl-remote-note', 'Motivo de Meta: ' + reasonText(remote) + ' Ajusta el texto y solicita una versión nueva con otro nombre en LANA.'));
    var changed = reclassified(template);
    if (changed) article.append(el('p', 'tpl-remote-note', 'Meta la clasificó como ' + (CATEGORY[changed] || changed) + '. Para recordatorios automáticos necesita ser de Utilidad.'));

    var details = el('details', 'tpl-details');
    details.append(el('summary', '', 'Variables y datos técnicos'));
    var list = el('dl', 'tpl-facts');
    [['Nombre en Meta', template.id], ['Idioma', catalog.LANGUAGE.label + ' · ' + catalog.LANGUAGE.code]].forEach(function (row) {
      list.append(el('dt', '', row[0]), el('dd', '', row[1]));
    });
    template.variables.forEach(function (variable, index) {
      list.append(el('dt', '', '{{' + (index + 1) + '}}'), el('dd', '', variable.label + ' · ej. ' + variable.example));
    });
    details.append(list); article.append(details);

    var actions = el('footer', 'tpl-actions');
    var key = statusKey(template);
    if (state.remote && key === 'NONE') actions.append(requestButton(template));
    actions.append(copyButton('Copiar para LANA', function () { return catalog.formatForLana(template); }, !(state.remote && key === 'NONE')), copyButton('Copiar solo el texto', function () { return template.body; }, false));
    article.append(actions);
    return article;
  }

  function renderStatus() {
    var host = document.querySelector('[data-tpl-status]');
    if (!host) return;
    host.innerHTML = '';
    if (state.notice) { var notice = el('span', 'tpl-notice', state.notice.text); notice.dataset.kind = state.notice.kind; host.append(notice); }
    if (state.loading) { host.append(el('span', 'tpl-status-text', 'Consultando LANA…')); return; }
    if (state.error) {
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { loadApproved(true); };
      host.append(el('span', 'tpl-status-text', 'No pudimos consultar el estado en LANA. Puedes copiar las plantillas y solicitarlas allá.'), retry);
      return;
    }
    if (state.remote) {
      var counts = { APPROVED: 0, PENDING: 0, REJECTED: 0 };
      catalog.TEMPLATES.forEach(function (template) {
        var key = statusKey(template);
        if (key === 'APPROVED') counts.APPROVED += 1; else if (key === 'PENDING') counts.PENDING += 1; else if (key !== 'NONE') counts.REJECTED += 1;
      });
      host.append(el('strong', '', counts.APPROVED + ' de ' + catalog.TEMPLATES.length), el('span', 'tpl-status-text', 'aprobadas'));
      if (counts.PENDING) host.append(el('span', 'tpl-status-text', '· ' + counts.PENDING + ' en revisión'));
      if (counts.REJECTED) host.append(el('span', 'tpl-status-text', '· ' + counts.REJECTED + ' con problemas'));
    }
  }

  function renderToolbar() {
    var tabs = document.querySelector('[data-tpl-tabs]');
    if (!tabs) return;
    tabs.innerHTML = '';
    [['all', 'Todas'], ['UTILITY', 'Utilidad'], ['MARKETING', 'Marketing']].forEach(function (entry) {
      var total = catalog.TEMPLATES.filter(function (template) { return entry[0] === 'all' || template.category === entry[0]; }).length;
      var button = el('button', '', entry[1]); button.type = 'button'; button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(state.category === entry[0]));
      button.append(el('b', '', String(total)));
      button.onclick = function () { state.category = entry[0]; renderToolbar(); renderGrid(); };
      tabs.append(button);
    });
  }

  function renderGrid() {
    var grid = document.querySelector('[data-tpl-grid]');
    var count = document.querySelector('[data-tpl-count]');
    if (!grid) return;
    var items = visibleTemplates();
    grid.innerHTML = '';
    if (count) count.textContent = items.length === catalog.TEMPLATES.length ? items.length + ' plantillas' : items.length + ' de ' + catalog.TEMPLATES.length + ' plantillas';
    if (!items.length) {
      var empty = el('div', 'tpl-empty'); empty.append(el('strong', '', 'No hay plantillas con esos filtros'), el('p', '', 'Prueba con otra categoría o borra la búsqueda.'));
      grid.append(empty); return;
    }
    items.forEach(function (template) { grid.append(card(template)); });
  }

  function build() {
    var page = el('section', 'pantalla templates-page'); page.id = 'p-plantillas';
    var head = el('header', 'tpl-head');
    var copyBlock = el('div');
    copyBlock.append(el('span', 'pro-eyebrow', 'MENSAJERÍA'), el('h1', '', 'Plantillas de WhatsApp'),
      el('p', '', catalog.TEMPLATES.length + ' propuestas para clínicas dentales. Solicítalas aquí: Meta debe aprobar cada una antes de usarla fuera de la ventana de 24 horas.'));
    var status = el('div', 'tpl-status'); status.dataset.tplStatus = '';
    head.append(copyBlock, status);

    // En celular los pasos empiezan plegados para llegar antes a las plantillas.
    var how = el('details', 'tpl-how'); how.open = !window.matchMedia('(max-width:760px)').matches;
    how.append(el('summary', '', 'Cómo solicitarlas'));
    var steps = el('ol', 'tpl-steps');
    [['Elige una plantilla', 'Revisa el texto y presiona «Solicitar a Meta» (solo el propietario puede hacerlo).'],
     ['Espera a Meta', 'Suele tardar de unos minutos a 48 horas. SMYL no la aprueba: solo Meta.'],
     ['Úsala', 'Cuando diga «Aprobada», ya puedes usarla en recordatorios y mensajes fuera de las 24 horas. Si no puedes solicitar desde aquí, copia la plantilla y créala en LANA.']].forEach(function (step, index) {
      var item = el('li'); item.append(el('b', '', String(index + 1)));
      var text = el('div'); text.append(el('strong', '', step[0]), el('span', '', step[1])); item.append(text); steps.append(item);
    });

    var rules = el('details', 'tpl-rules');
    rules.append(el('summary', '', 'Reglas de Meta que respetan estas plantillas'));
    var ruleList = el('div', 'tpl-rule-list');
    catalog.RULES.forEach(function (rule) { var item = el('div'); item.append(el('strong', '', rule.title), el('p', '', rule.text)); ruleList.append(item); });
    rules.append(ruleList);

    var toolbar = el('div', 'tpl-toolbar');
    var tabs = el('div', 'tpl-tabs'); tabs.dataset.tplTabs = ''; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Categoría');
    var search = el('input'); search.type = 'search'; search.placeholder = 'Buscar plantilla'; search.setAttribute('aria-label', 'Buscar plantilla');
    search.oninput = function () { state.query = search.value; renderGrid(); };
    var group = el('select'); group.setAttribute('aria-label', 'Tipo de mensaje');
    group.append(new Option('Todos los tipos', 'all'));
    catalog.GROUPS.forEach(function (entry) { group.append(new Option(entry.label, entry.id)); });
    group.onchange = function () { state.group = group.value; renderGrid(); };
    toolbar.append(tabs, group, search);

    var count = el('p', 'tpl-count'); count.dataset.tplCount = '';
    var grid = el('div', 'tpl-grid'); grid.dataset.tplGrid = '';
    how.append(steps);
    page.append(head, how, rules, toolbar, count, grid);
    document.querySelector('.contenido').append(page);
    renderToolbar(); renderStatus(); renderGrid();
  }

  function init() {
    if (document.getElementById('p-plantillas')) return;
    window.TITULOS = window.TITULOS || {};
    window.TITULOS.plantillas = 'Plantillas de WhatsApp';
    build();
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (route) {
        var result = previous.apply(this, arguments);
        if (route === 'plantillas') loadApproved(false);
        return result;
      };
    }
    window.SmylTemplates = Object.freeze({ reload: function () { return loadApproved(true); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
