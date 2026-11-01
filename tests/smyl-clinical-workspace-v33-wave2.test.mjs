import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function enhancement(css, marker) {
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `No se encontró el bloque ${marker}`);
  return css.slice(start);
}

function literalMicrotext(css) {
  return [...css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)]
    .map(match => Number(match[1]))
    .filter(size => size < 12);
}

test('Ficha 360 adopta la escala cerrada y controles táctiles del Clinical Workspace', () => {
  const css = enhancement(read('smyl-patient-360.css'), 'Clinical Workspace v3.3 · Ficha 360');
  assert.match(css, /--p360-text-xs:var\(--smyl-ui-text-meta,12px\)/);
  assert.match(css, /\.p360-root button,\.p360-root summary\{min-height:42px/);
  assert.match(css, /\.p360-root button,\.p360-root summary,\.p360-root :is\(input,select\)\{min-height:44px\}/);
  assert.match(css, /\.p360-domain-grid\{grid-template-columns:1fr\}/);
  assert.deepEqual(literalMicrotext(css), []);
});

test('Ficha 360 conserva una sola prioridad y navegación canónica por fuentes', () => {
  const js = read('smyl-patient-360.js');
  assert.equal((js.match(/class="p360-priority"/g) || []).length, 1);
  assert.match(js, /class="p360-record-map"/);
  assert.match(js, /class="p360-domain-grid"/);
  assert.match(js, /data-p360-tab/);
});

test('Cotizaciones separa documento, decisión y seguimiento con una jerarquía explícita', () => {
  const css = enhancement(read('smyl-proposals.css'), 'Clinical Workspace v3.3 · Cotizaciones');
  const js = read('smyl-proposals.js');
  assert.match(css, /\.proposal-layout\{grid-template-columns:minmax\(0,1fr\) minmax\(320px,360px\)/);
  assert.match(css, /#proposal-save,#proposal-export/);
  assert.match(css, /#proposal-preview\{min-height:46px\}/);
  assert.match(css, /\.proposal-summary\{[\s\S]*?position:static/);
  assert.deepEqual(literalMicrotext(css), []);
  for (const id of ['proposal-save', 'proposal-preview', 'proposal-export', 'proposal-approve']) {
    assert.equal((js.match(new RegExp(`id='${id}'`, 'g')) || []).length, 1, `${id} debe tener una sola acción`);
  }
});

test('La lista y el documento de cotización refluyen sin perder acciones', () => {
  const css = enhancement(read('smyl-proposals.css'), 'Clinical Workspace v3.3 · Cotizaciones');
  assert.match(css, /\.proposal-list-row\{[\s\S]*?display:grid/);
  assert.match(css, /@media screen and \(max-width:700px\)/);
  assert.match(css, /\.proposal-photo-pair\{grid-template-columns:1fr\}/);
  assert.match(css, /\.proposal-preview-footer>\.btn\{width:100%\}/);
  assert.match(css, /\.proposal-quote tr\{grid-template-columns:1fr\}/);
});

test('El control de preparación de cotización elimina microtexto y mantiene foco visible', () => {
  const css = enhancement(read('smyl-treatment-quote-stage3.css'), 'Clinical Workspace v3.3 · preparación de cotización');
  assert.match(css, /font-size:var\(--smyl-ui-text-meta,12px\)/);
  assert.match(css, /min-height:42px/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /@media screen and \(max-width:420px\)/);
  assert.deepEqual(literalMicrotext(css), []);
});
