import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261126220000_smyl_orthodontics_backend.sql');

test('el caso, sus versiones y los controles son relaciones clínicas canónicas', () => {
  for (const table of [
    'smyl_orthodontic_cases',
    'smyl_orthodontic_case_versions',
    'smyl_orthodontic_controls'
  ]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));

  assert.match(sql, /foreign key \(tenant_id, treatment_chapter_id\)[\s\S]*?smyl_treatments\(tenant_id, id\)/);
  assert.match(sql, /foreign key \(tenant_id, clinical_note_id\)[\s\S]*?smyl_clinical_notes\(tenant_id, id\)/);
  assert.match(sql, /unique \(tenant_id, treatment_chapter_id\)/);
  assert.match(sql, /unique \(tenant_id, clinical_note_id\)/);
  assert.match(sql, /primary key \(tenant_id, orthodontic_case_id, revision\)/);
});

test('el acceso es multi-clínica, acotado al paciente y sin escritura directa', () => {
  assert.match(sql, /revoke all on public\.smyl_orthodontic_cases,[\s\S]*?from public, anon, authenticated/);
  assert.match(sql, /public\.smyl_has_permission\(tenant_id, 'clinical\.read'\)/);
  assert.match(sql, /public\.smyl_can_access_patient\(tenant_id, patient_id, 'clinical'\)/);
  assert.match(sql, /create or replace function public\.smyl_orthodontic_access/);
  assert.match(sql, /p_permission not in \('clinical\.read','clinical\.write','clinical\.approve'\)/);
  assert.match(sql, /not public\.smyl_can_access_patient\(v_tenant, p_patient_id, 'clinical'\)/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all) on public\.smyl_orthodontic/i);
});

