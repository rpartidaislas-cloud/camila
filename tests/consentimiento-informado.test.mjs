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

test('la validación evita llegar a la firma con un documento mayor que el límite del servidor', () => {
  const f = { title: 'Procedimiento', description: 'Descripción suficiente', benefits: 'Beneficios suficientes', risks: 'R'.repeat(20000), alternatives: 'Alternativas suficientes', care: '', notes: '', relation: 'patient', signer: 'Ana', patient: 'Ana', clinic: 'Clínica', date: 'hoy', explained: true, inked: true };
  assert.match(IC.validate(f), /demasiado extenso/);
});

test('el flujo valida cada etapa sin mezclar lectura, firma y confirmación', () => {
  const f = { title: 'Extracción dental', description: 'Retiro del diente indicado', benefits: 'Eliminar dolor e infección', risks: 'Sangrado, inflamación e infección', alternatives: 'Tratamiento conservador cuando sea posible', signer: 'Ana', explained: true, inked: true, readFull: true, questions: true, answered: true };
  assert.equal(IC.stepIssue('procedure', f), '');
  assert.equal(IC.stepIssue('customize', f), '');
  assert.equal(IC.stepIssue('read', f), '');
  assert.equal(IC.stepIssue('sign', f), '');
  assert.match(IC.stepIssue('read', { ...f, explained: false }), /explicaste/);
  assert.match(IC.stepIssue('sign', { ...f, inked: false }), /firma/);
});

test('la experiencia usa documento seguro, firma adaptable y diálogo propio de revocación', () => {
  const source = read('smyl-informed-consent.js');
  assert.match(source, /new ResizeObserver\(resize\)/);
  assert.match(source, /distance >= 24 && points >= 2/);
  assert.match(source, /invalidateDocumentReview/);
  assert.match(source, /invalidateSigner/);
  assert.doesNotMatch(source, /window\.prompt|window\.alert|document\.write/);
  assert.match(source, /ic-revoke-dialog/);
  assert.match(source, /Firmar con mi celular/);
  assert.match(source, /Firmar en este dispositivo/);
  assert.match(source, /smyl_finalize_informed_consent_signature/);
  assert.match(source, /p_identity_verified: true/);
  assert.match(source, /Leí o recibí la lectura de este documento/);
  assert.doesNotMatch(source, /Enviar por WhatsApp|Firmar por WhatsApp/);
});

test('la versión web y la PWA comparten exactamente el mismo flujo profesional', () => {
  for (const file of ['app.html', 'sw.js', 'smyl-informed-consent.js', 'smyl-informed-consent.css', 'firma-consentimiento.html', 'smyl-consent-signature.js', 'smyl-consent-signature.css']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  assert.match(read('app.html'), /smyl-informed-consent\.css\?v=3/);
  assert.match(read('app.html'), /smyl-informed-consent\.js\?v=3/);
  assert.match(read('sw.js'), /firma-consentimiento\.html/);
  assert.match(read('sw.js'), /smyl-consent-signature\.js\?v=1/);
});

test('la base guarda texto exacto, huella, firma y profesional con cédula; no se edita ni se borra', () => {
  const sql = read('supabase/migrations/20261129130000_smyl_informed_consent_signing.sql');
  assert.match(sql, /encode\(sha256\(convert_to\(p_document_text, 'UTF8'\)\), 'hex'\)/);
  assert.match(sql, /v_method := public\.smyl_recent_auth_method\(600\)/);
  assert.match(sql, /revoke all on (?:table )?public\.smyl_informed_consents from public, anon, authenticated/);
  assert.match(sql, /Un consentimiento informado no se puede eliminar/);
  assert.match(sql, /signature_capture_method in \('clinic_device', 'clinic_qr'\)/);
  assert.match(sql, /identity_verification_method.*'in_person'/s);
  assert.match(sql, /smyl_valid_signature_png/);
  assert.match(sql, /p_idempotency_key uuid/);
  assert.doesNotMatch(sql, /pg_trigger_depth\(\) = 1/);
  assert.match(read('smyl-patient-360.js'), /window\.SmylInformedConsent\.mount\(\{host:s\.historyHost/);
  assert.match(read('app.html'), /smyl-informed-consent\.js\?v=3/);
});

test('la página pública conserva el token fuera de la ruta y exige revisar antes de enviar', () => {
  const html = read('firma-consentimiento.html');
  const js = read('smyl-consent-signature.js');
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /frame-ancestors 'none'/);
  assert.match(js, /location\.hash\.slice\(1\)/);
  assert.match(js, /history\.replaceState/);
  assert.match(js, /smyl_informed_consent_signature_link_info/);
  assert.match(js, /smyl_submit_informed_consent_signature/);
  assert.match(js, /acceptanceText: value\.acceptance_text \|\| ACCEPTANCE_TEXT/);
  assert.match(js, /output\.width = 600/);
  assert.match(js, /output\.height = 200/);
  assert.match(js, /Revisa este consentimiento/);
  assert.match(js, /Confirma tu firma/);
});
