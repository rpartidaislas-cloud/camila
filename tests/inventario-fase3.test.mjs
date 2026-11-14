import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../smyl-inventory.js', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const h = new Function([
  pick(/function fmt\(n\)\{[^\n]*\n/), pick(/function orderMessage\([^\n]*\n/), pick(/function waPhone\(v\)\{[^\n]*\n/),
  pick(/function countDiffs\([^\n]*\n/), pick(/function expiryBuckets\([^\n]*\n/),
].join('\n') + ';return {orderMessage,waPhone,countDiffs,expiryBuckets};')();

test('pedido: mensaje con líneas, destino y fecha', () => {
  const m = h.orderMessage({ reference: 'OC-1', expected_on: '2026-12-01' }, { contact_name: 'Ana' }, { name: 'Almacén' },
    [{ item_id: 'a', ordered_quantity: 5 }], [{ id: 'a', name: 'Guantes', package_label: 'Caja 100' }]);
  assert.match(m, /Hola Ana/); assert.match(m, /OC-1/); assert.match(m, /• 5 × Guantes \(Caja 100\)/);
  assert.match(m, /Entrega en: Almacén/); assert.match(m, /2026-12-01/);
});
test('teléfono: normaliza a formato wa.me de México', () => {
  assert.equal(h.waPhone('(55) 1234-5678'), '525512345678');
  assert.equal(h.waPhone('+52 1 55 1234 5678'), '525512345678');
  assert.equal(h.waPhone('123'), '');
});
test('conteo: solo registra diferencias reales y valores válidos', () => {
  const rows = [{ item_id: 'a', lot_id: 'l1', on_hand: 10 }, { item_id: 'b', lot_id: null, on_hand: 4 }, { item_id: 'c', lot_id: null, on_hand: 2 }];
  const d = h.countDiffs(rows, { 'a|l1': '8', 'b|': '4', 'c|': '-1' });
  assert.deepEqual(d.map((x) => [x.item_id, x.diff]), [['a', -2]]);
  assert.deepEqual(h.countDiffs(rows, { 'b|': '5.5' }).map((x) => x.diff), [1.5]);
});
test('caducidad: separa vencidos, 30 y 31–90 días', () => {
  const b = h.expiryBuckets([{ on_hand: 1, days_to_expiry: -1 }, { on_hand: 1, days_to_expiry: 10 }, { on_hand: 1, days_to_expiry: 60 }, { on_hand: 1, days_to_expiry: 200 }, { on_hand: 0, days_to_expiry: 5 }]);
  assert.deepEqual(b, { expired: 1, d30: 1, d90: 1 });
});

test('sin movimiento: solo existencia con último movimiento anterior al límite', () => {
  const stale = new Function(src.match(/function staleRows\([^\n]*\n/)[0] + ';return staleRows;')();
  const now = Date.parse('2026-11-14T00:00:00Z'), day = 86400000;
  const snap = [
    { location_id: 'L', item_id: 'viejo', on_hand: 3 }, { location_id: 'L', item_id: 'reciente', on_hand: 3 },
    { location_id: 'L', item_id: 'vacio', on_hand: 0 }, { location_id: 'L', item_id: 'sin-dato', on_hand: 2 },
  ];
  const moves = [
    { location_id: 'L', item_id: 'viejo', last_moved_at: new Date(now - 120 * day).toISOString() },
    { location_id: 'L', item_id: 'reciente', last_moved_at: new Date(now - 10 * day).toISOString() },
    { location_id: 'L', item_id: 'vacio', last_moved_at: new Date(now - 300 * day).toISOString() },
  ];
  assert.deepEqual(stale(snap, moves, now, 90).map((x) => x.item_id), ['viejo']);
  assert.deepEqual(stale(snap, [], now, 90), []);
});
