import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const board = createRequire(import.meta.url)('../smyl-schedule-board.js');

const branches = [{ id: 'c', name: 'Sucursal Centro', timezone: 'America/Mexico_City' }, { id: 'p', name: 'Sucursal Plaza Sol', timezone: 'America/Mexico_City' }];
const H = (pro, br, days, a, z) => days.map((w) => ({ professional_id: pro, branch_id: br, weekday: w, starts_at: a, ends_at: z, active: true }));
const hours = [...H('f', 'p', [2, 4], '12:00', '20:00'), ...H('f', 'p', [6], '10:00', '15:00'), ...H('f', 'c', [5], '15:00', '19:00'), ...H('v', 'c', [1, 3, 5], '09:00', '14:00'), ...H('v', 'p', [2, 4], '10:00', '16:00')];
const clinic = [
  ...[1, 2, 3, 4, 5].flatMap((w) => [{ branch_id: 'c', weekday: w, starts_at: '09:00', ends_at: '14:00' }, { branch_id: 'c', weekday: w, starts_at: '15:00', ends_at: '19:00' }, { branch_id: 'p', weekday: w, starts_at: '10:00', ends_at: '20:00' }]),
  { branch_id: 'c', weekday: 6, starts_at: '09:00', ends_at: '14:00' }, { branch_id: 'p', weekday: 6, starts_at: '10:00', ends_at: '15:00' }];
const pros = [{ id: 'f', display_name: 'Dra. Fernanda Lozano Vera' }, { id: 'v', display_name: 'Dra. Valeria Montoya Cruz' }];
const rooms = [{ id: 'r1', branch_id: 'p', active: true }, { id: 'r2', branch_id: 'c', active: true }, { id: 'r3', branch_id: 'c', active: true }];
// lunes 7 a domingo 13 de diciembre de 2026
const keys = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];
const svc = { duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0 };
const now = new Date('2026-12-01T00:00:00Z');
const run = (extra = {}) => board.compute({ service: svc, extra: 0, dayKeys: keys, professionals: pros, branches, hours, clinicHours: clinic, rooms, busy: { appointments: [], blocks: [], holds: [] }, now, ...extra });
const names = (res, key, pid, br) => ((res[key].find((e) => e.professionalId === pid && e.branchId === br) || { slots: [] }).slots).map((s) => new Date(s.start).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }));

test('cada dentista solo aparece los días y en las sucursales donde atiende', () => {
  const res = run();
  assert.deepEqual(res['2026-12-11'].map((e) => e.professionalId + '@' + e.branchId).sort(), ['f@c', 'v@c'], 'el viernes Fernanda está en Centro, no en Plaza Sol');
  assert.deepEqual(res['2026-12-08'].map((e) => e.professionalId + '@' + e.branchId).sort(), ['f@p', 'v@p']);
  assert.equal(res['2026-12-13'].length, 0, 'el domingo nadie atiende');
  assert.equal(board.countFor(res, '2026-12-11', { professionalId: 'f', branchId: 'p' }), 0);
  assert.ok(board.countFor(res, '2026-12-11', { professionalId: 'f', branchId: 'c' }) > 0);
});

test('el sillón único de Plaza Sol bloquea a la segunda dentista aunque esté libre', () => {
  const cita = [{ id: 'a', status: 'confirmed', professional_id: 'v', room_id: 'r1', start: new Date('2026-12-08T18:00:00Z'), end: new Date('2026-12-08T19:00:00Z'), before: 0, after: 0 }]; // martes 12:00–13:00
  const sin = names(run(), '2026-12-08', 'f', 'p'), con = names(run({ busy: { appointments: cita, blocks: [], holds: [] } }), '2026-12-08', 'f', 'p');
  assert.ok(sin.includes('12:00') && sin.includes('12:30'));
  assert.ok(!con.includes('12:00') && !con.includes('12:30') && con.includes('13:00'), 'con la cita de Valeria, Fernanda no ofrece 12:00 ni 12:30: ' + con.slice(0, 4));
});

test('un dentista no puede estar en dos sucursales a la vez', () => {
  const enPlazaSol = [{ id: 'b', status: 'confirmed', professional_id: 'f', room_id: 'r1', start: new Date('2026-12-11T21:00:00Z'), end: new Date('2026-12-11T22:00:00Z'), before: 0, after: 0 }]; // viernes 3:00 pm
  const con = names(run({ busy: { appointments: enPlazaSol, blocks: [], holds: [] } }), '2026-12-11', 'f', 'c');
  assert.ok(!con.includes('15:00') && con.includes('16:00'), 'la cita en otra sucursal también la ocupa: ' + con.slice(0, 3));
});

