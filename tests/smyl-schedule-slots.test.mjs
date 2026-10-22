import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const slots = createRequire(import.meta.url)('../smyl-schedule-slots.js');

const TZ = 'America/Mexico_City';
const base = {
  day: '2026-10-27', tz: TZ, duration: 45, before: 0, after: 15, step: 30, professionalId: 'p1', roomIds: ['r1'],
  now: new Date('2026-10-01T00:00:00Z'),
  clinic: [{ weekday: 2, starts_at: '09:00:00', ends_at: '18:00:00', active: true }],
  pro: [{ weekday: 2, starts_at: '09:00:00', ends_at: '17:00:00', active: true }]
};
const at = (day, minute) => slots.instant(day, minute, TZ);
const hours = list => list.map(item => slots.zoneParts(item.start, TZ).min / 60);

test('las horas libres respetan el horario de la clínica y el del profesional', () => {
  const list = slots.freeSlots(base);
  assert.equal(hours(list)[0], 9);
  // El profesional termina a las 17:00: la última cita de 45 min empieza a las 16:00 (16:30 ya no cabe).
  assert.equal(Math.max(...hours(list)), 16);
  assert.deepEqual(slots.freeSlots({ ...base, day: '2026-10-25' }), []); // domingo sin horario
  assert.deepEqual(slots.freeSlots({ ...base, professionalId: '' }), []);
  assert.deepEqual(slots.freeSlots({ ...base, duration: 0 }), []);
});

test('una cita existente ocupa también su preparación, igual que la validación de la base', () => {
  const existing = { id: 'x', status: 'confirmed', professional_id: 'p1', room_id: 'r1', start: at(base.day, 600), end: at(base.day, 645), before: 0, after: 15 };
  const list = hours(slots.freeSlots({ ...base, appointments: [existing] }));
  assert.ok(list.includes(9), '9:00 termina a las 9:45 y alcanza a dejar 15 min antes de las 10:00');
  assert.ok(!list.includes(9.5) && !list.includes(10) && !list.includes(10.5));
  assert.ok(list.includes(11), 'la cita termina a las 10:45 y su preparación a las 11:00');
  // Citas completadas, canceladas o que no vinieron no bloquean; la que se está cambiando tampoco.
  for (const status of ['completed', 'cancelled', 'no_show']) assert.ok(hours(slots.freeSlots({ ...base, appointments: [{ ...existing, status }] })).includes(10), status);
  assert.ok(hours(slots.freeSlots({ ...base, appointments: [existing], excludeId: 'x' })).includes(10));
});

test('sillón, bloqueos y apartados quitan los horarios que chocan', () => {
  const other = { id: 'y', status: 'arrived', professional_id: 'p2', room_id: 'r1', start: at(base.day, 780), end: at(base.day, 825), before: 0, after: 0 };
  assert.ok(!hours(slots.freeSlots({ ...base, appointments: [other] })).includes(13), 'otro doctor ocupa el mismo sillón');
  assert.ok(hours(slots.freeSlots({ ...base, roomIds: ['r1', 'r2'], appointments: [other] })).includes(13), 'con otro sillón libre sí se puede');
  const withRoom = slots.freeSlots({ ...base, roomIds: ['r1', 'r2'], appointments: [other] }).find(item => slots.zoneParts(item.start, TZ).min === 780);
  assert.equal(withRoom.roomId, 'r2');
  const block = { professional_id: 'p1', room_id: null, start: at(base.day, 840), end: at(base.day, 900) };
  assert.ok(!hours(slots.freeSlots({ ...base, blocks: [block] })).includes(14.5));
  const hold = { professional_id: 'p1', room_id: null, start: at(base.day, 960), end: at(base.day, 1005), before: 0, after: 0 };
  assert.ok(!hours(slots.freeSlots({ ...base, holds: [hold] })).includes(16));
  // Sin sillones en la sucursal no se pide uno.
  assert.ok(slots.freeSlots({ ...base, roomIds: [] }).length > 0);
});

test('no se ofrecen horas que ya pasaron y se respeta la zona de la sucursal', () => {
  const now = at(base.day, 12 * 60);
  const list = hours(slots.freeSlots({ ...base, now }));
  assert.ok(list.every(h => h >= 12));
  // 9:00 en Ciudad de México y en Tijuana son instantes distintos.
  const mx = at('2026-07-15', 540), tj = slots.instant('2026-07-15', 540, 'America/Tijuana');
  assert.equal(tj.getTime() - mx.getTime(), 60 * 60000);
  assert.deepEqual(slots.zoneParts(mx, TZ), { y: 2026, m: 7, d: 15, min: 540 });
});

test('Nueva cita ofrece días y horas libres y deja la validación final al servidor', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /function renderSlots\(form,appointment\)/);
  assert.match(schedule, /renderBookingCheck\(form,appointment\);renderSlots\(form,appointment\);/);
  assert.match(schedule, /from\('smyl_appointments'\)\.select\('id,professional_id,room_id,service_id,status,starts_at,ends_at'\)/);
  assert.match(schedule, /from\('smyl_appointment_requests'\)/);
  assert.match(schedule, /el sistema la revisa al confirmar/);
  assert.match(schedule, /rpc\('smyl_create_appointment'/);
  assert.doesNotMatch(schedule, /from\('smyl_appointments'\)\.insert/);
  assert.match(schedule, /data-slots aria-live="polite"/);
  assert.match(read('smyl-schedule.css'), /\.schedule-slot-time\[aria-pressed=true\]/);
});

test('las horas libres se distribuyen igual en web, móvil y PWA', () => {
  for (const file of ['smyl-schedule-slots.js', 'smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-schedule-slots\.js\?v=1/);
  assert.match(read('sw.js'), /\/camila\/smyl-schedule-slots\.js\?v=1/);
});
