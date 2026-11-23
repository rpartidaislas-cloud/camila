import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import P from '../smyl-patient-privacy-panel.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');
const firmado = { signed: true, signed_at: '2026-11-21T10:00:00Z', signer_name: 'Ana López', signer_relation: 'patient', notice_version: 'modelo-provisional-2', provisional: true };
const fmt = () => '21 de noviembre de 2026';

test('sin firma: falta el aviso, las decisiones sin tomar quedan pendientes y se avisa qué falta', () => {
  const m = P.model({ consent: { signed: false }, privacy: { ai_processing: { state: 'unknown' }, whatsapp: { state: 'unknown' }, marketing: { state: 'unknown' } } }, fmt);
  assert.equal(m.signed, false);
  assert.equal(m.state, 'pending');
  assert.equal(m.missing, 'Aviso de privacidad');
  assert.deepEqual(m.rows.map((r) => [r.label, r.badge]), [['Aviso de privacidad', 'Por firmar'], ['Inteligencia artificial', 'Sin decidir'], ['WhatsApp', 'Sin decidir'], ['Promociones', 'Sin decidir']]);
});

test('firmado con decisiones: quién, cuándo, versión, y la negativa de IA se dice claro', () => {
  const m = P.model({ consent: firmado, privacy: { ai_processing: { state: 'revoked' }, whatsapp: { state: 'granted' }, marketing: { state: 'revoked' } } }, fmt);
  assert.equal(m.missing, '');
  assert.equal(m.state, 'ok');
  assert.deepEqual(m.rows[0].lines, ['Firmado el 21 de noviembre de 2026 por Ana López.', 'Versión modelo-provisional-2 · texto modelo provisional']);
  assert.deepEqual(m.rows.slice(1).map((r) => [r.badge, r.state]), [['No acepta', 'alert'], ['Aceptó', 'ok'], ['No acepta', 'alert']]);
  assert.match(m.rows[1].text, /La IA no procesará sus datos/);
});

test('si no se puede leer nada no se inventa: queda sin dato y no se marca como pendiente', () => {
  const m = P.model({ consent: undefined, privacy: null }, fmt);
  assert.ok(m.rows.every((r) => r.state === 'empty'));
  assert.equal(m.state, 'neutral');
});

test('la sección es solo del consentimiento: sin atajos a otras pantallas ni solicitudes de derechos', () => {
  const m = P.model({ consent: { signed: false }, privacy: null, openRequests: 3 }, fmt);
  assert.ok(m.rows.every((r) => r.label !== 'Solicitudes de derechos'), 'las solicitudes ARCO viven en Privacidad y derechos');
  const html = P.render(m, 6, { link: true, screen: true, requests: true });
  assert.doesNotMatch(html, /data-hp-requests|data-hp-screen|Ver solicitudes|Firmar en pantalla/);
  assert.match(html, /Consentimiento de privacidad/);
  assert.match(html, /Lo que firmó el paciente y lo que permite sobre sus datos/);
});

test('los botones de firma solo se ofrecen si falta la firma y el rol puede actuar; todo se escapa', () => {
  const sin = P.model({ consent: { signed: false }, privacy: null }, fmt);
  const html = P.render(sin, 6, { link: true, screen: true });
  assert.match(html, /data-hp-link/); assert.match(html, /Que firme en su celular/);
  assert.doesNotMatch(P.render(sin, 6, {}), /data-hp-link/, 'sin permiso no hay botones');
  assert.doesNotMatch(P.render(P.model({ consent: firmado, privacy: null }, fmt), 6, { link: true, screen: true }), /data-hp-link/, 'ya firmado no se vuelve a pedir');
  const hostil = P.render(P.model({ consent: { signed: true, signer_name: '<img src=x onerror=alert(1)>', notice_version: '"><b>' }, privacy: null }, fmt), 6, {});
  assert.doesNotMatch(hostil, /<img/); assert.match(hostil, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(hostil, /&quot;&gt;&lt;b&gt;/);
  assert.match(P.indexButton(6, sin), /6 · Consentimiento/);
});

test('el expediente carga el módulo y lo monta en la historia clínica; la copia móvil es igual', () => {
  const t = read('smyl-patient-360.js');
  assert.match(t, /SmylPatientPrivacyPanel\.mount\(\{host:s\.historyHost,tenant:s\.tenant,patient:s\.patient/);
  for (const f of ['app.html', 'mobile/www/app.html']) { const a = read(f); assert.match(a, /smyl-patient-privacy-panel\.js\?v=5/); assert.match(a, /smyl-patient-privacy-panel\.css\?v=4/); assert.match(a, /smyl-patient-360\.js\?v=39/); }
  for (const f of ['sw.js', 'mobile/www/sw.js']) { const a = read(f); assert.match(a, /\/camila\/smyl-patient-privacy-panel\.js\?v=5/); assert.match(a, /privacidad-expediente-v2/); }
  for (const f of ['smyl-patient-privacy-panel.js', 'smyl-patient-privacy-panel.css', 'smyl-patient-360.js', 'smyl-consultorio.js', 'smyl-consultorio.css']) assert.equal(read(f), read('mobile/www/' + f), f);
  const js = read('smyl-patient-privacy-panel.js');
  assert.doesNotMatch(js.replace(/innerHTML = svg|tpl\.innerHTML = [^;]*;|itpl\.innerHTML = [^;]*;|qr\.innerHTML = svg/g, ''), /innerHTML/);
});

test('la firma en pantalla de Consultorio pide las tres decisiones y las guarda una por una', () => {
  const js = read('smyl-consultorio.js');
  assert.match(js, /CONSENT_CHOICES = \[\['ai_processing'/);
  assert.match(js, /rpc\('smyl_set_patient_privacy_choice'/);
  assert.match(js, /Falta elegir Sí o No en/);
});
