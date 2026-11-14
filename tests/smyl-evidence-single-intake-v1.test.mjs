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
  assert.match(integration, /querySelector\('\.dr-intake-notes'\)/);
  assert.match(integration, /querySelector\('\.dr-intake-discard'\)/);
  assert.match(integration, /Añadir notas opcionales antes de guardar la radiografía/);
  assert.match(integration, /Descartar esta carga radiográfica sin guardar/);
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
  assert.match(integration, /intake\.shell\.open = false/);
  assert.match(integration, /intake\.shell\.hidden = true/);
  assert.match(integration, /state\.fingerprint = '';/);
  assert.match(integration, /refresh\(state\)/);
  assert.match(integration, /active\.pendingRadiographIntake/);
  assert.match(integration, /event\.detail\?\.reason === 'saved'/);
});

test('el archivo muestra radiografías del paciente aunque todavía no exista un caso', () => {
  assert.match(integration, /const dental = global\.SmylDentalProgress\?\.status\?\.\(tenant, patient, caseId\) \|\| null/);
  assert.doesNotMatch(integration, /const dental = caseId \? global\.SmylDentalProgress/);
  assert.equal((integration.match(/const status = global\.SmylDentalProgress\?\.status\?\.\(state\.tenant, state\.patient, caseId\) \|\| null/g) || []).length, 2);
});

test('web y PWA publican las versiones del flujo único', () => {
  const app = read('app.html');
  const sw = read('sw.js');
  for (const tag of [
    'smyl-dental-record.js?v=30',
    'smyl-evidence-center.js?v=10',
    'smyl-evidence-center.css?v=7',
    'smyl-evidence-center-integration.js?v=11',
    'smyl-evidence-center-integration.css?v=6'
  ]) {
    assert.match(app, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
    assert.match(sw, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
  }
  assert.match(sw, /evidence-single-intake-v1/);
  assert.match(sw, /evidence-single-entry-fix-v1/);
});

test('la vista de control reproduce el modo enfocado en escritorio y móvil', () => {
  assert.match(fixture, /data-evidence-intake="ready"/);
  assert.match(fixture, /Radiografía sin guardar/);
  assert.match(fixture, /Guardar radiografía/);
  assert.match(fixture, /Añadir notas/);
  assert.match(fixture, /Descartar carga/);
});
