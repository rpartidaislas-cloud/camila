import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const center = read('smyl-evidence-center.js');
const centerCss = read('smyl-evidence-center.css');
const integration = read('smyl-evidence-center-integration.js');
const integrationCss = read('smyl-evidence-center-integration.css');
const dental = read('smyl-dental-record.js');
const fixture = read('tests/fixtures/smyl-evidence-single-intake-preview.html');

test('el archivo vacío ofrece una sola entrada y distingue filtros sin resultados', () => {
  assert.match(center, /archiveEmpty\s+\? 'Aún no hay archivos clínicos'/);
  assert.match(center, /archiveEmpty\s+\? 'Agrega el primer archivo clínico/);
  assert.match(center, /'Ver todo el archivo'/);
  assert.match(centerCss, /\.sec-root\[data-empty=true\] \.sec-head \.sec-add/);
});

test('la radiografía elegida entra a un único modo enfocado de revisión y guardado', () => {
  assert.match(integration, /function beginRadiographIntake/);
  assert.match(integration, /state\.root\.hidden = true/);
  assert.match(integration, /save\.textContent = 'Guardar radiografía'/);
  assert.match(integration, /shellTitle\.textContent = 'Revisar y guardar radiografía'/);
  assert.match(integration, /shellToggle\.textContent = 'En curso'/);
  assert.match(integration, /shell\.open = true/);
  assert.match(integration, /discard\.textContent = 'Descartar'/);
  assert.match(integration, /intake\.before\?\.has\(String\(studyId\)\)/);
  assert.match(integrationCss, /data-evidence-intake[^}]+\.dr-upload-fields/);
  assert.match(integrationCss, /\.dr-study:not\(\.is-evidence-intake\)\{display:none\}/);
  assert.match(integrationCss, /max-width:760px/);
});

test('guardar, descartar o fallar restaura el archivo sin borrar historia previa', () => {
  assert.match(dental, /savedDoc:M\.empty\(\)/);
  assert.match(dental, /ctx\.savedDoc=structuredClone\(row\.document\)/);
  assert.match(dental, /smyl:dental-study-prepared/);
  assert.match(dental, /smyl:dental-study-preparation-cancelled/);
  assert.match(dental, /smyl:dental-study-preparation-failed/);
  assert.match(dental, /reason:'saved'/);
  assert.match(dental, /ctx\.dirty=!SmylCaseModel\.same\(ctx\.doc,ctx\.savedDoc\)/);
  assert.match(integration, /function finishRadiographIntake/);
  assert.match(integration, /state\.root\.hidden = false/);
  assert.match(integration, /active\.pendingRadiographIntake/);
  assert.match(integration, /event\.detail\?\.reason === 'saved'/);
});

test('web y PWA publican las versiones del flujo único', () => {
  const app = read('app.html');
  const sw = read('sw.js');
  for (const tag of [
    'smyl-dental-record.js?v=26',
    'smyl-evidence-center.js?v=10',
    'smyl-evidence-center.css?v=6',
    'smyl-evidence-center-integration.js?v=7',
    'smyl-evidence-center-integration.css?v=4'
  ]) {
    assert.match(app, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
    assert.match(sw, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
  }
  assert.match(sw, /evidence-single-intake-v1/);
});

test('la vista de control reproduce el modo enfocado en escritorio y móvil', () => {
  assert.match(fixture, /data-evidence-intake="ready"/);
  assert.match(fixture, /Radiografía sin guardar/);
  assert.match(fixture, /Guardar radiografía/);
  assert.match(fixture, /Descartar/);
});
