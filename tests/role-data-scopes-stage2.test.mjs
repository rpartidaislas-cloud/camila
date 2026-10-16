import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261015040000_smyl_role_data_scopes.sql');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');

test('roles store configurable data scopes independently from permissions', () => {
  assert.match(migration, /create table public\.smyl_role_scopes/);
  assert.match(migration, /'own','care_team','branches','clinic'/);
  assert.match(migration, /create or replace function public\.smyl_effective_scope/);
  assert.match(migration, /smyl_scope_rank/);
  assert.match(migration, /No puedes conceder un alcance mayor al tuyo/);
});

test('patient care teams connect patients to authorized professionals', () => {
  assert.match(migration, /create table public\.smyl_patient_care_team/);
  assert.match(migration, /relationship in \('primary','treating','specialist','assistant','cover'\)/);
  assert.match(migration, /smyl_assign_patient_professional/);
  assert.match(migration, /smyl_can_access_patient/);
});

test('patient, schedule and clinical reads enforce the selected scope in RLS', () => {
  assert.match(migration, /create policy pacientes_read[\s\S]*smyl_can_access_patient/);
  assert.match(migration, /create policy smyl_appointments_read[\s\S]*smyl_can_access_schedule_row/);
  assert.match(migration, /create policy smyl_patient_histories_read[\s\S]*smyl_can_access_patient/);
  assert.match(migration, /create policy smyl_clinical_notes_read[\s\S]*smyl_can_access_patient/);
  assert.match(migration, /create policy smyl_appointment_events_read[\s\S]*smyl_can_access_schedule_row/);
  assert.match(migration, /create policy smyl_clinical_note_addenda_read[\s\S]*smyl_can_access_patient/);
});

test('security-definer writes cannot bypass the configured patient scope', () => {
  assert.match(migration, /create or replace function public\.smyl_guard_scoped_write/);
  assert.match(migration, /smyl_appointments_scope_guard/);
  assert.match(migration, /smyl_patient_histories_scope_guard/);
  assert.match(migration, /smyl_clinical_notes_scope_guard/);
  assert.match(migration, /auth\.role\(\)='service_role'/);
});

test('the role editor exposes scope selectors and explains every level', () => {
  assert.match(script, /var DATA_SCOPES =/);
  assert.match(script, /Solo propio/);
  assert.match(script, /Equipo tratante/);
  assert.match(script, /Sucursales asignadas/);
  assert.match(script, /Toda la clínica/);
  assert.match(script, /from\('smyl_role_scopes'\)/);
  assert.match(script, /p_scopes: scopes/);
  assert.match(styles, /clinic-admin-scope-grid/);
});
