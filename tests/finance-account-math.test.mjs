import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Ejecuta el código real de Caja (índices de cuenta) y lo contrasta con la definición directa (la lenta, de referencia).
const src = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const code = [
  pick(/var byIndex[\s\S]*?return acct;\}/),
  pick(/function paidFor\(charge\)\{[^\n]*\n/),
  pick(/function balance\(charge\)\{[^\n]*\n/),
  pick(/function patientBalance\(id\)\{[^\n]*\n/),
  pick(/function patientCredit\(id\)\{[^\n]*\n/),
  pick(/function accountSnapshot\(id\)\{[^\n]*\n/),
].join('\n');
const build = new Function('state', code + ';return {accountSnapshot,patientCredit,patientBalance,balance};');

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
