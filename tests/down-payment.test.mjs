import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('modelo: el anticipo es un porcentaje entero opcional y se calcula sobre el total', () => {
  const M = require('../smyl-proposal-model.js');
  assert.equal(M.normalize({ items: [], down_payment_pct: 30 }).down_payment_pct, 30);
  assert.equal(M.normalize({ items: [] }).down_payment_pct, undefined);
  assert.equal(M.normalize({ items: [], down_payment_pct: 150 }).down_payment_pct, undefined);
  assert.equal(M.downPayment({ down_payment_pct: 30 }, 3070000), 921000);
  assert.equal(M.downPayment({}, 3070000), 0);
  const item = { id: 'a', label: 'x', quantity: 1, unit_cents: 100, teeth: [], surfaces: [] };
  assert.match(M.valid({ title: 't', items: [item], down_payment_pct: 120 }, false), /anticipo/i);
  assert.equal(M.valid({ title: 't', items: [item], down_payment_pct: 40 }, false), '');
  assert.equal(JSON.stringify(M.normalize({ items: [] })).includes('down_payment_pct'), false);
});

test('migración: acepta down_payment_pct y la cita ligada se cobra al realizarse si falta saldo', () => {
  const sql = read('supabase/migrations/20261201600000_smyl_down_payment.sql');
  assert.match(sql, /'photos','down_payment_pct'\]/);
  assert.match(sql, /\^\(100\|\[1-9\]\?\[0-9\]\)\$/);
  assert.match(sql, /case when coalesce\(lk\.due_part, 0\) >= 0\.01 then 'due' else 'covered' end/);
  assert.match(sql, /row_number\(\) over \(partition by l\.proposal_id, l\.proposal_item_id order by a2\.starts_at/);
  assert.doesNotMatch(sql, /grant execute[^;]*to anon/);
});

test('el editor, el PDF y Finanzas usan el anticipo', () => {
  const proposals = read('smyl-proposals.js'), print = read('smyl-proposal-print.js'), fin = read('smyl-finance.js');
  assert.match(proposals, /id='proposal-down'/);
  assert.match(proposals, /doc\.down_payment_pct=Number\(downSel\.value\)/);
  assert.match(print, /Anticipo al aceptar \('\+doc\.down_payment_pct\+' %\)/);
  assert.match(print, /El resto se paga conforme se realiza cada tratamiento/);
  assert.match(fin, /proposal\.document\.down_payment_pct/);
  assert.match(fin, /amount:downAmount\|\|0/);
  assert.match(fin, /Number\(options\.amount\)>0/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-finance.js', 'smyl-proposal-model.js', 'smyl-proposal-print.js', 'smyl-proposals.js', 'smyl-proposals.css', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-proposals\.js\?v=34/);
  assert.match(read('sw.js'), /anticipo-v1/);
});

test('cobro en línea del anticipo: el servidor acepta un monto parcial y el cliente verifica que lo respetó', () => {
  const fin = read('smyl-finance.js'), fn = read('supabase/functions/smyl-pay/index.ts'), core = read('supabase/functions/_shared/smyl-pay-core.mjs');
  assert.match(core, /export function planDeCobro\(abiertos, \{ chargeIds = null, monto = null \} = \{\}\)/);
  assert.match(core, /amount_exceeds_balance/);
  assert.match(fn, /const monto = body\.amount === undefined/);
  assert.match(fn, /planDeCobro\(abiertos \|\| \[\], \{ chargeIds, monto \}\)/);
  assert.match(fin, /openOnlineLink\(pid,lnk,ids,downAmount>0\?downAmount:0\)/);
  assert.match(fin, /partial\?\{amount:partial\}:\{\}/);
  assert.match(fin, /Math\.abs\(Number\(data\.amount\)-partial\)>0\.009/);
  assert.match(fin, /action:'cancel',patient_id:patientId,link_id:data\.link_id/);
  assert.match(fin, /Anticipo a cobrar/);
});
