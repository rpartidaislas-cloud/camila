import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-schedule.js');
const css = read('smyl-schedule.css');

// Etiqueta de cobro en la Agenda. El comportamiento (vistas Semana/Día/Lista, detalle, «Ir a Cobros») se prueba en un navegador real con
// tests/qa/agenda-billing-smoke.cjs; la función de base de datos se prueba en Postgres real en appointment-billing-status-pglite.test.mjs.

test('la etiqueta sólo se pide y se muestra con permiso finance.read, y sólo a citas en las que el paciente ya llegó', () => {
  assert.match(js, /state\.canFinance=owner\|\|perms\.has\('finance\.read'\)/);
  assert.match(js, /if\(!state\.canFinance\|\|!window\.sb\)return;/);
  assert.match(js, /var ARRIVED=\['arrived','in_progress','completed'\]/);
  assert.match(js, /var b=state\.canFinance&&state\.billing\[a\.id\];if\(!b\|\|ARRIVED\.indexOf\(a\.status\)<0\)return null/);
});

test('usa una sola consulta de sólo lectura con tope de 300 citas y no bloquea la carga de la agenda', () => {
  assert.match(js, /rpc\('smyl_appointment_billing',\{p_appointment_ids:ids\}\)/);
  assert.match(js, /\.slice\(0,300\)/);
  assert.match(js, /state\.loaded=true;renderAll\(\);loadBilling\(\);/);
  assert.doesNotMatch(js, /smyl_post_charge|smyl_mark_appointment_no_charge/, 'la agenda nunca crea cargos');
});

test('los textos son Por cobrar, Saldo $X, Cobrada y Sin cargo; el servicio de $0 no lleva etiqueta', () => {
  assert.match(js, /pending:\['Por cobrar','pending'\],due:\['Saldo '\+fmtMoney\(b\.due_amount\),'due'\],paid:\['Cobrada','paid'\],no_charge:\['Sin cargo','none'\]/);
  assert.doesNotMatch(js, /free:\[/);
});

test('la etiqueta aparece en las tarjetas de semana y día, en la lista y en el detalle', () => {
  assert.equal((js.match(/billingChip\(a\)/g) || []).length >= 4, true, 'tarjeta, evento de semana, fila de lista y detalle');
  assert.match(js, /<li class="sched-billing-row"><span>Cobro<\/span>/);
  assert.match(js, /data-go-finance>Ir a Cobros<\/button>/);
  assert.match(js, /goFinance\.onclick=function\(\)\{close\(\);window\.ir\('caja'\);\}/);
});

test('se refresca al volver a la agenda y cuando Cobros cambia algo', () => {
  assert.match(js, /if\(route==='agenda'\)\{if\(state\.loaded\)loadBilling\(\);load\(false\);\}/);
  assert.match(js, /window\.addEventListener\('smyl:finance-updated',function\(\)\{if\(state\.loaded\)loadBilling\(\);\}\)/);
  assert.match(read('smyl-finance.js'), /window\.dispatchEvent\(new CustomEvent\('smyl:finance-updated'\)\)/);
});

test('la etiqueta se ve también en la línea de tiempo compacta del día y no sube la deuda tipográfica', () => {
  assert.match(css, /\.schedule-timeline-event \.schedule-appointment i\.schedule-billing\{display:inline-block;position:absolute/);
  for (const state of ['pending', 'due', 'paid', 'none']) assert.match(css, new RegExp(`\\.schedule-billing\\[data-billing=${state}\\]`));
  const block = css.slice(css.indexOf('/* Etiqueta de cobro en las citas'));
  assert.doesNotMatch(block, /font-size\s*:\s*(?:[0-9]|1[01])(?:\.\d+)?px/, 'el texto nuevo debe ser de 12 px o más');
});

test('la migración y las versiones quedan publicadas y sincronizadas con la app móvil', () => {
  assert.ok(fs.existsSync(path.join(root, 'supabase/migrations/20261108130000_smyl_appointment_billing_status.sql')));
  assert.match(read('.github/workflows/smyl-pendientes-cargo-migracion.yml'), /20261108130000_smyl_appointment_billing_status\.sql/);
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=31/);
    assert.match(read(file), /smyl-schedule\.css\?v=21/);
  }
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'smyl-finance.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
