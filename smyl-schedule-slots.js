/* SMYL · Agenda: horas libres para una cita.
   Calcula en el navegador los mismos choques que valida la base al confirmar (smyl_validate_service_appointment_slot):
   horario de la clínica y del profesional, citas con sus tiempos de preparación, sillón, bloqueos y apartados.
   Son sugerencias: al confirmar, el servidor vuelve a validar y manda la última palabra. Funciones puras, sin DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylScheduleSlots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 60000;
  var ACTIVE = { confirmed: true, arrived: true, in_progress: true };

  function zoneParts(date, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).forEach(function (x) { o[x.type] = x.value; });
    return { y: Number(o.year), m: Number(o.month), d: Number(o.day), min: Number(o.hour) * 60 + Number(o.minute) };
  }

  // Instante que corresponde a «día local + minuto del día» en la zona de la sucursal (null si esa hora no existe).
  function instant(day, minute, tz) {
    var p = String(day).split('-').map(Number);
    var wanted = Date.UTC(p[0], p[1] - 1, p[2], 0, minute);
    var guess = wanted;
    for (var i = 0; i < 3; i += 1) {
      var z = zoneParts(new Date(guess), tz);
      var shown = Date.UTC(z.y, z.m - 1, z.d, 0, z.min);
      if (shown === wanted) return new Date(guess);
      guess += wanted - shown;
    }
    var last = zoneParts(new Date(guess), tz);
    return Date.UTC(last.y, last.m - 1, last.d, 0, last.min) === wanted ? new Date(guess) : null;
  }

  function minutesOf(hhmm) {
    if (!/^\d{1,2}:\d{2}/.test(String(hhmm || ''))) return NaN;
    var p = String(hhmm).split(':'); return Number(p[0]) * 60 + Number(p[1]);
  }

  function windows(rows, weekday) {
    return (rows || []).filter(function (h) { return h.active !== false && h.weekday === weekday; })
      .map(function (h) { return [minutesOf(h.starts_at), minutesOf(h.ends_at)]; })
      .filter(function (w) { return isFinite(w[0]) && isFinite(w[1]) && w[1] > w[0]; });
  }

  function inside(list, from, to) { return list.some(function (w) { return from >= w[0] && to <= w[1]; }); }

  // Misma regla que la base: lo ya reservado ocupa también su preparación antes y después.
  function clash(st, en, before, after, busy) {
    return st.getTime() - before * MIN < busy.end.getTime() + (busy.after || 0) * MIN
      && en.getTime() + after * MIN > busy.start.getTime() - (busy.before || 0) * MIN;
  }

  /* opts: day 'AAAA-MM-DD', tz, duration/before/after (min), step (min), clinic/pro: filas de horario semanal,
     professionalId, roomIds (candidatos; [null] si la sucursal no usa sillones), now (Date),
     appointments [{id,professional_id,room_id,status,start,end,before,after}], blocks [{professional_id,room_id,start,end}],
     holds [{professional_id,room_id,start,end,before,after}], excludeId. */
  function freeSlots(opts) {
    var day = opts.day, tz = opts.tz, duration = Number(opts.duration) || 0, before = Number(opts.before) || 0, after = Number(opts.after) || 0;
    var step = Number(opts.step) || 30;
    if (!day || !duration || !opts.professionalId) return [];
    var p = day.split('-').map(Number), weekday = new Date(p[0], p[1] - 1, p[2]).getDay();
    var clinic = windows(opts.clinic, weekday), own = windows(opts.pro, weekday);
    if (!clinic.length || !own.length) return [];
    var rooms = opts.roomIds && opts.roomIds.length ? opts.roomIds : [null];
    var now = opts.now ? opts.now.getTime() : 0;
    var apps = (opts.appointments || []).filter(function (a) { return ACTIVE[a.status] && a.id !== opts.excludeId; });
    var out = [];
    var first = Math.min.apply(null, clinic.map(function (w) { return w[0]; }));
    var last = Math.max.apply(null, clinic.map(function (w) { return w[1]; }));
    for (var s = Math.ceil(first / step) * step; s + duration <= last; s += step) {
      if (s + duration > 1440) break;
      if (!inside(clinic, s, s + duration) || !inside(own, s, s + duration)) continue;
      var st = instant(day, s, tz), en = st && new Date(st.getTime() + duration * MIN);
      if (!st || st.getTime() < now) continue;
      var proBusy = apps.some(function (a) { return a.professional_id === opts.professionalId && clash(st, en, before, after, a); })
        || (opts.blocks || []).some(function (b) { return b.professional_id === opts.professionalId && clash(st, en, before, after, { start: b.start, end: b.end }); })
        || (opts.holds || []).some(function (h) { return h.professional_id === opts.professionalId && clash(st, en, before, after, h); });
      if (proBusy) continue;
      var free = rooms.filter(function (room) {
        if (!room) return true;
        return !apps.some(function (a) { return a.room_id === room && clash(st, en, before, after, a); })
          && !(opts.blocks || []).some(function (b) { return b.room_id === room && clash(st, en, before, after, { start: b.start, end: b.end }); })
          && !(opts.holds || []).some(function (h) { return h.room_id === room && clash(st, en, before, after, h); });
      });
      if (!free.length) continue;
      out.push({ start: st, end: en, roomId: free[0] });
    }
    return out;
  }

  return { freeSlots: freeSlots, instant: instant, zoneParts: zoneParts, windows: windows, clash: clash };
});