test('el plan usa bloqueo optimista y conserva cada revisión', () => {
  assert.match(sql, /smyl_update_orthodontic_case\([\s\S]*?p_expected_revision integer/);
  assert.match(sql, /v_row\.revision <> p_expected_revision[\s\S]*?errcode = '40001'/);
  assert.match(sql, /set revision = revision \+ 1/);
  assert.match(sql, /insert into public\.smyl_orthodontic_case_versions/g);
  assert.match(sql, /smyl_orthodontic_case_versions_guard[\s\S]*?before update or delete/);
  assert.match(sql, /El historial ortodóntico es inmutable/);
});

test('activar el caso exige aprobación y consentimiento vigente', () => {
  const transition = sql.match(/create or replace function public\.smyl_transition_orthodontic_phase[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(transition, /clinical\.approve/);
  assert.match(transition, /p_phase = 'active'/);
  assert.match(transition, /smyl_informed_consents/);
  assert.match(transition, /revoked_at is null/);
  assert.match(transition, /Vincula un consentimiento informado vigente/);
  assert.match(transition, /Un caso ortodóntico cerrado no se reabre/);
});

test('vincular consentimiento y activar es una sola operación atómica', () => {
  const activation = sql.match(/create or replace function public\.smyl_activate_orthodontic_case[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(activation, /p_expected_revision integer/);
  assert.match(activation, /clinical\.approve/);
  assert.match(activation, /for update/);
  assert.match(activation, /v_row\.revision <> p_expected_revision[\s\S]*?errcode = '40001'/);
  assert.match(activation, /smyl_informed_consents/);
  assert.match(activation, /c\.revoked_at is null/);
  assert.match(activation, /set phase = 'active'/);
  assert.match(activation, /consent_id = p_consent_id/);
  assert.match(activation, /insert into public\.smyl_orthodontic_case_versions/);
});

test('crear un control es idempotente y crea nota más índice en la misma transacción', () => {
  const fn = sql.match(/create or replace function public\.smyl_create_orthodontic_control[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(fn, /pg_advisory_xact_lock/);
  assert.match(fn, /where tenant_id = v_tenant and clinical_note_id = p_clinical_note_id/);
  assert.ok(fn.indexOf('select * into v_control') < fn.indexOf('insert into public.smyl_clinical_notes'));
  assert.match(fn, /insert into public\.smyl_clinical_notes/);
  assert.match(fn, /insert into public\.smyl_clinical_note_versions/);
  assert.match(fn, /insert into public\.smyl_orthodontic_controls/);
  assert.match(fn, /'caseId', v_case\.id/);
  assert.match(fn, /'treatmentId', v_case\.treatment_chapter_id/);
  assert.match(fn, /'controlType', p_control_type/);
  assert.match(fn, /'phase', v_case\.phase/);
  assert.match(fn, /v_case\.phase in \('records','planning'\) and p_control_type not in \('baseline','emergency'\)/);
  assert.match(fn, /Antes de registrar ajustes, activa el caso con un consentimiento informado vigente/);
  assert.match(fn, /El capítulo de tratamiento ya no está activo/);
});

test('la evidencia se vincula por contexto sin copiar archivos', () => {
  assert.match(sql, /'comparison','orthodontic_case'/);
  assert.match(sql, /clinical_role is null or clinical_role in \('baseline','progress','issue','final','retention'\)/);
  const fn = sql.match(/create or replace function public\.smyl_link_orthodontic_evidence[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(fn, /smyl_clinical_evidence_studies/);
  assert.match(fn, /patient_id = v_case\.patient_id and id = p_study_id/);
  assert.match(fn, /La nota no pertenece a un control de este caso/);
  assert.match(fn, /'orthodontic_case'/);
  assert.match(fn, /'clinical_note'/);
  assert.doesNotMatch(fn, /storage_path|smyl_patient_files|insert into public\.smyl_clinical_evidence_assets/);
});

test('las RPC públicas tienen firmas estables y sólo authenticated puede ejecutarlas', () => {
  for (const signature of [
    'smyl_get_orthodontic_case\\(uuid\\)',
    'smyl_create_orthodontic_case\\(uuid, jsonb\\)',
    'smyl_update_orthodontic_case\\(uuid, integer, jsonb\\)',
    'smyl_transition_orthodontic_phase\\(uuid, integer, text\\)',
    'smyl_activate_orthodontic_case\\(uuid, integer, uuid\\)',
    'smyl_create_orthodontic_control\\(uuid, uuid, uuid, uuid, text, timestamptz, jsonb\\)',
    'smyl_list_orthodontic_controls\\(uuid\\)',
    'smyl_link_orthodontic_evidence\\(uuid, uuid, uuid, text\\)'
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
});

test('la reconciliación reconoce el backend canónico ya aplicado', () => {
  const sentinels = read('scripts/migration-sentinels.mjs');
  assert.match(sentinels, /'20261126220000': \{ sentinel:/);
  assert.match(sentinels, /smyl_orthodontic_cases/);
  assert.match(sentinels, /smyl_create_orthodontic_control/);
  assert.match(sentinels, /smyl_activate_orthodontic_case/);
});

const require = createRequire(import.meta.url);
let pgliteEntry;
try {
  pgliteEntry = require.resolve('@electric-sql/pglite', { paths: [
    ...(process.env.SMYL_PGLITE_DIR ? [resolve(process.env.SMYL_PGLITE_DIR)] : []),
    resolve('.')
  ] });
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || process.env.SMYL_REQUIRE_PGLITE === '1') throw error;
}

test('PostgreSQL ejecuta el flujo caso → activación → control → evidencia sin duplicados', {
  skip: pgliteEntry ? false : 'Define SMYL_PGLITE_DIR para ejecutar el contrato en PostgreSQL.'
}, async t => {
  const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await db.exec(read('tests/fixtures/orthodontics-backend-stubs.sql'));
  await db.exec(sql);
  const { SENTINELAS } = await import('../scripts/migration-sentinels.mjs');
  assert.equal((await db.query(SENTINELAS['20261126220000'].sentinel)).rows[0].ok, true);
  await db.exec(read('tests/fixtures/orthodontics-backend-scenarios.sql'));
  const counts = (await db.query(`
    select
      (select count(*)::integer from public.smyl_orthodontic_cases) cases,
      (select count(*)::integer from public.smyl_orthodontic_case_versions) versions,
      (select count(*)::integer from public.smyl_orthodontic_controls) controls,
      (select count(*)::integer from public.smyl_clinical_notes) notes,
      (select count(*)::integer from public.smyl_clinical_evidence_context_links) links
  `)).rows[0];
  assert.deepEqual(counts, { cases: 1, versions: 2, controls: 1, notes: 1, links: 2 });
});
