/* SMYL · Mensajes: calendario mensual para agendar desde el chat.
   Solo presenta y organiza: la disponibilidad real la calcula el servidor (acción `availability`) y la cita la crea el flujo
   existente de solicitud + confirmación. Aquí no se escribe nada en la base de datos. */
(function () {
  'use strict';

  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var state = { host: null, ctx: null, month: null, day: null, key: '', cache: Object.create(null), token: 0, queue: [], running: 0, agenda: Object.create(null), agendaOpen: false, paint: 0 };

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dayKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function parseDay(key) { var parts = key.split('-'); return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])); }
  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function todayStart() { var now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
  function level(count) { return count <= 0 ? 'none' : count <= 4 ? 'few' : 'many'; }
  function longDay(key) { var date = parseDay(key); return WEEKDAYS[date.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + date.getDate() + ' de ' + MONTHS[date.getMonth()]; }
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
      else { cell.classList.add('is-' + level(slots.length)); cell.setAttribute('aria-label', date.getDate() + ' de ' + MONTHS[date.getMonth()] + ', ' + (slots.length ? (slots.length >= 30 ? '30 o más horarios libres' : slots.length + (slots.length === 1 ? ' horario libre' : ' horarios libres')) : 'sin horarios')); }
      if (key === state.day) { cell.classList.add('is-selected'); cell.setAttribute('aria-pressed', 'true'); } else cell.setAttribute('aria-pressed', 'false');
      cell.onclick = (function (value) { return function () { state.day = value; state.agendaOpen = false; paint(); }; })(key);
      grid.append(cell);
    }
    section.append(grid);
    var legend = el('div', 'smyl-cal-legend');
    [['many', 'Muchos horarios'], ['few', 'Pocos'], ['none', 'Sin horarios']].forEach(function (item) { var chip = el('span'); chip.append(el('u', 'is-' + item[0]), document.createTextNode(item[1])); legend.append(chip); });
    section.append(legend);
    return section;
  }

  function buildSlots(ctx, slots) {
    var wrap = el('div', 'smyl-cal-slots');
    var names = {}; slots.forEach(function (slot) { names[slot.professional_id] = true; });
    var many = Object.keys(names).length > 1;
    [['Mañana', function (hour) { return hour < 12; }], ['Tarde', function (hour) { return hour >= 12; }]].forEach(function (part) {
      var rows = slots.filter(function (slot) { return part[1](new Date(slot.starts_at).getHours()); });
      if (!rows.length) return;
      var group = el('div', 'smyl-cal-part'); group.append(el('span', '', part[0]));
      var list = el('div', 'smyl-cal-slotlist');
      rows.forEach(function (slot) {
        var selected = ctx.isSelected(slot);
        var button = el('button', 'smyl-cal-slot' + (selected ? ' is-selected' : '')); button.type = 'button'; button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', (selected ? 'Quitar' : 'Seleccionar') + ' horario de las ' + ctx.time(slot.starts_at) + ' con ' + slot.professional_name);
        button.append(el('strong', '', ctx.time(slot.starts_at)));
        if (many) button.append(el('small', '', String(slot.professional_name || '').split(' ').slice(0, 2).join(' ')));
        button.onclick = function () { ctx.toggle(slot); };
        list.append(button);
      });
      group.append(list); wrap.append(group);
    });
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
    if (!entry.rows.length) { box.append(el('p', 'smyl-cal-note', 'No hay citas registradas este día.')); return box; }
    var list = el('ol', 'smyl-cal-agenda-list');
    entry.rows.forEach(function (row) {
      var item = el('li'); item.dataset.status = row.status || '';
      item.append(el('time', '', ctx.time(row.starts_at) + ' – ' + ctx.time(row.ends_at)));
      var copy = el('span'); copy.append(el('strong', '', row.patient || 'Paciente'), el('small', '', [row.service, row.professional].filter(Boolean).join(' · ')));
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
    copy.append(el('small', '', !slots ? 'Consultando horarios…' : entry && entry.error ? 'No pudimos consultar este día' : slots.length ? (slots.length >= 30 ? '30 o más horarios libres' : slots.length + (slots.length === 1 ? ' horario libre' : ' horarios libres')) : 'Sin horarios libres'));
    var actions = el('div', 'smyl-cal-actions');
    var agendaButton = el('button', 'smyl-cal-btn', state.agendaOpen ? 'Ocultar agenda del día' : 'Ver agenda del día'); agendaButton.type = 'button'; agendaButton.setAttribute('aria-expanded', String(state.agendaOpen));
    agendaButton.onclick = function () { state.agendaOpen = !state.agendaOpen; paint(); };
    var full = el('button', 'smyl-cal-link', 'Abrir Agenda completa ↗'); full.type = 'button'; full.onclick = function () { ctx.openAgenda(key); };
    actions.append(agendaButton, full);
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
    } else section.append(buildSlots(ctx, slots));
    if (state.agendaOpen) section.append(buildAgenda(ctx, key));
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
