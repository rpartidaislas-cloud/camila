import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const BG = require('../smyl-clinical-background.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('la historia incluye heredofamiliares, aparatos y sistemas, gineco-obstétricos, tejidos blandos, ATM y ficha', () => {
  const rows = BG.summary({ family_history: { diabetes: 'Madre' }, systems_review: { cardiovascular: 'Negado' }, pregnancy: 'No', soft_tissue: { tongue: 'Sin lesiones' }, tmj: 'Normal' }, { domicilio: 'Av. 1', curp: 'GAXM900101HJCRRN09' });
  const labels = rows.map((r) => r[0]);
  for (const l of ['Domicilio', 'CURP', 'Heredofamiliares', 'Aparatos y sistemas', 'Gineco-obstétricos', 'Tejidos blandos', 'ATM']) assert.ok(labels.includes(l), l);
  assert.deepEqual(rows.find((r) => r[0] === 'Heredofamiliares')[1], ['Diabetes: Madre']);
  assert.ok(BG.CURP_RE.test('GAXM900101HJCRRN09')); assert.ok(!BG.CURP_RE.test('ABC'));
});

test('signos vitales con rangos y lectura compacta', () => {
  assert.match(BG.validateVitals({}), /al menos un signo/);
  assert.match(BG.validateVitals({ systolic: '900' }), /fuera de rango/);
  assert.equal(BG.validateVitals({ systolic: '120', diastolic: '80', temperature: '36,6' }), '');
  assert.equal(BG.vitalsLine({ systolic: 120, diastolic: 80, heart_rate: 70 }), 'TA 120/80 mmHg · FC 70 lpm');
});

test('la nota clínica registra diagnóstico (CIE-10 opcional) y pronóstico; la base versiona antecedentes y no edita signos vitales', () => {
  const p360 = read('smyl-patient-360.js');
  assert.match(p360, /name="diagnosis_code"/);
  assert.match(p360, /name="prognosis"/);
  assert.match(p360, /\^\[A-Z\]\[0-9\]\{2\}/);
  const sql = read('supabase/migrations/20261126140000_smyl_clinical_background.sql');
  assert.match(sql, /smyl_patient_clinical_background_versions/);
  assert.match(sql, /Los signos vitales registrados no se modifican/);
  assert.match(sql, /camila_pacientes_curp_check/);
  assert.match(sql, /union all select max\(measured_at\) from public\.smyl_patient_vital_signs/);
});
