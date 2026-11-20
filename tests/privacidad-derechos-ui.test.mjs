import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const src = read('smyl-privacy-rights.js');
const m = { exports: {} };
new Function('module', src)(m);
const P = m.exports;

test('plazos de las solicitudes: vencida, vence hoy, por vencer, en plazo y cerrada', () => {
  const hoy = '2026-11-20';
  assert.deepEqual(P.dueInfo({ status: 'received', due_on: '2026-11-16' }, hoy), { kind: 'overdue', days: -4, text: 'Vencida hace 4 días' });
  assert.equal(P.dueInfo({ status: 'received', due_on: '2026-11-19' }, hoy).text, 'Vencida hace 1 día');
  assert.equal(P.dueInfo({ status: 'in_review', due_on: '2026-11-20' }, hoy).text, 'Vence hoy');
  assert.equal(P.dueInfo({ status: 'in_review', due_on: '2026-11-21' }, hoy).text, 'Vence en 1 día');
  assert.equal(P.dueInfo({ status: 'received', due_on: '2026-11-23' }, hoy).kind, 'soon');
  assert.equal(P.dueInfo({ status: 'received', due_on: '2026-11-24' }, hoy).kind, 'ok');
  assert.equal(P.dueInfo({ status: 'completed', due_on: '2026-10-01' }, hoy).kind, 'closed', 'una cerrada no cuenta como vencida');
  assert.equal(P.dueInfo({ status: 'rejected', due_on: '2026-10-01' }, hoy).text, 'Rechazada');
  assert.equal(P.dueInfo({ status: 'received', due_on: 'no-fecha' }, hoy).kind, 'unknown');
  assert.equal(P.dueInfo(null, hoy).kind, 'unknown');
});

test('resumen y filtros: solo cuentan las abiertas, y las vencidas se destacan', () => {
  const rows = [{ status: 'received', due_on: '2026-11-10' }, { status: 'in_review', due_on: '2026-11-30' }, { status: 'completed', due_on: '2026-11-01' }, { status: 'rejected', due_on: '2026-11-01' }];
  assert.deepEqual(P.counts(rows, '2026-11-20'), { open: 2, overdue: 1 });
  assert.equal(P.visible(rows, 'open').length, 2);
  assert.equal(P.visible(rows, 'closed').length, 2);
  assert.equal(P.visible(rows, 'all').length, 4);
  assert.deepEqual(P.counts([], '2026-11-20'), { open: 0, overdue: 0 });
});

test('una oposición solo ofrece retirar lo que todavía no está retirado', () => {
  assert.deepEqual(P.revocablePurposes(null), ['ai_processing', 'whatsapp', 'marketing']);
  assert.deepEqual(P.revocablePurposes({ ai_processing: { state: 'revoked' }, whatsapp: { state: 'unknown' }, marketing: { state: 'granted' } }), ['whatsapp', 'marketing']);
});

test('nombres de archivo seguros y mensajes comprensibles', () => {
  assert.equal(P.fileName({ nombre: 'José', apellido: 'Muñoz Pérez' }, '2026-11-20'), 'datos-jose-munoz-perez-2026-11-20.json');
  assert.equal(P.fileName({ nombre: '../../x', apellido: '<script>' }, '2026-11-20'), 'datos-x-script-2026-11-20.json');
  assert.equal(P.fileName(null, '2026-11-20'), 'datos-paciente-2026-11-20.json');
  assert.match(P.friendly({ code: '42501' }), /rol no permite/);
  assert.match(P.friendly({ code: '55000' }), /ya está cerrada/);
  assert.match(P.friendly({ code: '22023', message: 'ERROR: Escribe la resolución (al menos 10 caracteres).' }), /^Escribe la resolución/);
  assert.match(P.friendly({ code: 'PGRST202' }), /todavía no está activada/);
  assert.match(P.friendly({ message: 'boom' }), /No se pudo completar/);
});

test('los textos cubren los cinco derechos y las tres finalidades, sin términos técnicos', () => {
  assert.deepEqual(Object.keys(P.RIGHTS), ['access', 'rectification', 'cancellation', 'opposition', 'revocation']);
  assert.deepEqual(Object.keys(P.PURPOSES), ['ai_processing', 'whatsapp', 'marketing']);
  assert.match(P.PURPOSES.ai_processing.label, /IA/);
  for (const v of [...Object.values(P.RIGHTS), ...Object.values(P.STATUS), ...Object.values(P.PURPOSES).map((x) => x.label)]) assert.doesNotMatch(v, /_|rpc|smyl/i);
});

test('la pantalla nunca arma HTML con datos: solo textContent (sin XSS por nombres o detalles)', () => {
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test('usa solo las funciones de la base con permiso y nunca escribe tablas directo', () => {
  for (const fn of ['smyl_open_data_request', 'smyl_update_data_request', 'smyl_set_patient_privacy_choice', 'smyl_patient_privacy_status', 'smyl_export_patient_data']) assert.match(src, new RegExp(fn));
  assert.doesNotMatch(src, /\.from\('smyl_data_rights_requests'\)\.(insert|update|delete|upsert)/);
  assert.doesNotMatch(src, /\.from\('smyl_patient_privacy_events'\)/);
  assert.match(src, /\.from\('smyl_data_rights_requests'\)\.select\('\*'\)\.eq\('tenant_id', win\.tenantId\)/);
});

test('se publica en la app, el service worker, Configuración y la app móvil', () => {
  for (const f of ['app.html', 'mobile/www/app.html']) {
    const html = read(f);
    assert.match(html, /<link rel="stylesheet" href="smyl-privacy-rights\.css\?v=1">/);
    assert.match(html, /<script defer src="smyl-privacy-rights\.js\?v=1"><\/script>/);
  }
  for (const f of ['sw.js', 'mobile/www/sw.js']) assert.match(read(f), /smyl-privacy-rights\.js\?v=1[\s\S]*smyl-privacy-rights\.css\?v=1/);
  assert.match(read('smyl-settings-hub.js'), /title: 'Privacidad y derechos'[^\n]*route: 'privacidad'/);
  assert.match(read('smyl-navigation.js'), /'seguridad', 'privacidad', 'sim-config'/);
  assert.match(read('smyl-navigation.js'), /\['Privacidad y derechos', 'privacidad', 'shield'\]/);
  for (const f of ['smyl-privacy-rights.js', 'smyl-privacy-rights.css', 'smyl-settings-hub.js', 'smyl-navigation.js', 'smyl-privacy-notice.js']) assert.equal(read(f), read('mobile/www/' + f), f);
});
