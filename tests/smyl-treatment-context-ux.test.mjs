import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const patient = read('../smyl-patient-360.js');

test('Tratamiento consume un resumen clínico protegido sin mover la ficha administrativa', () => {
  assert.match(workspace, /window\.SmylPatient360\?\.context\?\.\(ctx\.tenant,ctx\.patient\)/);
  assert.match(workspace, /function mountContext\(ctx,patient\)/);
  assert.match(workspace, /cw-context-admin/);
  assert.doesNotMatch(workspace, /querySelector\('\.clinic-patient-card'\)|append\(identity\)/);

  const contextSource = patient.slice(patient.indexOf('function patientContext'), patient.indexOf('function announcePatientContext'));
  assert.match(contextSource, /if\(!current\(s\)\|\|!s\.canRead\)return null/);
  assert.doesNotMatch(contextSource, /emergency_contact|clinical_note|subjective|objective/);
});

test('cero alertas no se interpreta como historia completa', () => {
  assert.match(patient, /safetyPending=!H\.reviewed\(d,'alerts_status',alerts\.length\)\|\|!H\.reviewed\(d,'allergies_status',allergies\.length\)/);
  assert.match(patient, /state:attentionCount\?'attention':safetyPending\|\|pending\.length\?'incomplete':'ready'/);
  assert.match(workspace, /state==='incomplete'/);
  assert.match(workspace, /Hay información clínica por confirmar/);
});

test('la revisión es explícita, temporal y queda obsoleta cuando cambia la historia', () => {
  assert.match(workspace, /ctx\.contextReviewSnapshot=\{historyRevision:state\.model\.historyRevision\}/);
  assert.match(workspace, /ctx\.contextReviewSnapshot\.historyRevision!==model\.historyRevision/);
  assert.match(workspace, /Contexto revisado en esta sesión/);
  assert.match(workspace, /El contexto cambió durante esta sesión/);
  assert.match(workspace, /smyl:patient-context-updated/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});

test('la propuesta sólo queda habilitada tras revisar contexto y hallazgos', () => {
  assert.match(workspace, /const evaluationComplete=findingsComplete&&contextReviewed/);
  assert.match(workspace, /const planComplete=evaluationComplete&&clinical\?\.ready/);
  assert.match(workspace, /reviewComplete:state\.evaluationComplete,findingsComplete:state\.findingsComplete/);
  assert.doesNotMatch(workspace, /const planComplete=reviewComplete&&clinical\?\.ready/);
});

test('navegar y revisar el contexto no escribe datos clínicos', () => {
  assert.doesNotMatch(workspace, /smyl_save_|\.rpc\(|\.from\(/);
  assert.match(workspace, /const selected=key===id;m\.details\.hidden=!selected;m\.details\.dataset\.active=String\(selected\)/);
  assert.match(workspace, /function acknowledgeContext\(ctx,acceptChanges=false\)/);
});
