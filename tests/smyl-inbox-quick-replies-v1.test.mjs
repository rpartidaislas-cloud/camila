import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('el atajo escrito conserva su rango y se sustituye por la respuesta', () => {
  assert.match(js, /function quickShortcutAtCaret\(input\)/);
  assert.match(js, /inputValue: input \? input\.value : '', insertStart: inline \? inline\.start/);
  assert.match(js, /input\.value === session\.inputValue/);
  assert.match(js, /input\.setRangeText\(text, start, end, 'end'\)/);
  assert.match(js, /maybeOpenQuickReplies\(event\)/);
  assert.match(js, /range\.query\.length < 2/);
});

test('la biblioteca explica el flujo y hace evidente cómo usar cada respuesta', () => {
  assert.match(js, /BIBLIOTECA DEL EQUIPO/);
  assert.match(js, /Inserta un mensaje preparado sin enviarlo automáticamente/);
  assert.match(js, /Buscar por atajo o texto/);
  assert.match(js, /Consejo: escribe <b>\/atajo<\/b>/);
  assert.match(js, /node\('span', 'smyl-quick-use-label', 'Usar'\)/);
  assert.match(css, /dialog\[data-quick-dialog\]\{width:min\(620px/);
  assert.match(css, /\.smyl-quick-overview/);
  assert.match(css, /\.smyl-quick-use-label/);
});

test('web y PWA publican la misma versión de respuestas rápidas', () => {
  assert.match(app, /smyl-inbox\.js\?v=99/);
  assert.match(app, /smyl-inbox\.css\?v=80/);
  assert.match(worker, /smyl-inbox\.js\?v=99/);
  assert.match(worker, /smyl-inbox\.css\?v=80/);
  assert.match(worker, /quick-replies-v1/);
  assert.equal(read('../mobile/www/smyl-inbox.js'), js);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.equal(read('../mobile/www/app.html'), app);
  assert.equal(read('../mobile/www/sw.js'), worker);
});
