import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const Menu = require('../smyl-select-menu.js');
const fakeSelect = (opts, value) => ({ value, options: opts.map(([v, t, extra]) => Object.assign({ value: v, textContent: t, hidden: false, disabled: false }, extra || {})) });

test('opciones: marca la vista global, salta ocultas y deshabilitadas, inicial sin prefijo', () => {
  const items = Menu.optionsOf(fakeSelect([['a', 'Sucursal Centro'], ['b', 'Consultorio Zapopan'], ['x', 'Oculta', { hidden: true }], ['y', 'Off', { disabled: true }], ['all', 'Todos los consultorios']], 'a'));
  assert.deepEqual(items.map((i) => i.text), ['Sucursal Centro', 'Consultorio Zapopan', 'Todos los consultorios']);
  assert.deepEqual(items.map((i) => i.global), [false, false, true]);
  assert.equal(items[0].initial, 'C');
  assert.equal(items[1].initial, 'Z');
  assert.equal(Menu.optionsOf(fakeSelect([['', 'Todas las sucursales']], ''))[0].global, true);
});

test('color estable por nombre y búsqueda sin acentos ni mayúsculas', () => {
  assert.equal(Menu.colorOf('Sucursal Centro'), Menu.colorOf('Sucursal Centro'));
  assert.match(Menu.colorOf('x'), /^#[0-9a-f]{6}$/);
  assert.ok(Menu.matches({ text: 'Clínica Providencia' }, 'clinica'));
  assert.ok(Menu.matches({ text: 'Sucursal Plaza Sol' }, 'PLAZA'));
  assert.ok(!Menu.matches({ text: 'Sucursal Centro' }, 'zapopan'));
  assert.ok(Menu.matches({ text: 'Lo que sea' }, '  '));
});

test('solo aplica a los selectores elegidos y sin insertar HTML como texto', () => {
  const src = read('smyl-select-menu.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src));
  assert.ok(Menu.TARGETS.some((t) => t.selector === '#sb-branch-select' && t.dark));
  assert.ok(Menu.TARGETS.some((t) => /#p-agenda \.schedule-filter select/.test(t.selector)));
  assert.match(src, /\(hover: hover\) and \(pointer: fine\)/, 'solo computadora');
  assert.match(read('smyl-select-menu.css'), /@media \(hover:hover\) and \(pointer:fine\)\{\s*body\.smyl-ui-governed #p-agenda \.schedule-filter select\{[^}]*font-size:13px!important/);
});

test('app.html, sw.js y la copia móvil cargan el módulo', () => {
  const app = read('app.html');
  assert.match(app, /<link rel="stylesheet" href="smyl-select-menu\.css\?v=1">\n<script defer src="smyl-select-menu\.js\?v=1"><\/script>/);
  const sw = read('sw.js');
  assert.match(sw, /'\/camila\/smyl-select-menu\.js\?v=1'/);
  assert.match(sw, /'\/camila\/smyl-select-menu\.css\?v=1'/);
  assert.match(sw, /-menu-selectores-v1(?:-|')/);
  for (const f of ['app.html', 'sw.js', 'smyl-select-menu.js', 'smyl-select-menu.css']) assert.equal(read(f), read('mobile/www/' + f), f + ' móvil igual');
});
