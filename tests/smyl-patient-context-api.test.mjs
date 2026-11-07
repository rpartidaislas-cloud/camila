import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const patient = read('../smyl-patient-360.js');
const mobile = read('../mobile/www/smyl-patient-360.js');

test('Patient 360 expone a Tratamiento un contexto clínico limitado y de solo lectura', () => {
  assert.match(patient, /function patientContext\(s\)/);
  assert.match(patient, /context:function\(tenant,patient\)/);
  assert.match(patient, /if\(!current\(s\)\|\|!s\.canRead\)return null/);
  for (const field of ['historyRevision', 'updatedAt', 'attentionCount', 'safetyPending', 'coverage', 'statuses', 'alerts', 'allergies', 'conditions', 'medications']) {
    assert.match(patient, new RegExp(field));
  }
  assert.match(patient, /state:attentionCount\?'attention':safetyPending\|\|pending\.length\?'incomplete':'ready'/);
  assert.match(patient, /Object\.freeze\(\{ready:true/);
});

test('el snapshot no expone notas clínicas o administrativas libres', () => {
  const contextSource = patient.slice(patient.indexOf('function patientContext'), patient.indexOf('function announcePatientContext'));
  assert.doesNotMatch(contextSource, /emergency_contact|d\.notes|clinical_note|subjective|objective|assessment/);
  assert.match(contextSource, /H\.recordsOf\(d,'allergy'\)/);
  assert.match(contextSource, /H\.recordsOf\(d,'condition'\)/);
  assert.match(contextSource, /H\.recordsOf\(d,'medication'\)/);
});

test('al guardar historia se anuncia sólo identidad y revisión para volver a consultar el snapshot', () => {
  assert.match(patient, /announcePatientContext\(s\);notify\(s,'Historia clínica actualizada/);
  assert.match(patient, /smyl:patient-context-updated/);
  assert.match(patient, /detail:\{tenant:s\.tenant,patient:s\.patient,historyRevision:context\.historyRevision\}/);
  assert.equal(patient, mobile);
});
