// Finanzas: integridad de caja y recibos (auditoría 2026-11-26). La conducta de la base se probó con Postgres local
// (docs/pruebas/caja-integridad/); aquí quedan los contratos del código y el comportamiento del recibo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const sql = read('supabase/migrations/20261127120000_smyl_finance_cash_integrity.sql');
const ui = read('smyl-finance.js');

test('el reembolso guarda de dónde salió el dinero: método, caja, sucursal y referencia', () => {
  assert.match(sql, /add column if not exists refund_method text/);
  assert.match(sql, /add column if not exists refund_cash_session_id uuid/);
  assert.match(sql, /add column if not exists refund_branch_id uuid/);
  assert.match(sql, /add column if not exists reference text not null default ''/);
  assert.match(sql, /smyl_finance_refunds_cash_session_check check \(refund_method is distinct from 'cash' or refund_cash_session_id is not null\)/, 'un reembolso en efectivo no puede quedar sin caja');
  assert.match(sql, /Para devolver efectivo elige una caja abierta/);
  assert.match(sql, /La caja elegida no está abierta/);
  assert.match(sql, /Escribe la referencia de la devolución/);
  assert.match(sql, /drop function if exists public\.smyl_refund_payment\(uuid, uuid, uuid, numeric, text\)/, 'sustituye la firma anterior');
});

test('una caja cerrada no recibe movimientos: el disparador bloquea la sesión y la vuelve a comprobar', () => {
  assert.match(sql, /from public\.smyl_cash_sessions where tenant_id = new\.tenant_id and id = v_session for update/);
  for (const table of ['smyl_finance_payments', 'smyl_cash_adjustments', 'smyl_finance_refunds']) {
    assert.match(sql, new RegExp('before insert on public\\.' + table + '\\s+for each row execute function public\\.smyl_lock_open_cash_session'), table);
  }
  assert.match(sql, /La caja ya fue cerrada/);
});

test('el corte sale de UNA función y los reembolsos históricos no cambian ningún corte cerrado', () => {
  assert.match(sql, /v_expected := public\.smyl_cash_expected\(v_tenant, p_session_id\)/);
  assert.match(sql, /r\.refund_method = 'cash' and r\.refund_cash_session_id = p_session/);
  assert.match(sql, /r\.refund_method is null and p\.cash_session_id = p_session and p\.method = 'cash'/, 'histórico: sigue en la caja del pago original');
  assert.match(sql, /revoke all on function public\.smyl_cash_expected\(uuid, uuid\) from public, anon, authenticated/, 'la función interna no la llama nadie desde el navegador');
  assert.match(sql, /smyl_can_access_finance_branch\(v_tenant, v_branch\)/, 'la lectura pública respeta el alcance por sucursal');
});

test('la pantalla manda método, caja y referencia, y conserva la llave del intento mientras el diálogo siga abierto', () => {
  const dlg = ui.slice(ui.indexOf('function openRefund(payment){'), ui.indexOf('function openCash(){'));
  assert.match(dlg, /var attempt=\{id:crypto\.randomUUID\(\),key:crypto\.randomUUID\(\)\}/, 'la llave se crea al abrir, no en cada clic');
  assert.ok(dlg.indexOf('attempt={') < dlg.indexOf('form.onsubmit'), 'la llave nace antes del envío');
  assert.match(dlg, /p_id:attempt\.id,p_idempotency_key:attempt\.key/);
  assert.match(dlg, /p_method:method,p_cash_session_id:method==='cash'\?f\.get\('cash_session'\):null,p_reference:/);
  assert.match(dlg, /No hay caja abierta/, 'sin caja abierta no se puede devolver efectivo y lo explica');
  assert.doesNotMatch(dlg, /p_id:crypto\.randomUUID\(\),p_idempotency_key:crypto\.randomUUID\(\)/);
  assert.match(ui, /function refundOnSession\(r,s\)/);
});

// Recibo: se arma siempre desde su fotografía.
function buildReceiptLines(state) {
  const m = ui.match(/function receiptLines\(receipt\)\{[\s\S]*?\n  \}/);
  assert.ok(m, 'no se encontró receiptLines');
  const by = (list, id) => list.find((x) => x.id === id);
  return new Function('state', 'by', 'acctIndex', m[0] + ';return receiptLines;')(state, by, () => ({ allocByPayment: state.currentAllocByPayment }));
}

test('recibo: aplicar después un anticipo NO reescribe el recibo ya emitido', () => {
  const state = {
    charges: [{ id: 'c1', concept: 'Limpieza' }, { id: 'c2', concept: 'Ortodoncia' }],
    payments: [{ id: 'p1' }],
    // Hoy el pago tiene dos aplicaciones (la segunda se hizo días después del cobro)…
    currentAllocByPayment: new Map([['p1', [{ charge_id: 'c1', amount: 300 }, { charge_id: 'c2', amount: 700 }]]]),
  };
  const lines = buildReceiptLines(state);
  // …pero el recibo se emitió cuando solo se había aplicado a c1.
  const emitido = { payment_id: 'p1', snapshot: { allocations: [{ charge_id: 'c1', amount: 300 }] } };
  assert.deepEqual(lines(emitido).map((l) => [l.charge.id, l.amount]), [['c1', 300]]);
  // Un anticipo (sin aplicaciones al cobrar) sigue viéndose sin servicios aunque después se aplique.
  const anticipo = { payment_id: 'p1', snapshot: { allocations: [] } };
  assert.deepEqual(lines(anticipo), []);
});

test('recibo: solo uno sin fotografía de aplicaciones (anterior a ese dato) cae a las aplicaciones actuales', () => {
  const state = { charges: [{ id: 'c1', concept: 'Limpieza' }], payments: [{ id: 'p1' }], currentAllocByPayment: new Map([['p1', [{ charge_id: 'c1', amount: 100 }]]]) };
  const lines = buildReceiptLines(state);
  assert.deepEqual(lines({ payment_id: 'p1', snapshot: {} }).map((l) => l.amount), [100]);
  assert.deepEqual(lines({ payment_id: 'p1' }).map((l) => l.amount), [100]);
  assert.deepEqual(lines(null), []);
  assert.deepEqual(lines({ payment_id: 'no-existe', snapshot: {} }), []);
});

test('la impresión y el envío del recibo usan receiptLines (la fotografía)', () => {
  assert.match(ui, /async function shareReceipt\(payment,receipt,button\)\{[^\n]*receiptLines\(receipt\)/);
  assert.match(ui, /async function printReceipt\(r\)\{[^\n]*lines=receiptLines\(r\)/);
});

test('web y móvil publican los mismos archivos de Finanzas', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), `mobile/www/${file} difiere`);
});
