import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('smyl-radiograph-workbench.css');
const review = read('smyl-radiograph-review.js');
const record = read('smyl-dental-record.js');
const fixture = read('tests/fixtures/smyl-radiograph-clinical-workspace-v33.html');
const browserQa = read('tests/smyl-radiograph-clinical-workspace-v33-browser.cjs');

test('la mesa radiográfica adopta Clinical Workspace v3.3 sin cambiar el dominio clínico', () => {
  assert.match(css, /Clinical Workspace v3\.3 · evidence -> decision -> detail/);
  assert.match(css, /--rr-v33-control: 42px/);
  assert.match(css, /--rr-v33-control: 44px/);
  assert.match(css, /grid-template-columns: minmax\(0, 72fr\) minmax\(336px, 28fr\)/);
  assert.match(css, /font-size: 12px/);
  assert.match(css, /outline: 3px solid/);
});

test('controles y señales mantienen objetivos legibles en revisión asistida y manual', () => {
  assert.match(css, /\.rr-filter \{ min-height: var\(--rr-v33-control\)/);
  assert.match(css, /\.rr-mark \{ width: var\(--rr-v33-control\)/);
  assert.match(css, /\.dr-radiograph-dialog \.dr-mark \{ width: var\(--rr-v33-control\)/);
  assert.match(css, /\.rr-tool-range \{[^}]*min-height: var\(--rr-v33-control\)/s);
  assert.match(css, /\.dr-tool-range \{[^}]*min-height: var\(--rr-v33-control\)/s);
});

test('evidencia, decisión y detalle publican semántica accesible', () => {
  assert.match(review, /Herramientas de imagen radiográfica/);
  assert.match(review, /Imagen radiográfica original y señales ubicadas/);
  assert.match(review, /Decisiones sobre señales clínicas/);
  assert.match(review, /Filtrar señales por estado/);
  assert.match(review, /role','listitem/);
  assert.match(record, /Visor radiográfico\. Amplía y arrastra para recorrer la imagen/);
});

test('la implementación no modifica modelos, análisis, persistencia ni permisos', () => {
  assert.doesNotMatch(css, /supabase|rpc\(|tenant_id|prompt|model:/i);
  assert.doesNotMatch(review, /\.from\(['"]|\.rpc\(|functions\.invoke/);
  assert.match(review, /SmylRadiographReviewStore\.connect/);
  assert.match(review, /SmylRadiographAnalysisClient\.analyze/);
  assert.match(review, /window\.miRolEquipo==='dueño'/);
});

test('la fixture y el QA recorren ambas superficies en 1440, 1024 y 390', () => {
  assert.match(fixture, /smyl-radiograph-workbench-preview\.html/);
  assert.match(fixture, /smyl-radiograph-manual-preview\.html/);
  assert.match(browserQa, /width: 1440/);
  assert.match(browserQa, /width: 1024/);
  assert.match(browserQa, /width: 390/);
  assert.match(browserQa, /assisted/);
  assert.match(browserQa, /manual/);
});
