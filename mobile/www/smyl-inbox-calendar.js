/* SMYL · Mensajes: calendario mensual para agendar desde el chat.
   Solo presenta y organiza: la disponibilidad real la calcula el servidor (acción `availability`) y la cita la crea el flujo
   existente de solicitud + confirmación. Aquí no se escribe nada en la base de datos. */
(function () {
  'use strict';

  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var STATUS_LABEL = { arrived: 'Ya llegó', in_progress: 'En consulta', completed: 'Terminada', no_show: 'No vino' };
  var WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var state = { host: null, ctx: null, month: null, day: null, key: '', cache: Object.create(null), token: 0, queue: [], running: 0, agenda: Object.create(null), agendaOpen: true, paint: 0, groupBy: 'time', expanded: Object.create(null) };
  var GROUP_PREVIEW = 12;

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dayKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function parseDay(key) { var parts = key.split('-'); return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])); }
  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function todayStart() { var now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
  function level(count) { return count <= 0 ? 'none' : count <= 4 ? 'few' : 'many'; }
  function longDay(key) { var date = parseDay(key); return WEEKDAYS[date.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + date.getDate() + ' de ' + MONTHS[date.getMonth()]; }
  function countText(slots, truncated) {
    if (!slots.length) return 'Sin horarios libres';
    return slots.length + (slots.length === 1 ? ' horario libre' : ' horarios libres') + (truncated ? ' o más' : '');
  }
  function truncatedFlag(slots) { return !!(slots && slots.truncated); }
  function hourOf(slot) { return new Date(slot.starts_at).getHours(); }
  function cacheKey(key) { return state.key + '#' + key; }

  function invalidate() {
    state.token += 1; state.queue = []; state.cache = Object.create(null); state.key = ''; state.agenda = Object.create(null); state.day = null;
  }

  function schedulePaint() {
    if (state.paint) return;
    state.paint = window.requestAnimationFrame ? window.requestAnimationFrame(function () { state.paint = 0; paint(); }) : setTimeout(function () { state.paint = 0; paint(); }, 16);
  }

  function pump() {
    var ctx = state.ctx; if (!ctx) return;
    while (state.running < 5 && state.queue.length) {
      (function (job) {
        state.running += 1;
        var token = state.token; var from = parseDay(job.day); var to = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59);
        Promise.resolve().then(function () { return ctx.fetchDay(from, to); }).then(function (slots) {
          if (token === state.token) state.cache[job.key] = { slots: slots || [] };
        }, function () {
          if (token === state.token) state.cache[job.key] = { error: true, slots: [] };
        }).then(function () { state.running -= 1; if (token === state.token) schedulePaint(); pump(); });
      })(state.queue.shift());
    }
  }

  // Un día = una consulta ligera al servidor; el resultado queda en caché mientras no cambien servicio, sucursal o profesional.
  function ensureMonth() {
    var first = state.month; var last = new Date(first.getFullYear(), first.getMonth() + 1, 0); var today = todayStart();
    for (var day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
      if (day < today) continue;
      var key = dayKey(day); var id = cacheKey(key);
      if (state.cache[id]) continue;
      state.cache[id] = { loading: true, slots: [] };
      state.queue.push({ day: key, key: id });
    }
    pump();
  }

  function slotsFor(key) { var entry = state.cache[cacheKey(key)]; return entry && !entry.loading ? entry.slots : null; }

  function pickDefaultDay() {
    var today = todayStart(); var first = state.month; var last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    for (var day = new Date(Math.max(first.getTime(), today.getTime())); day <= last; day.setDate(day.getDate() + 1)) {
      var slots = slotsFor(dayKey(day)); if (slots && slots.length) return dayKey(day);
    }
    return dayKey(new Date(Math.max(first.getTime(), today.getTime())));
  }

  function buildMonth(ctx) {
    var section = el('section', 'smyl-cal-month'); section.setAttribute('aria-label', 'Calendario de disponibilidad');
    var head = el('header');
    var title = el('strong', '', MONTHS[state.month.getMonth()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + state.month.getFullYear()); title.setAttribute('aria-live', 'polite');
    var nav = el('div', 'smyl-cal-nav');
    var todayButton = el('button', 'smyl-cal-btn', 'Hoy'); todayButton.type = 'button';
    var prev = el('button', 'smyl-cal-btn smyl-cal-icon', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Mes anterior');
    var next = el('button', 'smyl-cal-btn smyl-cal-icon', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Mes siguiente');
    var thisMonth = startOfMonth(new Date());
    prev.disabled = state.month <= thisMonth;
    todayButton.onclick = function () { state.month = thisMonth; state.day = dayKey(todayStart()); ensureMonth(); paint(); };
    prev.onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); state.day = null; ensureMonth(); paint(); };
    next.onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); state.day = null; ensureMonth(); paint(); };
    nav.append(todayButton, prev, next); head.append(title, nav); section.append(head);
    var week = el('div', 'smyl-cal-week'); week.setAttribute('aria-hidden', 'true');
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (name) { week.append(el('span', '', name)); });
    section.append(week);
    var grid = el('div', 'smyl-cal-grid');
    var offset = (state.month.getDay() + 6) % 7; var start = new Date(state.month.getFullYear(), state.month.getMonth(), 1 - offset); var today = todayStart();
    for (var i = 0; i < 42; i += 1) {
      var date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); var key = dayKey(date);
      var inMonth = date.getMonth() === state.month.getMonth(); var past = date < today;
      var cell = el('button', 'smyl-cal-d'); cell.type = 'button'; cell.dataset.day = key;
      cell.append(el('span', '', String(date.getDate())), el('i'));
      if (!inMonth) { cell.classList.add('is-out'); cell.disabled = true; cell.tabIndex = -1; cell.setAttribute('aria-hidden', 'true'); grid.append(cell); continue; }
      if (past) { cell.classList.add('is-past'); cell.disabled = true; cell.setAttribute('aria-label', date.getDate() + ' de ' + MONTHS[date.getMonth()] + ', día pasado'); grid.append(cell); continue; }
      var slots = slotsFor(key);
      if (key === dayKey(today)) cell.classList.add('is-today');
      if (!slots) { cell.classList.add('is-loading'); cell.setAttribute('aria-label', date.getDate() + ' de ' + MONTHS[date.getMonth()] + ', consultando'); }
      else { cell.classList.add('is-' + level(slots.length)); cell.setAttribute('aria-label', date.getDate() + ' de ' + MONTHS[date.getMonth()] + ', ' + (slots.length ? countText(slots, truncatedFlag(slots)) : 'sin horarios')); cell.title = slots.length ? countText(slots, truncatedFlag(slots)) : 'Sin horarios'; }
      if (key === state.day) { cell.classList.add('is-selected'); cell.setAttribute('aria-pressed', 'true'); } else cell.setAttribute('aria-pressed', 'false');
      cell.onclick = (function (value) { return function () { state.day = value; paint(); }; })(key);
      grid.append(cell);
    }
    section.append(grid);
    var legend = el('div', 'smyl-cal-legend');
    [['many', 'Muchos horarios'], ['few', 'Pocos'], ['none', 'Sin horarios']].forEach(function (item) { var chip = el('span'); chip.append(el('u', 'is-' + item[0]), document.createTextNode(item[1])); legend.append(chip); });
    section.append(legend);
    return section;
  }

  function distinct(slots, field) { var seen = {}; slots.forEach(function (slot) { seen[slot[field] || ''] = true; }); return Object.keys(seen).length; }
  function shortName(name) { return String(name || '').split(' ').slice(0, 2).join(' '); }
  function range(ctx, rows) { return ctx.time(rows[0].starts_at) + ' – ' + ctx.time(rows[rows.length - 1].starts_at); }

  function slotButton(ctx, slot, sub) {
    var selected = ctx.isSelected(slot);
    var button = el('button', 'smyl-cal-slot' + (selected ? ' is-selected' : '')); button.type = 'button'; button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', (selected ? 'Quitar' : 'Seleccionar') + ' horario de las ' + ctx.time(slot.starts_at) + ' con ' + slot.professional_name + (slot.branch_name ? ' en ' + slot.branch_name : ''));
    button.append(el('strong', '', ctx.time(slot.starts_at)));
    (Array.isArray(sub) ? sub : sub ? [sub] : []).forEach(function (line) { if (line) button.append(el('small', '', line)); });
    button.onclick = function () { ctx.toggle(slot); };
    return button;
  }

  // Un grupo con título, número de horarios y «Ver N más» para no llenar la pantalla de botones.
  function slotGroup(ctx, id, title, detail, rows, subFor) {
    var group = el('div', 'smyl-cal-part'); group.dataset.group = id;
    var head = el('div', 'smyl-cal-part-head'); head.append(el('span', '', title));
    head.append(el('em', '', detail ? detail + ' · ' + rows.length : String(rows.length)));
    group.append(head);
    var open = !!state.expanded[id]; var shown = open ? rows : rows.slice(0, GROUP_PREVIEW);
    var list = el('div', 'smyl-cal-slotlist');
    shown.forEach(function (slot) { list.append(slotButton(ctx, slot, subFor(slot))); });
    group.append(list);
    if (rows.length > GROUP_PREVIEW) {
      var more = el('button', 'smyl-cal-more', open ? 'Ver menos' : 'Ver ' + (rows.length - GROUP_PREVIEW) + ' más'); more.type = 'button'; more.setAttribute('aria-expanded', String(open));
      more.onclick = function () { state.expanded[id] = !open; paint(); };
      group.append(more);
    }
    return group;
  }

  function buildSlots(ctx, slots, truncated) {
    var wrap = el('div', 'smyl-cal-slots');
    var people = distinct(slots, 'professional_id'), places = distinct(slots, 'branch_id');
    var canGroup = people > 1 || places > 1;
    if (canGroup) {
      var switcher = el('div', 'smyl-cal-group'); switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', 'Ordenar horarios');
      [['time', 'Por hora'], ['person', 'Por dentista']].forEach(function (item) {
        var b = el('button', '', item[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(state.groupBy === item[0]));
        b.onclick = function () { state.groupBy = item[0]; paint(); };
        switcher.append(b);
      });
      wrap.append(switcher);
    } else state.groupBy = 'time';
    var subTime = function (slot) { return [people > 1 ? shortName(slot.professional_name) : '', places > 1 ? slot.branch_name : '']; };
    if (state.groupBy === 'person' && canGroup) {
      var order = []; var by = {};
      slots.forEach(function (slot) { var id = slot.professional_id + '|' + (slot.branch_id || ''); if (!by[id]) { by[id] = []; order.push(id); } by[id].push(slot); });
      order.forEach(function (id) {
        var rows = by[id].slice().sort(function (l, r) { return new Date(l.starts_at) - new Date(r.starts_at); });
        wrap.append(slotGroup(ctx, 'p:' + id, rows[0].professional_name || 'Dentista', (places > 1 && rows[0].branch_name ? rows[0].branch_name + ' · ' : '') + range(ctx, rows), rows, function () { return ''; }));
      });
    } else {
      [['m', 'Por la mañana', function (hour) { return hour < 12; }], ['t', 'Por la tarde', function (hour) { return hour >= 12; }]].forEach(function (part) {
        var rows = slots.filter(function (slot) { return part[2](hourOf(slot)); });
        if (!rows.length) return;
        wrap.append(slotGroup(ctx, 't:' + part[0], part[1], range(ctx, rows), rows, subTime));
      });
    }
    if (truncated) wrap.append(el('p', 'smyl-cal-note smyl-cal-trunc', 'Hay más horarios de los que caben aquí. Elige un dentista o una sucursal arriba para ver los demás.'));
    return wrap;
  }

  function buildAgenda(ctx, key) {
    var box = el('section', 'smyl-cal-agenda'); box.setAttribute('aria-label', 'Agenda del día');
    var entry = state.agenda[key];
    if (!entry) {
      box.append(el('p', 'smyl-cal-note', 'Consultando la agenda…'));
      state.agenda[key] = { loading: true };
      Promise.resolve().then(function () { return ctx.loadAgenda(key); }).then(function (rows) { state.agenda[key] = { rows: rows || [] }; schedulePaint(); }, function () { state.agenda[key] = { error: true }; schedulePaint(); });
      return box;
    }
    if (entry.loading) { box.append(el('p', 'smyl-cal-note', 'Consultando la agenda…')); return box; }
    if (entry.error) { box.append(el('p', 'smyl-cal-note', 'No pudimos consultar la agenda de este día con tu rol.')); return box; }
    var title = el('h4', 'smyl-cal-agenda-title', entry.rows.length ? 'Citas del día · ' + entry.rows.length : 'Citas del día');
    box.append(title);
    if (!entry.rows.length) { box.append(el('p', 'smyl-cal-note', 'No hay citas registradas este día.')); return box; }
    var list = el('ol', 'smyl-cal-agenda-list');
    entry.rows.slice().sort(function (left, right) { return new Date(left.starts_at) - new Date(right.starts_at); }).forEach(function (row) {
      var item = el('li'); item.dataset.status = row.status || '';
      item.append(el('time', '', ctx.time(row.starts_at) + ' – ' + ctx.time(row.ends_at)));
      var copy = el('span'); var name = el('strong', '', row.patient || 'Paciente');
      if (STATUS_LABEL[row.status]) name.append(el('em', 'smyl-cal-agenda-status', STATUS_LABEL[row.status]));
      copy.append(name, el('small', '', [row.service, row.professional].filter(Boolean).join(' · ')));
      item.append(copy); list.append(item);
    });
    box.append(list);
    return box;
  }

  function buildDay(ctx) {
    var section = el('section', 'smyl-cal-day');
    var key = state.day; var slots = slotsFor(key); var entry = state.cache[cacheKey(key)];
    var head = el('header'); var copy = el('div');
    copy.append(el('strong', '', longDay(key)));
    var booked = state.agenda[key] && state.agenda[key].rows ? state.agenda[key].rows.length : null;
    var freeText = !slots ? 'Consultando horarios…' : entry && entry.error ? 'No pudimos consultar este día' : countText(slots, truncatedFlag(slots));
    copy.append(el('small', '', freeText + (booked !== null && slots ? ' · ' + (booked ? booked + (booked === 1 ? ' cita agendada' : ' citas agendadas') : 'sin citas') : '')));
    var actions = el('div', 'smyl-cal-actions');
    var agendaAllowed = ctx.canReadAgenda !== false;
    var full = el('button', 'smyl-cal-link', 'Abrir Agenda completa ↗'); full.type = 'button'; full.onclick = function () { ctx.openAgenda(key); };
    if (agendaAllowed) {
      var agendaButton = el('button', 'smyl-cal-btn', state.agendaOpen ? 'Ocultar citas del día' : 'Ver citas del día'); agendaButton.type = 'button'; agendaButton.setAttribute('aria-expanded', String(state.agendaOpen));
      agendaButton.onclick = function () { state.agendaOpen = !state.agendaOpen; paint(); };
      actions.append(agendaButton);
    }
    actions.append(full);
    head.append(copy, actions); section.append(head);
    if (!slots) { var loading = el('div', 'smyl-cal-loading'); loading.append(el('i'), el('i'), el('i'), el('i')); section.append(loading); }
    else if (entry && entry.error) {
      var retry = el('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button';
      retry.onclick = function () { delete state.cache[cacheKey(key)]; state.queue.push({ day: key, key: cacheKey(key) }); state.cache[cacheKey(key)] = { loading: true, slots: [] }; pump(); paint(); };
      section.append(el('p', 'smyl-cal-note', 'Intenta de nuevo en unos segundos.'), retry);
    } else if (!slots.length) {
      var emptyNote = el('p', 'smyl-cal-note', 'Elige otro día del calendario; los verdes tienen más horarios.');
      var nextDay = null; var cursor = parseDay(key);
      for (var i = 1; i <= 31 && !nextDay; i += 1) { cursor.setDate(cursor.getDate() + 1); var candidate = slotsFor(dayKey(cursor)); if (candidate && candidate.length) nextDay = dayKey(cursor); }
      section.append(emptyNote);
      if (nextDay) { var jump = el('button', 'btn btn-primary btn-sm', 'Ir al siguiente día con horarios · ' + longDay(nextDay)); jump.type = 'button'; jump.onclick = function () { state.day = nextDay; paint(); }; section.append(jump); }
    } else section.append(buildSlots(ctx, slots, truncatedFlag(slots)));
    if (state.agendaOpen && ctx.canReadAgenda !== false) section.append(buildAgenda(ctx, key));
    return section;
  }

  function paint() {
    var host = state.host; var ctx = state.ctx; if (!host || !ctx || !host.isConnected) return;
    var focused = document.activeElement && host.contains(document.activeElement) ? (document.activeElement.dataset.day || '') : '';
    host.innerHTML = '';
    if (!state.month) state.month = startOfMonth(new Date());
    if (!state.day) state.day = pickDefaultDay();
    var root = el('div', 'smyl-cal');
    root.append(buildMonth(ctx), buildDay(ctx));
    host.append(root);
    if (focused) { var again = host.querySelector('[data-day="' + focused + '"]'); if (again) again.focus(); }
  }

  function render(host, ctx) {
    state.host = host; state.ctx = ctx;
    var params = ctx.params();
    var key = [params.serviceId, params.branchId || '', params.professionalId || ''].join('|');
    if (key !== state.key) { var month = state.month; invalidate(); state.key = key; state.month = month; }
    if (!state.month) state.month = startOfMonth(new Date());
    ensureMonth();
    paint();
  }

  window.SmylInboxCalendar = Object.freeze({ render: render, invalidate: invalidate });
})();
