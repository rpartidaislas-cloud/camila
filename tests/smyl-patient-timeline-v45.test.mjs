import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261027130000_smyl_patient_timeline_v2.sql');
const workflow = read('../.github/workflows/smyl-ficha-360-timeline-migracion.yml');
const script = read('../smyl-patient-360.js');
const app = read('../app.html');
const worker = read('../sw.js');
const functionSql = migration.slice(
  migration.indexOf('create or replace function public.smyl_patient_timeline'),
  migration.indexOf('revoke all on function public.smyl_patient_timeline')
);

test('el RPC exige permiso clínico y alcance del paciente antes de leer', () => {
  assert.match(functionSql, /smyl_has_permission\(v_tenant,'clinical\.read'\)/);
  assert.match(functionSql, /smyl_can_access_patient\(patient\.tenant_id,patient\.id,'clinical'\)/);
  assert.match(functionSql, /errcode='42501',message='El paciente no está disponible para tu rol\.'/);
  assert.doesNotMatch(functionSql, /message='El paciente no existe\.'/);
});

test('cada dominio repite su permiso y alcance dentro del SECURITY DEFINER', () => {
  assert.match(functionSql, /smyl_has_permission\(v_tenant,'schedule\.read'\)/);
  assert.match(functionSql, /smyl_can_access_schedule_row\(/);
  assert.match(functionSql, /smyl_has_permission\(v_tenant,'proposal\.read'\)/);
  assert.match(functionSql, /smyl_has_permission\(v_tenant,'finance\.read'\)/);
  assert.match(functionSql, /smyl_can_access_finance_patient\(/);
  assert.match(functionSql, /smyl_has_permission\(v_tenant,'messages\.read'\)/);
  assert.match(functionSql, /smyl_can_access_patient\(v_tenant,p_patient_id,'messages'\)/);
});

test('la cronología cubre las fuentes longitudinales sin exponer su contenido', () => {
  for (const type of [
    'appointment','clinical_note','file','dental_record','photo_review','radiograph_review',
    'clinical_plan','proposal','proposal_event','finance_charge','finance_charge_voided',
    'finance_payment','finance_refund','finance_receipt','cfdi','conversation_link','conversation_file'
  ]) assert.match(functionSql, new RegExp(`'${type}'`));

  assert.doesNotMatch(functionSql, /\.document\b|\.snapshot\b|\.display_name\b|\.storage_path\b/);
  assert.doesNotMatch(functionSql, /\.concept\b|\.total_cents\b|\.amount\b|\.rfc\b|\.fiscal_snapshot\b/);
  assert.doesNotMatch(functionSql, /\.provider_message\b|\.external_uuid\b|\.lana_conversation_id\b|proposal_event\.note\b/);
});

test('el contrato conserva límite, orden estable y ACL cerrada', () => {
  assert.match(functionSql, /greatest\(1,least\(coalesce\(p_limit,100\),250\)\)/);
  assert.match(functionSql, /order by timeline\.event_at desc,timeline\.event_type,timeline\.reference_id,timeline\.metadata::text/);
  assert.match(migration, /language plpgsql security definer set search_path=pg_catalog,public/);
  assert.match(migration, /revoke all on function public\.smyl_patient_timeline\(uuid,integer\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.smyl_patient_timeline\(uuid,integer\) to authenticated/);
});

test('las lecturas directas sustituyen políticas amplias por alcance de paciente', () => {
  for (const policy of [
    'smyl_dental_records_scoped_read','smyl_dental_versions_scoped_read',
    'smyl_photo_reviews_scoped_read','smyl_radiograph_reviews_scoped_read',
    'smyl_patient_case_archive_scoped_read','smyl_clinical_plans_scoped_read',
    'smyl_clinical_versions_scoped_read','smyl_proposals_scoped_read',
    'smyl_proposal_versions_scoped_read','smyl_proposal_events_scoped_read',
    'camila_lana_handoffs_scoped_read','camila_lana_clinical_links_scoped_read'
  ]) assert.match(migration, new RegExp(`create policy ${policy}`));
  assert.match(migration, /drop policy if exists smyl_clinical_team_read/);
  assert.match(migration, /smyl_has_permission\(tenant_id,'proposal\.read'\)[\s\S]*smyl_can_access_patient/);
  assert.match(migration, /smyl_has_permission\(tenant_id,'messages\.read'\)[\s\S]*smyl_can_access_patient/);
});

test('la interfaz agrupa eventos y los lleva a su fuente canónica', () => {
  assert.match(script, /function timelineGroup\(item\)/);
  assert.match(script, /return 'proposals'/);
  assert.match(script, /return 'finance'/);
  assert.match(script, /return 'messages'/);
  assert.match(script, /\['dental_record','photo_review','radiograph_review','radiograph_source','radiograph_report','clinical_plan','proposal','proposal_event'\]/);
  assert.match(script, /showSection\(s,'billing'\)/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.match(app, /smyl-patient-360\.js\?v=15/);
  assert.match(worker, /patient-timeline-v45/);
});

test('la publicación de la migración es manual, idempotente y verificada', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /MIGRATION_VERSION: "20261027130000"/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /smyl_can_access_patient/);
  assert.match(workflow, /security_definer_ok/);
  assert.match(workflow, /public_blocked/);
  assert.match(workflow, /migration repair --status applied/);
});
