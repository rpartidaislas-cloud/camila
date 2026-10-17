import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');

test('the team can select no more than three verified alternatives', () => {
  assert.match(inbox, /availabilitySelected/);
  assert.match(inbox, /selected \? 'Seleccionado' : 'Seleccionar'/);
  assert.match(inbox, /aria-pressed/);
  assert.match(inbox, /availabilitySelected\.length >= 3/);
  assert.match(inbox, /hasta tres alternativas/);
});

test('the patient-facing shortlist is explicit and does not promise a booking', () => {
  assert.match(inbox, /Te comparto estas opciones disponibles/);
  assert.match(inbox, /Responde con el número que prefieres/);
  assert.match(inbox, /La clínica confirmará el horario después de tu elección/);
  assert.match(inbox, /setComposerText\(lines\.join/);
  const prepare = inbox.slice(inbox.indexOf('function prepareAvailabilityOptions'), inbox.indexOf('async function loadAvailabilityRequests'));
  assert.doesNotMatch(prepare, /request\('POST'|sendMessage|appointment_request/);
});

test('new searches discard stale alternatives and respect conversation operation', () => {
  assert.ok((inbox.match(/availabilitySelected = \[\]/g) || []).length >= 2);
  assert.match(inbox, /canOperate\(selectedConversation\(\), 'messages\.respond'\)/);
  assert.match(css, /smyl-inbox-availability-offer/);
});

test('the shortlist experience remains identical on web and mobile', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
