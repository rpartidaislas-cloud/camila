import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-finance.js');

// Pacientes pendientes de cargo: una cita en la que el paciente ya llegó aparece en Cobros SIN crear ningún cargo.
// El comportamiento completo (lista, «Agregar cargo», «Sin cargo», reabrir) se prueba en un navegador real con
// tests/qa/cobros-pending-visits-smoke.cjs; la migración se prueba en Postgres real en appointment-no-charge-pglite.test.mjs.

test('la lista de pendientes sólo toma citas en las que el paciente ya llegó, de los últimos 14 días', () => {
  assert.match(js, /\.in\('status',\['arrived','in_progress','completed','no_show'\]\)\.gte\('starts_at',since\)/);
  assert.match(js, /Date\.now\(\)-14\*864e5/);
});

test('no se crea ningún cargo al llegar: el cargo sólo sale de «Agregar cargo» con el formulario de siempre', () => {
  const block = js.slice(js.indexOf('// ── Pacientes pendientes de cargo'), js.indexOf('async function reload(text)'));
  assert.doesNotMatch(block, /smyl_post_charge/, 'la lista no registra cargos por sí sola');
  assert.match(block, /openCharge\(a\.patient_id,\{due:'0',appointmentId:a\.id\}\)/);
});

test('no es pendiente lo que ya tiene cargo vigente, ya se cerró sin cargo o es un servicio de $0 (Revisión)', () => {
  assert.match(js, /if\(c\.status!=='voided'\)charged\[c\.appointment_id\]=1/);
  assert.match(js, /closed\[n\.appointment_id\]=1/);
  assert.match(js, /s\.reference_price!=null&&Number\(s\.reference_price\)===0/);
});

test('las que ya terminaron van primero y quien no gestiona cobros sólo consulta', () => {
  assert.match(js, /rank=\{completed:0,in_progress:1,arrived:2,no_show:3\}/);
  assert.match(js, /state\.canManage\?\(a\.status==='no_show'\?.*:'<button type="button" class="btn btn-primary" data-visit-charge=/);
  assert.match(js, /Tu rol puede consultar, no registrar cobros\./);
});

test('«Sin cargo» pide motivo, usa la función segura y se puede reabrir', () => {
  assert.match(js, /review:'Revisión',warranty:'Garantía',courtesy:'Cortesía',other:'Otro'/);
  assert.match(js, /rpc\('smyl_mark_appointment_no_charge',\{p_appointment_id:appointmentId,p_reason:f\.elements\.reason\.value,p_note:f\.elements\.note\.value\.trim\(\)\}\)/);
  assert.match(js, /rpc\('smyl_reopen_appointment_charge',\{p_appointment_id:b\.dataset\.visitReopen\}\)/);
});

test('Cobros sigue funcionando si todavía no se aplicó la migración: la lista se ve y «Sin cargo» se oculta', () => {
  assert.match(js, /state\.noChargeReady=false/);
  assert.match(js, /\(state\.noChargeReady\?'<button type="button" data-visit-nocharge=/);
});

test('al volver a Cobros se refresca la lista sin recargar toda la caja', () => {
  assert.match(js, /if\(route==='caja'\)\{Promise\.resolve\(load\(false\)\)\.then\(function\(\)\{if\(state\.loaded\)refreshVisits\(\);\}\);\}/);
});

test('el formulario de cargo se abre con la cita elegida y ofrece las citas de pendientes', () => {
  assert.match(js, /options\.appointmentId&&list\.some/);
  assert.match(js, /allAppointments\(\)\.filter\(function\(a\)\{return a\.patient_id===pid&&a\.status!=='cancelled';\}\)/);
});

test('la migración, la hoja de estilos y las versiones quedan publicadas y sincronizadas con la app móvil', () => {
  assert.ok(fs.existsSync(path.join(root, 'supabase/migrations/20261108140000_smyl_appointment_no_charge.sql')));
  assert.match(read('smyl-finance.css'), /\.finance-visit-row\{/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=32/);
  assert.match(read('sw.js'), /smyl-finance\.js\?v=32/);
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
