import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const schedule = read('../smyl-schedule.js');
const css = read('../smyl-schedule.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('la agenda ofrece mes, semana, día por profesional y lista operativa', () => {
  for (const view of ['month', 'week', 'day', 'agenda']) assert.match(schedule, new RegExp(`data-schedule-view="${view}"`));
  assert.match(schedule, /function renderMonth/);
  assert.match(schedule, /function renderDayTimeline/);
  assert.match(schedule, /function renderAgenda/);
  assert.match(schedule, /Próximos 14 días/);
  assert.match(css, /schedule-month-grid/);
  assert.match(css, /schedule-resource-lane/);
  assert.match(css, /schedule-agenda-row/);
  assert.match(read('./fixtures/smyl-schedule-multiview-stage5-preview.html'), /smyl-schedule\.js/);
});

test('seleccionar un horario prepara la cita sin saltarse la validación canónica', () => {
  assert.match(schedule, /data-book-slot/);
  assert.match(schedule, /openNew\(null,null,start,b\.dataset\.professional/);
  assert.match(schedule, /smyl_create_appointment/);
  assert.match(schedule, /CONTROL DE RESERVA/);
  assert.match(schedule, /vuelve a validar disponibilidad, horario y traslapes/);
  assert.doesNotMatch(schedule, /from\('smyl_appointments'\)\.insert/);
});

test('la nueva agenda mantiene paridad web, móvil y PWA', () => {
  assert.match(app, /smyl-schedule\.js\?v=8/);
  assert.match(app, /smyl-schedule\.css\?v=4/);
  assert.match(worker, /smyl-v227-schedule-multiview/);
  assert.equal(schedule, read('../mobile/www/smyl-schedule.js'));
  assert.equal(css, read('../mobile/www/smyl-schedule.css'));
  assert.equal(app, read('../mobile/www/app.html'));
});
