import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');

test('la cabecera prioriza paciente, estado y una sola acción operativa', () => {
  assert.match(inbox, /data-inbox-context aria-label="Abrir paciente y atención"/);
  assert.match(inbox, /data-thread-state/);
  assert.match(inbox, /data-thread-mode/);
  assert.match(inbox, /conversation\.paused \? prepareResume\(\) : mutateConversation\('pause'\)/);
  assert.match(inbox, /data-thread-carebar aria-label="Siguiente acción del paciente"/);
  assert.equal((inbox.match(/host\.append\(primaryButton\)/g) || []).length, 1);
  assert.match(inbox, /primaryButton\.dataset\.threadPrimaryAction/);
  assert.match(inbox, /data-thread-menu role="menu"[^>]+hidden/);
  assert.match(inbox, /data-thread-action-menu/);
});

test('el compositor deja visibles únicamente herramientas primarias', () => {
  assert.match(inbox, /data-compose-more aria-expanded="false"/);
  assert.match(inbox, /data-compose-copilot aria-label="Sugerir con Copilot">Sugerir/);
  assert.match(inbox, /data-compose-tools[^>]+hidden/);
  assert.match(inbox, /toggleComposerTools/);
  assert.match(css, /\.smyl-inbox-compose-tools\[hidden\]\{display:none!important\}/);
});

test('las acciones secundarias de mensajes se revelan mediante Más', () => {
  assert.match(inbox, /smyl-inbox-message-secondary/);
  assert.match(inbox, /smyl-inbox-message-more/);
  assert.match(inbox, /moreActions\.setAttribute\('aria-expanded'/);
  assert.match(css, /\.smyl-inbox-bubble:hover \.smyl-inbox-message-actions/);
});

test('la optimización conserva paridad web y móvil', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
