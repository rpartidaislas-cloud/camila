import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const sql = read('supabase/migrations/20261128120000_smyl_cash_close_online_report.sql');
const block = (name) => { const m = js.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}\\n')); assert.ok(m, name); return m[0]; };
const cents = (v) => Math.round(Number(v || 0) * 100);

function build(state) {
  const byKey = (list, key, id) => list.find((x) => x[key] === id);
  return new Function('state', 'cents', 'byKey', block("onlinePaymentIds").replace(/^/, '') + block('onlineForCut') + 'return {onlinePaymentIds,onlineForCut};')(state, cents, byKey);
}

const session = { id: 's1', branch_id: 'b1', opened_at: '2026-11-27T10:00:00Z' };
const base = () => ({
  sessions: [session],
  payments: [
    { id: 'a', branch_id: 'b1', patient_id: 'p', method: 'card', amount: 300, paid_at: '2026-11-27T11:00:00Z' },
    { id: 'b', branch_id: 'b1', patient_id: 'p', method: 'transfer', amount: 200, paid_at: '2026-11-27T12:00:00Z' },
    { id: 'c', branch_id: 'b1', patient_id: 'p', method: 'card', amount: 120, paid_at: '2026-11-27T11:30:00Z' },
    { id: 'd', branch_id: 'b2', patient_id: 'p', method: 'card', amount: 77, paid_at: '2026-11-27T11:30:00Z' },
    { id: 'e', branch_id: 'b1', patient_id: 'p', method: 'card', amount: 55, paid_at: '2026-11-26T09:00:00Z' },
  ],
  refunds: [{ payment_id: 'b', amount: 50 }],
  receipts: ['a', 'b', 'd', 'e'].map((id, i) => ({ payment_id: id, folio: 9001 + i, snapshot: { provider: 'openpay' } })).concat([{ payment_id: 'c', folio: 9100, snapshot: { document_type: 'internal_receipt' } }]),
});

test('el reporte del corte toma solo cobros Openpay de la sucursal desde la apertura, netos de reembolsos', () => {
  const r = build(base()).onlineForCut(session);
  assert.deepEqual(r.items.map((x) => x.payment_id), ['a', 'b']);
  assert.equal(r.totalCents, 45000);
  assert.deepEqual(r.byMethod, { card: 30000, transfer: 15000 });
});

test('un cobro que ya salió en el reporte de otro corte no se repite', () => {
  const st = base();
  st.sessions.push({ id: 's0', close_reconciliation: { online: { items: [{ payment_id: 'a' }] } } });
  assert.deepEqual(build(st).onlineForCut(session).items.map((x) => x.payment_id), ['b']);
});

test('lo esperado por contar excluye los cobros en línea y el diálogo los muestra aparte', () => {
  assert.match(js, /payments=closePeriodPayments\(s\)\.filter\(function\(p\)\{return p\.method===method&&!online\.has\(p\.id\);\}\)/);
  assert.match(js, /data-close-online/);
  assert.match(js, /verificados automáticamente\. No se cuentan/);
  assert.match(js, /Cobros en línea \(Openpay\)\./);
});

test('la migración arma el reporte en el servidor, lo guarda en el corte y no se abre a usuarios', () => {
  assert.match(sql, /close_reconciliation \|\| jsonb_build_object\('online'|v_recon \|\| jsonb_build_object\('online', v_online\)/);
  assert.match(sql, /r\.snapshot->>'provider' = 'openpay'/);
  assert.match(sql, /revoke all on function public\.smyl_cash_online_report\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.smyl_cash_online_report\(uuid, uuid\) to service_role;/);
});
