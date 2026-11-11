import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const patient = read('../smyl-patient-360.js');
const workspace = read('../smyl-case-workspace.js');
const evidenceIntegration = read('../smyl-evidence-center-integration.js');
const photoReview = read('../smyl-clinical-photo-review.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('cada fuente activa una capa del mismo odontograma clínico', () => {
  for (const copy of ["['all','Todo']", "['manual','Clínica']", "['photo','Fotografías']", "['radiograph','Rayos X']", "['pending','Pendientes']"]) assert.match(workspace, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(workspace, /renderClinicalMap\(ctx,ctx\.mapSnapshot\)/);
  assert.match(workspace, /ctx\.mapFilter=id/);
  assert.doesNotMatch(workspace, /renderSourceWorkspace\(/);
});

test('fotografías y radiografías habilitan su propio flujo de archivo', () => {
  assert.match(patient, /window\.SmylPatientFiles=Object\.freeze/);
  assert.match(patient, /select\.value=category/);
  assert.match(workspace, /Agregar fotografías/);
  assert.doesNotMatch(workspace, /SmylPatientFiles\?\.add\('clinical_photo'\)/);
  assert.match(evidenceIntegration, /routeClinicalPhoto/);
  assert.match(evidenceIntegration, /indexPatientFile/);
  assert.match(photoReview, /Aquí no se suben archivos/);
  assert.match(workspace, /Agregar radiografía/);
  assert.match(workspace, /reviewPart\(ctx,1\)/);
});

test('la IA se presenta como sugerencia y requiere confirmación profesional', () => {
  assert.match(workspace, /Nada pasa al odontograma hasta que lo confirmes/);
  assert.match(workspace, /Revisa, edita o descarta cada sugerencia antes de continuar/);
  assert.doesNotMatch(workspace, /diagnóstico automático|guardar diagnóstico sugerido/i);
});

test('el editor completo queda bajo divulgación progresiva y no duplica el mapa principal', () => {
  assert.match(workspace, /cw-advanced-editor/);
  assert.match(workspace, /advanced\.hidden=true/);
  assert.match(workspace, /advanced\.append\(dental\)/);
  assert.match(styles, /\.cw-advanced-editor>\.dr-record/);
});

test('la nueva superficie concentra mapa, inspector y contexto con respuesta móvil', () => {
  for (const selector of ['cw-clinical-map-layout', 'cw-map-inspector', 'cw-map-inspector-facts', 'cw-map-context']) assert.match(styles, new RegExp(selector));
  assert.match(styles, /Hallazgos v4\.4/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(fixture, /Expediente unificado/);
  assert.match(fixture, /Pieza 11 · Incisivo central superior derecho/);
});

test('web, móvil y PWA publican la etapa 3.7', () => {
  assert.match(app, /smyl-patient-360\.js\?v=26/);
  assert.match(app, /smyl-case-workspace\.css\?v=24/);
  assert.match(app, /smyl-case-workspace\.js\?v=30/);
  assert.match(app, /smyl-clinical-photo-review\.js\?v=1/);
  assert.match(worker, /source-workspace-v37/);
  for (const file of [
    'app.html',
    'sw.js',
    'smyl-patient-360.js',
    'smyl-patient-360.css',
    'smyl-evidence-center.js',
    'smyl-evidence-center-integration.js',
    'smyl-clinical-photo-service.js',
    'smyl-clinical-photo-review.js',
    'smyl-clinical-photo-review.css',
    'smyl-case-workspace.js',
    'smyl-case-workspace.css'
  ]) assert.equal(read('../' + file), read('../mobile/www/' + file));
});
