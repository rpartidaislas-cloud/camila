import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const IC = require('../smyl-informed-consent.js');
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('las plantillas cubren los procedimientos comunes con riesgos, beneficios y alternativas', () => {
  for (const key of ['profilaxis', 'resina', 'endodoncia', 'extraccion', 'carillas', 'blanqueamiento', 'implante', 'ortodoncia']) {
    const t = IC.TEMPLATES.find((x) => x.key === key);
    assert.ok(t && t.description && t.benefits && t.risks.length > 40 && t.alternatives, key);
  }
});

test('el documento firmado contiene todos los elementos y la validación exige explicación y firma', () => {
  const f = { title: 'Extracción dental', description: 'Retiro del diente 38', benefits: 'Eliminar el dolor', risks: 'Sangrado, infección y alveolitis', alternatives: 'Conservar el diente con endodoncia', care: '', notes: '', relation: 'patient', signer: 'Ana', patient: 'Ana', clinic: 'Clínica', date: 'hoy', explained: false, inked: false };
  assert.match(IC.validate(f), /Confirma que explicaste/);
  assert.match(IC.validate({ ...f, explained: true }), /Falta la firma/);
  assert.equal(IC.validate({ ...f, explained: true, inked: true }), '');
  const text = IC.compose(f);
  for (const part of ['CONSENTIMIENTO INFORMADO', 'Procedimiento: Extracción dental', 'Beneficios esperados:', 'Riesgos y posibles complicaciones:', 'Alternativas:', 'puedo revocar', 'NOM-004-SSA3-2012']) assert.ok(text.includes(part), part);
  assert.ok(IC.render([{ id: '1', procedure_title: '<b>x</b>', signer_name: 'A', professional_name: 'B', professional_license: '1', signed_at: new Date().toISOString() }], 7, true).includes('&lt;b&gt;x&lt;/b&gt;'), 'escapa');
});

test('la base guarda texto exacto, huella, firma y profesional con cédula; no se edita ni se borra', () => {
  const sql = read('supabase/migrations/20261126120000_smyl_informed_consents.sql');
  assert.match(sql, /encode\(sha256\(convert_to\(p_document_text, 'UTF8'\)\), 'hex'\)/);
  assert.match(sql, /v_method := public\.smyl_recent_auth_method\(600\)/);
  assert.match(sql, /revoke all on public\.smyl_informed_consents from public, anon, authenticated/);
  assert.match(sql, /Un consentimiento informado no se puede eliminar/);
  assert.match(sql, /union all select max\(signed_at\) from public\.smyl_informed_consents/);
  assert.match(read('smyl-patient-360.js'), /window\.SmylInformedConsent\.mount\(\{host:s\.historyHost/);
  assert.match(read('app.html'), /smyl-informed-consent\.js\?v=1/);
});
