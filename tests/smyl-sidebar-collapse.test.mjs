import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const nav = read('../smyl-navigation.js');
const navCss = read('../smyl-navigation.css');
const inboxCss = read('../smyl-inbox.css');

test('el sidebar se contrae a iconos con una flecha y recuerda la preferencia', () => {
  assert.match(nav, /function setupCollapse/);
  assert.match(nav, /pro-sidebar-toggle/);
  assert.match(nav, /smyl-sidebar-collapsed/);
  assert.match(nav, /aria-expanded/);
  assert.match(nav, /button\.title = entry\[0\]/);
  assert.match(navCss, /body\.smyl-sidebar-collapsed \.sidebar\{width:72px\}/);
});

test('Mensajes ocupa todo el ancho junto al sidebar en escritorio', () => {
  assert.match(inboxCss, /\.contenido:has\(>\.smyl-inbox-page\.activa\)\{max-width:none;margin:0;padding:0\}/);
});

test('web y móvil distribuyen la misma navegación', () => {
  assert.equal(read('../mobile/www/smyl-navigation.js'), nav);
  assert.equal(read('../mobile/www/smyl-navigation.css'), navCss);
});
