import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validarCorreo, enmascararCorreo, clasificarEnvio } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('correo: una sola dirección válida, en minúsculas', () => {
  assert.equal(validarCorreo('  Juan.Perez@Gmail.COM '), 'juan.perez@gmail.com');
  assert.equal(validarCorreo('a@b'), '');
  assert.equal(validarCorreo('sin-arroba.com'), '');
  assert.equal(validarCorreo('a@b.mx, c@d.mx'), '', 'varias direcciones no se aceptan');
  assert.equal(validarCorreo('a@b.mx;c@d.mx'), '');
  assert.equal(validarCorreo('<a@b.mx>'), '');
  assert.equal(validarCorreo('a b@c.mx'), '');
  assert.equal(validarCorreo(''), '');
  assert.equal(validarCorreo(null), '');
  assert.equal(validarCorreo('a'.repeat(250) + '@b.mx'), '');
});

test('correo enmascarado para mostrar y registrar sin guardar la dirección completa', () => {
  assert.equal(enmascararCorreo('juan.perez@gmail.com'), 'j***@gmail.com');
  assert.equal(enmascararCorreo('Z@Dental.MX'), 'z***@dental.mx');
  assert.equal(enmascararCorreo('no-es-correo'), '');
});

test('respuesta de Facturapi al enviar: lo dudoso no se reenvía a ciegas', () => {
  assert.equal(clasificarEnvio(200, { ok: true }), 'ok');
  assert.equal(clasificarEnvio(200, { ok: false }), 'unknown');
  assert.equal(clasificarEnvio(200, null), 'unknown');
  for (const status of [400, 401, 404, 429]) assert.equal(clasificarEnvio(status, null), 'rejected', String(status));
  for (const status of [0, 408, 500, 503]) assert.equal(clasificarEnvio(status, null), 'unknown', String(status));
});

test('la función: finance.invoice, comprobante timbrado, un solo destinatario, freno y bitácora sin la dirección completa', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /action === "send_email"/);
  assert.match(fn, /esTimbrado \? "finance\.invoice" : "finance\.manage"/);
  assert.match(fn, /draft\.status !== "issued" \|\| !draft\.provider_invoice_id\) return json\(CORS, 409, \{ error: "Solo un comprobante timbrado se puede enviar por correo/);
  assert.match(fn, /validarCorreo\(typeof body\.email === "string"/);
  assert.match(fn, /JSON\.stringify\(\{ email: destino \}\)/, 'siempre manda un destinatario explícito');
  assert.match(fn, /< 30_000/);
  // la bitácora y el comprobante guardan solo la dirección enmascarada
  assert.match(fn, /last_emailed_to: masked/);
  assert.match(fn, /\{ to: masked,/);
  assert.doesNotMatch(fn, /\{ to: destino/);
  assert.doesNotMatch(fn, /last_emailed_to: destino/);
});

test('migración: solo el destinatario enmascarado y acción «email» en la bitácora', () => {
  const sql = read('supabase/migrations/20261118100000_smyl_cfdi_email.sql');
  assert.match(sql, /add column if not exists last_emailed_to text/);
  assert.match(sql, /char_length\(last_emailed_to\) <= 120/);
  assert.match(sql, /check \(action in \('stamp', 'reconcile', 'download', 'cancel', 'cancel_check', 'email'\)\)/);
  const versions = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261118100000').length, 1);
});

test('Cobros: botón Enviar/Reenviar, destinatario editable y última vez enviado', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /data-email-cfdi/);
  // En una emitida, «Enviar» (o «Reenviar») es el botón de la fila; solo con permiso para facturar.
  assert.match(js, /if\(state\.canInvoice\)\{[\s\S]{0,700}else if\(d\.status==='issued'\)\{[\s\S]{0,260}else main=button\('data-email-cfdi',d\.last_emailed_at\?'Reenviar':'Enviar'\);/);
  assert.match(js, /d\.last_emailed_at\?'Reenviar por correo':'Enviar por correo'/);
  assert.match(js, /facturapiAction\(\{action:'send_email',draft_id:draft\.id,email:email\}\)/);
  assert.match(js, /'Enviada a '\+esc\(d\.last_emailed_to\|\|'el paciente'\)\+' · '\+esc\(whenLabel\(d\.last_emailed_at\)\)/);
  assert.equal(js, read('mobile/www/smyl-finance.js'));
});
