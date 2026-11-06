import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const patient = read('../smyl-patient-360.js');
const clinic = read('../smyl-clinic.js');
const clinicalSql = read('../supabase/migrations/20261014181000_smyl_security_lint_cleanup.sql');
const historySql = read('../supabase/migrations/20261012280000_smyl_patient_360_actions.sql');
const dentalSql = read('../supabase/migrations/20261001000000_smyl_dental_records.sql');

test('Tratamiento conserva las rutas internas y navegar no escribe datos clínicos', () => {
  assert.match(patient, /data-p360-tab="treatment"[^>]*>Tratamiento</);
  assert.match(workspace, /const moduleId=id=>id==='photos'\|\|id==='review'\?'evaluation':id==='share'\?'approval':id/);
  assert.match(workspace, /open\('plan'\)/);
  assert.match(workspace, /m\.details\.hidden=!selected;m\.details\.open=selected/);
  assert.doesNotMatch(workspace, /smyl_save_|\.rpc\(|\.from\(/);
});

test('la propuesta mantiene visible el historial sin reemplazar el editor canónico', () => {
  assert.match(clinic, /versions\.id = 'clinic-history'/);
  assert.match(clinic, /smyl_clinical_versions/);
  assert.match(clinic, /order\('revision', \{ ascending: false \}\)\.limit\(25\)/);
  assert.match(clinic, /Consultar una versión no modifica el plan actual/);
  assert.match(workspace, /Cada guardado crea una nueva versión\. Lo anterior no se reemplaza/);
  assert.match(workspace, /document\.getElementById\('clinic-history'\)/);
  assert.match(workspace, /const clinical=screen\.querySelector\('\.clinic-workspace'\);if\(clinical\)plan\.body\.append\(clinical\)/);
  assert.doesNotMatch(workspace, /cloneNode|innerHTML\s*=\s*clinical|replaceChildren\(clinical/);
});

test('historia, propuesta y odontograma agregan versiones con control de revisión', () => {
  assert.match(historySql, /smyl_save_patient_history\(p_patient_id uuid,p_expected_revision integer/);
  assert.match(historySql, /insert into public\.smyl_patient_history_versions/);
  assert.match(clinicalSql, /smyl_save_clinical_plan_v2[\s\S]*p_expected_revision integer/);
  assert.match(clinicalSql, /insert into public\.smyl_clinical_versions/);
  assert.match(dentalSql, /smyl_save_dental_record\(p_patient_id uuid,p_expected_revision integer/);
  assert.match(dentalSql, /insert into public\.smyl_dental_versions/);
  for (const source of [historySql, clinicalSql, dentalSql]) {
    assert.doesNotMatch(source, /(?:update|delete from) public\.smyl_(?:patient_history|clinical|dental)_versions/i);
  }
});

test('las evoluciones firmadas permanecen inmutables y las correcciones son adendas', () => {
  assert.match(historySql, /if v_row\.status<>'draft' then raise exception[\s\S]*Una nota firmada no puede modificarse; agrega una adenda/);
  assert.match(historySql, /smyl_add_clinical_note_addendum/);
  assert.match(patient, /Las notas firmadas quedan inmutables\. Las correcciones posteriores se agregan como adendas/);
});
