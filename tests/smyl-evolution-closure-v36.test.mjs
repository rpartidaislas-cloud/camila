import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const patient = read('../smyl-patient-360.js');
const dental = read('../smyl-dental-record.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('el seguimiento reutiliza notas, citas y odontograma existentes', () => {
  assert.match(patient, /window\.SmylPatientProgress=Object\.freeze/);
  assert.match(patient, /notes:\{total:s\.notes\.length,signed:signed\.length,drafts:drafts\.length/);
  assert.match(patient, /appointments:\{total:s\.appointments\.length,completed:completed\.length/);
  assert.match(dental, /teeth:\{total:toothNotes\.length,pending:/);
  assert.match(workspace, /renderEvolution\(ctx,progress,dental,clinical\)/);
});

test('el resumen longitudinal no expone el contenido SOAP', () => {
  const snapshot = patient.slice(patient.indexOf('window.SmylPatientProgress'), patient.indexOf('function init()'));
  for (const field of ['subjective', 'objective', 'assessment', 'document:latest.document']) assert.doesNotMatch(snapshot, new RegExp(field));
  assert.match(snapshot, /label:noteTitle\(latest\)/);
  assert.match(snapshot, /timeline:s\.timeline\.slice\(0,4\)/);
});

test('el médico puede registrar evolución, actualizar el mapa y abrir el historial', () => {
  for (const copy of ['Registrar evolución', 'Actualizar odontograma', 'Ver historial clínico']) assert.match(workspace, new RegExp(copy));
  assert.match(patient, /select\.value='progress'/);
  assert.match(workspace, /SmylPatient360\?\.open\('notes'\)/);
  assert.match(workspace, /ctx\.mapHost\?\.scrollIntoView/);
  assert.doesNotMatch(workspace, /reviewPart\(ctx,0\)/);
});

test('el cierre permanece documentado y nunca se automatiza', () => {
  assert.match(workspace, /El cierre se documenta con una evolución firmada y el odontograma actualizado/);
  assert.match(workspace, /SMYL no cierra casos automáticamente/);
  assert.doesNotMatch(workspace, /cerrarCaso|autoClose|status:\s*'closed'/);
});

test('la política visual cubre escritorio y móvil sin saturar el flujo', () => {
  for (const selector of ['cw-evolution-head', 'cw-evolution-metrics', 'cw-evolution-route', 'cw-evolution-actions']) assert.match(styles, new RegExp(selector));
  assert.match(styles, /Tratamiento v3\.6/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(fixture, /Paciente de demostración/);
  assert.match(fixture, /Listo para documentar cierre/);
});

test('web, móvil y PWA publican la etapa 3.6', () => {
  assert.match(app, /smyl-patient-360\.js\?v=12/);
  assert.match(app, /smyl-dental-record\.js\?v=16/);
  assert.match(app, /smyl-case-workspace\.css\?v=15/);
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(worker, /evolution-closure-v36/);
  for (const file of ['app.html', 'sw.js', 'smyl-patient-360.js', 'smyl-dental-record.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) assert.equal(read('../' + file), read('../mobile/www/' + file));
});