test('el tiempo extra alarga la cita y la hora de comida no se cruza', () => {
  const normal = names(run(), '2026-12-07', 'v', 'c'), conExtra = names(run({ extra: 60 }), '2026-12-07', 'v', 'c');
  assert.ok(normal.includes('13:00') && !conExtra.includes('13:00'), 'una hora más ya no cabe antes de las 2:00 pm');
  assert.ok(!normal.some((h) => h > '13:00' && h < '15:00'), 'Centro cierra de 14:00 a 15:00');
});

test('la explicación dice por qué no hay horarios y qué hacer', () => {
  const res = run(), base = { dayKeys: keys, result: res, professionals: pros, branches, hours, clinicHours: clinic };
  const viernes = board.explain({ ...base, dayKey: '2026-12-11', filter: { professionalId: 'f', branchId: 'p' } });
  assert.match(viernes.title, /Dra\. Fernanda Lozano Vera no atiende en Sucursal Plaza Sol el viernes/);
  assert.match(viernes.text, /Sucursal Centro de 3:00 pm a 7:00 pm/);
  assert.deepEqual(viernes.actions.map((a) => a.type), ['branch', 'all', 'day']);
  assert.equal(viernes.actions[0].branchId, 'c');
  assert.equal(viernes.actions[2].key, '2026-12-12');
  const domingo = board.explain({ ...base, dayKey: '2026-12-13', filter: { professionalId: 'f' } });
  assert.match(domingo.title, /no atiende los domingos/);
  assert.match(domingo.text, /Plaza Sol mar jue sáb/);
  const miercoles = board.explain({ ...base, dayKey: '2026-12-09', filter: { branchId: 'p' } });
  assert.match(miercoles.title, /En Sucursal Plaza Sol nadie que haga este tratamiento/);
  const sinClinica = board.explain({ ...base, clinicHours: clinic.filter((h) => !(h.branch_id === 'p' && h.weekday === 2)), dayKey: '2026-12-08', filter: { professionalId: 'f' }, result: { ...res, '2026-12-08': [{ professionalId: 'f', branchId: 'p', slots: [] }] } });
  assert.match(sinClinica.title, /no tiene horario de la sucursal/, 'si falta el horario de la sucursal lo dice, en vez de «ocupado»');
});

test('el menú del dentista enseña dónde y cuándo atiende', () => {
  assert.equal(board.scheduleLabel(pros[0], hours, branches), 'Dra. Fernanda Lozano Vera — Plaza Sol mar jue sáb · Centro vie');
  assert.equal(board.scheduleLabel({ id: 'x', display_name: 'Dr. Nuevo' }, hours, branches), 'Dr. Nuevo — sin horario configurado');
  assert.equal(board.daysShort([1, 2, 3, 4, 5]), 'lun a vie');
  assert.equal(board.daysShort([6, 0, 2]), 'mar sáb dom');
});

test('Nueva cita usa el tablero, sin cambiar cómo se guarda ni lo demás', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /boardMode=!appointment&&!request&&!walkIn&&!!window\.SmylScheduleBoard/, 'solo Nueva cita; reagendar, solicitudes y «Llegó sin cita» quedan como antes');
  assert.match(schedule, /rpc\('smyl_create_appointment'/);
  assert.doesNotMatch(schedule, /from\('smyl_appointments'\)\.insert/);
  assert.match(schedule, /Elige una hora disponible de la lista/);
  // Un dentista no puede estar en dos sitios a la vez: las citas se cargan de TODAS las sucursales.
  const range = schedule.slice(schedule.indexOf('async function rangeBusy'), schedule.indexOf('function renderBoard'));
  assert.doesNotMatch(range, /eq\('branch_id'/);
  assert.match(read('smyl-schedule-board.js'), /api\.pick\(/);
  assert.doesNotMatch(read('smyl-schedule-board.js'), /\.from\('|\.rpc\(|fetch\(|XMLHttpRequest/, 'el tablero no consulta ni escribe datos por su cuenta');
});

test('web, PWA y móvil publican el tablero', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule-board\.js\?v=3/);
    assert.match(read(file), /smyl-schedule\.js\?v=60/);
    assert.match(read(file), /smyl-schedule\.css\?v=37/);
  }
  assert.ok(read('app.html').indexOf('smyl-schedule-slots.js') < read('app.html').indexOf('smyl-schedule-board.js') && read('app.html').indexOf('smyl-schedule-board.js') < read('app.html').indexOf('smyl-schedule.js?'), 'el tablero se carga después de las horas libres y antes de la Agenda');
  for (const file of ['smyl-schedule-board.js', 'smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
});
