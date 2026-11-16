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
    assert.match(read(file), /smyl-inbox-ficha\.js\?v=3/);
    assert.match(read(file), /smyl-inbox\.js\?v=52/);
    assert.match(read(file), /smyl-inbox\.css\?v=45/);
  }
  for (const file of ['smyl-inbox.js', 'smyl-inbox-ficha.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
