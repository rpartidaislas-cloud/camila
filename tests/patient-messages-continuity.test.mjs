import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const inbox = read('../smyl-inbox.js');
const styles = read('../smyl-inbox.css');
const worker = read('../sw.js');

test('Mensajes prioritizes the conversations that need the dental team', () => {
  assert.match(inbox, /<h1 class="smyl-inbox-sr">Mensajes<\/h1>/);
  assert.match(inbox, /requieren.*al equipo ahora/);
  assert.match(inbox, /Boolean\(a\.needs_human\).*Boolean\(b\.needs_human\)/);
  assert.match(inbox, /Boolean\(a\.unread_count\).*Boolean\(b\.unread_count\)/);
  assert.match(styles, /smyl-inbox-queue-summary/);
  assert.match(styles, /data-priority=human/);
});

test('each thread exposes a clear next action and patient continuity', () => {
  // Ficha 360 v4: la siguiente acción vive en el encabezado del hilo; la ficha solo consulta.
  assert.match(inbox, /Intervención solicitada/);
  assert.doesNotMatch(inbox, /Expediente ↗/);
  assert.match(fs.readFileSync(new URL('../smyl-inbox-ficha.js', import.meta.url), 'utf8'), /Vincular paciente/);
  assert.match(inbox, /Identificando paciente/);
  assert.match(inbox, /Agendar cita/);
  assert.match(inbox, /Paciente y atención/);
  assert.match(inbox, /Paciente vinculado/);
});

test('reply tools are understandable and preserve human review', () => {
  for (const label of ['Sugerir con MILA', 'Plantilla', 'Programar', 'Adjuntar', 'Ubicación']) assert.match(inbox, new RegExp(label));
  assert.match(inbox, /aria-label="Enviar mensaje"/);
  assert.match(styles, /smyl-inbox-message-row/);
  assert.doesNotMatch(inbox, /localStorage/);
  assert.match(inbox, /crypto\.subtle\.encrypt\(\{ name: 'AES-GCM'/);
  assert.doesNotMatch(inbox, /Sin borrador|data-draft-status/);
});

test('web, mobile and offline bundles ship the same inbox stage', () => {
  assert.match(app, /smyl-inbox\.css\?v=75/);
  assert.match(app, /smyl-inbox\.js\?v=88/);
assert.match(worker, /smyl-v263-lana-connection-recovery/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(inbox, read('../mobile/www/smyl-inbox.js'));
  assert.equal(styles, read('../mobile/www/smyl-inbox.css'));
});
