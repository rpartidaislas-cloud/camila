import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../supabase/migrations/20261012270000_smyl_patient_360.sql');
const actions = read('../supabase/migrations/20261012280000_smyl_patient_360_actions.sql');
const storage = read('../supabase/migrations/20261012290000_smyl_patient_360_storage.sql');
const app = read('../app.html');
const script = read('../smyl-patient-360.js');
const styles = read('../smyl-patient-360.css');
const worker = read('../sw.js');

test('patient 360 owns versioned history, notes, addenda and private files', () => {
  for (const table of ['smyl_patient_histories','smyl_patient_history_versions','smyl_clinical_notes','smyl_clinical_note_versions','smyl_clinical_note_addenda','smyl_patient_files']) {
    assert.match(schema, new RegExp(`create table public\\.${table}\\b`));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(schema, /foreign key \(tenant_id, patient_id\)[\s\S]*camila_pacientes\(tenant_id, id\)/);
});

test('clinical access uses explicit read, write and approve permissions', () => {
  assert.match(schema, /smyl_has_permission\(tenant_id,'clinical\.read'\)/);
  assert.match(actions, /smyl_has_permission\(v_tenant,'clinical\.write'\)/);
  assert.match(actions, /smyl_has_permission\(v_tenant,'clinical\.approve'\)/);
  assert.match(script, /perms\.has\('clinical\.read'\)/);
  assert.match(script, /if\(!s\.canRead&&!s\.canFinanceRead\)/);
});

test('signed notes are immutable and corrections use append-only addenda', () => {
  assert.match(actions, /if v_row\.status<>'draft' then raise exception/);
  assert.match(actions, /Una nota firmada no puede modificarse; agrega una adenda/);
  assert.match(actions, /smyl_add_clinical_note_addendum/);
  assert.match(actions, /status='signed'/);
  assert.match(script, /Al firmar, esta nota quedará inmutable/);
});

test('clinical files remain private and tenant-patient scoped', () => {
  assert.match(storage, /'smyl-clinical-files','smyl-clinical-files',false/);
  assert.match(storage, /file_size_limit/);
  assert.match(storage, /smyl_clinical_file_path_allowed\(name,'clinical\.read'\)/);
  assert.match(storage, /smyl_clinical_file_path_allowed\(name,'clinical\.write'\)/);
  assert.doesNotMatch(storage, /for delete to authenticated/);
  assert.match(actions, /p_storage_path not like v_prefix/);
  assert.match(actions, /smyl_discard_unregistered_file/);
});

test('patient 360 unifies existing dental modules without exposing LANA', () => {
  assert.match(app, /smyl-patient-360\.css\?v=3/);
  assert.match(app, /smyl-patient-360\.js\?v=4/);
  assert.match(script, /Información clínica y administrativa, en contexto/);
  assert.match(script, /p360-dental/);
  assert.match(script, /p360-cases/);
  assert.match(script, /p360-plan/);
  assert.doesNotMatch(script, /LANA/i);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
});

test('web, mobile and offline patient assets stay in lockstep', () => {
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-patient-360.js'));
  assert.equal(styles, read('../mobile/www/smyl-patient-360.css'));
assert.match(worker, /smyl-v242-patient-operations/);
  assert.match(worker, /smyl-patient-360\.js\?v=4/);
  assert.match(worker, /smyl-patient-360\.css\?v=3/);
});

test('patient profile owns fiscal details and starts traced material use from an appointment', () => {
  assert.match(script, /data-p360-tab="billing"/);
  assert.match(script, /smyl_patient_fiscal_profiles/);
  assert.match(script, /Datos fiscales del paciente/);
  assert.match(script, /data-materials=/);
  assert.match(script, /SmylInventory\.openConsumption/);
  assert.match(styles, /p360-billing-status/);
  assert.match(styles, /p360-appointment-actions/);
});
