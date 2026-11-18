/* SMYL · Agenda: tablero de disponibilidad para «Nueva cita».
   Que la asistente vea primero QUÉ hay libre (por día, dentista y sucursal) en vez de adivinar con ensayo y error.
   La lógica (compute / explain / scheduleLabel) es pura y se prueba en Node; render() solo dibuja y no escribe datos:
   al elegir una hora llama a api.pick(), y la cita la crea el flujo de siempre (smyl_create_appointment), donde el servidor
   vuelve a validar todo. Los horarios son sugerencias calculadas con la agenda cargada, con la misma regla de smyl-schedule-slots.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./smyl-schedule-slots.js'));
  else root.SmylScheduleBoard = factory(root.SmylScheduleSlots);
})(typeof self !== 'undefined' ? self : this, function (Slots) {
  'use strict';

  var DAY_COUNT = 14;
  var WD_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var WD_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var WD_PLURAL = ['los domingos', 'los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados'];
  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function dateOf(key) { var p = String(key).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function weekdayOf(key) { return dateOf(key).getDay(); }
  function dayKeys(from, count) {
    var out = [], base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (var i = 0; i < (count || DAY_COUNT); i += 1) { var d = new Date(base); d.setDate(d.getDate() + i); out.push(keyOf(d)); }
    return out;
  }
  function minutesOf(hhmm) { var p = String(hhmm || '').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function clock(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60, h12 = h % 12 || 12;
    return h12 + ':' + pad(m) + ' ' + (h < 12 ? 'am' : 'pm');
  }
  function clockShort(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60, h12 = h % 12 || 12;
    return h12 + (m ? ':' + pad(m) : '') + (h < 12 ? ' am' : ' pm');
  }
  function toLocalInput(date) { var d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  // «Sucursal Plaza Sol» → «Plaza Sol» en menús y celdas, donde el espacio es poco.
  function shortName(name) { return String(name || '').replace(/^sucursal\s+/i, ''); }
  function weekdayOrder(w) { return w === 0 ? 7 : w; } // lunes primero, domingo al final

  function activeRows(rows) { return (rows || []).filter(function (h) { return h.active !== false; }); }
  function hoursFor(hours, professionalId, branchId) {
    return activeRows(hours).filter(function (h) { return h.professional_id === professionalId && (!branchId || h.branch_id === branchId); });
  }
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
  }
  // [1,2,3,4,5] → «lun a vie»; [2,4,6] → «mar jue sáb» (corridas de 3 o más días seguidos se comprimen).
  function daysShort(list) {
    var days = Array.from(new Set(list)).sort(function (a, b) { return weekdayOrder(a) - weekdayOrder(b); }), out = [], i = 0;
    while (i < days.length) {
      var j = i;
      while (j + 1 < days.length && weekdayOrder(days[j + 1]) === weekdayOrder(days[j]) + 1) j += 1;
      if (j - i >= 2) out.push(WD_SHORT[days[i]] + ' a ' + WD_SHORT[days[j]]);
      else for (var k = i; k <= j; k += 1) out.push(WD_SHORT[days[k]]);
      i = j + 1;
    }
    return out.join(' ');
  }

  /* «Dra. Fernanda — Plaza Sol mar jue sáb · Centro vie»: el menú del dentista enseña dónde y cuándo atiende. */
  function scheduleLabel(professional, hours, branches) {
    var rows = hoursFor(hours, professional.id), byBranch = {}, order = [];
    rows.forEach(function (h) { if (!byBranch[h.branch_id]) { byBranch[h.branch_id] = []; order.push(h.branch_id); } byBranch[h.branch_id].push(h.weekday); });
    var multi = (branches || []).length > 1;
    var parts = order.map(function (id) {
      var b = (branches || []).filter(function (x) { return x.id === id; })[0];
      return (multi && b ? shortName(b.name) + ' ' : '') + daysShort(byBranch[id]);
    });
    return professional.display_name + ' — ' + (parts.length ? parts.join(' · ') : 'sin horario configurado');
  }

  /* Horarios libres de los próximos días para cada dentista que hace el tratamiento y cada sucursal donde trabaja.
     o: {service, extra, dayKeys, professionals, branches, hours, clinicHours, rooms, busy:{appointments,blocks,holds}, now, excludeId}
     → { 'AAAA-MM-DD': [{professionalId, branchId, slots:[{start,end,roomId}], step}] }  (sin entrada = no atiende ese día) */
  function compute(o) {
    var svc = o.service || {}, extra = Number(o.extra) || 0, duration = (Number(svc.duration_minutes) || 0) + extra;
    var before = Number(svc.buffer_before_minutes) || 0, after = Number(svc.buffer_after_minutes) || 0, busy = o.busy || {};
    var out = {};
    (o.dayKeys || []).forEach(function (key) {
      var weekday = weekdayOf(key), entries = [];
      (o.professionals || []).forEach(function (p) {
        (o.branches || []).forEach(function (b) {
          var pro = hoursFor(o.hours, p.id, b.id);
          if (!pro.some(function (h) { return h.weekday === weekday; })) return;
          var base = {
            day: key, tz: b.timezone, duration: duration, before: before, after: after,
            clinic: activeRows(o.clinicHours).filter(function (h) { return h.branch_id === b.id; }), pro: pro, professionalId: p.id,
            roomIds: (o.rooms || []).filter(function (r) { return r.branch_id === b.id && r.active !== false; }).map(function (r) { return r.id; }),
            now: o.now || new Date(), appointments: busy.appointments, blocks: busy.blocks, holds: busy.holds, excludeId: o.excludeId
          };
          var step = 30, slots = Slots.freeSlots(Object.assign({ step: 30 }, base));
          if (!slots.length) { step = 15; slots = Slots.freeSlots(Object.assign({ step: 15 }, base)); }
          entries.push({ professionalId: p.id, branchId: b.id, slots: slots, step: step });
        });
      });
      out[key] = entries;
    });
    return out;
  }

  function matches(entry, filter) {
    return (!filter || !filter.professionalId || entry.professionalId === filter.professionalId) && (!filter || !filter.branchId || entry.branchId === filter.branchId);
  }
  function entriesFor(result, key, filter) { return (result[key] || []).filter(function (e) { return matches(e, filter); }); }
  function countFor(result, key, filter) { return entriesFor(result, key, filter).reduce(function (n, e) { return n + e.slots.length; }, 0); }
  function firstDayWithSlots(result, keys, filter, from) {
    for (var i = from || 0; i < keys.length; i += 1) if (countFor(result, keys[i], filter)) return keys[i];
    return '';
  }

  /* Por qué un día no tiene horarios con el filtro actual, y qué hacer. → {title, text, actions:[{type,label,...}]} */
  function explain(o) {
    var key = o.dayKey, weekday = weekdayOf(key), filter = o.filter || {}, actions = [], title, text = '';
    var pro = (o.professionals || []).filter(function (p) { return p.id === filter.professionalId; })[0];
    var branchName = function (id) { var b = (o.branches || []).filter(function (x) { return x.id === id; })[0]; return b ? b.name : 'esa sucursal'; };
    var rangeText = function (rows) {
      var lo = Math.min.apply(null, rows.map(function (h) { return minutesOf(h.starts_at); })), hi = Math.max.apply(null, rows.map(function (h) { return minutesOf(h.ends_at); }));
      return 'de ' + clock(lo) + ' a ' + clock(hi);
    };
    if (pro) {
      var mine = hoursFor(o.hours, pro.id).filter(function (h) { return h.weekday === weekday; });
      var branchIds = Array.from(new Set(mine.map(function (h) { return h.branch_id; })));
      if (mine.length && filter.branchId && branchIds.indexOf(filter.branchId) < 0) {
        title = pro.display_name + ' no atiende en ' + branchName(filter.branchId) + ' el ' + WD_LONG[weekday] + '.';
        text = 'Ese día sí atiende en ' + joinList(branchIds.map(function (id) { return branchName(id) + ' ' + rangeText(mine.filter(function (h) { return h.branch_id === id; })); })) + '.';
        actions.push({ type: 'branch', branchId: branchIds[0], label: 'Ver ' + branchName(branchIds[0]), primary: true });
      } else if (!mine.length) {
        var all = hoursFor(o.hours, pro.id);
        title = pro.display_name + ' no atiende ' + WD_PLURAL[weekday] + '.';
        text = all.length ? 'Atiende: ' + scheduleLabel(pro, o.hours, o.branches).split(' — ')[1] + '.' : 'No tiene horario semanal configurado. Agrégalo en Agenda, Disponibilidad.';
      } else {
        var closed = branchIds.filter(function (id) { return !Slots.windows(activeRows(o.clinicHours).filter(function (h) { return h.branch_id === id; }), weekday).length; });
        if (closed.length) {
          title = joinList(closed.map(branchName)) + (closed.length > 1 ? ' no tienen' : ' no tiene') + ' horario de la sucursal ' + 'el ' + WD_LONG[weekday] + '.';
          text = pro.display_name + ' sí tiene horario ese día, pero sin horario de la sucursal no se puede agendar. Agrégalo en Agenda, Disponibilidad.';
        } else {
          title = 'A ' + pro.display_name + ' ya no le quedan horarios libres ese día.';
          text = 'Todo su horario de ese día está ocupado' + (filter.branchId ? ' en ' + branchName(filter.branchId) : '') + '.';
        }
      }
    } else if (filter.branchId) {
      title = 'En ' + branchName(filter.branchId) + ' nadie que haga este tratamiento tiene horarios libres ese día.';
      text = 'Prueba otra sucursal o quita el filtro.';
    } else {
      title = 'Ese día no hay horarios libres para este tratamiento.';
      text = 'Ninguno de los dentistas que lo hacen tiene espacio ese día.';
    }
    if (filter.professionalId || filter.branchId) {
      var names = {};
      (o.result[key] || []).filter(function (e) { return e.slots.length && e.professionalId !== filter.professionalId; }).forEach(function (e) {
        var p = (o.professionals || []).filter(function (x) { return x.id === e.professionalId; })[0];
        if (p) names[p.display_name + ' (' + branchName(e.branchId) + ')'] = 1;
      });
      var who = Object.keys(names);
      if (who.length) {
        text += (filter.professionalId ? ' Otros que hacen este tratamiento ese día: ' : ' Ese día sí hay con: ') + joinList(who) + '.';
        actions.push({ type: 'all', label: 'Ver a todos ese día' });
      }
    }
    var next = firstDayWithSlots(o.result, o.dayKeys, filter, o.dayKeys.indexOf(key) + 1);
    if (next) {
      var nd = dateOf(next);
      actions.push({ type: 'day', key: next, primary: true, label: 'Ir al próximo día con horarios: ' + WD_SHORT[nd.getDay()] + ' ' + nd.getDate() });
    }
    return { title: title, text: text, actions: actions };
  }

  // ── Pantalla ───────────────────────────────────────────────────────────────────────────────────
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(cls, text) { var b = el('button', cls, text); b.type = 'button'; return b; }

  /* api: values() → {serviceId, extra, professionalId, branchId, starts}; initial() → {professionalId, branchId};
     context() → {service, professionals (activos que hacen el servicio), branches (activas), hours, clinicHours, rooms};
     loadBusy(dayKeys) → Promise<{appointments, blocks, holds, truncated}>; pick({professionalId, branchId, roomId, start}); time(date) → texto. */
  function render(host, api) {
    var values = api.values(), ctx = api.context();
    var ui = host._ui;
    if (!ui) { var init = api.initial() || {}; ui = host._ui = { svc: '', day: '', professional: init.professionalId || '', branch: init.branchId || '', token: 0, result: null, resultKey: '' }; }
    if (!values.serviceId || !ctx.service) { host._sig = ''; ui.result = null; ui.svc = ''; show(el('p', 'schedule-slots-hint', 'Elige el tratamiento para ver quién tiene horarios libres.')); return; }
    var capable = ctx.professionals || [];
    if (!capable.length) { host._sig = ''; show(el('p', 'schedule-slots-hint', 'Ningún dentista tiene asignado este tratamiento. Asígnalo en Agenda, Disponibilidad.')); return; }
    if (!activeRows(ctx.clinicHours).length) { host._sig = ''; show(el('p', 'schedule-slots-hint', 'Las sucursales no tienen horario semanal configurado. Agrégalo en Agenda, Disponibilidad; sin eso no se puede confirmar ninguna cita.')); return; }
    var sig = [values.serviceId, values.extra, values.starts, values.professionalId, values.branchId].join('|');
    if (host._sig === sig && host.firstChild) return;
    host._sig = sig;
    if (ui.svc !== values.serviceId) {
      ui.svc = values.serviceId; ui.day = ''; ui.result = null;
      if (ui.professional && !capable.some(function (p) { return p.id === ui.professional; })) ui.professional = '';
    }
    var resultKey = values.serviceId + '|' + (Number(values.extra) || 0);
    if (ui.result && ui.resultKey === resultKey) { draw(); return; }
    var token = ++ui.token, keys = dayKeys(new Date(), DAY_COUNT);
    show(slotsSkeleton());
    Promise.resolve(api.loadBusy(keys)).then(function (busy) {
      if (host._ui.token !== token) return;
      ui.keys = keys; ui.busy = busy || {};
      ui.result = compute({ service: ctx.service, extra: values.extra, dayKeys: keys, professionals: capable, branches: ctx.branches, hours: ctx.hours, clinicHours: ctx.clinicHours, rooms: ctx.rooms, busy: ui.busy, now: new Date() });
      ui.resultKey = resultKey;
      if (!ui.day || keys.indexOf(ui.day) < 0) {
        var wanted = String(values.starts || '').slice(0, 10);
        ui.day = keys.indexOf(wanted) >= 0 ? wanted : (firstDayWithSlots(ui.result, keys, filterNow()) || keys[0]);
      }
      draw();
    }).catch(function () {
      if (host._ui.token !== token) return;
      host._sig = '';
      show(el('p', 'schedule-slots-hint', 'No pudimos revisar los horarios libres. Usa «Elegir a mano»; el sistema revisa al confirmar.'));
    });

    function show(node) { host.innerHTML = ''; host.append(node); }
    function filterNow() { return { professionalId: ui.professional, branchId: ui.branch }; }
    function refilter(jump) { if (jump) ui.day = firstDayWithSlots(ui.result, ui.keys, filterNow()) || ui.day; draw(); }
    function nameOf(id, list, field) { var x = list.filter(function (r) { return r.id === id; })[0]; return x ? x[field] : ''; }

    function draw() {
      var ctx2 = api.context(), v = api.values(), filter = filterNow(), root = el('div', 'schedule-board');
      var multi = (ctx2.branches || []).length > 1;

      // 1 · filtros opcionales
      root.append(el('div', 'schedule-board-step', '¿Con quién y dónde? (opcional)'));
      var filters = el('div', 'schedule-board-filters');
      var proSel = document.createElement('select'); proSel.setAttribute('aria-label', 'Filtrar por dentista');
      proSel.append(new Option('Cualquiera que haga este tratamiento', ''));
      ctx2.professionals.forEach(function (p) { proSel.append(new Option(scheduleLabel(p, ctx2.hours, ctx2.branches), p.id)); });
      proSel.value = ui.professional;
      proSel.onchange = function (e) { e.stopPropagation(); ui.professional = proSel.value; refilter(true); };
      var proLabel = el('label', '', 'Dentista'); proLabel.append(proSel); filters.append(proLabel);
      if (multi) {
        var brSel = document.createElement('select'); brSel.setAttribute('aria-label', 'Filtrar por sucursal');
        brSel.append(new Option('Todas las sucursales', '')); ctx2.branches.forEach(function (b) { brSel.append(new Option(b.name, b.id)); });
        brSel.value = ui.branch;
        brSel.onchange = function (e) { e.stopPropagation(); ui.branch = brSel.value; refilter(true); };
        var brLabel = el('label', '', 'Sucursal'); brLabel.append(brSel); filters.append(brLabel);
      }
      root.append(filters);

      // 2 · día, con cuántos horarios libres tiene cada uno
      root.append(el('div', 'schedule-board-step', 'Elige el día'));
      var days = el('div', 'schedule-board-days'); days.setAttribute('role', 'group'); days.setAttribute('aria-label', 'Día');
      ui.keys.forEach(function (key, i) {
        var d = dateOf(key), n = countFor(ui.result, key, filter);
        var b = btn('schedule-board-day ' + (n === 0 ? 'is-none' : n >= 8 ? 'is-many' : 'is-few'));
        b.setAttribute('aria-pressed', String(key === ui.day));
        b.setAttribute('aria-label', WD_LONG[d.getDay()] + ' ' + d.getDate() + ' de ' + MONTHS[d.getMonth()] + ': ' + (n ? n + (n === 1 ? ' horario libre' : ' horarios libres') : 'sin horarios'));
        b.append(el('small', '', i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : WD_SHORT[d.getDay()]), el('b', '', String(d.getDate())), el('i'), el('em', '', n ? n + (n === 1 ? ' libre' : ' libres') : 'sin horarios'));
        b.onclick = function () { ui.day = key; draw(); };
        days.append(b);
      });
      root.append(days);
      var legend = el('div', 'schedule-board-legend');
      [['is-many', 'Muchos horarios'], ['is-few', 'Pocos'], ['is-none', 'Sin horarios con este filtro']].forEach(function (x) { var s = el('span'); s.append(el('u', x[0]), document.createTextNode(x[1])); legend.append(s); });
      root.append(legend);

      // 3 · horas del día, agrupadas por dentista y sucursal (o por qué no hay y qué hacer)
      var date = dateOf(ui.day);
      root.append(el('div', 'schedule-board-step', 'Elige la hora — ' + WD_LONG[date.getDay()] + ' ' + date.getDate()));
      var detail = el('div', 'schedule-board-detail'); detail.setAttribute('aria-live', 'polite');
      var groups = entriesFor(ui.result, ui.day, filter).filter(function (e) { return e.slots.length; });
      if (!groups.length) {
        var info = explain({ dayKey: ui.day, dayKeys: ui.keys, filter: filter, result: ui.result, professionals: ctx2.professionals, branches: ctx2.branches, hours: ctx2.hours, clinicHours: ctx2.clinicHours });
        var box = el('div', 'schedule-board-explain'); box.append(el('b', '', info.title), el('p', '', info.text));
        var row = el('div', 'schedule-board-actions');
        info.actions.forEach(function (a) {
          var b = btn('schedule-board-action' + (a.primary ? ' is-primary' : ''), a.label);
          b.onclick = function () {
            if (a.type === 'branch') { ui.branch = a.branchId; draw(); }
            else if (a.type === 'all') { ui.professional = ''; ui.branch = ''; draw(); }
            else if (a.type === 'day') { ui.day = a.key; draw(); }
          };
          row.append(b);
        });
        box.append(row); detail.append(box);
      } else {
        groups.sort(function (a, b) { return nameOf(a.professionalId, ctx2.professionals, 'display_name').localeCompare(nameOf(b.professionalId, ctx2.professionals, 'display_name')) || nameOf(a.branchId, ctx2.branches, 'name').localeCompare(nameOf(b.branchId, ctx2.branches, 'name')); });
        groups.forEach(function (g) {
          var p = ctx2.professionals.filter(function (x) { return x.id === g.professionalId; })[0], line = el('div', 'schedule-board-group');
          var who = el('div', 'schedule-board-who'), dot = el('i', 'schedule-board-dot is-' + ((p && p.color_token) || 'teal')), copy = el('div');
          var chairs = (ctx2.rooms || []).filter(function (r) { return r.branch_id === g.branchId && r.active !== false; }).length;
          copy.append(el('b', '', p ? p.display_name : ''), el('small', '', (multi ? nameOf(g.branchId, ctx2.branches, 'name') : '') + (chairs === 1 ? (multi ? ' · ' : '') + '1 solo sillón' : '')));
          who.append(dot, copy);
          var list = el('div', 'schedule-slot-times'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Horarios libres de ' + (p ? p.display_name : ''));
          g.slots.forEach(function (s) {
            var chosen = v.starts === toLocalInput(s.start) && v.professionalId === g.professionalId && v.branchId === g.branchId;
            var b = btn('schedule-slot-time', api.time(s.start)); b.setAttribute('aria-pressed', String(chosen));
            b.onclick = function () { api.pick({ professionalId: g.professionalId, branchId: g.branchId, roomId: s.roomId || '', start: s.start }); };
            list.append(b);
          });
          line.append(who, list); detail.append(line);
        });
      }
      root.append(detail);

      // 5 · quién atiende cada día (próximos 7 días)
      var matrix = el('details', 'schedule-board-matrix'); matrix.append(el('summary', '', 'Ver quién atiende cada día (los próximos 7 días)'));
      if (host._matrixOpen) matrix.open = true;
      matrix.addEventListener('toggle', function () { host._matrixOpen = matrix.open; });
      var wrap = el('div', 'schedule-board-matrixwrap'), table = el('table'), head = el('tr');
      head.append(el('th', '', 'Dentista'));
      ui.keys.slice(0, 7).forEach(function (key, i) { var d = dateOf(key); head.append(el('th', '', i === 0 ? 'Hoy ' + d.getDate() : WD_SHORT[d.getDay()] + ' ' + d.getDate())); });
      table.append(head);
      ctx2.professionals.forEach(function (p) {
        var tr = el('tr'); var tdName = el('td', '', p.display_name.split(' ').slice(0, 2).join(' ')); tdName.title = p.display_name; tr.append(tdName);
        ui.keys.slice(0, 7).forEach(function (key) {
          var td = el('td'), rows = hoursFor(ctx2.hours, p.id).filter(function (h) { return h.weekday === weekdayOf(key); }), done = {};
          if (!rows.length) td.append(el('span', 'schedule-board-dash', '—'));
          rows.forEach(function (h) {
            if (done[h.branch_id]) return; done[h.branch_id] = true;
            var mine = rows.filter(function (x) { return x.branch_id === h.branch_id; }), lo = Math.min.apply(null, mine.map(function (x) { return minutesOf(x.starts_at); })), hi = Math.max.apply(null, mine.map(function (x) { return minutesOf(x.ends_at); }));
            var free = (ui.result[key] || []).filter(function (e) { return e.professionalId === p.id && e.branchId === h.branch_id; }).reduce(function (n, e) { return n + e.slots.length; }, 0);
            var c = btn('schedule-board-cell is-' + (p.color_token || 'teal') + (free ? '' : ' is-full'));
            if (multi) c.append(el('span', 'schedule-board-cell-branch', shortName(nameOf(h.branch_id, ctx2.branches, 'name'))));
            c.append(el('span', 'schedule-board-cell-hours', clockShort(lo) + '–' + clockShort(hi)), el('small', '', free ? free + ' libres' : 'sin libres'));
            c.onclick = function () { ui.professional = p.id; ui.branch = h.branch_id; ui.day = key; draw(); };
            td.append(c);
          });
          tr.append(td);
        });
        table.append(tr);
      });
      wrap.append(table); matrix.append(wrap); root.append(matrix);

      root.append(el('p', 'schedule-slots-hint', 'Los horarios se calculan con la agenda de la clínica. Al confirmar, el servidor los vuelve a revisar.' + (ui.busy && ui.busy.truncated ? ' Hay muchas citas en estos días; confirma al guardar.' : '')));
      host.innerHTML = ''; host.append(root);
    }
  }

  return { render: render, compute: compute, explain: explain, scheduleLabel: scheduleLabel, daysShort: daysShort, dayKeys: dayKeys, countFor: countFor, entriesFor: entriesFor, firstDayWithSlots: firstDayWithSlots, toLocalInput: toLocalInput, DAY_COUNT: DAY_COUNT };
});
