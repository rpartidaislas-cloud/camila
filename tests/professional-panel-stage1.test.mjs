import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../smyl-panel.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../smyl-panel.css', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('dashboard presents the existing four-stage clinical path', () => {
  for (const label of ['Documentación clínica', 'Odontograma', 'Plan de tratamiento', 'Cotización']) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /pro-path-list/);
  assert.match(panel, /pro-action-grid/);
});

test('unfinished collaboration is removed from professional navigation', () => {
  assert.doesNotMatch(panel, /take\('colaboraciones'/);
  assert.doesNotMatch(panel, /\['historial','nuevo-diseno'/);
  assert.match(panel, /label\.textContent = 'Marca y simulación'/);
});

test('internal prompt controls stay out of the dentist-facing product', () => {
  assert.match(app, /card advanced-ai-settings/);
  assert.match(app, /advanced-ai-settings[^>]*hidden/);
  assert.match(styles, /\.advanced-ai-settings\{display:none\}/);
  assert.match(app, /Tú revisas y apruebas cada importe/);
});

test('all primary creation actions open the same professional simulator', () => {
  assert.doesNotMatch(app, />Crear primer diseño</);
  assert.match(app, /Nueva simulación/);
  assert.match(app, /simulacion-rapida\.html\?workspace=professional/);
});

test('panel assets and PWA cache advance together', () => {
  assert.match(app, /smyl-panel\.css\?v=5/);
  assert.match(app, /smyl-panel\.js\?v=6/);
assert.match(serviceWorker, /smyl-v257-plan-consumption/);
  assert.match(serviceWorker, /smyl-panel\.css\?v=5/);
  assert.match(serviceWorker, /smyl-panel\.js\?v=6/);
});
