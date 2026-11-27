// ARCHIVO GENERADO por scripts/sync-schedule-suggest.mjs a partir de smyl-schedule-suggest.js: no lo edites.
const module = { exports: {} };
/* SMYL · Agenda: «Sugerir horarios».
   Elige, entre los horarios libres que ya calculó el servidor, un máximo de tres opciones ordenadas y variadas para ofrecerlas
   a un paciente. No consulta ni escribe datos: solo ordena lo que recibe. Es determinista (sin IA) para que el resultado sea
   explicable y repetible, y es el mismo motor que usará el asistente de IA cuando agende solo.

   Reglas:
   1. Una sola sucursal: la que se pidió o, si no hay, la del primer espacio libre.
   2. Opción 1: el primer espacio libre (o el de su profesional de continuidad si cae dentro de 72 h del primero).
   3. Opción 2: otro día y otra franja del día (mañana / tarde); si no existe, otro día; si no, el mismo día con 3 h de distancia.
   4. Opción 3: un tercer día; si no existe, un horario que se separe al menos 2 h de los demás.
   5. Nunca se ofrece un horario ya pasado ni con menos de `minLeadMinutes` de anticipación. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylScheduleSuggest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600000;
  var AFTERNOON_FROM = 13;           // 13:00 en adelante cuenta como «tarde»
  var CONTINUITY_WINDOW_MS = 72 * HOUR;
  var SAME_DAY_GAP_MS = 3 * HOUR, FALLBACK_GAP_MS = 2 * HOUR;

  function keyOf(slot) {
    return [slot.service_id || '', slot.branch_id || '', slot.professional_id || '', new Date(slot.starts_at).toISOString()].join('|');
  }

  // Día (YYYY-MM-DD) y hora en la zona de la sucursal; sin zona o con una inválida usa la del navegador.
  function localParts(iso, timeZone) {
    var date = new Date(iso);
    function from(zone) {
      var options = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' };
      if (zone) options.timeZone = zone;
      var out = {}; new Intl.DateTimeFormat('en-CA', options).formatToParts(date).forEach(function (part) { out[part.type] = part.value; });
      return { day: out.year + '-' + out.month + '-' + out.day, hour: Number(out.hour) % 24 };
    }
    try { return from(timeZone); } catch (error) { return from(undefined); }
  }

  function daypart(parts) { return parts.hour >= AFTERNOON_FROM ? 'afternoon' : 'morning'; }

  function prepare(slots, config) {
    var now = config.now instanceof Date ? config.now.getTime() : Number(config.now || Date.now());
    var earliest = now + Math.max(0, Number(config.minLeadMinutes == null ? 60 : config.minLeadMinutes)) * 60000;
    var excluded = {}; (config.exclude || []).forEach(function (key) { excluded[key] = true; });
    var rows = [];
    (Array.isArray(slots) ? slots : []).forEach(function (slot) {
      if (!slot || !slot.starts_at) return;
      var start = new Date(slot.starts_at).getTime();
      if (!Number.isFinite(start) || start < earliest || excluded[keyOf(slot)]) return;
      if (config.professionalId && slot.professional_id !== config.professionalId) return;
      var parts = localParts(slot.starts_at, slot.timezone);
      rows.push({ slot: slot, start: start, day: parts.day, part: daypart(parts) });
    });
    rows.sort(function (a, b) { return a.start - b.start || String(a.slot.professional_name || '').localeCompare(String(b.slot.professional_name || '')); });
    return rows;
  }

  function pick(rows, picked, test) {
    for (var i = 0; i < rows.length; i += 1) {
      if (picked.indexOf(rows[i]) >= 0) continue;
      if (test(rows[i])) return rows[i];
    }
    return null;
  }

  // slots: lista del servidor. config: { now, limit (≤3), branchId, professionalId, preferredProfessionalId, exclude: [clave], minLeadMinutes }
  function suggest(slots, config) {
    config = config || {};
    var limit = Math.min(Math.max(Number(config.limit) || 3, 1), 3);
    var rows = prepare(slots, config);
    if (config.branchId) rows = rows.filter(function (row) { return row.slot.branch_id === config.branchId; });
    var branchIds = {}; rows.forEach(function (row) { branchIds[row.slot.branch_id || ''] = true; });
    var otherBranches = Object.keys(branchIds).length > 1;
    if (!config.branchId && rows.length) { var chosen = rows[0].slot.branch_id; rows = rows.filter(function (row) { return row.slot.branch_id === chosen; }); }
    var result = { options: [], reason: rows.length ? 'ok' : 'none', total: rows.length, branch_id: rows.length ? rows[0].slot.branch_id : null, other_branches: otherBranches && !config.branchId };
    if (!rows.length) return result;

    var picked = [], tags = [];
    // 1) primer espacio libre, o el de su profesional si está cerca
    var first = rows[0];
    if (config.preferredProfessionalId) {
      var continuity = pick(rows, [], function (row) { return row.slot.professional_id === config.preferredProfessionalId && row.start - rows[0].start <= CONTINUITY_WINDOW_MS; });
      if (continuity) first = continuity;
    }
    picked.push(first); tags.push(first === rows[0] ? 'Primer espacio libre' : 'Con su profesional');
    // 2) otro día y otra franja
    if (limit >= 2) {
      var second = pick(rows, picked, function (row) { return row.day !== first.day && row.part !== first.part; })
        || pick(rows, picked, function (row) { return row.day !== first.day; })
        || pick(rows, picked, function (row) { return row.day === first.day && Math.abs(row.start - first.start) >= SAME_DAY_GAP_MS; });
      if (second) { picked.push(second); tags.push(second.day === first.day ? 'Más tarde ese día' : second.part !== first.part ? (second.part === 'afternoon' ? 'Por la tarde' : 'Por la mañana') : 'Otro día'); }
    }
    // 3) un tercer día
    if (limit >= 3 && picked.length >= 2) {
      var days = picked.map(function (row) { return row.day; });
      var third = pick(rows, picked, function (row) { return days.indexOf(row.day) < 0; })
        || pick(rows, picked, function (row) { return picked.every(function (p) { return Math.abs(row.start - p.start) >= FALLBACK_GAP_MS; }); });
      if (third) { picked.push(third); tags.push(days.indexOf(third.day) < 0 ? 'Otro día' : 'Otro horario'); }
    }
    var order = picked.map(function (row, index) { return { row: row, tag: tags[index], rank: index + 1 }; });
    order.sort(function (a, b) { return a.row.start - b.row.start; });
    result.options = order.map(function (item) { return { slot: item.row.slot, tag: item.tag, rank: item.rank, key: keyOf(item.row.slot) }; });
    if (result.options.length < limit) result.reason = 'few';
    return result;
  }

  // Frase corta para el equipo cuando no hay tres opciones.
  function describe(result, periodLabel) {
    if (!result || result.reason === 'none') return 'No hay espacios libres' + (periodLabel ? ' ' + periodLabel : '') + '. Amplía el periodo o prueba con otra sucursal o profesional.';
    if (result.reason === 'few') return 'Solo encontré ' + result.options.length + (result.options.length === 1 ? ' espacio' : ' espacios') + (periodLabel ? ' ' + periodLabel : '') + '. Puedes ampliar el periodo para tener más opciones.';
    return '';
  }

  return { suggest: suggest, describe: describe, keyOf: keyOf, localParts: localParts, AFTERNOON_FROM: AFTERNOON_FROM };
});

export const suggest = module.exports.suggest;
export const describe = module.exports.describe;
export const keyOf = module.exports.keyOf;
export const localParts = module.exports.localParts;
export const AFTERNOON_FROM = module.exports.AFTERNOON_FROM;
export default module.exports;
