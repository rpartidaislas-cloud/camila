import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Ejecuta el código real de Caja (índices de cuenta) y lo contrasta con la definición directa (la lenta, de referencia).
const src = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
// El bloque inicial trae cents(), by(), byKey() y acctIndex(); después van los saldos, que se calculan en centavos enteros.
const code = [
  pick(/var byIndex[\s\S]*?return acct;\}/),
  pick(/function paidCents\(charge\)\{[^\n]*\n/),
  pick(/function balanceCents\(charge\)\{[^\n]*\n/),
  pick(/function sumBalance\(list\)\{[^\n]*\n/),
  pick(/function creditCents\(id\)\{[^\n]*\n/),
  pick(/function paidFor\(charge\)\{[^\n]*\n/),
  pick(/function balance\(charge\)\{[^\n]*\n/),
  pick(/function patientBalance\(id\)\{[^\n]*\n/),
  pick(/function patientCredit\(id\)\{[^\n]*\n/),
  pick(/function accountSnapshot\(id\)\{[^\n]*\n/),
  pick(/function cashFlow\(s\)\{[\s\S]*?return out;\}/),
  pick(/function cashExpected\(s\)\{[^\n]*\n/),
].join('\n');
const build = new Function('state', code + ';return {accountSnapshot,patientCredit,patientBalance,balance,paidFor,sumBalance,cents,cashFlow,cashExpected};');

const by = (a, id) => a.find((x) => x.id === id);
function referencia(state) {
  const paidFor = (c) => state.allocations.filter((a) => a.charge_id === c.id).reduce((s, a) => s + Number(a.amount), 0)
    - state.refundAllocations.filter((a) => a.charge_id === c.id).reduce((s, a) => s + Number(a.amount), 0);
  const balance = (c) => (c.status === 'voided' ? 0 : Math.max(0, Number(c.total_amount) - paidFor(c)));
  const credit = (id) => {
    const rec = state.payments.filter((p) => p.patient_id === id).reduce((s, p) => s + Number(p.amount), 0);
    const ref = state.refunds.filter((r) => { const p = by(state.payments, r.payment_id); return p && p.patient_id === id; }).reduce((s, r) => s + Number(r.amount), 0);
    const app = state.allocations.filter((a) => { const p = by(state.payments, a.payment_id); return p && p.patient_id === id; }).reduce((s, a) => s + Number(a.amount), 0);
    return Math.max(0, rec - ref - app);
  };
  return { paidFor, balance, credit, due: (id) => state.charges.filter((c) => c.patient_id === id && c.status !== 'voided').reduce((s, c) => s + balance(c), 0) };
}

function datos(seed, n) {
  let x = seed; const rnd = (m) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % m; };
  const state = { patients: [], charges: [], payments: [], allocations: [], refunds: [], refundAllocations: [] };
  for (let i = 0; i < n; i++) state.patients.push({ id: 'p' + i });
  for (let i = 0; i < n * 3; i++) state.charges.push({ id: 'c' + i, patient_id: 'p' + rnd(n), status: rnd(10) ? 'posted' : 'voided', total_amount: 100 + rnd(900), due_on: '2026-0' + (1 + rnd(9)) + '-10', created_at: new Date(2026, 0, 1 + rnd(300)).toISOString() });
  for (let i = 0; i < n * 2; i++) state.payments.push({ id: 'y' + i, patient_id: 'p' + rnd(n), amount: 50 + rnd(500) });
  for (let i = 0; i < n * 3; i++) state.allocations.push({ id: 'a' + i, payment_id: 'y' + rnd(n * 2), charge_id: 'c' + rnd(n * 3), amount: 10 + rnd(40) });
  for (let i = 0; i < n / 5; i++) state.refunds.push({ id: 'r' + i, payment_id: 'y' + rnd(n * 2), amount: 5 + rnd(20) });
  for (let i = 0; i < n / 5; i++) state.refundAllocations.push({ id: 'ra' + i, charge_id: 'c' + rnd(n * 3), amount: 3 });
  return state;
}

test('Caja: saldo, crédito y cuenta por paciente coinciden con la definición directa', () => {
  for (const seed of [1, 7, 42]) {
    const state = datos(seed, 60);
    const f = build(state), ref = referencia(state);
    for (const p of state.patients) {
      const snap = f.accountSnapshot(p.id);
      assert.ok(Math.abs(snap.credit - ref.credit(p.id)) < 1e-9, 'crédito ' + p.id);
      assert.ok(Math.abs(snap.due - ref.due(p.id)) < 1e-9, 'saldo ' + p.id);
      assert.ok(Math.abs(f.patientBalance(p.id) - ref.due(p.id)) < 1e-9, 'saldo paciente ' + p.id);
    }
  }
});

test('Caja: el índice se reconstruye cuando cambian los datos (un pago nuevo reduce el saldo)', () => {
  const state = { patients: [{ id: 'p1' }], charges: [{ id: 'c1', patient_id: 'p1', status: 'posted', total_amount: 100 }], payments: [], allocations: [], refunds: [], refundAllocations: [] };
  const f = build(state);
  assert.equal(f.accountSnapshot('p1').due, 100);
  state.payments = [{ id: 'y1', patient_id: 'p1', amount: 100 }];
  state.allocations = [{ id: 'a1', payment_id: 'y1', charge_id: 'c1', amount: 60 }];
  assert.equal(f.accountSnapshot('p1').due, 40);
  assert.equal(f.accountSnapshot('p1').credit, 40);
});

test('Caja: 400 pacientes se calculan en tiempo lineal (sin el congelamiento cúbico de antes)', () => {
  const state = datos(9, 400);
  const f = build(state);
  const t0 = performance.now();
  state.patients.forEach((p) => f.accountSnapshot(p.id));
  assert.ok(performance.now() - t0 < 500, 'tardó ' + (performance.now() - t0).toFixed(0) + ' ms');
});

// ── Resumen ligero de la cuenta de un paciente (tarjeta «Cuenta» del chat) ──
const resumenFn = (() => {
  const m = src.match(/function summarizeAccount\(d,today\)\{[^\n]*\n/);
  assert.ok(m, 'no se encontró summarizeAccount');
  return new Function(m[0] + ';return summarizeAccount;')();
})();

test('Cuenta del chat: saldo, vencidos, próximo vencimiento y crédito', () => {
  const r = resumenFn({
    charges: [
      { id: 'c1', status: 'posted', total_amount: 1000, due_on: '2026-11-01' },
      { id: 'c2', status: 'posted', total_amount: 500, due_on: '2026-12-10' },
      { id: 'c3', status: 'voided', total_amount: 900, due_on: '2026-10-01' },
    ],
    payments: [{ id: 'p1', amount: 700 }],
    allocations: [{ id: 'a1', charge_id: 'c1', payment_id: 'p1', amount: 400 }],
    refunds: [], refundAllocations: [],
  }, '2026-11-08');
  assert.equal(r.due, 1100);
  assert.equal(r.openCount, 2);
  assert.equal(r.overdueCount, 1);
  assert.equal(r.overdueAmount, 600);
  assert.equal(r.nextDue, '2026-11-01');
  assert.equal(r.credit, 300);
  assert.equal(r.chargeCount, 2);
});

test('Cuenta del chat: coincide con la definición de Caja para datos aleatorios', () => {
  for (const seed of [3, 11]) {
    const state = datos(seed, 40), ref = referencia(state);
    for (const p of state.patients.slice(0, 15)) {
      const charges = state.charges.filter((c) => c.patient_id === p.id);
      const payments = state.payments.filter((x) => x.patient_id === p.id);
      const cids = new Set(charges.map((c) => c.id)), pids = new Set(payments.map((x) => x.id));
      const r = resumenFn({
        charges, payments,
        allocations: state.allocations.filter((a) => cids.has(a.charge_id) || pids.has(a.payment_id)),
        refunds: state.refunds.filter((x) => pids.has(x.payment_id)),
        refundAllocations: state.refundAllocations.filter((a) => cids.has(a.charge_id)),
      }, '2026-11-08');
      assert.ok(Math.abs(r.due - ref.due(p.id)) < 1e-9, 'saldo ' + p.id);
      assert.ok(Math.abs(r.credit - ref.credit(p.id)) < 1e-9, 'crédito ' + p.id);
    }
  }
});

test('Cuenta del chat: sin cargos ni pagos queda en cero', () => {
  const r = resumenFn({ charges: [], payments: [], allocations: [], refunds: [], refundAllocations: [] }, '2026-11-08');
  assert.deepEqual([r.due, r.credit, r.chargeCount, r.overdueCount, r.nextDue], [0, 0, 0, 0, null]);
});

// ── Centavos: el dinero se suma en enteros para que los saldos cuadren al centavo ──
const pagosEnPartes = () => ({
  patients: [{ id: 'p1' }],
  charges: [{ id: 'c1', patient_id: 'p1', status: 'open', total_amount: 100.2, created_at: '2026-11-01T10:00:00Z' }],
  payments: [1, 2, 3].map((i) => ({ id: 'y' + i, patient_id: 'p1', amount: 33.4, paid_at: '2026-11-0' + i + 'T10:00:00Z' })),
  allocations: [1, 2, 3].map((i) => ({ id: 'a' + i, payment_id: 'y' + i, charge_id: 'c1', amount: 33.4 })),
  refunds: [], refundAllocations: [],
});

test('Centavos: $100.20 pagado en tres partes de $33.40 queda en cero y deja de estar pendiente', () => {
  // Con decimales la suma no cuadra: por eso la cuenta seguía en «Pendientes» con saldo $0.00 y botón «Cobrar $0.00».
  assert.notEqual(100.2 - (33.4 + 33.4 + 33.4), 0);
  const state = pagosEnPartes(), f = build(state), snap = f.accountSnapshot('p1');
  assert.equal(snap.due, 0);
  assert.equal(snap.dueCents, 0);
  assert.equal(snap.paid, 100.2);
  assert.equal(snap.credit, 0);
  assert.equal(snap.progress, 100);
  assert.equal(snap.overdue.length, 0);
  assert.equal(f.balance(state.charges[0]), 0);
  assert.equal(f.patientBalance('p1'), 0);
  assert.equal(f.paidFor(state.charges[0]), 100.2);
});

test('Centavos: tres cargos de $33.40 suman exactamente $100.20 por cobrar', () => {
  const state = { patients: [{ id: 'p1' }], charges: [1, 2, 3].map((i) => ({ id: 'c' + i, patient_id: 'p1', status: 'open', total_amount: 33.4 })), payments: [], allocations: [], refunds: [], refundAllocations: [] };
  const f = build(state), snap = f.accountSnapshot('p1');
  assert.notEqual(33.4 + 33.4 + 33.4, 100.2);
  assert.equal(snap.due, 100.2);
  assert.equal(snap.dueCents, 10020);
  assert.equal(f.sumBalance(state.charges), 100.2);
  // Un pago por el saldo exacto no deja ni deuda ni saldo a favor.
  state.payments = [{ id: 'y1', patient_id: 'p1', amount: 100.2 }];
  state.allocations = [1, 2, 3].map((i) => ({ id: 'a' + i, payment_id: 'y1', charge_id: 'c' + i, amount: 33.4 }));
  const after = f.accountSnapshot('p1');
  assert.equal(after.due, 0);
  assert.equal(after.credit, 0);
});

test('Centavos: importes con decimales al azar coinciden con una contabilidad exacta en enteros', () => {
  let x = 77; const rnd = (m) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % m; };
  for (let round = 0; round < 30; round++) {
    const state = { patients: [{ id: 'p1' }], charges: [], payments: [], allocations: [], refunds: [], refundAllocations: [] };
    const total = new Map(), paid = new Map(); let received = 0, applied = 0, refunded = 0;
    for (let i = 0; i < 12; i++) { const c = 1 + rnd(250000); total.set('c' + i, c); paid.set('c' + i, 0); state.charges.push({ id: 'c' + i, patient_id: 'p1', status: 'open', total_amount: c / 100 }); }
    for (let i = 0; i < 20; i++) { const c = 1 + rnd(90000); received += c; state.payments.push({ id: 'y' + i, patient_id: 'p1', amount: c / 100 }); }
    for (let i = 0; i < 40; i++) { const c = 1 + rnd(9000), charge = 'c' + rnd(12); applied += c; paid.set(charge, paid.get(charge) + c); state.allocations.push({ id: 'a' + i, payment_id: 'y' + rnd(20), charge_id: charge, amount: c / 100 }); }
    for (let i = 0; i < 4; i++) { const c = 1 + rnd(3000); refunded += c; state.refunds.push({ id: 'r' + i, payment_id: 'y' + rnd(20), amount: c / 100 }); }
    let due = 0; for (const [id, t] of total) due += Math.max(0, t - paid.get(id));
    const snap = build(state).accountSnapshot('p1');
    assert.equal(snap.dueCents, due, 'saldo en centavos, vuelta ' + round);
    assert.equal(snap.creditCents, Math.max(0, received - refunded - applied), 'saldo a favor en centavos, vuelta ' + round);
    assert.equal(snap.due, due / 100);
  }
});

test('Centavos: la caja separa cobros, reembolsos, entradas y salidas, y el esperado cuadra', () => {
  const state = {
    patients: [], charges: [], allocations: [], refundAllocations: [],
    payments: [
      { id: 'y1', cash_session_id: 's1', method: 'cash', amount: 800 },
      { id: 'y2', cash_session_id: 's1', method: 'cash', amount: 500 },
      { id: 'y3', cash_session_id: 's1', method: 'card', amount: 999 },
      { id: 'y4', cash_session_id: 's2', method: 'cash', amount: 70 },
    ],
    refunds: [{ id: 'r1', payment_id: 'y2', amount: 0.1 }, { id: 'r2', payment_id: 'y3', amount: 50 }],
    adjustments: [{ cash_session_id: 's1', direction: 'out', amount: 120 }, { cash_session_id: 's1', direction: 'in', amount: 0.2 }, { cash_session_id: 's2', direction: 'out', amount: 9 }],
  };
  const f = build(state), flow = f.cashFlow({ id: 's1', opening_cash: 500 });
  // «Cobros en efectivo» es lo cobrado ($1,300.00); antes se mostraba ya con las salidas restadas ($1,180.00).
  // Cada renglón dice además cuántos movimientos lo forman (lo que muestra el desglose de Caja).
  assert.deepEqual(flow, { opening: 50000, collected: 130000, refunded: 10, added: 20, removed: 12000, payments: 2, refunds: 1, ins: 1, outs: 1, expected: 168010 });
  assert.equal(f.cashExpected({ id: 's1', opening_cash: 500 }), 1680.1);
  assert.equal(f.cashExpected({ id: 's2', opening_cash: 0 }), 61);
});

test('Centavos: el resumen de cuenta del chat también cuadra con pagos en partes', () => {
  const state = pagosEnPartes();
  const r = resumenFn({ charges: state.charges, payments: state.payments, allocations: state.allocations, refunds: [], refundAllocations: [] }, '2026-11-08');
  assert.deepEqual([r.due, r.credit, r.openCount, r.overdueAmount, r.lastPaymentAmount], [0, 0, 0, 0, 33.4]);
  const sinPagar = resumenFn({ charges: [1, 2, 3].map((i) => ({ id: 'c' + i, status: 'open', total_amount: 33.4, due_on: '2026-11-01' })), payments: [], allocations: [], refunds: [], refundAllocations: [] }, '2026-11-08');
  assert.deepEqual([sinPagar.due, sinPagar.overdueAmount, sinPagar.nextBalance], [100.2, 100.2, 33.4]);
});

test('Centavos: el módulo ya no resta pesos con decimales para decidir saldos, reembolsos o conciliación', () => {
  assert.doesNotMatch(src, /Math\.max\(0,Number\([a-z.]*total_amount\)-/);
  assert.doesNotMatch(src, /available=Number\(payment\.amount\)-already/);
  assert.match(src, /available=Math\.max\(0,cents\(payment\.amount\)-already\)\/100/);
  assert.match(src, /allocated===cents\(payment\.amount\)/);
  assert.match(src, /return \(received-refunded\)\/100;/);
});
