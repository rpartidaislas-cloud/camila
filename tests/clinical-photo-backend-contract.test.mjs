import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const edge = readFileSync(new URL('../supabase/functions/claude/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261110120000_smyl_clinical_photo_analysis.sql', import.meta.url), 'utf8');

test('clinical photo action accepts identifiers only and requires clinical.write', () => {
  assert.match(edge, /CLINICAL_PHOTO_ANALYSIS_ACTION\s*=\s*"analyze_clinical_photos_v1"/);
  assert.match(edge, /requirePermission\(auth, CORS, "clinical\.write"\)/);
  assert.match(edge, /exactKeys\(body, \["action", "requestId", "studyIds", "consent"\]\)/);
  assert.match(edge, /clinicalPhotoStudyIds\.length > 4/);
  assert.match(edge, /loadClinicalPhotoSources\(tenantEfectivo as string, user!\.id, clinicalPhotoStudyIds\)/);
});

test('server reloads and verifies each private original before Anthropic', () => {
  assert.match(edge, /storage\.from\("smyl-clinical-files"\)\.download/);
  assert.match(edge, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(edge, /matchesImageSignature\(bytes, file\.mime_type\)/);
  assert.match(edge, /blob\.size !== Number\(file\.size_bytes\)/);
  assert.match(edge, /clinicalPhotoDimensions\(bytes, file\.mime_type\)/);
  assert.match(edge, /dimensions\.width > 8000 \|\| dimensions\.height > 8000/);
  assert.match(edge, /4 \* Math\.ceil\(bytes\.byteLength \/ 3\) > 10 \* 1024 \* 1024/);
  assert.match(edge, /file\.category !== "clinical_photo"/);
  assert.match(edge, /smyl_actor_can_access_patient_explicit/);
});

test('prompt and schema enforce abstention and pending professional review', () => {
  assert.match(edge, /usable", "limited", "unusable/);
  assert.match(edge, /usa unusable y no generes findings/);
  assert.match(edge, /No des tratamientos, urgencias, pronósticos, costos ni porcentajes/);
  assert.match(edge, /Sólo dentición permanente FDI 11–48/);
  assert.match(edge, /smyl_store_clinical_photo_ai_analysis/);
  assert.doesNotMatch(edge, /studies:\s*report\.images[\s\S]{0,700}report:\s*report/);
});

test('migration is transactional, idempotent and never auto-confirms AI findings', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /smyl_reserve_clinical_photo_analysis/);
  assert.match(migration, /status in \('processing','completed','failed'\)/);
  assert.match(migration, /lease_until/);
  assert.match(edge, /reservation\?\.state === "processing"/);
  assert.match(migration, /unique \(tenant_id, request_id\)/);
  assert.match(migration, /'ai',v_db_category,'model_candidate'/);
  assert.match(migration, /\(v_finding->>'confidence'\)::numeric,'pending'/);
  assert.doesNotMatch(migration, /'ai'[\s\S]{0,500}'confirmed'/);
  assert.match(migration, /grant execute on function public\.smyl_store_clinical_photo_ai_analysis[\s\S]*to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /commit;\s*$/);
});

test('database contract requires every top-level property before persisting', () => {
  assert.match(migration, /not \(p_report \?& array\['schema','images','findings','limitations'\]\)/);
  assert.match(migration, /p_report->'schema' is distinct from '1'::jsonb/);
});

test('clinical photo analysis has a server-side feature quota', () => {
  assert.match(edge, /CLINICAL_PHOTO_DAILY_LIMIT/);
  assert.match(edge, /CLINICAL_PHOTO_MONTHLY_LIMIT/);
  assert.match(edge, /eq\("feature", "clinical_photo_analysis"\)/);
  assert.match(edge, /code: "ai_quota_exceeded"/);
});

test('file indexing reuses the verified patient file without copying storage bytes', () => {
  assert.match(migration, /create or replace function public\.smyl_evidence_register_photo_file/);
  assert.match(migration, /a\.patient_file_id=p_patient_file_id/);
  assert.match(migration, /'original',v_file\.id/);
  assert.doesNotMatch(migration, /storage\.objects|storage_path\s*=/i);
});

test('a professional can close a photo without inventing an AI finding', () => {
  assert.match(migration, /create table public\.smyl_clinical_photo_study_reviews/);
  assert.match(migration, /state text not null check \(state in \('reviewed_no_findings','not_evaluable','manual_only'\)\)/);
  assert.match(migration, /reviewer_id uuid not null references auth\.users\(id\)/);
  assert.match(migration, /reviewer_professional_id uuid not null/);
  assert.match(migration, /unique \(tenant_id, study_id, revision\)/);
  assert.match(migration, /create or replace function public\.smyl_evidence_set_photo_disposition/);
  assert.match(migration, /smyl_evidence_guard\(v_study\.patient_id,'clinical\.approve'\)/);
  assert.match(migration, /smyl_current_professional_id\(v_tenant\)/);
  assert.match(migration, /p_expected_revision/);
  assert.match(migration, /errcode='PT409'/);
  assert.match(migration, /Sugerencias pendientes|sugerencias pendientes/i);
  assert.match(migration, /before update or delete on public\.smyl_clinical_photo_study_reviews/);
  assert.match(migration, /grant execute on function public\.smyl_evidence_set_photo_disposition\(uuid,integer,text,text,text\)[\s\S]*to authenticated/);
  assert.match(migration, /smyl_clinical_photo_study_reviews_read[\s\S]*clinical\.read/);
});
