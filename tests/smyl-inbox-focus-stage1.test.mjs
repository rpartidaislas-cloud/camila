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
  assert.doesNotMatch(inbox, /data-thread-menu|smyl-inbox-briefing-row/);
  assert.match(inbox, /Atiende el chat<\/small>/);
});

test('el compositor deja visibles únicamente herramientas primarias', () => {
  assert.match(inbox, /data-compose-more aria-expanded="false"/);
  assert.match(inbox, /data-compose-copilot aria-label="Sugerir con MILA">/);
  assert.match(inbox, /data-compose-tools[^>]+hidden/);
  assert.match(inbox, /toggleComposerTools/);
  assert.match(css, /\.smyl-inbox-compose-tools\[hidden\]\{display:none!important\}/);
});

test('las acciones del mensaje se abren en el menú lateral de tres puntos', () => {
  assert.match(inbox, /smyl-inbox-message-menu/);
  assert.match(inbox, /smyl-inbox-message-more/);
  assert.match(inbox, /button\.setAttribute\('aria-haspopup', 'menu'\)/);
  assert.match(inbox, /row\.append\(actions\)/);
  assert.match(inbox, /if \(messageMenu\) return true/);
});

test('la optimización conserva paridad web y móvil', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
