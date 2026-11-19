import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWindow, localParts, zonedInstant, sendAtWithinWindow, insideWindow } from '../supabase/functions/_shared/reminder-schedule.mjs';

const ZONE = 'America/Mexico_City';           // UTC−6 todo el año
const WIN = normalizeWindow('09:00', '20:00');
const at = (y, m, d, hh, mm = 0) => zonedInstant(y, m, d, hh * 60 + mm, ZONE);
const show = (ms) => { const p = localParts(ms, ZONE); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`; };
const HOUR = 3600e3;

test('la ventana inválida o demasiado corta vuelve a 9:00–20:00', () => {
  assert.deepEqual(normalizeWindow('9:30', '18:00'), { startMin: 570, endMin: 1080 });
  assert.deepEqual(normalizeWindow('20:00', '09:00'), { startMin: 540, endMin: 1200 });
  assert.deepEqual(normalizeWindow('10:00', '10:30'), { startMin: 540, endMin: 1200 });
  assert.deepEqual(normalizeWindow(null, undefined), { startMin: 540, endMin: 1200 });
  assert.deepEqual(normalizeWindow('25:00', '18:00'), { startMin: 540, endMin: 1080 });
});

test('zonedInstant y localParts son inversos en la zona de la sucursal', () => {
  const ms = at(2026, 11, 20, 9, 30);
  assert.equal(show(ms), '2026-11-20 09:30');
  assert.equal(new Date(ms).toISOString(), '2026-11-20T15:30:00.000Z');
});

test('dentro de la ventana el envío no se mueve', () => {
  const now = at(2026, 11, 19, 11), starts = at(2026, 11, 25, 10);
  const r = sendAtWithinWindow({ dueMs: now, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'later' });
  assert.equal(r.moved, false);
  assert.equal(r.sendAtMs, now + 2 * 60e3);
});

test('confirmación a las 22:30 sale al abrir la ventana del día siguiente (9:00)', () => {
  const now = at(2026, 11, 19, 22, 30), starts = at(2026, 11, 25, 10);
  const r = sendAtWithinWindow({ dueMs: now, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'later' });
  assert.equal(show(r.sendAtMs), '2026-11-20 09:00');
  assert.equal(r.moved, true);
});

test('confirmación de madrugada (3:00) sale ese mismo día a las 9:00', () => {
  const now = at(2026, 11, 19, 3), starts = at(2026, 11, 25, 10);
  assert.equal(show(sendAtWithinWindow({ dueMs: now, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'later' }).sendAtMs), '2026-11-19 09:00');
});

test('recordatorio «24 h antes» que cae a las 7:30 sale a las 9:00 (el borde más cercano), no 35 horas antes', () => {
  const starts = at(2026, 11, 25, 7, 30), now = at(2026, 11, 20, 12);
  const r = sendAtWithinWindow({ dueMs: starts - 24 * HOUR, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'nearest' });
  assert.equal(show(r.sendAtMs), '2026-11-24 09:00');
});

test('recordatorio que cae a las 22:00 sale a las 20:00 del mismo día', () => {
  const starts = at(2026, 11, 26, 22), now = at(2026, 11, 20, 12);
  const r = sendAtWithinWindow({ dueMs: starts - 24 * HOUR, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'nearest' });
  assert.equal(show(r.sendAtMs), '2026-11-25 20:00');
});

test('si no cabe ninguna ventana antes de la cita, el recordatorio sale en cuanto se pueda', () => {
  // cita mañana 07:30; «24 h antes» ya pasó (hoy 07:30) y ahora son las 21:00 → no hay ventana antes → mañana 9:00 es tarde (cita 7:30): sale ya
  const now = at(2026, 11, 19, 21), starts = at(2026, 11, 20, 7, 30);
  const r = sendAtWithinWindow({ dueMs: starts - 24 * HOUR, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'nearest' });
  assert.equal(r.sendAtMs, now + 2 * 60e3);
  assert.equal(r.moved, false);
});

test('cita pasado mañana a las 15:00, ahora 23:00: el recordatorio sale mañana a las 9:00', () => {
  const now = at(2026, 11, 19, 23), starts = at(2026, 11, 21, 15);
  const r = sendAtWithinWindow({ dueMs: starts - 24 * HOUR, nowMs: now, startsMs: starts, zone: ZONE, window: WIN, mode: 'nearest' });
  // 24 h antes = mañana 15:00, que ya está dentro de la ventana
  assert.equal(show(r.sendAtMs), '2026-11-20 15:00');
});

test('insideWindow incluye los bordes', () => {
  assert.equal(insideWindow(at(2026, 11, 19, 9), ZONE, WIN), true);
  assert.equal(insideWindow(at(2026, 11, 19, 20), ZONE, WIN), true);
  assert.equal(insideWindow(at(2026, 11, 19, 20, 1), ZONE, WIN), false);
  assert.equal(insideWindow(at(2026, 11, 19, 8, 59), ZONE, WIN), false);
});

test('otra zona horaria de sucursal usa su propio reloj', () => {
  const tijuana = 'America/Tijuana'; // UTC−8 en noviembre
  const now = Date.UTC(2026, 10, 19, 5, 0); // 21:00 en Tijuana
  const starts = Date.UTC(2026, 10, 25, 18, 0);
  const r = sendAtWithinWindow({ dueMs: now, nowMs: now, startsMs: starts, zone: tijuana, window: WIN, mode: 'later' });
  const p = localParts(r.sendAtMs, tijuana);
  assert.equal(p.minutes, 540);
});
