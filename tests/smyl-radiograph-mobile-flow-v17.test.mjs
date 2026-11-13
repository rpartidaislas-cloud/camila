import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('la revisión PWA conserva el contexto y presenta acciones sin superposición', () => {
  const review = read('smyl-radiograph-review.js');
  const css = read('smyl-radiograph-workbench.css');
  assert.match(review, /is-context/);
  assert.match(review, /Confirmar y continuar/);
  assert.match(review, /button\('Descartar'/);
  assert.match(review, /Continuando con la siguiente/);
  assert.match(review, /setTimeout\(\(\)=>\{if\(e\.isConnected\)/);
  assert.match(css, /PWA radiográfica v17/);
  assert.match(css, /@media \(max-width: 639px\)[\s\S]*?\.rr-image-stage > \.rr-mark\.is-context\s*\{[^}]*display:\s*block[^}]*opacity/);
  assert.match(css, /\.rr-save\[data-dirty="true"\][\s\S]*?position: static/);
  assert.match(css, /\.rr-image-stage \{ min-width: 100%; flex: none; \}/);
});

test('el expediente móvil reduce filtros y muestra estudios como lista compacta', () => {
  const workspace = read('smyl-case-workspace.js');
  const css = read('smyl-case-workspace.css');
  assert.match(workspace, /button\.dataset\.count=String\(counts\[id\]\|\|0\)/);
  assert.match(workspace, /btn\('Quitar filtro'/);
  assert.match(workspace, /cw-radiograph-pieces/);
  assert.match(css, /Expediente PWA v25/);
  assert.match(css, /\.cw-map-filter\[data-count="0"\]:not\(\[aria-pressed="true"\]\)\{display:none\}/);
  assert.match(css, /\.cw-radiograph-grid\{display:grid;grid-auto-flow:row/);
  assert.match(css, /padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)/);
});

test('web, PWA y copia móvil distribuyen la misma versión', () => {
  const app = read('app.html');
  const worker = read('sw.js');
  for (const expected of ['smyl-radiograph-workbench.css?v=21', 'smyl-radiograph-review.js?v=27', 'smyl-case-workspace.css?v=28', 'smyl-case-workspace.js?v=37']) {
    assert.match(app, new RegExp(expected.replaceAll('.', '\\.').replace('?', '\\?')));
    assert.match(worker, new RegExp(expected.replaceAll('.', '\\.').replace('?', '\\?')));
  }
  assert.match(worker, /radiograph-mobile-flow-v17/);
  assert.match(worker, /radiograph-device-parity-zoom-v21/);
  for (const file of ['app.html', 'sw.js', 'smyl-radiograph-review.js', 'smyl-radiograph-workbench.css', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) {
    assert.equal(read(file), read('mobile/www/' + file), file + ' debe coincidir en mobile/www');
  }
});
