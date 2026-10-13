import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const inbox = read('../smyl-inbox.js');
const styles = read('../smyl-inbox.css');
const worker = read('../sw.js');

test('Mensajes prioritizes the conversations that need the dental team', () => {
  assert.match(inbox, /CENTRO DE ATENCIÓN DENTAL/);
  assert.match(inbox, /requieren.*al equipo ahora/);
  assert.match(inbox, /Boolean\(a\.needs_human\).*Boolean\(b\.needs_human\)/);
  assert.match(inbox, /Boolean\(a\.unread_count\).*Boolean\(b\.unread_count\)/);
  assert.match(styles, /smyl-inbox-queue-summary/);
  assert.match(styles, /data-priority=human/);
});

test('each thread exposes a clear next action and patient continuity', () => {
  assert.match(inbox, /SIGUIENTE ACCIÓN/);
  assert.match(inbox, /Responder y resolver la solicitud/);
  assert.match(inbox, /Abrir expediente/);
  assert.match(inbox, /Vincular paciente/);
  assert.match(inbox, /Ver Agenda/);
  assert.match(inbox, /Paciente y atención/);
  assert.match(inbox, /Expediente vinculado/);
});

test('reply tools are understandable and preserve human review', () => {
  for (const label of ['Sugerir con Copilot', 'Plantilla', 'Programar', 'Adjuntar', 'Ubicación']) assert.match(inbox, new RegExp(label));
  assert.match(inbox, /el equipo siempre revisa y decide el envío/);
  assert.match(styles, /smyl-inbox-message-row/);
  assert.doesNotMatch(inbox, /localStorage|sessionStorage/);
});

test('web, mobile and offline bundles ship the same inbox stage', () => {
  assert.match(app, /smyl-inbox\.css\?v=6/);
  assert.match(app, /smyl-inbox\.js\?v=8/);
  assert.match(worker, /smyl-v192-action-center-gmail/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(inbox, read('../mobile/www/smyl-inbox.js'));
  assert.equal(styles, read('../mobile/www/smyl-inbox.css'));
});
