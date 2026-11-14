import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const inv = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
const fin = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
const pick = (src, re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const summarize = new Function(pick(inv, /function summarizeUsed\([^\n]*\n/) + ';return summarizeUsed;')();

test('material usado: agrupa por insumo, suma el costo congelado y cuenta aparte lo que no tiene costo', () => {
  const items = [{ id: 'a', name: 'Anestesia', unit: 'carpule' }, { id: 'b', name: 'Guantes', unit: 'par' }];
  const r = summarize([
    { item_id: 'a', quantity: 1, unit_cost: 12.5 }, { item_id: 'a', quantity: 2, unit_cost: 10 },
    { item_id: 'b', quantity: 2, unit_cost: null },
  ], items);
  assert.equal(r.state, 'done');
  assert.deepEqual(r.lines.map((l) => [l.name, l.quantity]), [['Anestesia', 3], ['Guantes', 2]]);
  assert.equal(r.cost, 32.5);
  assert.equal(r.uncosted, 2);
  assert.equal(summarize([], []).state, 'none');
});

test('cobros: el material es informativo y no entra al recibo impreso ni a la factura', () => {
  const printFn = pick(fin, /async function printReceipt\(r\)\{[^\n]*\n/);
  assert.doesNotMatch(printFn, /material|consumption/i);
  assert.match(fin, /No aparece en el recibo ni en la factura/);
  assert.match(inv, /consumptionBatch:consumptionBatch,consumptionDetail:consumptionDetail/);
});

test('cobros: sin permiso de consumo no se ofrece registrar y el aviso va al clínico', () => {
  assert.match(fin, /r\.canRegister\?/);
  assert.match(fin, /Lo registra quien atendió/);
});
