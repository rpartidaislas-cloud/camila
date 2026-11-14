import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('smyl-case-workspace.js');
const dental = read('smyl-dental-record.js');
const integration = read('smyl-evidence-center-integration.js');
const integrationCss = read('smyl-evidence-center-integration.css');
const fixture = read('tests/fixtures/smyl-evidence-single-intake-preview.html');

test('cada estudio radiográfico presenta una sola acción clínica según su estado', () => {
  assert.match(workspace, /function radiographAction\(study,canReview=true\)/);
  for (const label of ['Iniciar revisión', 'Resolver revisión', 'Continuar revisión', 'Ver revisión', 'Ver estudio']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /Revisar '\+progress\.pending\+' '/);
  assert.match(workspace, /study\.reviewed/);
  assert.match(workspace, /data\.nextAction|dataset\.nextAction/);
  assert.doesNotMatch(workspace, /Valorar estudio|Revisar estudio|Revisar resultado/);
});

test('la etapa radiográfica no repite la acción de la tarjeta en el pie', () => {
  assert.match(workspace, /reviewSource==='radiograph'/);
  assert.match(workspace, /ctx\.evaluationCta\.hidden=true/);
  assert.match(workspace, /label='Continuar a conclusión'/);
  assert.doesNotMatch(workspace, /ctx\.reviewButton=btn/);
});

test('la carga sin guardar prioriza guardar y deja notas y descarte como opciones secundarias', () => {
  assert.match(dental, /pendingUpload&&ctx\.canWrite\?'Añadir notas':ctx\.canWrite\?'Abrir archivo':'Ver archivo'/);
  assert.match(dental, /pendingUpload\?'Descartar carga':'Retirar'/);
  assert.match(dental, /dr-intake-notes/);
  assert.match(dental, /dr-intake-discard/);
  assert.doesNotMatch(dental, /Abrir y anotar/);
  assert.match(integration, /save\.textContent = 'Guardar radiografía'/);
  assert.match(integration, /save\.classList\.add\('seci-intake-save'\)/);
  assert.match(integrationCss, /una sola acción dominante: guardar/);
  assert.match(integrationCss, /\.dr-intake-notes/);
  assert.match(integrationCss, /\.dr-intake-discard/);
});

test('los permisos cierran por defecto las acciones de decisión clínica', () => {
  assert.match(dental, /canReviewStudies:ctx\.canWrite&&ctx\.canApprove/);
  assert.match(workspace, /canReviewStudies===true/);
});

test('la vista de control cubre carga y cola con la misma jerarquía', () => {
  for (const label of ['Guardar radiografía', 'Añadir notas', 'Descartar carga', 'Iniciar revisión', 'Revisar 2 hallazgos']) {
    assert.match(fixture, new RegExp(label));
  }
  assert.match(fixture, /data-next-action="not-started"/);
  assert.match(fixture, /data-next-action="pending"/);
});

test('web y PWA distribuyen el mismo flujo y fuerzan una caché nueva', () => {
  const app = read('app.html');
  const worker = read('sw.js');
  for (const tag of [
    'smyl-radiograph-review.js?v=28',
    'smyl-dental-record.js?v=31',
    'smyl-case-workspace.js?v=40',
    'smyl-evidence-center-integration.js?v=11',
    'smyl-evidence-center-integration.css?v=6'
  ]) {
    assert.match(app, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
    assert.match(worker, new RegExp(tag.replaceAll('.', '\\.').replace('?', '\\?')));
  }
  assert.match(worker, /radiograph-single-action-v1/);
  for (const file of [
    'app.html',
    'sw.js',
    'smyl-radiograph-review.js',
    'smyl-dental-record.js',
    'smyl-case-workspace.js',
    'smyl-evidence-center-integration.js',
    'smyl-evidence-center-integration.css'
  ]) assert.equal(read(file), read(`mobile/www/${file}`), `${file} debe coincidir en mobile/www`);
});
