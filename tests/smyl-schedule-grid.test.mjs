import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const grid = createRequire(import.meta.url)('../smyl-schedule-grid.js');

test('el rango de horas cubre el horario abierto y lo que quede fuera de él', () => {
  assert.deepEqual({ ...grid.bounds([[540, 1080]], []) }, { start: 540, end: 1080 });
  assert.deepEqual({ ...grid.bounds([[540, 1080]], [[480, 520], [1100, 1140]]) }, { start: 480, end: 1140 });
  assert.deepEqual({ ...grid.bounds([], []) }, { start: 480, end: 1200 });
  // Un horario muy corto no deja una cuadrícula diminuta.
  const short = grid.bounds([[600, 610]], []);
  assert.equal(short.end - short.start, 240);
  assert.deepEqual({ ...grid.bounds([[1380, 1440]], []) }, { start: 1200, end: 1440 });
  assert.equal(grid.toMinutes('09:30:00'), 570);
  assert.ok(Number.isNaN(grid.toMinutes('')));
});

test('las citas encimadas se reparten en columnas y las que no se tocan usan todo el ancho', () => {
  const placed = grid.lanes([
    { id: 'a', start: 540, end: 600 }, { id: 'b', start: 560, end: 620 },
    { id: 'c', start: 600, end: 660 }, { id: 'd', start: 700, end: 760 }
  ]);
  const by = Object.fromEntries(placed.map(item => [item.id, [item.lane, item.lanes]]));
  assert.deepEqual(by, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  assert.deepEqual(grid.lanes([]), []);
  // Tres a la vez necesitan tres carriles; una cita de duración cero no desaparece.
  const three = grid.lanes([{ id: 'x', start: 600, end: 660 }, { id: 'y', start: 600, end: 660 }, { id: 'z', start: 610, end: 610 }]);
  assert.equal(Math.max(...three.map(item => item.lanes)), 3);
  assert.equal(three.length, 3);
});

test('el clic en un hueco se ajusta a 15 minutos dentro del horario visible', () => {
  assert.equal(grid.slotAt(0, 1.4, 540, 1080), 540);
  assert.equal(grid.slotAt(100, 1.4, 540, 1080), 600);
  assert.equal(grid.slotAt(-30, 1.4, 540, 1080), 540);
  assert.equal(grid.slotAt(99999, 1.4, 540, 1080), 1065);
  assert.equal(grid.size(30), 's');
  assert.equal(grid.size(60), 'm');
  assert.equal(grid.size(120), 'l');
});

test('la semana usa la cuadrícula y conserva la vista de tarjetas como respaldo', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /function renderWeekGrid\(host,days,apps,blocks\)/);
  assert.match(schedule, /function renderWeekCards\(host,days,apps,blocks\)/);
  assert.match(schedule, /if\(window\.SmylScheduleGrid\)renderWeekGrid/);
  assert.match(schedule, /if\(!apps\.length&&!blocks\.length\)\{emptyWeek\(host,days\);return;\}/);
  assert.match(schedule, /openNew\(null,null,x\.date,prof\)/);
  assert.match(schedule, /matchMedia\('\(max-width:700px\)'\)\.matches\)state\.view='day'/);
  assert.match(schedule, /setInterval\(placeNow,60000\)/);
  // El fondo de las líneas horarias (84px = 60 min × 1.4) debe seguir a la escala del JS.
  assert.match(schedule, /var WK_PX=1\.4;/);
  assert.match(read('smyl-schedule.css'), /calc\(84px - 1px\)/);
});

test('la cuadrícula se distribuye igual en web, móvil y PWA', () => {
  for (const file of ['smyl-schedule-grid.js', 'smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-schedule-grid\.js\?v=1/);
  assert.match(read('sw.js'), /\/camila\/smyl-schedule-grid\.js\?v=1/);
});
