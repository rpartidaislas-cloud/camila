import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261126100000_smyl_clinical_record_retention.sql', import.meta.url), 'utf8');

test('no se borra un paciente con expediente ni una clínica con pacientes (NOM-004, 5 años)', () => {
  assert.match(sql, /before delete on public\.camila_pacientes/);
  assert.match(sql, /before delete on public\.camila_tenants/);
  assert.match(sql, /if ultimo is null then\s+return old;/, 'sin expediente sí se puede borrar');
  assert.match(sql, /current_setting\('smyl\.retention_purge', true\), ''\) = 'nom004-5y'\s+and ultimo < clock_timestamp\(\) - interval '5 years'/);
  for (const t of ['smyl_clinical_notes', 'smyl_patient_histories', 'smyl_dental_records', 'smyl_patient_files', 'smyl_radiograph_sources', 'smyl_clinical_evidence_studies', 'mila_clinical_notes', 'smyl_patient_consents']) {
    assert.match(sql, new RegExp('public\\.' + t + '\\b'), t);
  }
  assert.match(sql, /revoke all on function public\.smyl_patient_last_clinical_activity\(uuid, uuid\) from public, anon, authenticated/);
});
