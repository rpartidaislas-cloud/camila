// Aviso de privacidad (modelo provisional) y reglas de la firma. Lo que importa: lo que se firma es lo que se guarda, y un
// toque suelto o una pantalla en blanco nunca cuentan como firma.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const N = createRequire(import.meta.url)('../smyl-privacy-notice.js');
const trazo = (n, paso = 10) => [Array.from({ length: n }, (_, i) => ({ x: i * paso, y: (i % 3) * 5 }))];

test('el texto lleva el nombre de la clínica, está marcado como provisional y no deja marcas sin reemplazar', () => {
  const n = N.render('Diseño de Sonrisas');
  assert.equal(n.provisional, true);
  assert.equal(n.version, 'modelo-provisional-1');
  assert.match(n.text, /Responsable: Diseño de Sonrisas\./);
  assert.doesNotMatch(n.text, /\{|\}/);
  assert.ok(n.text.length >= 50 && n.text.length <= 8000, 'cabe en lo que acepta la base');
  assert.match(N.render('  ').text, /Responsable: la clínica\./);
  assert.equal(N.paragraphs('X').length, 4);
});

test('cubre lo mínimo: finalidades, datos sensibles, terceros, derechos ARCO y consentimiento expreso', () => {
  const t = N.render('X').text;
  for (const re of [/de salud \(datos personales sensibles\)/, /finalidades|para crear y mantener/, /terceros/, /acceso, rectificación, cancelación y oposición/, /consentimiento expreso/]) assert.match(t, re);
});

test('un toque suelto o muy poco trazo no es firma; un trazo real sí', () => {
  assert.equal(N.inkOf([]).ok, false);
  assert.equal(N.inkOf([[{ x: 5, y: 5 }]]).ok, false, 'un punto');
  assert.equal(N.inkOf(trazo(5, 3)).ok, false, 'trazo corto');
  assert.equal(N.inkOf(trazo(20, 8)).ok, true);
  assert.equal(N.inkOf([trazo(8, 8)[0], trazo(8, 8)[0]]).ok, true, 'se suman los trazos');
  assert.equal(N.inkOf(null).ok, false);
});

test('validar: nombre, quién firma, consentimiento y firma, en ese orden y con mensaje claro', () => {
  const ink = N.inkOf(trazo(20, 8));
  assert.equal(N.validate({ name: ' ', relation: 'patient', checked: true, ink }).field, 'name');
  assert.equal(N.validate({ name: 'Ana', relation: 'x', checked: true, ink }).field, 'relation');
  assert.equal(N.validate({ name: 'Ana', relation: 'patient', checked: false, ink }).field, 'checked');
  assert.equal(N.validate({ name: 'Ana', relation: 'patient', checked: true, ink: N.inkOf([]) }).field, 'signature');
  assert.match(N.validate({ name: 'Ana', relation: 'patient', checked: true, ink: N.inkOf([]) }).message, /Falta la firma/);
  assert.deepEqual(N.validate({ name: 'Ana', relation: 'guardian', checked: true, ink }), { ok: true });
  assert.equal(N.validate().ok, false);
});

test('los argumentos de la base llevan exactamente el texto mostrado, su versión y la marca provisional', () => {
  const p = N.payload({ patientId: 'p1', clinicName: 'Diseño de Sonrisas', name: ' Ana López ', relation: 'patient', signaturePng: 'data:image/png;base64,iVBORw0KGgoAAAA' });
  assert.deepEqual(Object.keys(p), ['p_patient_id', 'p_notice_version', 'p_notice_text', 'p_provisional', 'p_signer_name', 'p_signer_relation', 'p_signature_png']);
  assert.equal(p.p_notice_text, N.render('Diseño de Sonrisas').text);
  assert.equal(p.p_provisional, true);
  assert.equal(p.p_signer_name, 'Ana López');
});

test('texto del estado: quién, cuándo y si fue con el texto provisional', () => {
  const fmt = () => '16 de noviembre de 2026';
  assert.equal(N.statusText({ signed: false }), '');
  assert.equal(N.statusText({ signed: true, signed_at: 'x', signer_name: 'Ana López', signer_relation: 'patient', provisional: true }, fmt), 'Firmado el 16 de noviembre de 2026 por Ana López. Con el texto modelo provisional.');
  assert.equal(N.statusText({ signed: true, signer_name: 'Luis', signer_relation: 'guardian', provisional: false }, fmt), 'Firmado por Luis (tutor).');
});

test('la migración exige los mismos límites que estas reglas', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261116210000_smyl_patient_consents.sql', import.meta.url), 'utf8');
  assert.match(sql, /char_length\(notice_text\) between 50 and 8000/);
  assert.match(sql, /signer_relation in \('patient', 'guardian'\)/);
  assert.match(sql, /sha256\(convert_to\(p_notice_text, 'utf8'\)\)/, 'la huella la calcula la base');
  assert.match(sql, /revoke all on public\.smyl_patient_consents from public, anon, authenticated/, 'sin acceso directo a la tabla');
  assert.match(sql, /smyl_patient_consents_no_update before update/);
  assert.doesNotMatch(sql, /smyl_audit_row/, 'la auditoría general copiaría la imagen de la firma');
});

test('no se puede aceptar sin haber llegado al final del aviso', () => {
  const ink = N.inkOf(trazo(20, 8)), base = { name: 'Ana', relation: 'patient', checked: true, ink };
  assert.equal(N.validate({ ...base, read: false }).field, 'read');
  assert.match(N.validate({ ...base, read: false }).message, /hasta el final/);
  assert.equal(N.validate({ ...base, read: true }).ok, true);
  assert.equal(N.validate(base).ok, true, 'sin dato de lectura no se bloquea (compatibilidad)');
});
