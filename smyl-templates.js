/* SMYL · Mensajería → Plantillas de WhatsApp.
   Muestra el catálogo de plantillas para clínicas dentales (smyl-template-catalog.js), cómo va cada una
   en Meta y deja al propietario solicitarlas. Todo pasa por la función whatsapp-templates, que le pide
   al servicio de mensajería que las cree: SMYL nunca guarda tokens de Meta y solo Meta las aprueba. */
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
  // Filtro por estado (panel «Tus solicitudes a Meta» y barra de filtros). PAUSED, DISABLED y PENDING_DELETION cuentan como problemas.
  var STATE_FILTERS = [['all', 'Todas'], ['NONE', 'Por solicitar'], ['PENDING', 'En revisión'], ['APPROVED', 'Aprobadas'], ['PROBLEM', 'Con problemas']];
  var AUTO_REFRESH_MS = 60 * 1000;
  var state = { category: 'all', group: 'all', status: 'all', query: '', remote: null, canRequest: false, loading: false, error: '', loadedAt: 0, requesting: '', notice: null };
  var refreshTimer = 0;
  var searchTimer = 0;

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
    state.loading = true; state.error = ''; renderStatus(); renderTracker();
    try {
      var data = await invoke({ action: 'list' });
      var map = {};
      (data.templates || []).forEach(function (item) { if (item && item.name && item.language === catalog.LANGUAGE.code) map[String(item.name)] = item; });
      state.remote = map; state.canRequest = data.can_request === true;
      state.loadedAt = Date.now();
    } catch (error) {
      state.remote = null; state.canRequest = false; state.error = error.message || 'No pudimos consultar el servicio de mensajería.';
    } finally {
      state.loading = false; renderStatus(); renderTracker(); renderStatusFilters(); renderGrid(); notifyChange(); scheduleRefresh();
    }
  }

  function remoteOf(template) { return state.remote ? state.remote[template.id] || null : null; }
  function statusKey(template) {
    var remote = remoteOf(template);
    if (!remote) return 'NONE';
    return STATUS[remote.status] ? remote.status : 'PENDING';
  }
  function stateGroup(key) { return key === 'NONE' || key === 'PENDING' || key === 'APPROVED' ? key : 'PROBLEM'; }

  // «hace 5 min», «hace 2 h», «ayer», «el 12 nov». Sin fecha devuelve ''.
  function ago(value) {
    var time = value ? new Date(value).getTime() : NaN;
    if (!isFinite(time)) return '';
    var minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return 'hace un momento';
    if (minutes < 60) return 'hace ' + minutes + ' min';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    if (hours < 48) return 'ayer';
    try { return 'el ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(time)); } catch (_) { return ''; }
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
      if (state.status !== 'all' && (!state.remote || stateGroup(statusKey(template)) !== state.status)) return false;
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
    var article = el('article', 'tpl-card'); article.dataset.category = template.category; article.dataset.tplCard = template.id;
    if (state.remote) article.dataset.state = STATUS[statusKey(template)][1];
    var head = el('header', 'tpl-card-head');
    var chips = el('div', 'tpl-chips');
    var category = el('span', 'tpl-chip', CATEGORY[template.category]); category.dataset.category = template.category;
    chips.append(category);
    var status = statusChip(template); if (status) chips.prepend(status);
    if (template.recommended) chips.append(el('span', 'tpl-chip tpl-chip-recommended', 'Recomendada'));
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
    if (remote && remote.status === 'REJECTED') article.append(el('p', 'tpl-remote-note', 'Motivo de Meta: ' + reasonText(remote) + ' Ajusta el texto y solicita una versión nueva con otro nombre en tu panel de mensajería.'));
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

    /* El aviso de privacidad se puede mandar solo a pacientes nuevos: el interruptor vive junto a su plantilla. */
    if (template.id === 'aviso_privacidad_v1' && window.SmylPrivacyRights && typeof window.SmylPrivacyRights.autoControl === 'function') {
      var autoHost = el('div', 'tpl-auto');
      article.append(autoHost);
      window.SmylPrivacyRights.autoControl({ approved: state.remote ? statusKey(template) === 'APPROVED' : null }).then(function (node) { autoHost.append(node); });
    }

    var actions = el('footer', 'tpl-actions');
    var key = statusKey(template);
    if (state.remote && key === 'NONE') actions.append(requestButton(template));
    actions.append(copyButton('Copiar datos de solicitud', function () { return catalog.formatForLana(template); }, !state.remote), copyButton('Copiar solo el texto', function () { return template.body; }, false));
    article.append(actions);
    return article;
  }

  function renderStatus() {
    var host = document.querySelector('[data-tpl-status]');
    if (!host) return;
    host.replaceChildren();
    if (state.notice) { var notice = el('span', 'tpl-notice', state.notice.text); notice.dataset.kind = state.notice.kind; host.append(notice); }
    if (state.loading) {
      if (window.SmylSkeleton) { var skNode = window.SmylSkeleton.node('text', { lines: 1, label: 'Consultando plantillas' }); skNode.classList.add('tpl-status-skeleton'); host.append(skNode); }
      else host.append(el('span', 'tpl-status-text', 'Consultando plantillas…'));
      return;
    }
    if (state.error) {
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { loadApproved(true); };
      host.append(el('span', 'tpl-status-text', 'No pudimos consultar el estado en el servicio de mensajería. Puedes copiar los datos y solicitarlas desde tu panel de mensajería.'), retry);
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

  // ── Panel «Tus solicitudes a Meta»: todo lo que ya se mandó a revisión, lo más urgente primero ──
  var TRACK_ORDER = { PENDING: 0, PROBLEM: 1, APPROVED: 2 };
  function trackedItems() {
    if (!state.remote) return [];
    var known = {};
    var items = catalog.TEMPLATES.filter(function (template) { known[template.id] = true; return statusKey(template) !== 'NONE'; }).map(function (template) {
      return { id: template.id, title: template.title, group: template.group, category: template.category, key: statusKey(template), remote: remoteOf(template), inCatalog: true };
    });
    // Plantillas que existen en Meta pero no en el catálogo (creadas desde el panel de mensajería).
    Object.keys(state.remote).forEach(function (name) {
      if (known[name]) return;
      var remote = state.remote[name];
      items.push({ id: name, title: name, group: '', category: remote.category, key: STATUS[remote.status] ? remote.status : 'PENDING', remote: remote, inCatalog: false });
    });
    return items.sort(function (a, b) {
      var order = TRACK_ORDER[stateGroup(a.key)] - TRACK_ORDER[stateGroup(b.key)];
      if (order) return order;
      return String((b.remote && b.remote.requested_at) || '').localeCompare(String((a.remote && a.remote.requested_at) || ''));
    });
  }

  function groupLabel(id) {
    var match = catalog.GROUPS.filter(function (group) { return group.id === id; })[0];
    return match ? match.label : '';
  }

  function focusCard(id) {
    state.category = 'all'; state.group = 'all'; state.status = 'all'; state.query = '';
    var input = document.querySelector('#p-plantillas .tpl-toolbar input[type="search"]'); if (input) input.value = '';
    renderToolbar(); renderGroupToolbar(); renderStatusFilters(); renderGrid();
    var target = document.querySelector('[data-tpl-card="' + id + '"]');
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('is-focus');
    setTimeout(function () { target.classList.remove('is-focus'); }, 2200);
  }

  function renderTracker() {
    var host = document.querySelector('[data-tpl-tracker]');
    if (!host) return;
    host.replaceChildren();
    if (!state.remote) { host.hidden = true; return; }
    host.hidden = false;
    var items = trackedItems();
    var counts = { PENDING: 0, APPROVED: 0, PROBLEM: 0 };
    items.forEach(function (item) { counts[stateGroup(item.key)] += 1; });

    var head = el('div', 'tpl-track-head');
    var title = el('div');
    title.append(el('h2', '', 'Tus solicitudes a Meta'),
      el('p', '', items.length ? 'Meta revisa cada plantilla; aquí ves cómo va cada una. El estado se actualiza solo mientras haya plantillas en revisión.' : 'Todavía no has enviado plantillas a Meta. Empieza por las marcadas como «Recomendada».'));
    var side = el('div', 'tpl-track-side');
    if (state.loadedAt) side.append(el('span', 'tpl-track-time', 'Consultado ' + ago(state.loadedAt)));
    var refresh = el('button', 'btn btn-secondary btn-sm', state.loading ? 'Actualizando…' : 'Actualizar estado');
    refresh.type = 'button'; refresh.disabled = state.loading;
    refresh.onclick = function () { loadApproved(true); };
    side.append(refresh);
    head.append(title, side);
    host.append(head);
    if (!items.length) return;
    // Con solicitudes en curso, la guía de pasos ya no hace falta abierta (una sola vez; luego respeta lo que elija la persona).
    if (!state.guideCollapsed) { state.guideCollapsed = true; var how = document.querySelector('#p-plantillas .tpl-how'); if (how) how.open = false; }
    // Con solicitudes en curso, la guía de pasos ya no hace falta abierta (una sola vez; luego respeta lo que elija la persona).
    if (!state.guideCollapsed) { state.guideCollapsed = true; var how = document.querySelector('#p-plantillas .tpl-how'); if (how) how.open = false; }

    var stats = el('div', 'tpl-track-stats');
    [['PENDING', 'En revisión', 'pending'], ['APPROVED', 'Aprobadas', 'approved'], ['PROBLEM', 'Con problemas', 'rejected']].forEach(function (entry) {
      var button = el('button', 'tpl-track-stat'); button.type = 'button'; button.dataset.state = entry[2];
      button.setAttribute('aria-pressed', String(state.status === entry[0]));
      button.append(el('strong', '', String(counts[entry[0]])), el('span', '', entry[1]));
      button.disabled = !counts[entry[0]];
      button.onclick = function () { state.status = state.status === entry[0] ? 'all' : entry[0]; renderTracker(); renderStatusFilters(); renderGrid(); };
      stats.append(button);
    });
    host.append(stats);

    var list = el('ul', 'tpl-track-list');
    items.forEach(function (item) {
      var row = el('li', 'tpl-track-row'); row.dataset.state = STATUS[item.key][1];
      var main = el('div', 'tpl-track-main');
      var line = el('div', 'tpl-track-line');
      var pill = el('span', 'tpl-chip tpl-chip-status', STATUS[item.key][0]); pill.dataset.state = STATUS[item.key][1];
      line.append(pill, el('strong', '', item.title));
      main.append(line);
      var meta = [CATEGORY[item.category] || item.category, groupLabel(item.group)].filter(Boolean);
      var requested = ago(item.remote && item.remote.requested_at);
      var updated = ago(item.remote && item.remote.updated_at);
      if (requested) meta.push('Solicitada ' + requested);
      if (updated && updated !== requested && item.key !== 'PENDING') meta.push('Respuesta de Meta ' + updated);
      if (!item.inCatalog) meta.push('Creada fuera del catálogo');
      main.append(el('p', 'tpl-track-meta', meta.join(' · ')));
      if (item.key === 'PENDING') main.append(el('p', 'tpl-track-hint', 'Meta suele responder entre unos minutos y 48 horas. No tienes que hacer nada.'));
      if (stateGroup(item.key) === 'PROBLEM' && item.remote) main.append(el('p', 'tpl-track-reason', 'Motivo: ' + reasonText(item.remote)));
      var template = catalog.TEMPLATES.filter(function (t) { return t.id === item.id; })[0];
      var changed = template ? reclassified(template) : '';
      if (changed) main.append(el('p', 'tpl-track-reason', 'Meta la clasificó como ' + (CATEGORY[changed] || changed) + '; para recordatorios automáticos debe ser de Utilidad.'));
      row.append(main);
      if (item.inCatalog) {
        var view = el('button', 'btn btn-secondary btn-sm', 'Ver plantilla'); view.type = 'button';
        view.onclick = function () { focusCard(item.id); };
        row.append(view);
      }
      list.append(row);
    });
    host.append(list);
  }

  function renderStatusFilters() {
    var host = document.querySelector('[data-tpl-states]');
    if (!host) return;
    host.replaceChildren();
    host.hidden = !state.remote;
    if (!state.remote) return;
    STATE_FILTERS.forEach(function (entry) {
      var total = catalog.TEMPLATES.filter(function (template) { return entry[0] === 'all' || stateGroup(statusKey(template)) === entry[0]; }).length;
      var button = el('button'); button.type = 'button';
      button.setAttribute('aria-pressed', String(state.status === entry[0]));
      button.append(el('span', '', entry[1]), el('b', '', String(total)));
      button.onclick = function () { state.status = entry[0]; renderStatusFilters(); renderTracker(); renderGrid(); };
      host.append(button);
    });
  }

  // Mientras haya plantillas en revisión y la pantalla esté a la vista, se vuelve a consultar cada minuto.
  function pendingCount() {
    if (!state.remote) return 0;
    return trackedItems().filter(function (item) { return item.key === 'PENDING'; }).length;
  }
  function pageVisible() {
    var page = document.getElementById('p-plantillas');
    return Boolean(page && page.offsetParent !== null && document.visibilityState === 'visible');
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!pendingCount()) return;
    refreshTimer = setTimeout(function () {
      if (pageVisible()) loadApproved(true); else scheduleRefresh();
    }, AUTO_REFRESH_MS);
  }

  function renderToolbar() {
    var tabs = document.querySelector('[data-tpl-tabs]');
    if (!tabs) return;
    tabs.replaceChildren();
    [['all', 'Todas'], ['UTILITY', 'Utilidad'], ['MARKETING', 'Marketing']].forEach(function (entry) {
      var total = catalog.TEMPLATES.filter(function (template) { return entry[0] === 'all' || template.category === entry[0]; }).length;
      var button = el('button', '', entry[1]); button.type = 'button'; button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(state.category === entry[0]));
      button.append(el('b', '', String(total)));
      button.onclick = function () { state.category = entry[0]; renderToolbar(); renderGrid(); };
      tabs.append(button);
    });
  }

  function renderGroupToolbar() {
    var host = document.querySelector('[data-tpl-groups]');
    if (!host) return;
    host.replaceChildren();
    [{ id: 'all', label: 'Todas' }].concat(catalog.GROUPS).forEach(function (entry) {
      var total = catalog.TEMPLATES.filter(function (template) { return entry.id === 'all' || template.group === entry.id; }).length;
      var button = el('button', '', entry.label); button.type = 'button';
      button.setAttribute('aria-pressed', String(state.group === entry.id));
      button.append(el('b', '', String(total)));
      button.onclick = function () { state.group = entry.id; renderGroupToolbar(); renderGrid(); };
      host.append(button);
    });
  }

  function renderGrid() {
    var grid = document.querySelector('[data-tpl-grid]');
    var count = document.querySelector('[data-tpl-count]');
    if (!grid) return;
    var items = visibleTemplates();
    grid.replaceChildren();
    if (count) count.textContent = items.length === catalog.TEMPLATES.length ? items.length + ' plantillas' : items.length + ' de ' + catalog.TEMPLATES.length + ' plantillas';
    if (!items.length) {
      var empty = el('div', 'tpl-empty'); empty.append(el('strong', '', 'No hay plantillas con esos filtros'), el('p', '', 'Prueba con otra categoría, otro estado o borra la búsqueda.'));
      grid.append(empty); return;
    }
    catalog.GROUPS.forEach(function (group) {
      var groupItems = items.filter(function (template) { return template.group === group.id; });
      if (!groupItems.length) return;
      var section = el('section', 'tpl-group-section');
      var heading = el('div', 'tpl-group-head');
      var title = el('h2', '', group.label); title.append(el('span', '', String(groupItems.length)));
      heading.append(title, el('p', '', group.description || ''));
      var cards = el('div', 'tpl-group-grid');
      groupItems.forEach(function (template) { cards.append(card(template)); });
      section.append(heading, cards); grid.append(section);
    });
  }


  // ── API para otras pantallas (Cobros): estado de un grupo de plantillas, solicitud y navegación ──
  var listeners = [];
  function notifyChange() { listeners.slice().forEach(function (fn) { try { fn(); } catch (_) {} }); }
  async function summary(groupId) {
    await loadApproved(false);
    var list = catalog.TEMPLATES.filter(function (template) { return !groupId || template.group === groupId; }).map(function (template) {
      var key = statusKey(template), remote = remoteOf(template);
      return {
        id: template.id, title: template.title, when: template.when, category: template.category,
        status: key, statusLabel: state.remote ? STATUS[key][0] : 'Sin consultar', tone: STATUS[key][1],
        reclassified: reclassified(template) || '', reason: remote && (key === 'REJECTED' || key === 'PAUSED' || key === 'DISABLED') ? reasonText(remote) : ''
      };
    });
    return { templates: list, canRequest: state.canRequest, error: state.error, loaded: Boolean(state.remote) };
  }
  function requestTemplate(id) {
    var template = catalog.TEMPLATES.filter(function (item) { return item.id === id; })[0];
    if (template && state.canRequest && !state.requesting) confirmRequest(template);
  }
  function showTemplates(groupId, query) {
    state.category = 'all'; state.group = groupId || 'all'; state.status = 'all'; state.query = query || '';
    var input = document.querySelector('#p-plantillas .tpl-toolbar input[type="search"]'); if (input) input.value = state.query;
    renderToolbar(); renderGroupToolbar(); renderGrid();
    if (typeof window.ir === 'function') window.ir('plantillas');
  }

  function build() {
    var page = el('section', 'pantalla templates-page'); page.id = 'p-plantillas';
    var head = el('header', 'tpl-head');
    var copyBlock = el('div');
    copyBlock.append(el('span', 'pro-eyebrow', 'MENSAJERÍA'), el('h1', '', 'Plantillas de WhatsApp'),
      el('p', '', catalog.TEMPLATES.length + ' propuestas para clínicas dentales. Solicítalas aquí: Meta debe aprobar cada una antes de usarla fuera de la ventana de 24 horas.'));
    var status = el('div', 'tpl-status'); status.dataset.tplStatus = ''; status.setAttribute('aria-live', 'polite');
    head.append(copyBlock, status);

    // En celular los pasos empiezan plegados para llegar antes a las plantillas.
    var how = el('details', 'tpl-how'); how.open = !window.matchMedia('(max-width:760px)').matches;
    how.append(el('summary', '', 'Cómo solicitarlas'));
    var steps = el('ol', 'tpl-steps');
    [['Elige una plantilla', 'Revisa el texto y presiona «Solicitar a Meta» (solo el propietario puede hacerlo).'],
     ['Espera a Meta', 'Suele tardar de unos minutos a 48 horas. SMYL no la aprueba: solo Meta.'],
     ['Úsala', 'Cuando diga «Aprobada», ya puedes usarla en recordatorios y mensajes fuera de las 24 horas. Si no puedes solicitar desde aquí, copia los datos de solicitud y créala en tu panel de mensajería.']].forEach(function (step, index) {
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
    search.oninput = function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.query = search.value; renderGrid(); }, 150);
    };
    var groups = el('div', 'tpl-group-tabs'); groups.dataset.tplGroups = ''; groups.setAttribute('aria-label', 'Uso de la plantilla');
    var states = el('div', 'tpl-state-tabs'); states.dataset.tplStates = ''; states.setAttribute('aria-label', 'Estado en Meta'); states.hidden = true;
    toolbar.append(tabs, groups, states, search);

    var count = el('p', 'tpl-count'); count.dataset.tplCount = '';
    var grid = el('div', 'tpl-grid'); grid.dataset.tplGrid = '';
    how.append(steps);
    var tracker = el('section', 'tpl-tracker'); tracker.dataset.tplTracker = ''; tracker.hidden = true; tracker.setAttribute('aria-label', 'Tus solicitudes a Meta');
    page.append(head, tracker, how, rules, toolbar, count, grid);
    document.querySelector('.contenido').append(page);
    renderToolbar(); renderGroupToolbar(); renderStatus(); renderGrid();
  }

  function init() {
    if (document.getElementById('p-plantillas')) return;
    window.TITULOS = window.TITULOS || {};
    window.TITULOS.plantillas = 'Plantillas de WhatsApp';
    build();
    var previous = window.ir;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && pendingCount() && pageVisible()) loadApproved(false);
    });
    if (typeof previous === 'function') {
      window.ir = function (route) {
        var result = previous.apply(this, arguments);
        if (route === 'plantillas') loadApproved(false);
        return result;
      };
    }
    window.SmylTemplates = Object.freeze({
      reload: function () { return loadApproved(true); },
      summary: summary, request: requestTemplate, show: showTemplates,
      onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
