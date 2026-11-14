// Menú lateral v2 (maqueta aprobada el 2026-11-08): cabecera única, «Nueva cita» arriba con atajo N,
// iconos sueltos, activa evidente, grupos que se abren al entrar y usuario abajo con menú ⋯.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const nav = read('smyl-navigation.js');
const css = read('smyl-ui-template-v3.css');
const v2 = css.slice(css.indexOf('/* Menú lateral v2'));

test('los grupos arrancan cerrados, se abren al entrar y se cierran al salir', () => {
  assert.match(nav, /nav\.append\(sectionLabel\('Comunicación'\)\)/);
  assert.match(nav, /detailsGroup\('Mensajería', MESSAGING, false, 'messages'\)/);
  assert.match(nav, /detailsGroup\('Negocio', BUSINESS, false, 'reports'\)/);
  assert.match(nav, /group\.open = contains;/);
  assert.match(nav, /pro-nav-group-count/);
});

test('cabecera única con el nombre de la clínica y usuario abajo con Mi cuenta y Cerrar sesión', () => {
  assert.match(nav, /function setupShellHeader\(\)/);
  assert.match(nav, /getElementById\('sb-consultorio'\)/);
  assert.match(nav, /function setupUserFooter\(\)/);
  assert.match(nav, /querySelector\('\.btn-cerrar'\)/);
  assert.match(nav, /setAttribute\('role', 'menu'\)/);
  assert.match(nav, /event\.key === 'Escape'/);
});

test('«Nueva cita» va arriba y el atajo N no interfiere al escribir ni con modificadores', () => {
  assert.match(nav, /logo\.after\(wrap\)/);
  assert.match(nav, /aria-keyshortcuts', 'N'/);
  assert.match(nav, /event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey/);
  assert.match(nav, /function isTypingTarget/);
  assert.match(nav, /getClientRects\(\)\.length/);
});

test('el estilo v2 usa iconos sin baldosa, pesos del contrato y respeta el colapsado', () => {
  assert.ok(v2.length > 1000, 'existe el bloque v2');
  assert.doesNotMatch(css, /Menú lateral: iconos de línea en baldosa/);
  const weights = [...v2.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1]));
  assert.ok(weights.every((w) => [400, 500, 600, 700].includes(w)), String(weights));
  assert.match(v2, /background: none;/);
  assert.match(v2, /smyl-sidebar-collapsed\) \.pro-nav-group \.pro-nav-flyout \.pro-nav-icon \{ display: none; \}/);
  for (const f of ['smyl-navigation.js', 'smyl-ui-template-v3.css', 'smyl-ui-datta-v4.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + f), read(f), f);
  }
});
