import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync('simulacion-rapida.html', 'utf8');
const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const css = fs.readFileSync('smyl-studio.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('result view selector cannot collapse on mobile', () => {
  assert.match(html, /\.res-photos\{[^}]*flex:0 0 auto[^}]*min-height:128px[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
  assert.match(html, /\.res-thumb\{[^}]*width:80px[^}]*height:80px[^}]*aspect-ratio:auto/);
  assert.match(css, /\.smyl-organized \.res-photos\{[^}]*flex:0 0 auto[^}]*min-height:132px[^}]*overflow-y:hidden/);
  assert.match(css, /@media\(max-width:680px\)[\s\S]*?\.smyl-organized #res-photos\{[^}]*min-height:124px/);
  assert.match(css, /\.smyl-organized \.res-thumb\{[^}]*width:76px[^}]*height:76px/);
});

test('every result view is a labelled, touch-friendly selectable button', () => {
  assert.match(html, /<button type="button" class="res-view-card" aria-pressed=/);
  assert.match(html, /class="res-thumb-check"/);
  assert.match(html, /class="res-thumb-lbl"/);
  assert.match(html, /class="res-thumb-state"/);
  assert.match(html, /var estado = activo \? 'En pantalla'/);
  assert.match(html, /onclick="cambiarVistaBA/);
  assert.match(studio, /viewsHead\.id='flow-result-views-head'/);
});

test('the visible selector update is cache-busted and mirrored by the service worker', () => {
  assert.match(html, /smyl-studio\.css\?v=29/);
  assert.match(sw, /result-views-v11/);
  assert.match(sw, /smyl-studio\.css\?v=29/);
});
