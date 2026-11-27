import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import P from '../smyl-privacy-inbox.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(root + f, 'utf8');

const SI = [
  ['Quiero que borren mis datos', 'cancellation'], ['Por favor eliminen todos mis datos personales de su sistema', 'cancellation'], ['Quiero ejercer mi derecho al olvido', 'cancellation'],
  ['No quiero que usen mis fotos', 'opposition'], ['Dejen de enviarme promociones', 'opposition'], ['No me manden más mensajes de promociones', 'opposition'], ['Me opongo a que usen mis datos', 'opposition'],
  ['Retiro mi consentimiento', 'revocation'], ['Ya no autorizo el uso de mis datos', 'revocation'],
  ['Quiero corregir mis datos personales', 'rectification'], ['Mis datos están mal', 'rectification'],
  ['¿Qué datos míos tienen guardados?', 'access'], ['Quiero una copia de mi expediente', 'access'], ['Quiero acceso a mis datos', 'access'], ['Solicito mis derechos ARCO', 'access']
];
const NO = ['Hola buenas tardes', 'Quiero cambiar mi cita al jueves', 'BAJA', '¿Me pueden mandar mi cotización?', 'Mi teléfono cambió, es el 2221234567', 'Gracias, ahí estaré', 'Quiero cancelar mi cita',
  '¿Cuánto cuesta la limpieza?', 'No puedo asistir hoy, me pueden mandar otra hora', 'Necesito mis radiografías para llevarlas a otro dentista', 'Ya no quiero el tratamiento', ''];

test('detecta las frases claras de cada derecho', () => {
  for (const [text, right] of SI) assert.equal(P.detect(text)?.right, right, text);
});

test('no salta con conversación normal: citas, cotizaciones, BAJA de cobros', () => {
  for (const text of NO) assert.equal(P.detect(text), null, text);
  assert.equal(P.detect('x'.repeat(2000) + ' quiero que borren mis datos'), null, 'un mensaje enorme no se analiza');
});

test('con varias coincidencias manda la más delicada: borrar antes que acceso', () => {
  assert.equal(P.detect('Quiero saber qué datos tienen de mi y que borren mis datos').right, 'cancellation');
});

test('toma la solicitud posible más reciente, dentro de 14 días y sin las descartadas', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const msgs = [
    { id: 'a', text: 'Quiero acceso a mis datos', at: '2026-11-10T10:00:00Z' },
    { id: 'b', text: 'Quiero que borren mis datos', at: '2026-11-20T10:00:00Z' },
    { id: 'c', text: 'Gracias', at: '2026-11-21T10:00:00Z' },
    { id: 'd', text: 'Quiero acceso a mis datos', at: '2026-10-01T10:00:00Z' }
  ];
  assert.equal(P.latest(msgs, { now }).id, 'b');
  assert.equal(P.latest(msgs, { now, skip: { b: 1 } }).id, 'a');
  assert.equal(P.latest(msgs, { now, skip: { a: 1, b: 1 } }), null, 'el de octubre ya es muy viejo');
  assert.equal(P.latest([], { now }), null);
});

test('los argumentos de la solicitud coinciden con la función de la base y con los canales que acepta', () => {
  const a = P.args({ patientId: 'p1', right: 'cancellation', channel: 'whatsapp', name: '  Ana  ', contact: '222', details: 'borren', receivedOn: '2026-11-20' });
  assert.deepEqual(a, { p_patient_id: 'p1', p_right: 'cancellation', p_channel: 'whatsapp', p_requester_name: 'Ana', p_requester_contact: '222', p_details: 'borren', p_received_on: '2026-11-20' });
  assert.equal(P.args({ right: 'access', channel: 'instagram', name: '' }).p_channel, 'other');
  assert.equal(P.args({ right: 'access', channel: 'messenger', name: '' }).p_requester_name, 'Sin nombre');
  assert.equal(P.args({ right: 'access', channel: 'whatsapp' }).p_patient_id, null, 'sin paciente ligado se registra sin paciente');
  const sql = read('supabase/migrations/20261123100000_smyl_privacy_rights.sql');
  const fn = sql.match(/function public\.smyl_open_data_request\(([\s\S]*?)\)\s*returns/)[1];
  assert.deepEqual([...fn.matchAll(/\b(p_[a-z_]+)\b/g)].map((m) => m[1]).sort(), Object.keys(a).sort());
  assert.match(sql, /channel[^;]*check \(channel in \('in_person', 'email', 'whatsapp', 'phone', 'other'\)\)/);
  for (const right of P.ORDER) assert.match(sql, new RegExp(`'${right}'`));
});

test('el chat llama al aviso con lo que escribió el paciente; web y móvil iguales; sin innerHTML', () => {
  const inbox = read('smyl-inbox.js');
  assert.match(inbox, /renderPrivacyNotice\(items, body\);/);
  assert.match(inbox, /item\.author_type === 'patient' && !item\.deleted/);
  assert.match(inbox, /hasPermission\('patients\.manage'\)/);
  for (const f of ['smyl-inbox.js', 'smyl-privacy-inbox.js', 'smyl-privacy-inbox.css']) assert.equal(read(f), read('mobile/www/' + f), f);
  assert.doesNotMatch(read('smyl-privacy-inbox.js'), /innerHTML/);
  for (const f of ['app.html', 'mobile/www/app.html']) { const a = read(f); assert.match(a, /smyl-privacy-inbox\.js\?v=2/); assert.match(a, /smyl-privacy-inbox\.css\?v=1/); assert.ok(a.indexOf('smyl-privacy-inbox.js') < a.indexOf('smyl-inbox.js?v=100')); }
  for (const f of ['sw.js', 'mobile/www/sw.js']) { const a = read(f); assert.match(a, /\/camila\/smyl-privacy-inbox\.js\?v=2/); assert.match(a, /privacidad-chat-v1/); }
});

test('el aviso solo ayuda: no contesta ni borra solo', () => {
  const js = read('smyl-privacy-inbox.js');
  assert.doesNotMatch(js, /smyl_export_patient_data|smyl_update_data_request|smyl_set_patient_privacy_choice|meta-send|sendTemplate/);
  assert.match(js, /smyl_open_data_request/);
});
