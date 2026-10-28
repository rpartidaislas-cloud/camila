import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const patient = read('../smyl-patient-360.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('cada fuente activa una tarea clínica distinta', () => {
  for (const copy of ['Todo el contexto clínico', 'Observaciones clínicas por pieza', 'Archivo visual y revisión asistida', 'Rayos X con interpretación asistida']) assert.match(workspace, new RegExp(copy));
  assert.match(workspace, /renderSourceWorkspace\(ctx,filter,totals\)/);
  assert.match(workspace, /mode\.dataset\.mode=filter/);
});

test('fotografías y radiografías habilitan su propio flujo de archivo', () => {
  assert.match(patient, /window\.SmylPatientFiles=Object\.freeze/);
  assert.match(patient, /select\.value=category/);
  assert.match(workspace, /Agregar fotografías/);
  assert.match(workspace, /SmylPatientFiles\?\.add\('clinical_photo'\)/);
  assert.match(workspace, /Agregar radiografía/);
  assert.match(workspace, /reviewPart\(ctx,1\)/);
});

test('la IA se presenta como valoración sugerida y requiere confirmación profesional', () => {
  assert.match(workspace, /Valoración asistida, no diagnóstico/);
  assert.match(workspace, /confirmar, editar o descartar/);
  assert.doesNotMatch(workspace, /diagnóstico automático|guardar diagnóstico sugerido/i);
});

test('el editor completo queda bajo divulgación progresiva y no duplica el mapa principal', () => {
  assert.match(workspace, /cw-advanced-editor/);
  assert.match(workspace, /advanced\.hidden=true/);
  assert.match(workspace, /advanced\.append\(dental\)/);
  assert.match(styles, /\.cw-advanced-editor>\.dr-record/);
});

test('la nueva superficie amplía jerarquía y respuesta móvil', () => {
  for (const selector of ['cw-source-mode', 'cw-source-stats', 'cw-source-suggestion', 'cw-source-actions']) assert.match(styles, new RegExp(selector));
  assert.match(styles, /Tratamiento v3\.7/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(fixture, /EXPEDIENTE UNIFICADO/);
});

test('web, móvil y PWA publican la etapa 3.7', () => {
  assert.match(app, /smyl-patient-360\.js\?v=15/);
  assert.match(app, /smyl-case-workspace\.css\?v=15/);
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(worker, /source-workspace-v37/);
  for (const file of ['app.html', 'sw.js', 'smyl-patient-360.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) assert.equal(read('../' + file), read('../mobile/www/' + file));
});
