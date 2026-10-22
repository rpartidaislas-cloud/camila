/* SMYL · Agenda: geometría de la semana con eje de horas.
   Funciones puras (sin DOM) para que el reparto de citas encimadas, el rango de horas y el clic en un hueco
   se puedan probar sin navegador. Los minutos son del día local (0 a 1440). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylScheduleGrid = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STEP = 15;

  function toMinutes(hhmm) {
    if (!/^\d{1,2}:\d{2}/.test(String(hhmm || ''))) return NaN;
    var p = String(hhmm).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  // Rango visible en minutos, redondeado a horas completas: cubre el horario abierto de la semana y cualquier
  // cita o bloqueo que quede fuera de él. Sin datos usa 8:00 a 20:00 y siempre muestra al menos 4 horas.
  function bounds(windows, spans) {
    var starts = [], ends = [];
    (windows || []).concat(spans || []).forEach(function (w) {
      if (w && isFinite(w[0]) && isFinite(w[1]) && w[1] > w[0]) { starts.push(w[0]); ends.push(w[1]); }
    });
    var start = starts.length ? Math.floor(Math.min.apply(null, starts) / 60) * 60 : 8 * 60;
    var end = ends.length ? Math.ceil(Math.max.apply(null, ends) / 60) * 60 : 20 * 60;
    start = Math.max(0, start); end = Math.min(1440, end);
    if (end - start < 240) end = Math.min(1440, start + 240);
    if (end - start < 240) start = Math.max(0, end - 240);
    return { start: start, end: end };
  }

  // Rango compacto: solo lo que ocupan las citas y bloqueos de la semana con una hora de margen (nunca fuera del rango
  // completo) y al menos `hours` horas (5 por omisión). Sin citas devuelve el rango completo.
  function compact(windows, spans, hours) {
    var all = bounds(windows, spans), min = (hours || 5) * 60;
    var used = (spans || []).filter(function (w) { return w && isFinite(w[0]) && isFinite(w[1]) && w[1] > w[0]; });
    if (!used.length) return all;
    var s = Math.min.apply(null, used.map(function (w) { return w[0]; })), e = Math.max.apply(null, used.map(function (w) { return w[1]; }));
    var start = Math.max(all.start, Math.floor((s - 60) / 60) * 60), end = Math.min(all.end, Math.ceil((e + 60) / 60) * 60);
    if (end - start < min) {
      end = Math.min(all.end, start + min);
      start = Math.max(all.start, end - min);
      end = Math.min(all.end, start + min);
    }
    return { start: start, end: end };
  }

  // Reparte las citas que se encieman en columnas lado a lado. Devuelve cada elemento con su carril y los carriles
  // del grupo al que pertenece (las citas que no se tocan ocupan todo el ancho).
  function lanes(items) {
    var sorted = (items || []).map(function (item, index) { return { item: item, index: index, start: item.start, end: Math.max(item.end, item.start + 1) }; })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end || a.index - b.index; });
    var out = [], group = [], groupEnd = -Infinity;
    function flush() {
      var count = group.reduce(function (max, entry) { return Math.max(max, entry.lane + 1); }, 1);
      group.forEach(function (entry) { out.push(Object.assign({}, entry.item, { lane: entry.lane, lanes: count })); });
      group = [];
    }
    sorted.forEach(function (entry) {
      if (group.length && entry.start >= groupEnd) { flush(); groupEnd = -Infinity; }
      var used = {};
      group.forEach(function (other) { if (other.end > entry.start) used[other.lane] = true; });
      var lane = 0; while (used[lane]) lane += 1;
      entry.lane = lane; group.push(entry); groupEnd = Math.max(groupEnd, entry.end);
    });
    flush();
    return out;
  }

  // Minutos del día que corresponden a un clic a `offsetY` píxeles del inicio de la columna, ajustados a 15 min.
  function slotAt(offsetY, pxPerMinute, startMinute, endMinute) {
    var raw = startMinute + Math.max(0, offsetY) / pxPerMinute;
    var snapped = Math.floor(raw / STEP) * STEP;
    return Math.min(Math.max(startMinute, snapped), Math.max(startMinute, endMinute - STEP));
  }

  function size(heightPx) { return heightPx < 46 ? 's' : heightPx < 84 ? 'm' : 'l'; }

  return { STEP: STEP, toMinutes: toMinutes, bounds: bounds, compact: compact, lanes: lanes, slotAt: slotAt, size: size };
});
