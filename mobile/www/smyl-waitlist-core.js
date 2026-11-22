/* SMYL · Lista de espera: a quién ofrecerle un horario que se liberó.
   Lógica pura (sin red ni datos): recibe las entradas en espera y el hueco libre y devuelve a quién ofrecérselo, en orden y con el
   motivo. Una persona decide y envía; esto nunca agenda ni manda mensajes. Es la misma lógica que usará la IA cuando agende sola.

   Una entrada encaja con un hueco si:
   · está en espera (o se le ofreció hace más del tiempo de respuesta sin contestar) y no venció;
   · el hueco empieza con al menos `minLeadMinutes` de anticipación;
   · el servicio es el del hueco, o es uno más corto que ese profesional hace y cabe en el hueco;
   · sucursal y profesional coinciden (si los pidió), y el día y la franja (mañana/tarde) le acomodan.
   Orden: urgentes primero; luego quien pidió a ese profesional o sucursal; luego servicio exacto; luego quien lleva más tiempo esperando. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylWaitlistCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AFTERNOON_FROM = 13;
  var DEFAULTS = { minLeadMinutes: 60, offerTimeoutMinutes: 120 };

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

  function minutesBetween(startIso, endIso) { return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000; }

  function hasPair(pairs, professionalId, serviceId) {
    return (pairs || []).some(function (row) { return row.professional_id === professionalId && row.service_id === serviceId; });
  }

  // slot: { starts_at, ends_at, branch_id, professional_id, service_id, timezone }
  // ctx: { now, minLeadMinutes, offerTimeoutMinutes, durations: { serviceId: minutos }, professionalServices: [{ professional_id, service_id }] }
  function matches(entries, slot, ctx) {
    ctx = ctx || {}; slot = slot || {};
    var now = ctx.now instanceof Date ? ctx.now.getTime() : Number(ctx.now || Date.now());
    var lead = ctx.minLeadMinutes == null ? DEFAULTS.minLeadMinutes : ctx.minLeadMinutes;
    var timeout = (ctx.offerTimeoutMinutes == null ? DEFAULTS.offerTimeoutMinutes : ctx.offerTimeoutMinutes) * 60000;
    var start = new Date(slot.starts_at).getTime();
    if (!Number.isFinite(start) || start < now + lead * 60000) return [];
    var slotMinutes = slot.ends_at ? minutesBetween(slot.starts_at, slot.ends_at) : null;
    var parts = localParts(slot.starts_at, slot.timezone), part = parts.hour >= AFTERNOON_FROM ? 'afternoon' : 'morning';
    var out = [];
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || !entry.service_id) return;
      var reoffer = false;
      if (entry.status === 'offered') {
        var since = new Date(entry.offered_at).getTime();
        if (!Number.isFinite(since) || now - since < timeout) return;            // todavía puede contestar
        reoffer = true;
      } else if (entry.status !== 'waiting') return;
      if (entry.expires_at && new Date(entry.expires_at).getTime() <= now) return;
      var fit = null;
      if (entry.service_id === slot.service_id) fit = 'exact';
      else {
        var needed = ctx.durations && ctx.durations[entry.service_id];
        if (needed != null && slotMinutes != null && needed <= slotMinutes && hasPair(ctx.professionalServices, slot.professional_id, entry.service_id)) fit = 'shorter';
      }
      if (!fit) return;
      if (entry.branch_id && entry.branch_id !== slot.branch_id) return;
      if (entry.professional_id && entry.professional_id !== slot.professional_id) return;
      if (entry.not_before && parts.day < String(entry.not_before).slice(0, 10)) return;
      if (entry.not_after && parts.day > String(entry.not_after).slice(0, 10)) return;
      if (entry.daypart && entry.daypart !== 'any' && entry.daypart !== part) return;
      var reasons = [], score = 0;
      if (entry.priority === 'urgent') { score += 100; reasons.push('Urgente'); }
      if (entry.professional_id) { score += 10; reasons.push('Pidió a este profesional'); }
      if (entry.branch_id) { score += 5; reasons.push('Pidió esta sucursal'); }
      if (fit === 'exact') score += 3; else reasons.push('Servicio más corto que cabe en el hueco');
      if (reoffer) reasons.push('No contestó la oferta anterior');
      out.push({ entry: entry, fit: fit, reoffer: reoffer, reasons: reasons, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score || new Date(a.entry.created_at).getTime() - new Date(b.entry.created_at).getTime(); });
    return out;
  }

  var DAYPART = { any: 'cualquier horario', morning: 'por la mañana', afternoon: 'por la tarde' };

  // «Valoración · Centro · por la tarde · hasta 30 nov»
  function describe(entry, lookup) {
    lookup = lookup || {}; var bits = [];
    bits.push((lookup.service && lookup.service(entry.service_id)) || 'Servicio');
    bits.push(entry.branch_id ? ((lookup.branch && lookup.branch(entry.branch_id)) || 'Sucursal') : 'cualquier sucursal');
    if (entry.professional_id) bits.push((lookup.professional && lookup.professional(entry.professional_id)) || 'Profesional');
    bits.push(DAYPART[entry.daypart] || DAYPART.any);
    if (entry.not_after) bits.push('hasta ' + dayLabel(entry.not_after));
    return bits.join(' · ');
  }

  function dayLabel(day) {
    var m = String(day || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return '';
    var months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return Number(m[3]) + ' ' + months[Number(m[2]) - 1];
  }

  // «hace 3 días», «hoy», «hace 2 h»
  function waitingSince(entry, now) {
    var at = new Date(entry.created_at).getTime(), ref = now instanceof Date ? now.getTime() : Number(now || Date.now());
    if (!Number.isFinite(at)) return '';
    var hours = Math.max(0, Math.floor((ref - at) / 3600000));
    if (hours < 1) return 'hace un momento';
    if (hours < 24) return 'hace ' + hours + ' h';
    var days = Math.floor(hours / 24);
    return days === 1 ? 'hace 1 día' : 'hace ' + days + ' días';
  }

  // Mensaje para el paciente. `when` ya viene formateado (SmylVisitMessage.whenText) para no depender de otro módulo.
  function offerMessage(data) {
    data = data || {};
    var name = String(data.firstName || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 40);
    var place = [data.professional, data.branch].filter(Boolean).join(' · ');
    var lines = [(name ? 'Hola ' + name + ', ' : 'Hola, ') + 'se liberó un horario' + (data.service ? ' para ' + data.service : '') + ':', ''];
    if (data.when) lines.push(data.when);
    if (place) lines.push(place);
    lines.push('');
    lines.push('¿Te acomoda? Respóndeme «sí» y te lo aparto. Si no te sirve, sigues en nuestra lista de espera.');
    return lines.join('\n');
  }

  return { matches: matches, describe: describe, waitingSince: waitingSince, offerMessage: offerMessage, localParts: localParts, dayLabel: dayLabel, DEFAULTS: DEFAULTS };
});
