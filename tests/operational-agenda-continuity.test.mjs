import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-schedule.js');
const styles = read('../smyl-schedule.css');
const worker = read('../sw.js');

test('agenda surfaces one operational priority queue without taking the final decision', () => {
  assert.match(script, /QUÉ REQUIERE ATENCIÓN/);
  assert.match(script, /el equipo conserva la decisión final/);
  assert.match(script, /Estado pendiente/);
  assert.match(script, /Solicitud del asistente/);
  assert.match(script, /Recordatorio fallido/);
  assert.match(script, /Seguimiento pendiente/);
  assert.doesNotMatch(script, /from\('smyl_appointment_requests'\)\.insert/);
});

test('operational context connects appointments with reminders, patient record and follow-up', () => {
  assert.match(script, /from\('smyl_appointment_reminders'\)/);
  assert.match(script, /Abrir ficha/);
  assert.match(script, /Continuar en Mensajes/);
  assert.match(script, /window\.verPaciente\(a\.patient_id\)/);
  assert.match(script, /window\.ir\('inbox'\)/);
});

test('agenda stage two ships responsive and cache-safe on web and mobile', () => {
  assert.match(styles, /\.schedule-focus/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(app, /smyl-schedule\.css\?v=5/);
  assert.match(app, /smyl-schedule\.js\?v=10/);
  assert.match(worker, /smyl-v252-visual-policy-v2/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-schedule.js'));
  assert.equal(styles, read('../mobile/www/smyl-schedule.css'));
});
