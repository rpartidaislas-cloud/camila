import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const schedule = read('../smyl-schedule.js');
const styles = read('../smyl-schedule.css');

test('la agenda comunica tiempo, profesional y consultorio como recursos clínicos', () => {
  assert.match(schedule, /fmtRange\(a\)/);
  assert.match(schedule, /durationLabel\(a,s\)/);
  assert.match(schedule, /Consultorio o sillón/);
  assert.match(schedule, /Todos los consultorios/);
  assert.match(schedule, /Espacio por asignar/);
});

test('la reserva guía al equipo sin sustituir la validación del servidor', () => {
  assert.match(schedule, /CONTROL DE RESERVA/);
  assert.match(schedule, /El profesional no tiene este servicio asignado/);
  assert.match(schedule, /El profesional no está asignado a esta sucursal/);
  assert.match(schedule, /appointment\|\|request\?'disabled'/);
  assert.match(schedule, /SMYL valida nuevamente horarios, tiempos de preparación, profesional, sillón, bloqueos y apartados temporales/);
  assert.match(schedule, /rpc\('smyl_create_appointment'/);
  assert.doesNotMatch(schedule, /from\('smyl_appointments'\)\.insert/);
});

test('el detalle presenta recordatorios y estados operativos verificables', () => {
  assert.match(schedule, /RECORDATORIOS/);
  assert.match(schedule, /Requiere atención/);
  assert.match(schedule, /duration_minutes/);
  assert.match(schedule, /smyl_appointment_reminders/);
  assert.match(styles, /\.schedule-reminder-status/);
  assert.match(styles, /\.schedule-booking-check/);
});

test('web, móvil y PWA publican la etapa cuatro sincronizada', () => {
  assert.match(app, /smyl-schedule\.css\?v=(?:[6-9]|1[0-9])/);
  assert.match(app, /smyl-schedule\.js\?v=(?:1[1-9]|[2-9][0-9])/);
  assert.match(worker, /smyl-v254-visible-shell-v4/);
  for (const file of ['app.html', 'sw.js', 'smyl-schedule.js', 'smyl-schedule.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
