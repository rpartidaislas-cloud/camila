// Etapa 1 de la política visual v4: personalidad de Datta Able con los colores de SMYL.
// La hoja solo cambia forma, sombra, tipografía y estructura; no puede introducir colores del repo de origen.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const css = read('smyl-ui-datta-v4.css'), app = read('app.html'), sw = read('sw.js');

test('no introduce los colores de Datta Able ni ningún hex nuevo', () => {
  for (const hex of ['#04a9f5', '#1de9b6', '#3f4d67', '#f4c22b', '#a9b7d0', '#f44236']) assert.doesNotMatch(css.toLowerCase(), new RegExp(hex));
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hexes = (body.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()).filter((h) => h !== '#fff' && h !== '#ffffff');
  assert.deepEqual(hexes, [], 'solo blanco, rgba() derivados de la paleta y variables existentes');
});

test('define la personalidad: Open Sans, radios 8/10/12 px, tarjetas planas con sombra difusa, marca de 3 px', () => {
  assert.match(css, /--smyl-ui-font:\s*"Open Sans"/);
  assert.match(css, /--smyl-ui-radius-control:\s*\.5rem/);
  assert.match(css, /--smyl-ui-radius-card:\s*\.625rem/);
  assert.match(css, /--smyl-ui-radius-panel:\s*\.75rem/);
  assert.match(css, /--smyl-ui-shadow-card:\s*0 1px 20px 0 rgba\(11, 27, 46, \.08\)/);
  assert.match(css, /\.layout \.card,\s*\n\.layout \.stat-card \{\s*\n\s*border: 0;/);
  assert.match(css, /::before \{\s*\n\s*top: 0;\s*\n\s*bottom: 0;\s*\n\s*width: 3px;[\s\S]*?background: var\(--color-accent\)/);
});

test('la barra lateral se adapta al marcado real y respeta el colapsado', () => {
  const sidebar = css.slice(css.indexOf('/* ── Barra lateral'), css.indexOf('/* ── Cabecera'));
  const selectors = sidebar.match(/^body\.smyl-ui-governed[^{]+\{/gm) || [];
  assert.ok(selectors.length >= 5);
  for (const sel of selectors) {
    if (/\.sidebar \.nav-item|\.nav-item:is/.test(sel)) assert.match(sel, /:not\(\.smyl-sidebar-collapsed\)/, sel);
  }
  assert.doesNotMatch(css, /\.layout \.nav-item|\.layout \.sidebar \{/, 'el marcado estático de app.html lo reemplaza smyl-navigation.js');
});

test('se carga la última, con Open Sans y precache; web, PWA y copia móvil sincronizadas', () => {
  const links = [...app.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(links.at(-1), 'smyl-ui-datta-v4.css?v=1');
  assert.match(app, /family=Open\+Sans:wght@400;500;600;700/);
  assert.match(sw, /'\/camila\/smyl-ui-datta-v4\.css\?v=1'/);
  for (const f of ['smyl-ui-datta-v4.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

test('la guía v4 existe y declara que los colores de SMYL no cambian', () => {
  const doc = read('docs/POLITICA_VISUAL_SMYL_V4.md');
  assert.match(doc, /colores de SMYL no cambian/i);
  assert.match(doc, /Datta Able/);
  assert.match(doc, /MIT/);
});
