import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../smyl-evidence-model.js');
const sql = fs.readFileSync(new URL('../supabase/migrations/20261108120000_smyl_clinical_evidence_center.sql', import.meta.url), 'utf8');

test('la migración crea el expediente multimodal con RLS y sin reescribir tablas previas', () => {
  const tables = [
    'studies', 'assets', 'anatomy_links', 'context_links', 'findings', 'decisions',
    'reports', 'report_versions', 'report_addenda', 'access_events'
  ];
  for (const suffix of tables) {
    const table = `smyl_clinical_evidence_${suffix}`;
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`));
    assert.match(sql, new RegExp(`alter table public\\.%I enable row level security`));
    assert.match(sql, new RegExp(`'${table}'`));
  }
  assert.doesNotMatch(sql, /drop table|truncate table|delete from public\.smyl_/i);
});

test('modelo y base comparten modalidades, subtipos y categorías canónicas', () => {
  for (const modality of model.MODALITIES) assert.match(sql, new RegExp(`'${modality}'`));
  for (const subtype of Object.values(model.SUBTYPES).flat()) assert.match(sql, new RegExp(`'${subtype}'`));
  for (const category of model.FINDING_CATEGORIES) assert.match(sql, new RegExp(`'${category}'`));
});

test('tenant, paciente, estudio y hallazgo quedan ligados por claves compuestas', () => {
  assert.match(sql, /unique \(tenant_id, patient_id, id\)/);
  assert.match(sql, /foreign key \(tenant_id, patient_id, study_id\) references public\.smyl_clinical_evidence_studies\(tenant_id, patient_id, id\)/);
  assert.match(sql, /foreign key \(tenant_id, patient_id, study_id, finding_id\) references public\.smyl_clinical_evidence_findings\(tenant_id, patient_id, study_id, id\)/);
  assert.match(sql, /foreign key \(tenant_id, patient_id, report_id\) references public\.smyl_clinical_evidence_reports\(tenant_id, patient_id, id\)/);
});

test('la IA nunca confirma y las decisiones requieren aprobación profesional', () => {
  assert.match(sql, /origin = 'ai' and initial_state = 'pending'/);
  assert.match(sql, /origin = 'imported' and confidence is null and model is null and initial_state = 'pending'/);
  assert.match(sql, /smyl_evidence_guard\(v_finding\.patient_id,'clinical\.approve'\)/);
  assert.match(sql, /Sólo un profesional clínico registrado puede decidir un hallazgo/);
  assert.match(sql, /v_revision is distinct from p_expected_revision/);
  assert.match(sql, /Las sugerencias de IA sólo se registran desde un backend clínico verificado/);
});

test('los vínculos se crean, revocan y sustituyen sin borrar historia', () => {
  assert.match(sql, /function public\.smyl_evidence_link_context/);
  assert.match(sql, /function public\.smyl_evidence_revoke_link/);
  assert.match(sql, /function public\.smyl_evidence_supersede_study/);
  assert.match(sql, /from public\.smyl_appointments a\s+where a\.tenant_id=v_tenant and a\.patient_id=v_study\.patient_id and a\.id=p_context_id/);
  assert.match(sql, /from public\.smyl_clinical_notes n\s+where n\.tenant_id=v_tenant and n\.patient_id=v_study\.patient_id and n\.id=p_context_id/);
  assert.match(sql, /from public\.smyl_dental_records d\s+where d\.tenant_id=v_tenant and d\.patient_id=v_study\.patient_id/);
  assert.match(sql, /from public\.smyl_clinical_plans p\s+where p\.tenant_id=v_tenant and p\.patient_id=v_study\.patient_id/);
  assert.match(sql, /p_context_type in \('periodontogram','diagnosis'\)/);
  assert.match(sql, /no tiene todavía un almacén clínico canónico y permanece deshabilitado/);
  assert.match(sql, /Los vínculos clínicos no se borran; se revocan/);
});

test('la firma conserva informe y decisiones confirmadas en el hash', () => {
  assert.match(sql, /signed_hash=public\.smyl_evidence_report_hash\(jsonb_build_object\('schema',1,'tenantId',v_tenant,'patientId',v_old\.patient_id/);
  assert.match(sql, /'signedFindings',v_snapshot,'signedBy',auth\.uid\(\),'signedProfessionalId',v_professional,'signedAt',v_signed_at/);
  assert.match(sql, /Un estudio sustituido no puede volver a firmarse/);
  assert.match(sql, /Completa el control de calidad antes de firmar/);
  assert.match(sql, /El estudio requiere un archivo original antes de firmar/);
  assert.match(sql, /f\.initial_state\) not in \('confirmed','corrected'\)/);
  assert.match(sql, /smyl_clinical_evidence_report_versions\(tenant_id,patient_id,report_id,revision,snapshot,actor_id\)/);
  assert.doesNotMatch(sql, /signed_findings::text\) <= 131072/);
});
