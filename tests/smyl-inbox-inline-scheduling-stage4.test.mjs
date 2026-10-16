import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');

test('todos los accesos para agendar permanecen dentro del chat', () => {
  assert.match(inbox, /'Agendar cita'\); agenda\.type = 'button'; agenda\.onclick = openAvailabilityDialog/);
  assert.match(inbox, /'Agendar cita'\);\s*appointment\.type = 'button'; appointment\.onclick = openAvailabilityDialog/);
  assert.doesNotMatch(inbox, /window\.ir\('agenda'\)/);
});

test('la ventana aparece antes de consultar la agenda y conserva al paciente', () => {
  const start = inbox.indexOf('async function openAvailabilityDialog');
  const end = inbox.indexOf('async function searchAvailability', start);
  const flow = inbox.slice(start, end);
  assert.ok(flow.indexOf('dialog.showModal()') < flow.indexOf("request('GET', { action: 'availability_catalog'"));
  assert.match(flow, /conversation\.contact_name/);
  assert.match(flow, /control\.disabled = true/);
  assert.match(flow, /control\.disabled = false/);
});

test('la agenda embebida mantiene paridad móvil y una versión pública nueva', () => {
  assert.equal(mobileInbox, inbox);
  assert.match(app, /smyl-inbox\.js\?v=20/);
  assert.match(worker, /smyl-inbox\.js\?v=20/);
});
