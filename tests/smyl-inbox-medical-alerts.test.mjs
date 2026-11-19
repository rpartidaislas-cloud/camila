import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const edge = read('supabase/functions/lana-inbox/index.ts');
const js = read('smyl-inbox.js');
const ficha = read('smyl-inbox-ficha.js');

test('el servidor arma las alertas desde el alta y la historia clínica, después de validar el alcance clínico', () => {
  const start = edge.indexOf('async function clinicalContext');
  const fn = edge.slice(start, edge.indexOf('type PatientLinkIdentity', start));
  assert.ok(fn.indexOf('accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")') < fn.indexOf('smyl_patient_histories'));
  assert.match(fn, /consentimiento_whatsapp,alertas_medicas/);
  assert.match(fn, /from\("smyl_patient_histories"\)\.select\("document,updated_at"\)\s*\.eq\("tenant_id", tenantId\)\.eq\("patient_id", handoff\.patient_id\)/);
  assert.match(fn, /medical_alerts: medicalAlerts\(patient\.alertas_medicas, history\)/);
  assert.match(edge, /allergy_records/);
  assert.match(edge, /historyReviewed\(document, "alerts_status", historyAlerts\.length\) && historyReviewed\(document, "allergies_status", allergies\.length\)/);
});

test('el chat no consulta tablas para las alertas y solo las muestra con permiso clínico', () => {
  assert.doesNotMatch(js, /smyl_patient_histories|alertas_medicas/);
  assert.match(js, /hasPermission\('clinical\.read'\) && threadFicha && threadFicha\.linked/);
  assert.match(js, /data-thread-medical hidden/);
  assert.match(ficha, /Sin alergias ni alertas médicas conocidas/);
  assert.match(ficha, /Alergias y alertas médicas sin confirmar/);
  assert.match(ficha, /'Alergia: '/);
});

test('web, móvil y PWA publican las alertas médicas', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-inbox-ficha\.js\?v=11/);
    assert.match(read(file), /smyl-inbox\.js\?v=79/);
    assert.match(read(file), /smyl-inbox\.css\?v=68/);
  }
  for (const file of ['smyl-inbox.js', 'smyl-inbox-ficha.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});

test('sin paciente vinculado la ficha invita a resolver la identidad para ver alertas', () => {
  assert.match(js, /\{ unlinked: true, onLink: function \(\) \{ openPatientContext\(conversation\.id\); \} \}/);
  assert.match(ficha, /Vincula este chat a un paciente para ver sus alergias y alertas médicas/);
});

test('si LANA pide capacitación, el resumen lo explica sin el error crudo y solo ofrece un enlace discreto a quien administra', () => {
  assert.match(js, /function isTrainingMissing\(entry\)/);
  assert.match(js, /onOpenTraining: hasPermission\('settings\.manage'\) \? openAssistantTraining : null/);
  assert.match(js, /\[data-connection-tab="assistant"\]/);
  assert.match(ficha, /'Configurar asistente', 'smyl-f360-link'/);
  assert.doesNotMatch(ficha, /Publicar capacitación/);
});
