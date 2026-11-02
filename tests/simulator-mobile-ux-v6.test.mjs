import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('simulacion-rapida.html', 'utf8');
const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const css = fs.readFileSync('smyl-studio.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('the quick objective step keeps only distinct alignment choices', () => {
  assert.doesNotMatch(html, /data-quick-objective="veneers"/);
  assert.match(html, /data-quick-objective="alignment"/);
  assert.match(html, /data-quick-objective="combined"/);
  assert.match(studio, /initialDesign\.mode==='veneers'.*mode:'combined'/);
});

test('photo preparation exposes two primary controls and moves edits into one menu', () => {
  assert.match(studio, /photoMenu\.id='flow-photo-actions-menu'/);
  assert.match(studio, /Añadir otra foto/);
  assert.match(studio, /Reencuadrar/);
  assert.match(studio, /Reemplazar/);
  assert.match(studio, /Restaurar original/);
  assert.match(studio, /Quitar foto/);
  assert.doesNotMatch(studio, /flow-photo-notice/);
  assert.match(css, /\.flow-photo-actions-popover/);
});

test('result action saves first and shares only after confirmation', () => {
  assert.doesNotMatch(studio, /Guardar o compartir/);
  assert.match(studio, /Guardar resultado/);
  assert.match(studio, /Compartir resultado/);
  assert.match(studio, /await window\.guardarCaso\(\)/);
  assert.match(studio, /await window\.compartirResultadoGuardado\(\)/);
  assert.match(html, /smyl:case-saved/);
  assert.match(html, /async function compartirResultadoGuardado\(\)/);
});

test('comparison preserves vertical page scrolling on mobile', () => {
  assert.match(html, /touch-action:pan-y pinch-zoom/);
  assert.match(html, /compareTouch\.axis=Math\.abs\(dx\)>Math\.abs\(dy\)\*1\.15\?'x':'y'/);
  assert.match(html, /if\(compareTouch\.axis==='y'\)\{drag=false;compareTouch=null;return;\}/);
  assert.match(css, /#ba-wrap\{touch-action:pan-y pinch-zoom!important;overscroll-behavior:auto!important\}/);
});

test('studio assets are cache-busted together', () => {
  assert.match(html, /smyl-studio\.css\?v=25/);
  assert.match(html, /smyl-studio\.js\?v=24/);
  assert.match(sw, /simulator-ux-v6/);
  assert.match(sw, /smyl-studio\.css\?v=25/);
  assert.match(sw, /smyl-studio\.js\?v=24/);
});

test('Capacitor receives the same simulator experience', () => {
  for (const file of ['simulacion-rapida.html', 'smyl-studio.js', 'smyl-studio.css', 'sw.js']) {
    assert.equal(fs.readFileSync(`mobile/www/${file}`, 'utf8'), fs.readFileSync(file, 'utf8'));
  }
});
