(function () {
  'use strict';

  // Piezas visuales de la Ficha 360 del chat (cabecera, bloques plegables, resumen IA, citas, movimientos y archivos).
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
    // Los avisos (p. ej. «Sin consentimiento de WhatsApp») van dentro de la tarjeta de identidad, no en una fila aparte.
    if ((ctx.chips || []).length) {
      var chips = node('div', 'smyl-f360-chips');
      ctx.chips.forEach(function (chip) { chips.append(node('span', 'smyl-f360-chip is-' + (chip.tone || 'neutral'), chip.text)); });
      copy.append(chips);
    }
    identity.append(copy); root.append(identity);
    if (ctx.medical) root.append(medicalAlerts(ctx.medical, ctx.onCompleteHistory));
    if ((ctx.actions || []).length) {
      var actions = node('div', 'smyl-f360-actions');
      ctx.actions.forEach(function (action) { actions.append(button(action.label, 'smyl-f360-action' + (action.primary ? ' is-primary' : ''), action.run)); });
      root.append(actions);
    }
    // Bloques plegables en un orden fijo (Resumen, Cuenta, Citas, Archivos). Cerrados muestran su dato clave.
    var list = node('div', 'smyl-f360-sections');
    (ctx.sections || []).forEach(function (section) {
      var wrap = node('section', 'smyl-f360-section' + (section.open ? ' is-open' : ''));
      wrap.dataset.section = 'f360-' + section.id;
      var bodyId = 'smyl-f360-section-' + section.id;
      var head = node('button', 'smyl-f360-section-head'); head.type = 'button';
      head.setAttribute('aria-expanded', section.open ? 'true' : 'false'); head.setAttribute('aria-controls', bodyId);
      head.dataset.f360Section = section.id;
      var title = node('span', 'smyl-f360-section-title', section.title);
      if (section.badge) title.append(node('span', 'smyl-f360-ai-badge', section.badge));
      head.append(title);
      if (section.peek && section.peek.text) head.append(node('span', 'smyl-f360-peek is-' + (section.peek.tone || 'muted'), section.peek.text));
      var chevron = node('span', 'smyl-f360-chevron'); chevron.setAttribute('aria-hidden', 'true'); head.append(chevron);
      head.onclick = function () { if (ctx.onToggle) ctx.onToggle(section.id); };
      var heading = node('h3', 'smyl-f360-section-heading'); heading.append(head);
      wrap.append(heading);
      var body = node('div', 'smyl-f360-section-body'); body.id = bodyId; body.hidden = !section.open;
      if (section.open && section.node) body.append(section.node);
      wrap.append(body); list.append(wrap);
    });
    root.append(list);
    return root;
  }

  // Alertas médicas en la cabecera: lo primero que ve el equipo antes de agendar o tratar.
  function medicalAlerts(medical, onCompleteHistory) {
    if (medical.unlinked) {
      var unlinked = node('div', 'smyl-f360-med is-pending'); unlinked.setAttribute('role', 'note');
      unlinked.append(node('span', 'smyl-f360-med-icon', '!'), node('p', '', 'Vincula este chat a un paciente para ver sus alergias y alertas médicas'));
      if (medical.onLink) unlinked.append(button('Vincular paciente', 'smyl-f360-link', medical.onLink));
      return unlinked;
    }
    var items = medical.items || [];
    if (!items.length) {
      var quiet = node('div', 'smyl-f360-med is-' + (medical.reviewed ? 'clear' : 'pending'));
      quiet.setAttribute('role', 'note');
      quiet.append(node('span', 'smyl-f360-med-icon', medical.reviewed ? '✓' : '!'));
      quiet.append(node('p', '', medical.reviewed ? 'Sin alergias ni alertas médicas conocidas' : 'Alergias y alertas médicas sin confirmar'));
      if (!medical.reviewed && onCompleteHistory) quiet.append(button('Completar historia', 'smyl-f360-link', onCompleteHistory));
      return quiet;
    }
    var box = node('section', 'smyl-f360-med is-alert'); box.setAttribute('aria-labelledby', 'smyl-f360-med-title');
    var head = node('div', 'smyl-f360-med-head');
    head.append(node('span', 'smyl-f360-med-icon', '⚠'));
    var title = node('h3', '', items.length === 1 ? 'Alerta médica' : items.length + ' alertas médicas'); title.id = 'smyl-f360-med-title';
    head.append(title); box.append(head);
    var list = node('ul', 'smyl-f360-med-list');
    items.forEach(function (item) {
      var row = node('li', 'smyl-f360-med-item' + (item.kind === 'allergy' ? ' is-allergy' : '') + (item.severity === 'high' ? ' is-high' : ''));
      row.append(node('strong', '', (item.kind === 'allergy' ? 'Alergia: ' : '') + item.label));
      if (item.detail) row.append(node('small', '', item.detail));
      list.append(row);
    });
    box.append(list);
    if (!medical.reviewed) box.append(node('p', 'smyl-f360-med-note', 'La historia clínica aún tiene alergias o alertas sin confirmar.'));
    return box;
  }

  function skel(kind, options) { var holder = document.createElement('div'); holder.innerHTML = window.SmylSkeleton ? window.SmylSkeleton.html(kind, options) : '<p class="smyl-f360-note">' + ((options && options.label) || 'Cargando…') + '</p>'; return holder.firstElementChild; }
  function notice(text, tone) { return node('p', 'smyl-f360-note' + (tone ? ' is-' + tone : ''), text); }

  var KINDS = { image: 'Foto', document: 'Documento', audio: 'Audio', video: 'Video' };
  var FILTERS = [['all', 'Todos'], ['image', 'Fotos'], ['document', 'Documentos'], ['audio', 'Audios']];

  function files(ctx) {
    var root = node('div', 'smyl-f360-files');
    if (ctx.loading) { root.append(skel('media', { count: 4, label: 'Consultando archivos del chat' })); return root; }
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
      if (item.media_type === 'image' && ctx.thumbnail) preview.append(ctx.thumbnail(item));
      else preview.append(node('b', '', item.media_type === 'document' ? 'Doc' : item.media_type === 'audio' ? '♪' : item.media_type === 'image' ? 'Foto' : '▶'));
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
      var open = ctx.makeOpenButton && ctx.makeOpenButton(chosen);
      var fileUrl = ctx.fileUrl && ctx.fileUrl(chosen.media_url);
      if (open) row.append(open);
      else if (fileUrl) { var link = node('a', 'smyl-f360-action', 'Abrir / descargar'); link.href = fileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
      detail.append(row); root.append(detail);
    }
    root.append(node('p', 'smyl-f360-files-note', 'Las fotos que envías a revisión clínica pasan al expediente y solo se analizan con IA cuando el equipo lo autoriza.'));
    return root;
  }

  // Resumen de la conversación generado por SMYL Copilot (modo summary). Solo pinta; smyl-inbox.js decide cuándo pedirlo.
  function conversationSummary(ctx) {
    var card = node('section', 'smyl-f360-summary' + (ctx.stale ? ' is-stale' : ''));
    card.setAttribute('aria-labelledby', 'smyl-f360-summary-title'); card.setAttribute('aria-busy', ctx.loading ? 'true' : 'false');
    var title = node('h4', 'smyl-inbox-sr', 'Resumen de la conversación'); title.id = 'smyl-f360-summary-title';
    card.append(title);
    var data = ctx.data;
    if (ctx.loading && !data) {
      var skeleton = node('div', 'smyl-f360-skeleton'); skeleton.setAttribute('aria-hidden', 'true');
      skeleton.append(node('i'), node('i'), node('i'));
      card.append(node('p', 'smyl-inbox-sr', 'Resumiendo la conversación…'), skeleton);
      return card;
    }
    if (ctx.needsTraining && !data) {
      // Sin capacitación del asistente no hay resumen; se informa sin convertirlo en tarea del paciente.
      card.append(node('p', 'smyl-f360-summary-text is-muted', 'El resumen con IA se activa cuando la clínica configura su asistente.'));
      if (ctx.onOpenTraining) card.append(button('Configurar asistente', 'smyl-f360-link', ctx.onOpenTraining));
      return card;
    }
    if (ctx.error && !data) {
      card.append(notice(ctx.error, 'warn'));
      if (ctx.onRefresh) card.append(button('Reintentar', 'smyl-f360-link', ctx.onRefresh));
      return card;
    }
    if (!data) {
      card.append(node('p', 'smyl-f360-summary-text is-muted', ctx.canGenerate === false ? 'Todavía nadie del equipo ha resumido esta conversación.' : 'Obtén en segundos qué pidió el paciente, qué se le respondió y qué falta.'));
      if (ctx.onRefresh) card.append(button('Resumir conversación', 'smyl-f360-action is-primary', ctx.onRefresh));
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
    foot.append(node('small', '', (ctx.loading ? 'Actualizando…' : 'Generado ' + shortDate(ctx.at, true).toLowerCase() + (ctx.by ? ' por ' + ctx.by : '')) + ' · revísalo antes de usarlo'));
    var tools = node('div', 'smyl-f360-summary-tools');
    if (ctx.onRefresh) {
      var refresh = button(ctx.loading ? 'Actualizando…' : 'Actualizar', 'smyl-f360-link' + (ctx.stale ? ' is-strong' : ''), ctx.onRefresh); refresh.disabled = Boolean(ctx.loading);
      tools.append(refresh);
    }
    if (ctx.onCopy) tools.append(button('Copiar', 'smyl-f360-link', ctx.onCopy));
    foot.append(tools); card.append(foot);
    return card;
  }

  var VISIT_STATUS = {
    confirmed: ['Confirmada', 'ok'], arrived: ['En sala', 'ok'], in_progress: ['En consulta', 'ok'],
    completed: ['Atendida', 'ok'], no_show: ['No asistió', 'danger'], cancelled: ['Cancelada', 'muted'],
  };

  function visitRow(visit, ctx) {
    var status = VISIT_STATUS[visit.status] || ['', 'muted'];
    var row = node('li', 'smyl-f360-visit' + (visit.status === 'cancelled' ? ' is-cancelled' : ''));
    var top = node('div', 'smyl-f360-visit-top');
    top.append(node('span', 'smyl-f360-visit-date', ctx.formatDate ? ctx.formatDate(visit.starts_at, visit.timezone) : shortDate(visit.starts_at, true)));
    if (status[0]) top.append(node('span', 'smyl-f360-pill is-' + status[1], status[0]));
    row.append(top, node('strong', '', visit.service));
    if (visit.treatments && visit.treatments.length) row.append(node('p', 'smyl-f360-visit-treatment', 'Tratamiento: ' + visit.treatments.join(', ')));
    var who = [visit.professional, visit.branch].filter(Boolean).join(' · ');
    if (who) row.append(node('small', '', who));
    return row;
  }

  // Citas del paciente: próximas primero (la más cercana arriba) y después las anteriores.
  function visits(ctx) {
    var root = node('div', 'smyl-f360-visits');
    if (ctx.loading) { root.append(skel('list', { rows: 2, plain: true, label: 'Consultando citas' })); return root; }
    var all = ctx.items || [];
    if (ctx.error) {
      root.append(notice(ctx.error, 'warn'), button('Reintentar', 'smyl-f360-link', ctx.onRetry));
      if (!all.length) return root;
    }
    if (!all.length) { root.append(notice('Este paciente todavía no tiene citas registradas.')); return root; }
    var upcoming = all.filter(ctx.isUpcoming).reverse();
    var past = all.filter(function (visit) { return !ctx.isUpcoming(visit); });
    function group(label, items) {
      if (!items.length) return;
      root.append(node('h4', 'smyl-f360-group', label));
      var list = node('ol', 'smyl-f360-visit-list');
      items.forEach(function (visit) { list.append(visitRow(visit, ctx)); });
      root.append(list);
    }
    group('Próximas', upcoming);
    var shownPast = ctx.showAll ? past : past.slice(0, 4);
    group(upcoming.length ? 'Anteriores' : 'Citas anteriores', shownPast);
    if (past.length > 4) root.append(button(ctx.showAll ? 'Ver menos' : 'Ver todas las anteriores (' + past.length + ')', 'smyl-f360-link', ctx.onShowAll));
    return root;
  }

  function money(value) { return Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); }

  // Últimos cargos y pagos, del más reciente al más antiguo.
  function movements(ctx) {
    var root = node('div', 'smyl-f360-moves');
    root.append(node('h4', 'smyl-f360-group', 'Últimos movimientos'));
    if (ctx.loading) { root.append(skel('list', { rows: 3, plain: true, avatar: false, action: true, label: 'Consultando movimientos' })); return root; }
    if (ctx.error) { root.append(notice(ctx.error, 'warn'), button('Reintentar', 'smyl-f360-link', ctx.onRetry)); return root; }
    if (!(ctx.items || []).length) { root.append(notice('Todavía no hay cargos ni pagos registrados.')); return root; }
    var list = node('ul', 'smyl-f360-move-list');
    ctx.items.forEach(function (item) {
      var row = node('li', 'smyl-f360-move is-' + item.kind + (item.voided ? ' is-voided' : ''));
      var copy = node('div', 'smyl-f360-move-copy');
      copy.append(node('strong', '', item.label), node('small', '', shortDate(item.at) + (item.voided ? ' · cancelado' : '')));
      row.append(copy, node('span', 'smyl-f360-move-amount', money(item.amount)));
      list.append(row);
    });
    root.append(list);
    return root;
  }

  window.SmylInboxFicha = Object.freeze({ shell: shell, files: files, visits: visits, movements: movements, conversationSummary: conversationSummary, notice: notice, shortDate: shortDate });
})();
