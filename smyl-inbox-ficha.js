(function () {
  'use strict';

  // Piezas visuales de la Ficha 360 del chat (cabecera, pestañas, tarjetas de resumen, galería de archivos y línea de tiempo).
  // No consulta datos ni conoce el tenant: smyl-inbox.js le pasa lo ya cargado y recibe las acciones por callbacks.

  function node(tag, cls, text) {
    var element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined && text !== null && text !== '') element.textContent = text;
    return element;
  }

  function button(label, cls, run) {
    var element = node('button', cls, label);
    element.type = 'button';
    if (run) element.onclick = run;
    return element;
  }

  function shortDate(value, withTime) {
    var date = value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) return '';
    var today = new Date(); var yesterday = new Date(Date.now() - 86400000);
    var time = date.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return withTime ? 'Hoy · ' + time : 'Hoy';
    if (date.toDateString() === yesterday.toDateString()) return withTime ? 'Ayer · ' + time : 'Ayer';
    var label = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).replace('.', '');
    return withTime ? label + ' · ' + time : label;
  }

  function shell(ctx) {
    var root = node('section', 'smyl-f360');
    var identity = node('div', 'smyl-f360-id');
    identity.append(node('span', 'smyl-f360-avatar', ctx.initials || '·'));
    var copy = node('div', 'smyl-f360-id-copy');
    copy.append(node('strong', ctx.subtitle ? '' : 'is-missing', ctx.subtitle || 'Sin teléfono ni correo registrados'));
    if (ctx.meta) copy.append(node('small', '', ctx.meta));
    identity.append(copy); root.append(identity);
    if ((ctx.chips || []).length) {
      var chips = node('div', 'smyl-f360-chips');
      ctx.chips.forEach(function (chip) { chips.append(node('span', 'smyl-f360-chip is-' + (chip.tone || 'neutral'), chip.text)); });
      root.append(chips);
    }
    if ((ctx.actions || []).length) {
      var actions = node('div', 'smyl-f360-actions');
      ctx.actions.forEach(function (action) { actions.append(button(action.label, 'smyl-f360-action' + (action.primary ? ' is-primary' : ''), action.run)); });
      root.append(actions);
    }
    var tabs = ctx.tabs || [];
    var active = tabs.some(function (tab) { return tab.id === ctx.active; }) ? ctx.active : (tabs[0] && tabs[0].id);
    var tablist = node('div', 'smyl-f360-tabs'); tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Secciones de la ficha del paciente');
    tabs.forEach(function (tab) {
      var element = node('button', 'smyl-f360-tab' + (tab.id === active ? ' is-active' : ''));
      element.type = 'button'; element.id = 'smyl-f360-tab-' + tab.id; element.setAttribute('role', 'tab');
      element.setAttribute('aria-selected', tab.id === active ? 'true' : 'false'); element.setAttribute('aria-controls', 'smyl-f360-panel-' + tab.id);
      element.tabIndex = tab.id === active ? 0 : -1; element.dataset.f360Tab = tab.id;
      element.append(document.createTextNode(tab.label)); if (tab.title) element.title = tab.title;
      if (tab.count) element.append(node('em', '', String(tab.count)));
      element.onclick = function () { if (ctx.onSelect) ctx.onSelect(tab.id); };
      tablist.append(element);
    });
    tablist.addEventListener('keydown', function (event) {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].indexOf(event.key) === -1) return;
      var items = Array.from(tablist.querySelectorAll('[role="tab"]')); var index = items.indexOf(document.activeElement); if (index < 0) return;
      event.preventDefault();
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      if (ctx.onSelect) ctx.onSelect(items[next].dataset.f360Tab, true);
    });
    root.append(tablist);
    var current = tabs.find(function (tab) { return tab.id === active; });
    var panel = node('div', 'smyl-f360-panel'); panel.id = 'smyl-f360-panel-' + active; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'smyl-f360-tab-' + active); panel.dataset.section = 'f360-' + active;
    if (current && current.node) panel.append(current.node);
    root.append(panel);
    return root;
  }

  function tiles(list) {
    var grid = node('div', 'smyl-f360-tiles');
    list.filter(Boolean).forEach(function (tile) {
      var card = node('div', 'smyl-f360-tile' + (tile.tone ? ' is-' + tile.tone : ''));
      card.append(node('small', '', tile.label), node('strong', '', tile.value));
      if (tile.sub) card.append(node('span', '', tile.sub));
      grid.append(card);
    });
    return grid;
  }

  function notice(text, tone) { return node('p', 'smyl-f360-note' + (tone ? ' is-' + tone : ''), text); }

  var KINDS = { image: 'Foto', document: 'Documento', audio: 'Audio', video: 'Video' };
  var FILTERS = [['all', 'Todos'], ['image', 'Fotos'], ['document', 'Documentos'], ['audio', 'Audios']];

  function files(ctx) {
    var root = node('div', 'smyl-f360-files');
    if (ctx.loading) { root.append(notice('Consultando archivos del chat…')); return root; }
    if (ctx.error) { root.append(notice(ctx.error, 'warn'), button('Reintentar', 'smyl-f360-link', ctx.onRetry)); return root; }
    var all = (ctx.items || []).filter(function (item) { return KINDS[item.media_type]; });
    if (!all.length) { root.append(notice('Este paciente todavía no ha enviado fotos, rayos X ni documentos por el chat.')); return root; }
    var filter = ctx.filter || 'all';
    var chipRow = node('div', 'smyl-f360-filters'); chipRow.setAttribute('role', 'group'); chipRow.setAttribute('aria-label', 'Filtrar archivos');
    FILTERS.forEach(function (entry) {
      var count = entry[0] === 'all' ? all.length : all.filter(function (item) { return item.media_type === entry[0]; }).length;
      if (entry[0] !== 'all' && !count) return;
      var chip = button(entry[1] + ' ' + count, 'smyl-f360-filter' + (filter === entry[0] ? ' is-active' : ''), function () { ctx.onFilter(entry[0]); });
      chip.setAttribute('aria-pressed', filter === entry[0] ? 'true' : 'false'); chipRow.append(chip);
    });
    root.append(chipRow);
    var visible = all.filter(function (item) { return filter === 'all' || item.media_type === filter; });
    var grid = node('div', 'smyl-f360-gallery');
    visible.forEach(function (item) {
      var selected = ctx.selectedId === item.id;
      var tile = node('button', 'smyl-f360-file' + (selected ? ' is-selected' : '')); tile.type = 'button';
      tile.setAttribute('aria-pressed', selected ? 'true' : 'false'); tile.setAttribute('aria-label', (KINDS[item.media_type] || 'Archivo') + ' del ' + shortDate(item.created_at));
      var preview = node('span', 'smyl-f360-file-preview');
      if (item.media_type === 'image' && item.media_url) { var image = document.createElement('img'); image.src = item.media_url; image.alt = ''; image.loading = 'lazy'; preview.append(image); }
      else preview.append(node('b', '', item.media_type === 'document' ? 'PDF' : item.media_type === 'audio' ? '♪' : '▶'));
      tile.append(preview, node('span', 'smyl-f360-file-kind', KINDS[item.media_type]));
      if (ctx.reviewed && ctx.reviewed[item.id]) tile.append(node('i', 'smyl-f360-file-check', '✓'));
      tile.append(node('span', 'smyl-f360-file-date', shortDate(item.created_at)));
      tile.onclick = function () { ctx.onSelect(selected ? '' : item.id); };
      grid.append(tile);
    });
    root.append(grid);
    var chosen = visible.find(function (item) { return item.id === ctx.selectedId; });
    if (chosen) {
      var detail = node('div', 'smyl-f360-file-detail');
      detail.append(node('strong', '', (KINDS[chosen.media_type] || 'Archivo') + ' recibido' + (ctx.channelLabel ? ' por ' + ctx.channelLabel : '')));
      detail.append(node('small', '', shortDate(chosen.created_at, true) + (ctx.reviewed && ctx.reviewed[chosen.id] ? ' · en revisión clínica' : '')));
      if (chosen.content) detail.append(node('p', '', chosen.content));
      var row = node('div', 'smyl-f360-file-actions');
      if (chosen.media_type === 'image' && ctx.canReview && !(ctx.reviewed && ctx.reviewed[chosen.id])) row.append(button('Enviar a revisión clínica', 'smyl-f360-action is-primary', function () { ctx.onReview(chosen); }));
      if (chosen.media_url) { var open = node('a', 'smyl-f360-action', 'Abrir / descargar'); open.href = chosen.media_url; open.target = '_blank'; open.rel = 'noopener noreferrer'; row.append(open); }
      detail.append(row); root.append(detail);
    }
    root.append(node('p', 'smyl-f360-files-note', 'Las fotos que envías a revisión clínica pasan al expediente y solo se analizan con IA cuando el equipo lo autoriza.'));
    return root;
  }

  // Resumen de la conversación generado por SMYL Copilot (modo summary). Solo pinta; smyl-inbox.js decide cuándo pedirlo.
  function conversationSummary(ctx) {
    var card = node('section', 'smyl-f360-summary' + (ctx.stale ? ' is-stale' : ''));
    card.setAttribute('aria-labelledby', 'smyl-f360-summary-title'); card.setAttribute('aria-busy', ctx.loading ? 'true' : 'false');
    var head = node('div', 'smyl-f360-summary-head');
    var title = node('h3', '', 'Resumen de la conversación'); title.id = 'smyl-f360-summary-title';
    head.append(title, node('span', 'smyl-f360-ai-badge', 'IA'));
    card.append(head);
    var data = ctx.data;
    if (ctx.loading && !data) {
      var skeleton = node('div', 'smyl-f360-skeleton'); skeleton.setAttribute('aria-hidden', 'true');
      skeleton.append(node('i'), node('i'), node('i'));
      card.append(node('p', 'smyl-inbox-sr', 'Resumiendo la conversación…'), skeleton);
      return card;
    }
    if (ctx.error && !data) {
      card.append(notice(ctx.error, 'warn'));
      card.append(button('Reintentar', 'smyl-f360-link', ctx.onRefresh));
      return card;
    }
    if (!data) {
      card.append(node('p', 'smyl-f360-summary-text is-muted', 'Obtén en segundos qué pidió el paciente, qué se le respondió y qué falta.'));
      card.append(button('Resumir conversación', 'smyl-f360-action is-primary', ctx.onRefresh));
      return card;
    }
    if (data.requires_human) card.append(notice('El asistente detectó algo que requiere atención humana.', 'warn'));
    card.append(node('p', 'smyl-f360-summary-text', data.summary || 'Sin contenido suficiente para resumir todavía.'));
    var facts = node('dl', 'smyl-f360-summary-facts');
    function fact(label, value, tone) {
      if (!value || (Array.isArray(value) && !value.length)) return;
      var row = node('div', tone ? 'is-' + tone : '');
      row.append(node('dt', '', label));
      var dd = node('dd');
      if (Array.isArray(value)) { var list = node('ul'); value.forEach(function (entry) { list.append(node('li', '', entry)); }); dd.append(list); }
      else dd.textContent = value;
      row.append(dd); facts.append(row);
    }
    fact('Siguiente paso', data.next_step, 'next');
    fact('Falta confirmar', data.open_questions, '');
    fact('No confirmado por el paciente', data.unconfirmed_facts, 'warn');
    if (facts.childNodes.length) card.append(facts);
    if (ctx.stale) card.append(notice('Llegaron mensajes nuevos después de este resumen.', 'warn'));
    var foot = node('div', 'smyl-f360-summary-foot');
    foot.append(node('small', '', (ctx.loading ? 'Actualizando…' : 'Generado ' + shortDate(ctx.at, true).toLowerCase()) + ' · revísalo antes de usarlo'));
    var tools = node('div', 'smyl-f360-summary-tools');
    var refresh = button(ctx.loading ? 'Actualizando…' : 'Actualizar', 'smyl-f360-link' + (ctx.stale ? ' is-strong' : ''), ctx.onRefresh); refresh.disabled = Boolean(ctx.loading);
    tools.append(refresh);
    if (ctx.onCopy) tools.append(button('Copiar', 'smyl-f360-link', ctx.onCopy));
    foot.append(tools); card.append(foot);
    return card;
  }

  var TIMELINE_TONES = { appointment: 'teal', file: 'purple', payment: 'amber', charge: 'amber', proposal: 'blue', note: 'blue' };

  function timeline(ctx) {
    var root = node('div', 'smyl-f360-timeline');
    if (ctx.loading) { root.append(notice('Consultando la línea de tiempo…')); return root; }
    if (ctx.error) { root.append(notice(ctx.error, 'warn'), button('Reintentar', 'smyl-f360-link', ctx.onRetry)); return root; }
    var rows = ctx.rows || [];
    if (!rows.length) { root.append(notice('Todavía no hay actividad registrada para este paciente.')); return root; }
    var list = node('ol', 'smyl-f360-events');
    rows.slice(0, ctx.limit || 30).forEach(function (row) {
      var item = node('li', 'smyl-f360-event is-' + (TIMELINE_TONES[row.event_type] || 'neutral'));
      item.append(node('small', '', shortDate(row.event_at, true)), node('strong', '', row.title || 'Actividad'));
      list.append(item);
    });
    root.append(list);
    return root;
  }

  window.SmylInboxFicha = Object.freeze({ shell: shell, tiles: tiles, files: files, timeline: timeline, conversationSummary: conversationSummary, notice: notice, shortDate: shortDate });
})();
