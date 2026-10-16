import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');

test('el escritorio reserva el espacio principal para lista y conversación', () => {
  assert.match(css, /Keep the stage 2 drawer authoritative/);
  assert.match(css, /\.smyl-inbox-workspace\{grid-template-columns:340px minmax\(0,1fr\)\}/);
  assert.match(css, /\.smyl-inbox-context\{position:absolute;top:0;right:0;bottom:0;z-index:20/);
  assert.match(css, /\.smyl-inbox-page\.context-open \.smyl-inbox-context\{transform:translateX\(0\)\}/);
});

test('el panel agrupa el contexto en secciones desplegables', () => {
  assert.match(inbox, /function organizeContextSections\(wrap, conversation, ficha\)/);
  assert.match(inbox, /node\('details', 'smyl-inbox-context-group'\)/);
  assert.match(inbox, /document\.createElement\('summary'\)/);
  assert.match(css, /\.smyl-inbox-context-group>summary/);
});

test('las prioridades clínicas y operativas abren su sección automáticamente', () => {
  assert.match(inbox, /var urgent = key === 'attention'/);
  assert.match(inbox, /key === 'appointment'/);
  assert.match(inbox, /key === 'record' && !\(ficha && ficha\.linked\)/);
  assert.match(inbox, /key === 'responsable' && !conversation\.assignment/);
  assert.match(inbox, /contextSections: \{\}/);
});

test('la etapa 2 conserva paridad web y móvil', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
