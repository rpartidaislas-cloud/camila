import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const schedule = read('../smyl-schedule.js');
const app = read('../app.html');
const migration = read('../supabase/migrations/20261115090000_smyl_patient_pending_registration.sql');
const workflow = read('../.github/workflows/smyl-paciente-por-registrar-migracion.yml');

test('la migración es aditiva: columna con valor por omisión y restricción de dos estados', () => {
  assert.match(migration, /add column if not exists registro_estado text not null default 'completo'/);
  assert.match(migration, /check \(registro_estado in \('completo','pendiente'\)\)/);
  assert.doesNotMatch(migration, /drop |delete from|policy|grant /i);
});

test('el workflow se dispara a mano y verifica la columna', () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /column: 'registro_estado'/);
});

test('agendar a alguien nuevo exige teléfono, no nombre', () => {
  assert.match(schedule, /if\(!nombre&&!tel\)\{fail\('Escribe el teléfono/);
  assert.match(schedule, /var pending=!nombre;if\(pending\)\{nombre=pendingName\(tel\);apellido='';\}/);
  assert.match(schedule, /if\(pending\)fields\.registro_estado='pendiente'/);
});

test('si la migración aún no está aplicada, el alta reintenta sin la columna', () => {
  assert.match(schedule, /catch\(first\)\{if\(!pending\|\|!\/registro_estado\|schema cache\|42703\|PGRST204\//);
  assert.match(schedule, /delete fields\.registro_estado/);
});

test('la agenda marca a la persona como por registrar en lista y semana', () => {
  assert.equal(schedule.split('schedule-pending-chip').length - 1, 2);
});

test('completar el registro exige un nombre real y marca el estado como completo', () => {
  assert.match(app, /nombre\.indexOf\('Por registrar · '\) === 0\) \{ alert\(/);
  assert.match(app, /registro_estado === 'pendiente'\) datos\.registro_estado = 'completo'/);
});

test('copias móviles idénticas', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js'])
    assert.equal(read('../' + file), read('../mobile/www/' + file), file);
});
