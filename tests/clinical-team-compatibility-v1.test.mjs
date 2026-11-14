import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261108130000_smyl_clinical_team_compatibility.sql');
const dental = read('smyl-dental-record.js');
const photoModel = read('smyl-photo-review-model.js');
const radiographModel = read('smyl-radiograph-review-model.js');

function body(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `falta ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start));
}

test('el bucket radiográfico separa lectura y escritura y conserva cuarentena e inmutabilidad', () => {
  const path = body('smyl_radiograph_path_allowed');
  assert.match(path, /v_tenant uuid := public\.smyl_current_tenant\(\)/);
  assert.match(path, /smyl_has_permission\(v_tenant,p_permission\)/);
  assert.match(path, /smyl_can_access_patient\(v_tenant,v_patient,'clinical'\)/);
  assert.match(path, /split_part\(p_name,'\/',1\) <> v_tenant::text/);
  assert.match(sql, /create policy rx_read[\s\S]*smyl_radiograph_path_allowed\(name,'clinical\.read'\)[\s\S]*smyl_file_is_usable\(bucket_id,name\)/);
  assert.match(sql, /create policy rx_insert[\s\S]*smyl_radiograph_path_allowed\(name,'clinical\.write'\)/);
  assert.match(sql, /create policy rx_read_guard on storage\.objects as restrictive/);
  assert.match(sql, /create policy rx_insert_guard on storage\.objects as restrictive/);
  assert.doesNotMatch(sql, /drop policy if exists rx_no_(update|delete)/);
});

test('guardar expediente deriva tenant y actor del servidor y exige alcance clínico', () => {
  const save = body('smyl_save_dental_record');
  assert.match(save, /v_tenant uuid:=public\.smyl_current_tenant\(\); v_actor uuid:=auth\.uid\(\)/);
  assert.match(save, /smyl_has_permission\(v_tenant,'clinical\.write'\)/);
  assert.match(save, /smyl_can_access_patient\(v_tenant,p_patient_id,'clinical'\)/);
  assert.match(save, /expected:=v_tenant::text\|\|'\/'\|\|p_patient_id::text/);
  assert.match(save, /values\(p_patient_id,v_tenant,p_expected_revision\+1,p_document,v_actor,clock_timestamp\(\)\)/);
  assert.match(save, /where smyl_dental_records\.tenant_id=excluded\.tenant_id/);
  for (const invariant of [
    'Invalid dental record', 'Too many studies', 'Invalid tooth note', 'Invalid study',
    'Invalid radiograph', 'Invalid size', 'Foreign radiograph', 'Radiograph unavailable',
    'Too many marks', 'Invalid mark', 'Invalid coordinates', 'Original radiographs are immutable',
    'Dental revision conflict'
  ]) assert.ok(save.includes(invariant), `se conservó ${invariant}`);
});

test('la autorización de IA exige write y approve y liga la fuente al paciente', () => {
  const authorize = body('smyl_authorize_clinical_ai');
  assert.match(authorize, /smyl_radiograph_guard\(p_patient_id,'clinical\.write'\)/);
  assert.match(authorize, /smyl_radiograph_guard\(p_patient_id,'clinical\.approve'\)/);
  assert.match(authorize, /s\.tenant_id=v_tenant and s\.patient_id=p_patient_id and s\.id=p_source_id/);
  assert.match(sql, /grant execute on function public\.smyl_authorize_clinical_ai\(uuid,uuid\) to authenticated/);
  assert.match(sql, /Debe invocarse[\s\S]*JWT del actor; no sustituye la autorización de una Edge Function/);
});

test('solicitar IA conserva límites, QC e idempotencia y ahora requiere autorización clínica completa', () => {
  const request = body('smyl_radiograph_request_ai_run');
  assert.match(request, /smyl_authorize_clinical_ai\(v_source\.patient_id,p_source_id\)/);
  assert.match(request, /p_kind not in \('qc','tooth_localization','finding_candidates'\)/);
  assert.match(request, /smyl_radiograph_flag_enabled\(v_flag, v_tenant\)/);
  assert.match(request, /smyl_radiograph_active_engine\(p_kind\)/);
  assert.match(request, /v_qc is null or v_qc->'quality'->>'status' = 'unusable'/);
  assert.match(request, /daily_run_cap/);
  assert.match(request, /failed_retry_cap/);
  assert.match(request, /not p_acknowledge_unconfirmed and exists/);
  assert.match(request, /sha256\(convert_to\(v_source\.sha256/);
});

test('decidir un candidato exige approve sin relajar contrato, firma o control de concurrencia', () => {
  const decide = body('smyl_radiograph_decide_candidate');
  assert.match(decide, /smyl_authorize_clinical_ai\(v_candidate\.patient_id,v_candidate\.source_id\)/);
  assert.match(decide, /p_state not in \('confirmed','corrected','rejected'\)/);
  assert.match(decide, /Sólo una corrección lleva datos/);
  assert.match(decide, /smyl_radiograph_geometry_valid\(v_payload->'geometry', false\)/);
  assert.match(decide, /El hallazgo forma parte de un informe firmado/);
  assert.match(decide, /errcode = 'PT409'/);
  assert.match(decide, /insert into public\.smyl_radiograph_decision_versions/);
});

test('los validadores aceptan al actor autenticado como UUID sin confundirlo con el tenant', () => {
  assert.match(radiographModel, /uuid\(row\.updated_by\)/);
  assert.doesNotMatch(radiographModel, /row\.updated_by===tenant/);
  assert.match(photoModel, /uuid\(row\.updated_by\)/);
  assert.doesNotMatch(photoModel, /row\.updated_by===row\.tenant_id/);
  assert.match(dental, /SmylCaseModel\.uuid\(r\.updated_by\)/);
  assert.doesNotMatch(dental, /r\.updated_by!==ctx\.tenant/);
});
