import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261126180000_smyl_treatments.sql', import.meta.url), 'utf8');

test('los tratamientos son capítulos del paciente: uno activo, cerrados inmutables y sin eliminar', () => {
  assert.match(sql, /create table if not exists public\.smyl_treatments/);
  assert.match(sql, /status in \('active', 'closed', 'abandoned', 'cancelled'\)/);
  assert.match(sql, /create unique index if not exists smyl_treatments_one_active_idx[\s\S]*where status = 'active'/);
  assert.match(sql, /Un tratamiento cerrado no se modifica/);
  assert.match(sql, /Un tratamiento no se puede eliminar/);
  assert.match(sql, /nom004-5y/);
});

test('el cierre por abandono exige la hoja de egreso (NOM-013-SSA2-2015, 9.7)', () => {
  assert.match(sql, /smyl_treatments_abandoned_note/);
  assert.match(sql, /status <> 'abandoned' or char_length\(btrim\(coalesce\(closure_note, ''\)\)\) >= 10/);
  assert.match(sql, /Para cerrar por abandono escribe en qué fase quedó el tratamiento/);
});

test('no se toca el plan, las notas ni las cotizaciones existentes: solo se congela una copia y se reinicia el plan con versión', () => {
  assert.doesNotMatch(sql, /alter table public\.(smyl_clinical_plans|smyl_clinical_notes|smyl_proposals|smyl_appointments)/i);
  assert.match(sql, /plan_snapshot = v_plan\.document/);
  assert.match(sql, /insert into public\.smyl_clinical_versions/);
  assert.match(sql, /revision = v_plan\.revision \+ 1/);
});

test('solo se usa con funciones, con permiso clínico y acceso al paciente, y sin lectura directa de la tabla', () => {
  assert.match(sql, /revoke all on public\.smyl_treatments from public, anon, authenticated/);
  for (const fn of ['smyl_list_treatments', 'smyl_get_treatment', 'smyl_open_treatment', 'smyl_update_treatment', 'smyl_close_treatment']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(`));
  }
  assert.match(sql, /'clinical\.write'/);
  assert.match(sql, /smyl_can_access_patient\(v_tenant, p_patient_id, 'clinical'\)/);
});

test('cada paciente con plan recibe su «Tratamiento inicial» y los planes nuevos crean uno si falta', () => {
  assert.match(sql, /'Tratamiento inicial'/);
  assert.match(sql, /create trigger smyl_plan_ensure_treatment after insert on public\.smyl_clinical_plans/);
});
