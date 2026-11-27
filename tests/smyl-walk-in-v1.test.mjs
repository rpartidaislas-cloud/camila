import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const schedule = read('smyl-schedule.js');
const finance = read('smyl-finance.js');

test('«Llegó sin cita» crea una cita para ahora y la marca como «Ya llegó» con las RPC y reglas existentes', () => {
  assert.match(schedule, /function openNew\(request,patientId,preferredStart,preferredProfessional,opts\)\{var walkIn=Boolean\(opts&&opts\.walkIn\);/);
  assert.match(schedule, /var start=walkIn\?new Date\(\)/, 'la hora es «ahora», sin redondear a 15 minutos');
  assert.match(schedule, /if\(!walkIn\)q\.setMinutes\(Math\.round/);
  assert.match(schedule, /p_notes:walkIn\?\('Llegó sin cita'/);
  assert.match(schedule, /if\(walkIn\)\{var made=await query\(window\.sb\.from\('smyl_appointments'\)[\s\S]*?await transition\(made\[0\],'arrived'\)/);
  assert.match(schedule, /step="'\+\(walkIn\?'60':'900'\)\+'"/, 'la hora de ahora no choca con el paso de 15 minutos');
  assert.match(schedule, /Registrar llegada/);
  assert.doesNotMatch(schedule, /smyl_create_walk_in|p_source:'walk_in'/, 'no se inventan RPC ni orígenes: no hay migración');
});

test('«Llegó sin cita» vive sólo en Agenda y no se mezcla con las acciones de Finanzas', () => {
  assert.match(schedule, /id="schedule-walkin">Llegó sin cita/);
  assert.match(schedule, /getElementById\('schedule-walkin'\)\.hidden=!state\.canManage/);
  assert.match(schedule, /openWalkIn:function\(opts\)\{[\s\S]*?window\.ir\('agenda'\)[\s\S]*?returnTo:opts&&opts\.returnTo/);
  assert.doesNotMatch(finance, /id="finance-walk-in"|openWalkIn\(\{returnTo:'caja'/);
  assert.match(finance, /function renderFinanceActions\(\)/);
});

test('en «Citas atendidas sin cobrar» la persona sin cita lo dice en su fila', () => {
  assert.match(finance, /select\('id,patient_id,service_id,branch_id,starts_at,status,notes'\)/);
  assert.match(finance, /if\(String\(a\.notes\|\|''\)\.indexOf\('Llegó sin cita'\)===0\)sub\.push\('llegó sin cita'\);/);
  assert.match(read('smyl-schedule.css'), /#schedule-appointment-form\[data-walk-in\] :is\(\[data-slots\],\[data-custom-time\]\)\{display:none!important\}/);
});

test('web y móvil publican la misma versión', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'smyl-finance.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), file);
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=68/);
    assert.match(read(file), /smyl-schedule\.css\?v=40/);
    assert.match(read(file), /smyl-finance\.js\?v=85/);
  }
});
