import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decidirIA, MENSAJE_IA_NO_PERMITIDA } from '../supabase/functions/_shared/privacy-core.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');

test('solo se bloquea la IA cuando el paciente la negó o la retiró; sin decisión sigue igual', () => {
  assert.equal(decidirIA({ data: 'revoked', error: null }), 'revoked');
  assert.equal(decidirIA({ data: 'granted', error: null }), 'allowed');
  assert.equal(decidirIA({ data: 'unknown', error: null }), 'allowed', 'los pacientes anteriores no se detienen');
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
