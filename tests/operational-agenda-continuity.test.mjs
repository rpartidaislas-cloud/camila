import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-schedule.js');
const styles = read('../smyl-schedule.css');
const worker = read('../sw.js');

test('agenda surfaces one operational priority queue without taking the final decision', () => {
  assert.match(script, /PENDIENTES DE HOY/);
  assert.match(script, /if\(!pending\)\{host\.hidden=true/);
  assert.match(script, /¿Ya llegó\?/);
  assert.match(script, /Pidió cita/);
  assert.match(script, /Aviso sin enviar/);
  assert.match(script, /No vino/);
  assert.doesNotMatch(script, /from\('smyl_appointment_requests'\)\.insert/);
});

test('operational context connects appointments with reminders, patient record and follow-up', () => {
  assert.match(script, /from\('smyl_appointment_reminders'\)/);
  assert.match(script, /Ficha del paciente/);
  assert.match(script, /data-open-inbox>Abrir chat/);
  assert.match(script, /window\.verPaciente\(a\.patient_id\)/);
  assert.match(script, /window\.ir\('inbox'\)/);
});

test('agenda stage two ships responsive and cache-safe on web and mobile', () => {
  assert.match(styles, /\.schedule-focus/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(app, /smyl-schedule\.css\?v=(?:[6-9]|1[0-9])/);
  assert.match(app, /smyl-schedule\.js\?v=(?:1[1-9]|[2-9][0-9])/);
  assert.match(worker, /smyl-v260-usage-history/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-schedule.js'));
  assert.equal(styles, read('../mobile/www/smyl-schedule.css'));
});
