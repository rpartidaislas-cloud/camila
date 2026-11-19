// SMYL · Cuándo sale un mensaje automático de cita (confirmación o recordatorio).
// Lógica pura, sin red ni base de datos: la usan la Edge Function appointment-reminders y las pruebas de Node.
//
// Regla: los mensajes solo salen dentro de una ventana del día en la hora de la sucursal (por omisión 9:00–20:00),
// para no avisar de madrugada ni de noche.
//   · «later»   (confirmaciones): si cae fuera de la ventana, sale al abrir la siguiente.
//   · «nearest» (recordatorios «24 h antes»): si cae fuera, sale en el borde de ventana MÁS CERCANO a la hora ideal
//     (al cerrar la anterior o al abrir la siguiente), siempre que quede ahora o después y antes de la cita.
// Si nada de lo anterior cabe antes de que empiece la cita, se envía en cuanto se pueda (mejor tarde que nunca).

export const DEFAULT_WINDOW = Object.freeze({ start: '09:00', end: '20:00' });

export function parseHM(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value == null ? '' : value));
  const hours = match ? Number(match[1]) : NaN, minutes = match ? Number(match[2]) : NaN;
  if (!(hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59)) return fallback;
  return hours * 60 + minutes;
}

// Normaliza la ventana: si falta, es inválida o no deja al menos una hora, usa la de por omisión.
export function normalizeWindow(start, end) {
  const startMin = parseHM(start, parseHM(DEFAULT_WINDOW.start));
  const endMin = parseHM(end, parseHM(DEFAULT_WINDOW.end));
  if (endMin - startMin < 60) return { startMin: parseHM(DEFAULT_WINDOW.start), endMin: parseHM(DEFAULT_WINDOW.end) };
  return { startMin, endMin };
}

function zoneOrDefault(zone) {
  try { new Intl.DateTimeFormat('es-MX', { timeZone: zone }); return zone || 'America/Mexico_City'; } catch (_) { return 'America/Mexico_City'; }
}

// Año, mes, día y minutos desde medianoche de un instante, en la hora local de una zona.
export function localParts(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zoneOrDefault(zone), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), minutes: get('hour') * 60 + get('minute') };
}

// Instante en que el reloj de la zona marca año-mes-día y minutos dados (resuelve el desfase de la zona).
export function zonedInstant(year, month, day, minutes, zone) {
  const target = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(guess, zone);
    const shown = Date.UTC(local.year, local.month - 1, local.day, 0, local.minutes);
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function addDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function insideWindow(ms, zone, win) {
  const { minutes } = localParts(ms, zone);
  return minutes >= win.startMin && minutes <= win.endMin;
}

function windowOpenOnOrAfter(ms, zone, win) {
  const local = localParts(ms, zone);
  if (local.minutes < win.startMin) return zonedInstant(local.year, local.month, local.day, win.startMin, zone);
  if (local.minutes > win.endMin) { const next = addDays(local, 1); return zonedInstant(next.year, next.month, next.day, win.startMin, zone); }
  return ms;
}

function windowCloseOnOrBefore(ms, zone, win) {
  const local = localParts(ms, zone);
  if (local.minutes > win.endMin) return zonedInstant(local.year, local.month, local.day, win.endMin, zone);
  if (local.minutes < win.startMin) { const prev = addDays(local, -1); return zonedInstant(prev.year, prev.month, prev.day, win.endMin, zone); }
  return ms;
}

/**
 * @param {object} input
 * @param {number} input.dueMs       momento ideal de envío (confirmación: ahora; recordatorio: cita − 24 h)
 * @param {number} input.nowMs       ahora
 * @param {number} input.startsMs    inicio de la cita
 * @param {string} input.zone        zona horaria de la sucursal
 * @param {{startMin:number,endMin:number}} input.window
 * @param {'later'|'nearest'} input.mode
 * @param {number} [input.leadMs]    margen mínimo desde ahora (por omisión 2 min)
 * @param {number} [input.minNoticeMs] tiempo mínimo antes de la cita para que el aviso tenga sentido (por omisión 2 h)
 * @returns {{ sendAtMs:number, moved:boolean }}
 */
// (Un solo parámetro, sin desestructurar en la firma: el empaquetador del panel de Supabase anota los parámetros con tipos.)
export function sendAtWithinWindow(input) {
  const dueMs = input.dueMs, nowMs = input.nowMs, startsMs = input.startsMs, zone = input.zone, win = input.window, mode = input.mode;
  const leadMs = input.leadMs == null ? 2 * 60 * 1000 : input.leadMs;
  const minNoticeMs = input.minNoticeMs == null ? 2 * 60 * 60 * 1000 : input.minNoticeMs;
  const earliest = nowMs + leadMs;
  const desired = Math.max(dueMs, earliest);
  const deadline = startsMs - minNoticeMs;
  if (insideWindow(desired, zone, win)) return { sendAtMs: desired, moved: false };
  if (mode === 'nearest') {
    const before = windowCloseOnOrBefore(desired, zone, win);
    const after = windowOpenOnOrAfter(desired, zone, win);
    const beforeOk = before >= earliest, afterOk = after <= deadline;
    if (beforeOk && afterOk) { const pick = desired - before <= after - desired ? before : after; return { sendAtMs: pick, moved: true }; }
    if (beforeOk) return { sendAtMs: before, moved: true };
    if (afterOk) return { sendAtMs: after, moved: true };
    return { sendAtMs: desired, moved: false };
  }
  // Confirmaciones: al abrir la siguiente ventana, si aún queda tiempo antes de la cita.
  const after = windowOpenOnOrAfter(desired, zone, win);
  if (after <= deadline) return { sendAtMs: after, moved: after !== desired };
  // No cabe en ninguna ventana antes de la cita: sale ya.
  return { sendAtMs: desired, moved: false };
}
