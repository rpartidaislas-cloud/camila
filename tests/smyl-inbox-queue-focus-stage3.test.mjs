import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const app = read('../app.html');
const mobileApp = read('../mobile/www/app.html');
const worker = read('../sw.js');

test('la bandeja deja visibles sólo los cuatro filtros de trabajo diario', () => {
  const start = inbox.indexOf('<div class="smyl-inbox-filters"');
  const end = inbox.indexOf('smyl-inbox-filter-panel', start);
  const filters = inbox.slice(start, end);
  assert.equal((filters.match(/data-inbox-filter=/g) || []).length, 4);
  assert.equal((filters.match(/role="tab"/g) || []).length, 4);
  assert.equal((filters.match(/aria-selected="(?:true|false)"/g) || []).length, 4);
  for (const filter of ['all', 'unread', 'attention', 'mine']) assert.match(filters, new RegExp(`data-inbox-filter="${filter}"`));
  assert.match(inbox, /data-inbox-filter-more[^>]+aria-expanded="false"[^>]+aria-controls="smyl-inbox-filter-panel"/);
  assert.match(inbox, /id="smyl-inbox-filter-panel"[^>]+data-inbox-filter-panel[^>]+hidden/);
  const controls = inbox.slice(inbox.indexOf('function renderFilterControls'), inbox.indexOf('function toggleInboxFilters'));
  assert.match(controls, /setAttribute\('aria-selected'/);
  assert.match(controls, /button\.tabIndex = selected \? 0 : -1/);
});

test('los filtros comunican conteos y conservan canales y selección múltiple', () => {
  assert.match(inbox, /function filterCount\(filter\)/);
  assert.match(inbox, /button\.innerHTML = '<span>' \+ labels\[filter\]/);
  assert.match(inbox, /data-inbox-channel aria-label="Filtrar por canal"/);
  assert.match(inbox, /data-inbox-bulk aria-pressed="false">Seleccionar varias/);
  assert.match(css, /\.smyl-inbox-filter-panel\[hidden\]\{display:none\}/);
});

test('cada conversación muestra un único estado operativo y la etapa en segundo nivel', () => {
  assert.match(inbox, /if \(item\.needs_human\).*'Por atender'/s);
  assert.match(inbox, /else if \(item\.paused\).*'Con el equipo'/s);
  assert.match(inbox, /else meta\.append\(node\('span', 'smyl-inbox-state', 'IA activa'\)\)/);
  assert.match(inbox, /smyl-inbox-row-stage-line/);
});

test('la etapa final publica recursos nuevos con paridad web y móvil', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
  assert.equal(mobileApp, app);
  assert.match(app, /smyl-inbox\.css\?v=35/);
  assert.match(app, /smyl-inbox\.js\?v=37/);
  assert.match(worker, /smyl-inbox\.js\?v=37/);
});
