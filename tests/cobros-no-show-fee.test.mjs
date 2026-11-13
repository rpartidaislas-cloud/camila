import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-finance.js');
const schedule = read('smyl-schedule.js');

// Cobro por «No vino». El comportamiento completo (monto, fila, cargo prellenado, perdonar, agenda y numerito) se prueba en un navegador real con
// tests/qa/cobros-no-show-smoke.cjs; las reglas de base de datos, en Postgres real en no-show-fee-pglite.test.mjs.

test('apagado por omisión: una inasistencia sólo se ofrece si la clínica configuró un monto mayor a cero', () => {
  assert.match(js, /if\(a\.status==='no_show'\)return state\.noShowFee>0;/);
  assert.match(js, /state\.noShowFee=Number\(st&&st\.no_show_fee\)\|\|0/);
  assert.match(js, /state\.noShowFee=0;state\.settingsReady=false/, 'sin la migración todo sigue apagado');
});

test('nunca se cobra sola: «Cobrar inasistencia» abre el formulario de cargo y «Perdonar» registra la decisión', () => {
  const block = js.slice(js.indexOf('// ── Pacientes pendientes de cargo'), js.indexOf('async function reload(text)'));
  assert.doesNotMatch(block, /smyl_post_charge/);
  assert.match(js, /openCharge\(a\.patient_id,\{due:'0',appointmentId:a\.id,noShow:true\}\)/);
  assert.match(js, /openNoCharge\(b\.dataset\.visitWaive,true\)/);
  assert.match(js, /<input type="hidden" name="reason" value="waived">/);
  assert.match(js, /await reload\(waive\?'Inasistencia perdonada\.':'Visita cerrada sin cargo\.'\)/);
});

test('el cargo se abre con la cita ligada, concepto libre «Inasistencia a cita del …» y el monto de la clínica', () => {
  assert.match(js, /if\(options\.noShow\)\{var nsApp=/);
  assert.match(js, /f\.elements\.service\.value='';f\.elements\.concept\.value='Inasistencia a cita'/);
  assert.match(js, /f\.elements\.price\.value=Number\(state\.noShowFee\)\.toFixed\(2\)/);
});

test('el monto se define en «Más acciones → Cobro por inasistencia», sólo para quien gestiona cobros, con aviso de política', () => {
  assert.match(js, /id="finance-no-show-fee"><strong>Cobro por inasistencia<\/strong>/);
  assert.match(js, /'finance-new-advance','finance-no-show-fee'\]\.forEach/);
  assert.match(js, /rpc\('smyl_set_no_show_fee',\{p_amount:amount\}\)/);
  assert.match(js, /<strong>Nunca se cobra solo<\/strong>/);
  assert.match(js, /Avisa a tus pacientes de esta política/);
});

test('la fila «No vino» va al final de la lista, y el numerito del menú la cuenta', () => {
  assert.match(js, /no_show:\['No vino','void'\]/);
  assert.match(js, /rank=\{completed:0,in_progress:1,arrived:2,no_show:3\}/);
  assert.match(js, /r\.billing_state==='pending'\|\|r\.billing_state==='no_show_pending'/);
  assert.match(js, /x\.n\.reason==='waived'\?'Inasistencia perdonada'/);
});

test('la agenda muestra «Inasistencia por cobrar» y «Perdonada» y manda a Cobros', () => {
  assert.match(schedule, /var ARRIVED=\['arrived','in_progress','completed','no_show'\]/);
  assert.match(schedule, /no_show_pending:\['Inasistencia por cobrar','pending'\]/);
  assert.match(schedule, /if\(b\.billing_state==='no_charge'&&a\.status==='no_show'\)return \['Perdonada','none'\]/);
  assert.match(schedule, /\['pending','no_show_pending','due'\]\.indexOf\(state\.billing\[a\.id\]\.billing_state\)>=0/);
});

test('la migración y las versiones quedan publicadas y sincronizadas con la app móvil', () => {
  assert.ok(fs.existsSync(path.join(root, 'supabase/migrations/20261108160000_smyl_no_show_fee.sql')));
  assert.match(read('.github/workflows/smyl-pendientes-cargo-migracion.yml'), /20261108160000_smyl_no_show_fee\.sql/);
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-finance\.js\?v=34/);
    assert.match(read(file), /smyl-finance\.css\?v=27/);
    assert.match(read(file), /smyl-schedule\.js\?v=33/);
  }
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
