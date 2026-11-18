import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function load() {
  const window = {};
  new Function('window', 'document', read('smyl-skeleton.js'))(window, { createElement: () => ({}) });
  return window.SmylSkeleton;
}

test('el asistente de skeletons dibuja los 11 tipos con región accesible y decorado oculto', () => {
  const sk = load();
  assert.deepEqual([...sk.kinds].sort(), ['calendar', 'cards', 'chart', 'detail', 'form', 'kpis', 'list', 'media', 'panel', 'table', 'text']);
  for (const kind of sk.kinds) {
    const out = sk.html(kind, { label: 'Cargando prueba' });
    assert.match(out, /role="status" aria-live="polite"/, kind);
    assert.match(out, /<span class="sk-sr">Cargando prueba<\/span>/, kind);
    assert.match(out, /<div aria-hidden="true">/, kind);
    assert.match(out, /class="sk[ "]/, kind);
  }
});

test('el texto del aviso se escapa, los conteos tienen tope y un tipo desconocido no rompe', () => {
  const sk = load();
  assert.doesNotMatch(sk.html('list', { label: '<img src=x onerror=alert(1)>' }), /<img/);
  assert.equal((sk.html('list', { rows: 3 }).match(/sk-list-item/g) || []).length, 3);
  assert.ok((sk.html('list', { rows: 9999 }).match(/sk-list-item/g) || []).length <= 24);
  assert.match(sk.html('no-existe', {}), /data-skeleton="no-existe"/);
  assert.match(sk.html('list'), /Cargando…/);
});

test('los estilos animan, respetan «reducir movimiento» y no usan texto menor a 12 px', () => {
  const css = read('smyl-skeleton.css');
  assert.match(css, /animation:sk-shimmer/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.sk\{animation:none/);
  assert.match(css, /@media \(forced-colors:active\)/);
  assert.doesNotMatch(css, /font-size:\s*(\d|1[01])(\.\d+)?px/);
});

test('el sistema llega a la app, a la caché sin conexión y al móvil, antes de los módulos', () => {
  const html = read('app.html');
  assert.ok(html.indexOf('smyl-skeleton.js') > 0 && html.indexOf('smyl-skeleton.js') < html.indexOf('smyl-panel.js'));
  assert.ok(html.indexOf('smyl-skeleton.css') > 0 && html.indexOf('smyl-skeleton.css') < html.indexOf('smyl-panel.css'));
  assert.match(read('sw.js'), /smyl-skeleton\.js\?v=1/);
  assert.match(read('sw.js'), /smyl-skeleton\.css\?v=1/);
  for (const file of ['smyl-skeleton.js', 'smyl-skeleton.css']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
