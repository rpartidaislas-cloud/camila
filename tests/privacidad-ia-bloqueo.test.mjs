import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decidirIA, MENSAJE_IA_NO_PERMITIDA } from '../supabase/functions/_shared/privacy-core.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');

test('la IA solo se usa con autorización expresa: sin decisión registrada también se bloquea', () => {
  assert.equal(decidirIA({ data: 'revoked', error: null }), 'revoked');
  assert.equal(decidirIA({ data: 'granted', error: null }), 'allowed');
  assert.equal(decidirIA({ data: 'unknown', error: null }), 'missing', 'datos de salud: consentimiento expreso (LFPDPPP)');
  const ts = read('supabase/functions/_shared/privacy.ts');
  assert.match(ts, /permiso === 'missing'\) return \{ status: 403, body: \{ error: MENSAJE_IA_SIN_AUTORIZACION, code: 'patient_ai_consent_missing' \} \}/);
});

test('ante un error o una respuesta rara se bloquea (no se manda nada a un tercero)', () => {
  assert.equal(decidirIA({ data: null, error: { message: 'x' } }), 'unavailable');
  assert.equal(decidirIA(null), 'unavailable');
  assert.equal(decidirIA({ data: null, error: null }), 'unavailable');
  assert.equal(decidirIA({ data: 'otra', error: null }), 'unavailable');
  assert.match(MENSAJE_IA_NO_PERMITIDA, /no autorizó/);
});

test('el ayudante consulta la finalidad ai_processing con la función solo para service_role', () => {
  const ts = read('supabase/functions/_shared/privacy.ts');
  assert.match(ts, /rpc\('smyl_patient_privacy_state', \{ p_tenant: tenantId, p_patient: patientId, p_purpose: 'ai_processing' \}\)/);
  assert.match(ts, /status: 403/);
  assert.match(ts, /status: 503/);
  assert.match(read('supabase/migrations/20261123100000_smyl_privacy_rights.sql'), /grant execute on function public\.smyl_patient_privacy_state\(uuid, uuid, text\) to service_role/);
});

const WIRED = {
  'periodontal-summary': /respuestaIAnegada\(await permisoIA\(admin, auth\.tenantId, body\.patientId\)\)[\s\S]*?const key = Deno\.env\.get\('OPENAI_API_KEY'\)/,
  claude: /respuestaIAnegada\(await permisoIA\(usageAdmin, tenant, patientId\)\)[\s\S]*?smyl_clinical_evidence_assets/,
  'radiograph-analyze': /respuestaIAnegada\(await permisoIA\(admin, src\.tenant_id, src\.patient_id\)\)[\s\S]*?runRadiographAnalysis\(/,
  'cloud-classify': /respuestaIAnegada\(await permisoIA\(admin, tenantId, String\(file\.patient_id\)\)\)[\s\S]*?ANTHROPIC_API_KEY/,
  'fiscal-extract': /respuestaIAnegada\(await permisoIA\(admin, tenantId, body\.patient_id\)\)[\s\S]*?const ahora = new Date\(\)/,
  'mila-interview': /respuestaIAnegada\(await permisoIA\(admin, tenantId, patientId\)\)[\s\S]*?await purgeExpired\(\)/,
};
for (const [fn, re] of Object.entries(WIRED)) {
  test(`${fn}: revisa el permiso del paciente antes de mandar nada a la IA, y el paquete para pegar está al día`, () => {
    assert.match(read(`supabase/functions/${fn}/index.ts`), re);
    const bundle = read(`docs/bundles/${fn}.single-file.ts`);
    assert.match(bundle, /smyl_patient_privacy_state/);
    assert.match(bundle, /patient_ai_not_allowed/);
  });
}

test('la entrevista previa pasa a formulario (sin voz ni asistente) si el paciente no autorizó la IA', () => {
  const src = read('supabase/functions/mila-interview/index.ts');
  assert.match(src, /let mode = o\.mode;\s*\n\s*if \(mode !== "form" && \(await permisoIA\(admin, tenantId, String\(patient\.id\)\)\) !== "allowed"\) mode = "form";/);
});

test('el panel manda de qué paciente es la constancia, para que la función pueda respetar su decisión', () => {
  const js = read('smyl-fiscal-capture.js');
  assert.match(js, /invoke\('fiscal-extract', \{ body: \{ file_base64: await readBase64\(file\), media_type: file\.type, patient_id: patientId \|\| undefined \} \}\)/);
  assert.match(js, /extract\(file, options\.patientId\)/);
  assert.equal(js, read('mobile/www/smyl-fiscal-capture.js'));
});

test('el simulador del expediente manda el paciente y claude / segment-teeth respetan si negó la IA', () => {
  const sim = read('simulacion-rapida.html');
  assert.match(sim, /q\.get\('workspace'\) === 'professional'/);
  assert.match(sim, /h\['X-SMYL-Patient-Id'\] = PACIENTE_DEL_EXPEDIENTE/);
  assert.match(sim, /if \(!CFG\.modoProspecto && PACIENTE_DEL_EXPEDIENTE\)/, 'en modo prospecto no se manda: no hay paciente');
  assert.equal(sim, read('mobile/www/simulacion-rapida.html'));
  for (const fn of ['claude', 'segment-teeth']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    assert.match(src, /req\.headers\.get\("x-smyl-patient-id"\)/);
    assert.match(src, /x-tenant-id, x-smyl-patient-id/, 'el navegador puede mandar la cabecera (CORS)');
    assert.match(src, /respuestaIAnegada\(await permisoIA\(/);
    assert.match(read(`docs/bundles/${fn}.single-file.ts`), /x-smyl-patient-id/);
  }
});
