import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261126210000_smyl_clinical_security_hardening.sql');

test('revocar un consentimiento exige autenticación reciente desde el servidor', () => {
  const body = sql.match(/create or replace function public\.smyl_revoke_informed_consent[\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.match(body, /smyl_recent_auth_method\(600\)/);
  assert.match(body, /hint = 'reauth_required'/);
  assert.match(body, /revoked_auth_method = v_method/);
  assert.match(body, /for update/);
  assert.match(sql, /array\['revoked_at', 'revoked_reason', 'revoked_by', 'revoked_auth_method'\]/);
});

test('la lectura de recetas respeta el alcance clínico sobre el paciente', () => {
  const policy = sql.match(/create policy smyl_prescriptions_read[\s\S]*?\);/i)?.[0] || '';
  assert.match(policy, /smyl_has_permission\(tenant_id, 'clinical\.read'\)/);
  assert.match(policy, /smyl_can_access_patient\(tenant_id, patient_id, 'clinical'\)/);
});

test('emitir y anular recetas pasan por envolturas seguras y el núcleo no queda expuesto', () => {
  assert.match(sql, /rename to smyl_issue_prescription_core_20261125/);
  assert.match(sql, /rename to smyl_void_prescription_core_20261125/);
  assert.match(sql, /revoke all on function public\.smyl_issue_prescription_core_20261125[\s\S]*?authenticated/);
  assert.match(sql, /revoke all on function public\.smyl_void_prescription_core_20261125[\s\S]*?authenticated/);

  const issue = sql.match(/create or replace function public\.smyl_issue_prescription\([\s\S]*?\n\$\$;/i)?.[0] || '';
  const voidPrescription = sql.match(/create or replace function public\.smyl_void_prescription\(p_id uuid, p_reason text\)[\s\S]*?\n\$\$;/i)?.[0] || '';
  assert.match(issue, /smyl_can_access_patient\(v_tenant, p_patient_id, 'clinical'\)/);
  assert.match(issue, /v_existing\.patient_id is distinct from p_patient_id/);
  assert.match(voidPrescription, /smyl_can_access_patient\(v_tenant, v_target\.patient_id, 'clinical'\)/);
});

test('web y PWA conservan los mismos nombres públicos de RPC', () => {
  const web = read('smyl-prescriptions.js');
  const mobile = read('mobile/www/smyl-prescriptions.js');
  assert.equal(web, mobile);
  assert.match(web, /smyl_issue_prescription/);
  assert.match(web, /smyl_void_prescription/);
  assert.match(read('smyl-informed-consent.js'), /smyl_revoke_informed_consent/);
});

test('la reconciliación puede reconocer la migración sin intentar reaplicarla', () => {
  const sentinels = read('scripts/migration-sentinels.mjs');
  assert.match(sentinels, /'20261126210000': \{ sentinel:/);
  assert.match(sentinels, /revoked_auth_method/);
  assert.match(sentinels, /smyl_issue_prescription_core/);
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

test('PostgreSQL aplica el cierre y hace cumplir autenticación y alcance por paciente', {
  skip: pgliteEntry ? false : 'Define SMYL_PGLITE_DIR para ejecutar el contrato en PostgreSQL.'
}, async t => {
  const { PGlite } = await import(pathToFileURL(pgliteEntry).href);
  const db = new PGlite();
  t.after(() => db.close());

  const tenant = '10000000-0000-4000-8000-000000000001';
  const actor = '10000000-0000-4000-8000-000000000002';
  const patientA = '10000000-0000-4000-8000-000000000003';
  const patientB = '10000000-0000-4000-8000-000000000004';
  const consent = '10000000-0000-4000-8000-000000000005';
  const prescriptionA = '10000000-0000-4000-8000-000000000006';
  const prescriptionB = '10000000-0000-4000-8000-000000000007';

  await db.exec(read('tests/fixtures/clinical-security-hardening-stubs.sql'));
  await db.exec(sql);
  const { SENTINELAS } = await import('../scripts/migration-sentinels.mjs');
  assert.equal((await db.query(SENTINELAS['20261126210000'].sentinel)).rows[0].ok, true);
  await db.exec(`
    select set_config('test.tenant_id', '${tenant}', false);
    select set_config('test.actor_id', '${actor}', false);
    select set_config('test.allowed_patient', '${patientA}', false);
    select set_config('test.recent_auth_method', '', false);
    insert into public.camila_pacientes(id, tenant_id) values ('${patientA}', '${tenant}'), ('${patientB}', '${tenant}');
    insert into public.smyl_informed_consents(id, tenant_id, patient_id) values ('${consent}', '${tenant}', '${patientA}');
  `);

  await assert.rejects(
    db.exec(`select public.smyl_revoke_informed_consent('${consent}', 'Solicitud del paciente')`),
    /Confirma tu identidad/
  );
  await db.exec(`
    select set_config('test.recent_auth_method', 'password', false);
    select public.smyl_revoke_informed_consent('${consent}', 'Solicitud del paciente');
  `);
  assert.deepEqual((await db.query(`select revoked_auth_method, revoked_by from public.smyl_informed_consents where id = '${consent}'`)).rows[0], {
    revoked_auth_method: 'password',
    revoked_by: actor
  });

  await db.exec(`select public.smyl_issue_prescription(
    '${prescriptionA}', '20000000-0000-4000-8000-000000000001', '${patientA}', null, null,
    'Control', 'Indicaciones', '[]'::jsonb, true
  )`);
  await assert.rejects(
    db.exec(`select public.smyl_issue_prescription(
      '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', '${patientB}', null, null,
      'Control', 'Indicaciones', '[]'::jsonb, true
    )`),
    /No tienes acceso clínico/
  );

  await db.exec(`
    select set_config('test.allowed_patient', '${patientB}', false);
    select public.smyl_issue_prescription(
      '${prescriptionB}', '20000000-0000-4000-8000-000000000004', '${patientB}', null, null,
      'Control', 'Indicaciones', '[]'::jsonb, true
    );
    select set_config('test.allowed_patient', '${patientA}', false);
  `);
  await assert.rejects(
    db.exec(`select public.smyl_void_prescription('${prescriptionB}', 'Corrección clínica')`),
    /No tienes acceso clínico/
  );
  assert.equal((await db.query(`select status from public.smyl_prescriptions where id = '${prescriptionB}'`)).rows[0].status, 'issued');
});
