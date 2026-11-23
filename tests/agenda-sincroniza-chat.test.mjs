import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const schedule = read('smyl-schedule.js');
const inbox = read('smyl-inbox.js');

test('el chat avisa a la Agenda cada vez que crea o confirma una cita', () => {
  assert.match(inbox, /function announceAppointmentsChanged\(\) \{\s+try \{ window\.dispatchEvent\(new CustomEvent\('smyl:appointments-changed', \{ detail: \{ source: 'inbox' \} \}\)\)/);
  // agendar directo desde el calendario del chat
  assert.match(inbox, /action: 'appointment_confirm', conversation_id: state\.selectedId, request_id: created\.request_id \}, uuid\(\)\);\s+announceAppointmentsChanged\(\);/);
  // confirmar una solicitud pendiente
  assert.match(inbox, /requestRow\.appointment_id = data\.appointment_id;\s+announceAppointmentsChanged\(\);/);
});

test('la Agenda se marca como vieja con ese aviso y se vuelve a leer, sin reaccionar a sus propios avisos', () => {
  assert.match(schedule, /window\.addEventListener\('smyl:appointments-changed',function\(event\)\{var detail=event&&event\.detail;if\(!detail\|\|detail\.source==='agenda'\)return;state\.loaded=false;state\.reuseStatic=true;/);
  assert.match(schedule, /page&&page\.offsetParent!==null&&!state\.loading\)load\(true\)/);
  // el aviso propio de la Agenda no lleva detalle: se ignora (si no, recargaría dos veces)
  assert.match(schedule, /window\.dispatchEvent\(new CustomEvent\('smyl:appointments-changed'\)\)/);
});

test('al abrir la Agenda se comprueba al momento si hay citas más nuevas, sin esperar el sondeo de 45 s', () => {
  assert.match(schedule, /if\(route==='agenda'\)\{if\(state\.loaded\)loadBilling\(\);load\(false\);setTimeout\(checkRemoteChanges,0\);\}/);
  assert.match(schedule, /setInterval\(checkRemoteChanges,45000\)/);
});

test('web y móvil entregan lo mismo', () => {
  for (const file of ['smyl-schedule.js', 'smyl-inbox.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
