// Finanzas: el diseño angosto se activa por el espacio disponible (contenedor), no solo por el ancho de la pantalla.
// En una tableta con el menú abierto la pantalla mide 820 px, pero a Finanzas le quedan unos 460 px: antes las filas se encimaban.
// scripts/finanzas-contenedor-css.mjs copia las reglas de página de cada «@media (max-width: N)» a un «@container finance-workspace (max-width: N)».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { containerize, strip, pageClasses } from '../scripts/finanzas-contenedor-css.mjs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const css = read('smyl-finance.css');
const js = read('smyl-finance.js');
const blocks = [...css.matchAll(/\/\*contenedor\*\/@container finance-workspace \(max-width:(\d+)px\)\{/g)];

test('la hoja publicada está al día con el generador (y el generador es estable)', () => {
  const again = containerize(css, js);
  assert.equal(again.css, css, 'corre «node scripts/finanzas-contenedor-css.mjs» después de cambiar un @media de página');
  assert.equal(containerize(again.css, js).css, again.css);
  assert.ok(again.blocks >= 30 && again.rules >= 150, again.blocks + ' bloques, ' + again.rules + ' reglas');
  assert.equal(blocks.length, again.blocks);
  assert.doesNotMatch(strip(css), /@container finance-workspace/);
  assert.equal(css, read('mobile/www/smyl-finance.css'));
});

test('Finanzas declara su contenedor y cada copia sigue a su «@media» con el mismo ancho', () => {
  assert.match(css, /\.finance-page\{[^}]*container:finance-workspace\/inline-size/);
  for (const block of blocks) {
    const before = css.slice(0, block.index).trimEnd();
    const mediaStart = before.lastIndexOf('@media');
    const condition = before.slice(mediaStart + 6, before.indexOf('{', mediaStart)).trim();
    assert.match(condition, new RegExp('^(?:screen\\s+and\\s+)?\\(max-width:\\s*' + block[1] + 'px\\)$'), 'bloque de ' + block[1] + ' px');
    // Entre el «@media» y su copia no hay nada más: la cascada queda igual que en el celular.
    let depth = 0, end = -1; const open = before.indexOf('{', mediaStart);
    for (let k = open; k < before.length; k++) { if (before[k] === '{') depth++; else if (before[k] === '}') { depth--; if (!depth) { end = k; break; } } }
    assert.equal(end, before.length - 1, 'la copia de ' + block[1] + ' px va justo después de su @media');
  }
});

test('las copias solo llevan reglas de la página y nunca apuntan al propio contenedor', () => {
  const classes = pageClasses(js);
  for (const name of ['finance-tabcards', 'finance-visit-row', 'finance-row', 'finance-account-filters', 'finance-fiscal-receipt-list', 'finance-session']) assert.ok(classes.has(name), name);
  for (const block of blocks) {
    let depth = 0, end = -1; const open = css.indexOf('{', block.index);
    for (let k = open; k < css.length; k++) { if (css[k] === '{') depth++; else if (css[k] === '}') { depth--; if (!depth) { end = k; break; } } }
    for (const rule of css.slice(open + 1, end).match(/[^{}]+\{[^{}]*\}/g) || []) {
      const selector = rule.slice(0, rule.indexOf('{'));
      assert.doesNotMatch(selector, /(^|,)\s*(?:#p-caja|\.finance-page)(?:\.[\w-]+)*\s*(,|$)/, 'una consulta de contenedor no puede cambiar al propio contenedor: ' + selector);
      assert.ok(/#p-caja|\.finance-page/.test(selector) || [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].some((m) => classes.has(m[1])), 'regla ajena a la página: ' + selector.slice(0, 80));
    }
  }
});

test('con poco espacio las pestañas pasan a dos columnas y las filas se apilan, aunque la pantalla sea ancha', () => {
  assert.match(css, /\/\*contenedor\*\/@container finance-workspace \(max-width:560px\)\{#p-caja \.finance-tabcards\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  const narrow = blocks.filter((b) => Number(b[1]) >= 700).map((b) => css.slice(b.index, css.indexOf('\n', b.index) < 0 ? css.length : css.indexOf('\n', b.index))).join('\n');
  assert.match(narrow, /\.finance-visit-row/);
  assert.match(narrow, /\.finance-account-filters/);
  assert.match(narrow, /min-height:44px/);
  // Las ventanas viven fuera del contenedor: siguen dependiendo del ancho de la pantalla y no se copian reglas solo de ventana.
  assert.doesNotMatch(css.split('\n').filter((l) => l.startsWith('/*contenedor*/')).join('\n'), /\{[^}]*\}\.finance-collection-guide>|^\/\*contenedor\*\/@container[^{]*\{\.finance-close-form/m);
});
