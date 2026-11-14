import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const review = read('../smyl-clinical-photo-review.js');
const service = read('../smyl-clinical-photo-service.js');
const styles = read('../smyl-clinical-photo-review.css');
const patient = read('../smyl-patient-360.js');

test('la lista protege los originales y sólo los verifica al abrir la valoración', () => {
  assert.match(review, /Se verifica al abrir/);
  assert.doesNotMatch(review, /function loadThumb/);
  assert.match(review, /const url = await originalUrl\(state, initialStudy\)/);
  assert.match(service, /smyl_evidence_log_open/);
  assert.match(service, /file\.tenant_id!==study\.tenant_id\|\|file\.patient_id!==study\.patient_id/);
});

test('una toma puede cerrarse de forma auditable sin inventar un hallazgo', () => {
  for (const state of ['reviewed_no_findings', 'not_evaluable', 'manual_only']) {
    assert.match(review, new RegExp(state));
    assert.match(service, new RegExp(state));
  }
  assert.match(service, /smyl_evidence_set_photo_disposition/);
  assert.match(review, /Continuar sin IA/);
  assert.match(review, /Registrar no evaluable/);
  assert.match(review, /Revisé el original y confirmo que este cierre corresponde a mi criterio profesional/);
});

test('confirmar, corregir y descartar conservan una decisión profesional explícita', () => {
  assert.match(review, /Confirmar descarte de la sugerencia/);
  assert.match(review, /Motivo del descarte/);
  assert.match(review, /rejectReason\.value\.trim\(\)\.length < 5/);
  assert.match(review, /category: category\.value/);
  assert.match(review, /scope: scope\.value/);
  assert.match(review, /regionCode: region\.value\.trim\(\)/);
  assert.match(review, /DECISIÓN PROFESIONAL GUARDADA/);
  assert.match(review, /Revisión \$\{decision\?\.revision \|\| 1\}/);
});

test('la carga de fotografías clínicas existe en Evidencia, no en el selector genérico', () => {
  assert.match(patient, /availableTypes=Object\.keys\(FILE_TYPES\)\.filter\(function\(k\)\{return photoFlow\|\|k!==\x27clinical_photo\x27;\}\)/);
  assert.match(patient, /Las fotografías clínicas se incorporan y clasifican únicamente desde Evidencia/);
  assert.match(patient, /options\.workflow===\x27clinical_photo\x27/);
});

test('la revisión mantiene legibilidad, foco y área segura en PWA', () => {
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(review, /setInterval\(\(\) => \{ if \(current\(state\) && !state\.dialog\) refresh\(state, true\); \}, 30000\)/);
});
