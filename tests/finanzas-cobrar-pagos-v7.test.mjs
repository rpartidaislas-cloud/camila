// Finanzas v6 · paso 2: «Por cobrar» con filas limpias y «Pagos» por periodo, con exportación a Excel.
// La primera parte ejecuta el código real del módulo (clasificación de pagos, periodos, totales, orden de cuentas y exportación);
// la segunda comprueba el contrato de las dos pantallas y de sus estilos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = read('smyl-finance.js');
const css = read('smyl-finance.css');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const line = (name) => pick(new RegExp('function ' + name + '\\([^)]*\\)\\{[^\\n]*\\n'));                          // funciones de una línea
const block = (name) => pick(new RegExp('(?:async )?function ' + name + '\\([^)]*\\)\\{\\n[\\s\\S]*?\\n  \\}\\n'));   // funciones de varias líneas
const code = [
  pick(/var byIndex[\s\S]*?return acct;\}/),
  line('money'), line('date'), line('name'), line('plural'),
  line('paidCents'), line('balanceCents'), line('creditCents'), line('accountSnapshot'),
  line('fold'), line('dayOf'), line('relDay'), line('dayKey'), line('parseDay'),
  pick(/var PAY_PERIODS=[^\n]*\n/), block('payRange'), line('signed'), block('paymentsView'), block('paymentFacts'), line('invoiceState'),
  line('matchAccount'), line('accountRank'), line('compareAccounts'),
  pick(/var PAYMENT_METHODS=[^\n]*\n/), line('receiptConcept'), block('exportPayments'),
].join('\n');
const build = (state, env = {}) => new Function('state', 'window', 'notify', code + ';return {accountSnapshot,fold,relDay,dayKey,parseDay,payRange,signed,paymentsView,paymentFacts,invoiceState,matchAccount,accountRank,compareAccounts,exportPayments,PAY_PERIODS,METHOD_ORDER};')(state, env.window || {}, env.notify || (() => {}));

// Momentos relativos a hoy, en la hora local de quien corre la prueba.
const at = (daysAgo, hour = 12) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const dayOnly = (daysAgo) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function clinic() {
  return {
    payPeriod: 'today', payMethod: '', payFrom: '', payTo: '',
    patients: [{ id: 'p1', nombre: 'Carlos', apellido: 'Aguilar' }, { id: 'p2', nombre: 'Paola', apellido: 'Ríos' }, { id: 'p3', nombre: 'Andrés', apellido: 'Delgado' }, { id: 'p4', nombre: 'Luis', apellido: 'Hernández' }, { id: 'p5', nombre: 'Ximena', apellido: 'Sin Movimientos' }],
    services: [{ id: 's1', name: 'Limpieza dental' }], branches: [{ id: 'b1', name: 'Principal' }], team: [{ id: 'u1', nombre: 'Ana Torres' }],
    charges: [
      { id: 'c1', patient_id: 'p1', status: 'open', total_amount: 800, service_id: 's1', concept: '12', created_at: at(1) },
      { id: 'c2', patient_id: 'p2', status: 'open', total_amount: 1200, concept: 'Resina', created_at: at(5) },
      { id: 'c3', patient_id: 'p4', status: 'open', total_amount: 1500, concept: 'Ortodoncia', due_on: dayOnly(6), created_at: at(20) },
      { id: 'c4', patient_id: 'p4', status: 'open', total_amount: 1500, concept: 'Ortodoncia', due_on: dayOnly(-24), created_at: at(2) },
      { id: 'c5', patient_id: 'p4', status: 'voided', total_amount: 999, concept: 'Anulado', due_on: dayOnly(40), created_at: at(50) }],
    payments: [
      { id: 'y1', patient_id: 'p1', amount: 800, method: 'cash', reference: '', paid_at: at(0, 10), branch_id: 'b1', created_by: 'u1' },
      { id: 'y2', patient_id: 'p2', amount: 600, method: 'transfer', reference: 'SPEI 9431', paid_at: at(2, 9), branch_id: 'b1', created_by: 'u1' },
      { id: 'y3', patient_id: 'p3', amount: 500, method: 'card', reference: '•••• 4421', paid_at: at(0, 11), branch_id: 'b1', created_by: 'otro' },
      { id: 'y4', patient_id: 'p4', amount: 700, method: 'card', reference: '1177', paid_at: at(12, 9), branch_id: 'b1', created_by: 'u1' }],
    allocations: [{ id: 'a1', payment_id: 'y1', charge_id: 'c1', amount: 800 }, { id: 'a2', payment_id: 'y2', charge_id: 'c2', amount: 600 }, { id: 'a4', payment_id: 'y4', charge_id: 'c3', amount: 700 }],
    refunds: [{ id: 'r1', payment_id: 'y2', amount: 200, reason: 'Se cobró de más', refunded_at: at(0, 13), created_by: 'u1' }],
    refundAllocations: [{ id: 'ra1', refund_id: 'r1', charge_id: 'c2', amount: 200 }],
    receipts: [{ id: 'k1', payment_id: 'y1', folio: 105 }, { id: 'k2', payment_id: 'y2', folio: 103 }, { id: 'k3', payment_id: 'y3', folio: 104 }, { id: 'k4', payment_id: 'y4', folio: 102 }],
    drafts: [{ id: 'd1', payment_id: 'y2', status: 'draft' }],
  };
}

test('cada pago dice lo que es: completo, abono o anticipo', () => {
  const state = clinic(), f = build(state), pay = (id) => f.paymentFacts(state.payments.find((p) => p.id === id));
  // Cubre el cargo completo: pago, sin etiqueta. El concepto sale del servicio aunque el cargo traiga solo un número.
  assert.deepEqual({ kind: pay('y1').kind, label: pay('y1').label, concept: pay('y1').concept, credit: pay('y1').creditCents }, { kind: 'full', label: 'Pago', concept: 'Limpieza dental', credit: 0 });
  // Cubre solo parte del cargo: abono (también el último abono de una serie).
  assert.equal(pay('y2').kind, 'partial'); assert.equal(pay('y2').label, 'Abono'); assert.equal(pay('y4').kind, 'partial');
  // No se aplicó a ningún cargo: anticipo, y todo queda a favor.
  assert.deepEqual({ kind: pay('y3').kind, label: pay('y3').label, concept: pay('y3').concept, credit: pay('y3').creditCents }, { kind: 'advance', label: 'Anticipo', concept: '', credit: 50000 });
});

test('lo que sobra de un pago queda a favor, y un reembolso primero deshace lo aplicado', () => {
  const state = clinic(), f = build(state);
  // $1,000 para un cargo de $800: pago completo y $200 a favor. Dos conceptos se resumen como «… + 1 más».
  state.charges.push({ id: 'c9', patient_id: 'p1', status: 'open', total_amount: 300, concept: 'Radiografía', created_at: at(1) });
  state.payments.push({ id: 'y9', patient_id: 'p1', amount: 1300, method: 'cash', paid_at: at(0, 9) });
  state.allocations.push({ id: 'a9', payment_id: 'y9', charge_id: 'c9', amount: 300 }, { id: 'a10', payment_id: 'y9', charge_id: 'c1', amount: 800 });
  const mixed = build(state).paymentFacts(state.payments.find((p) => p.id === 'y9'));
  assert.equal(mixed.kind, 'full'); assert.equal(mixed.creditCents, 20000); assert.equal(mixed.concept, 'Radiografía + 1 más'); assert.deepEqual(mixed.concepts, ['Radiografía', 'Limpieza dental']);
  // Abono de $600 con reembolso de $200: se deshace de lo aplicado; no aparece saldo a favor.
  const refunded = f.paymentFacts(clinic().payments[1]);
  assert.equal(refunded.refundedCents, 20000); assert.equal(refunded.creditCents, 0);
  // Anticipo de $500 con reembolso de $200: quedan $300 a favor. Con reembolso total, nada.
  const partial = clinic(); partial.refunds.push({ id: 'r2', payment_id: 'y3', amount: 200, reason: 'x', refunded_at: at(0) });
  assert.equal(build(partial).paymentFacts(partial.payments[2]).creditCents, 30000);
  const total = clinic(); total.refunds.push({ id: 'r3', payment_id: 'y3', amount: 500, reason: 'x', refunded_at: at(0) });
  assert.deepEqual([build(total).paymentFacts(total.payments[2]).creditCents, build(total).paymentFacts(total.payments[2]).refundedCents], [0, 50000]);
  // $1,000 con $800 aplicados y $900 reembolsados: el reembolso deshace los $800 y toma $100 del sobrante; quedan $100 a favor.
  const over = clinic(); over.payments.push({ id: 'y8', patient_id: 'p1', amount: 1000, method: 'cash', paid_at: at(0) }); over.allocations.push({ id: 'a8', payment_id: 'y8', charge_id: 'c1', amount: 800 }); over.refunds.push({ id: 'r8', payment_id: 'y8', amount: 900, reason: 'x', refunded_at: at(0) });
  assert.equal(build(over).paymentFacts(over.payments.find((p) => p.id === 'y8')).creditCents, 10000);
});

test('Pagos se consulta por periodo: hoy, 7 días, este mes o las fechas elegidas', () => {
  const state = clinic(), f = build(state), now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), day = 86400000;
  assert.deepEqual(f.PAY_PERIODS.map((p) => p.join(':')), ['today:Hoy', 'week:7 días', 'month:Este mes', 'custom:Fechas']);
  let r = f.payRange();
  assert.equal(r.from, midnight); assert.equal(r.to, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()); assert.equal(r.text, 'hoy'); assert.equal(r.fromDay, r.toDay);
  state.payPeriod = 'week'; r = f.payRange();
  assert.equal(r.from, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), 'hoy y los seis días anteriores'); assert.equal(r.text, 'en los últimos 7 días');
  state.payPeriod = 'month'; r = f.payRange();
  assert.equal(r.from, new Date(now.getFullYear(), now.getMonth(), 1).getTime()); assert.equal(r.text, 'este mes'); assert.match(r.fromDay, /-01$/);
  state.payPeriod = 'custom'; state.payFrom = '2026-10-01'; state.payTo = '2026-10-31'; r = f.payRange();
  assert.equal(r.from, new Date(2026, 9, 1).getTime()); assert.equal(r.to, new Date(2026, 10, 1).getTime(), 'el último día entra completo');
  assert.equal(r.text, 'del 1 oct 2026 al 31 oct 2026'); assert.deepEqual([r.fromDay, r.toDay], ['2026-10-01', '2026-10-31']);
  state.payFrom = '2026-10-31'; state.payTo = '2026-10-01'; assert.deepEqual([f.payRange().fromDay, f.payRange().toDay], ['2026-10-01', '2026-10-31'], 'fechas invertidas se ordenan');
  state.payFrom = '2026-10-15'; state.payTo = '2026-10-15'; assert.equal(f.payRange().text, 'el 15 oct 2026'); assert.equal(f.payRange().to - f.payRange().from, day);
  state.payFrom = ''; state.payTo = 'no es fecha'; assert.equal(f.payRange().from, midnight, 'sin fechas válidas se queda en hoy');
});

test('el total del periodo es neto (pagos menos reembolsos) y el desglose por forma de pago cuadra', () => {
  const state = clinic(), f = build(state);
  let v = f.paymentsView();   // hoy: dos pagos ($800 en efectivo y $500 con tarjeta) y el reembolso de $200 de una transferencia anterior
  assert.deepEqual(v.events.map((e) => e.kind + ':' + e.row.id), ['refund:r1', 'payment:y3', 'payment:y1'], 'del más reciente al más antiguo');
  assert.deepEqual([v.payments, v.refunds, v.totalCents], [2, 1, 110000]);
  assert.deepEqual(v.byMethod, { cash: 80000, card: 50000, transfer: -20000 });
  assert.equal(Object.values(v.byMethod).reduce((a, b) => a + b, 0), v.totalCents);
  assert.equal(v.events[0].payment.id, 'y2', 'el reembolso conoce su pago original');
  state.payMethod = 'cash'; v = f.paymentsView();
  assert.deepEqual([v.events.length, v.totalCents, v.refunds], [1, 80000, 0]);
  assert.deepEqual(v.byMethod, { cash: 80000, card: 50000, transfer: -20000 }, 'el desglose sigue siendo del periodo completo');
  state.payMethod = 'transfer'; v = f.paymentsView();
  assert.deepEqual([v.events.length, v.totalCents], [1, -20000], 'un reembolso se filtra por la forma de pago de su pago original');
  state.payMethod = ''; state.payPeriod = 'week'; v = f.paymentsView();
  assert.deepEqual([v.payments, v.refunds, v.totalCents], [3, 1, 170000], 'la semana suma el abono de hace dos días');
  state.payPeriod = 'custom'; state.payFrom = dayOnly(13); state.payTo = dayOnly(11); v = f.paymentsView();
  assert.deepEqual(v.events.map((e) => e.row.id), ['y4']);
  state.payFrom = '2020-01-01'; state.payTo = '2020-01-31';
  assert.deepEqual([f.paymentsView().events.length, f.paymentsView().totalCents], [0, 0]);
  assert.equal(f.signed(-20000), '−$200.00'); assert.equal(f.signed(110000), '$1,100.00'); assert.equal(f.signed(0), '$0.00');
});

test('la cuenta trae lo pagado de sus cargos abiertos, los días de atraso y el último pago', () => {
  const state = clinic(), f = build(state), luis = f.accountSnapshot('p4'), paola = f.accountSnapshot('p2'), carlos = f.accountSnapshot('p1'), andres = f.accountSnapshot('p3');
  // Luis: dos cargos de $1,500 (uno vencido hace 6 días con $700 pagados); el cargo anulado no cuenta.
  assert.deepEqual([luis.dueCents, luis.overdueCents, luis.openTotalCents, luis.totalCents, luis.overdueDays, luis.overdue.length], [230000, 80000, 300000, 300000, 6, 1]);
  assert.equal(luis.openTotalCents - luis.dueCents, 70000, 'pagado de los cargos abiertos');
  assert.equal(luis.lastPaid, state.payments[3].paid_at);
  // Paola: abonó $600 y se le reembolsaron $200 → $400 pagados de $1,200.
  assert.deepEqual([paola.dueCents, paola.openTotalCents - paola.dueCents, paola.overdueDays], [80000, 40000, 0]);
  // Carlos liquidó: sin cargos abiertos; Andrés solo tiene un anticipo.
  assert.deepEqual([carlos.dueCents, carlos.openTotalCents, carlos.totalCents, carlos.creditCents], [0, 0, 80000, 0]);
  assert.deepEqual([andres.dueCents, andres.creditCents, andres.charges.length], [0, 50000, 0]);
  assert.ok(andres.lastPaidAt > 0 && f.accountSnapshot('p5').lastPaidAt === 0 && f.accountSnapshot('p5').lastPaid === null);
});

test('las cuatro vistas y el orden de la lista: vencidas, con saldo, a favor, liquidadas y sin movimientos', () => {
  const state = clinic(), f = build(state), rows = state.patients.map((p) => ({ p, s: f.accountSnapshot(p.id) }));
  const names = (filter) => rows.filter((x) => f.matchAccount(x.s, filter)).sort(f.compareAccounts).map((x) => x.p.nombre);
  assert.deepEqual(names('open'), ['Luis', 'Paola']);
  assert.deepEqual(names('overdue'), ['Luis']);
  assert.deepEqual(names('credit'), ['Andrés']);
  assert.deepEqual(names('all'), ['Luis', 'Paola', 'Andrés', 'Carlos'], 'Todas: solo cuentas con movimientos');
  assert.deepEqual(rows.slice().sort(f.compareAccounts).map((x) => x.p.nombre), ['Luis', 'Paola', 'Andrés', 'Carlos', 'Ximena'], 'al buscar, quien no tiene movimientos va al final');
  assert.deepEqual(rows.map((x) => f.accountRank(x.s)), [3, 1, 2, 0, 4]);
  // Entre vencidas manda quien lleva más días; entre cuentas con saldo, quien debe más; a igualdad, el nombre.
  const s = (o) => ({ overdue: o.days ? [1] : [], overdueDays: o.days || 0, overdueCents: o.late || 0, dueCents: o.due || 0, creditCents: o.credit || 0, charges: o.due || o.paid ? [1] : [], lastPaidAt: o.paid || 0 });
  const sample = [{ p: state.patients[0], s: s({ due: 100 }) }, { p: state.patients[1], s: s({ due: 900 }) }, { p: state.patients[2], s: s({ due: 500, days: 3, late: 500 }) }, { p: state.patients[3], s: s({ due: 200, days: 30, late: 200 }) }, { p: state.patients[4], s: s({ due: 900 }) }];
  assert.deepEqual(sample.sort(f.compareAccounts).map((x) => x.p.nombre), ['Luis', 'Andrés', 'Paola', 'Ximena', 'Carlos']);
  const settled = [{ p: state.patients[0], s: s({ paid: 10 }) }, { p: state.patients[1], s: s({ paid: 50 }) }];
  assert.deepEqual(settled.sort(f.compareAccounts).map((x) => x.p.nombre), ['Paola', 'Carlos'], 'entre liquidadas, el pago más reciente primero');
});

test('buscar ignora acentos y mayúsculas, y las fechas se leen en palabras', () => {
  const f = build(clinic());
  assert.equal(f.fold('  LÓPEZ Núñez  '), '  lopez nunez  '); assert.equal(f.fold(null), ''); assert.ok(f.fold('María José Güemes').includes('guemes'));
  assert.equal(f.relDay(at(0), '', 'el '), 'hoy'); assert.equal(f.relDay(at(1), 'de ', 'del '), 'de ayer'); assert.match(f.relDay(at(9), 'de ', 'del '), /^del \d{1,2} [a-zé]{3}/); assert.equal(f.relDay('', '', 'el '), '');
  assert.equal(f.dayKey(new Date(2026, 0, 5)), '2026-01-05'); assert.equal(f.parseDay('2026-01-05').getTime(), new Date(2026, 0, 5).getTime()); assert.equal(f.parseDay('05/01/2026'), null);
  assert.equal(f.invoiceState({ id: 'y2' }), 'en preparación'); assert.equal(f.invoiceState({ id: 'y1' }), '');
});

test('Exportar arma el Excel con lo mismo que la pantalla y lo registra antes de descargarlo', async () => {
  const state = clinic(); state.payPeriod = 'week';
  const order = [], notes = [], out = {}, button = { disabled: false };
  const window = { SmylSecurity: { recordExport: async (d) => { order.push('registro'); out.record = d; return { ok: true }; } }, SmylXlsx: { download: async (file, sheets) => { order.push('descarga'); out.file = file; out.sheets = sheets; return 1; } } };
  await build(state, { window, notify: (t, tone) => notes.push([t, tone]) }).exportPayments(button);
  assert.deepEqual(order, ['registro', 'descarga'], 'primero se registra; después se genera el archivo');
  assert.deepEqual({ type: out.record.export_type, entity: out.record.entity_type, count: out.record.record_count, purpose: out.record.purpose }, { type: 'executive_csv', entity: 'executive_report', count: 4, purpose: 'administration' });
  assert.equal(out.record.entity_id, 'pagos:' + dayOnly(6) + ':' + dayOnly(0) + ':todas');
  assert.equal(out.file, 'pagos-' + dayOnly(6) + '_a_' + dayOnly(0) + '.xlsx');
  const [pagos, totales] = out.sheets;
  assert.deepEqual([pagos.name, pagos.filter, totales.name], ['Pagos', true, 'Totales']);
  assert.deepEqual(pagos.columns.map((c) => c.header + (c.type ? ':' + c.type : '')), ['Fecha:datetime', 'Recibo', 'Paciente', 'Tipo', 'Concepto', 'Forma de pago', 'Referencia', 'Importe:money', 'Sucursal', 'Registró', 'Factura']);
  assert.deepEqual(pagos.rows, [
    [state.refunds[0].refunded_at, '000103', 'Paola Ríos', 'Reembolso', 'Se cobró de más', 'Transferencia', 'SPEI 9431', -200, 'Principal', 'Ana Torres', ''],
    [state.payments[2].paid_at, '000104', 'Andrés Delgado', 'Anticipo', 'Saldo a favor', 'Tarjeta', '•••• 4421', 500, 'Principal', '', 'Sin factura'],
    [state.payments[0].paid_at, '000105', 'Carlos Aguilar', 'Pago', 'Limpieza dental', 'Efectivo', '', 800, 'Principal', 'Ana Torres', 'Sin factura'],
    [state.payments[1].paid_at, '000103', 'Paola Ríos', 'Abono', 'Resina', 'Transferencia', 'SPEI 9431', 600, 'Principal', 'Ana Torres', 'En preparación']]);
  assert.equal(pagos.rows.reduce((sum, r) => sum + r[7], 0), 1700, 'la suma del Excel es el total neto de la pantalla');
  const flat = totales.rows.map((r) => r.map((c) => (c && typeof c === 'object' && 'value' in c ? (c.value instanceof Date ? 'fecha' : c.value) : c)));
  assert.deepEqual(flat.slice(0, -1), [['Periodo', 'Del ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at(6))) + ' al ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(at(0)))], ['Forma de pago', 'Todas'], ['Pagos', 3], ['Reembolsos', 1], ['Total cobrado (pagos menos reembolsos)', 1700], ['Efectivo', 800], ['Tarjeta', 500], ['Transferencia', 400]]);
  assert.deepEqual(flat[flat.length - 1], ['Generado', 'fecha']);
  assert.deepEqual(notes, [['Se descargó ' + out.file + ' con 4 movimientos.', 'success']]);
  assert.equal(button.disabled, false, 'el botón vuelve a quedar disponible');
});

test('si la exportación no se puede registrar, no se descarga nada', async () => {
  for (const window of [{ SmylSecurity: { recordExport: async () => { throw new Error('La exportación no quedó registrada.'); } }, SmylXlsx: { download: async () => { throw new Error('no debió llamarse'); } } }, { SmylXlsx: { download: async () => { throw new Error('no debió llamarse'); } } }]) {
    const notes = [], button = { disabled: false };
    await build(clinic(), { window, notify: (t, tone) => notes.push([t, tone]) }).exportPayments(button);
    assert.equal(notes.length, 1); assert.equal(notes[0][1], 'error'); assert.equal(button.disabled, false);
  }
  // Sin movimientos en el periodo no hay nada que exportar ni que registrar.
  const empty = clinic(); empty.payPeriod = 'custom'; empty.payFrom = '2020-01-01'; empty.payTo = '2020-01-31'; let called = 0;
  await build(empty, { window: { SmylSecurity: { recordExport: async () => { called += 1; return { ok: true }; } }, SmylXlsx: { download: async () => { called += 1; } } } }).exportPayments({ disabled: false });
  assert.equal(called, 0);
});

test('«Por cobrar»: una tarjeta, cuatro vistas, un botón por fila y el nombre abre la cuenta', () => {
  assert.match(src, /<article class="finance-card finance-list-card"><div class="finance-list-tools"><input id="finance-search" type="search" placeholder="Buscar paciente"/);
  assert.deepEqual([...src.matchAll(/data-account-filter="(\w+)" aria-pressed="(true|false)">([^<]+)/g)].map((m) => m[1] + ':' + m[3].trim() + ':' + m[2]), ['open:Con saldo:true', 'overdue:Vencidas:false', 'credit:A favor:false', 'all:Todas:false']);
  // El buscador recorre todas las cuentas: mientras se busca no hay vista marcada, y elegir una vista limpia la búsqueda.
  assert.match(src, /filter=search\?'':state\.accountFilter/);
  assert.match(src, /function setAccountFilter\(filter\)\{var input=document\.getElementById\('finance-search'\);if\(input\)input\.value='';/);
  assert.match(src, /return search\?fold\(name\(x\.p\.id\)\)\.indexOf\(search\)!==-1:matchAccount\(x\.s,filter\);/);
  // Columnas fijas: Paciente, Pagado, Saldo y una sola acción.
  assert.match(src, /<div class="finance-cols" data-cols="accounts" aria-hidden="true"><span>Paciente<\/span><span>Pagado<\/span><span>Saldo<\/span><span><\/span><\/div>/);
  const row = src.slice(src.indexOf('function accountLine(x){'), src.indexOf('function renderAccounts(){'));
  assert.equal((row.match(/class="btn btn-secondary"/g) || []).length, 2, 'la fila arma «Cobrar» o «Ver cuenta», nunca los dos');
  assert.match(row, /\(debt&&state\.canManage\?'<button[^']*data-account-pay=[^:]*:'<button[^']*data-account="'\+id\+'"[^']*'\+label\+'">Ver cuenta<\/button>'\)/);
  assert.doesNotMatch(row, /btn-primary|finance-badge/, 'sin botón oscuro ni etiquetas de estado en cada fila');
  assert.equal((row.match(/data-tone="danger"/g) || []).length, 1, 'el único color de alerta es el de «Vencida»');
  assert.match(row, /if\(late\)sub='<span class="finance-tag" data-tone="danger">Vencida<\/span> '/);
  // El menú de tres puntos va antes del botón, para que el botón quede alineado en todas las filas.
  assert.ok(row.indexOf('<details class="finance-row-menu">') < row.indexOf('data-account-pay='));
  assert.match(row, /<button type="button" class="finance-line-who" data-account="'\+id\+'" title="Abrir la cuenta"><strong class="finance-line-name">/);
  assert.match(src, /Toca el nombre de un paciente para abrir su cuenta completa\./);
  // No se promete aplicar un saldo a favor desde la lista: hoy no existe esa operación.
  assert.doesNotMatch(src, /Listo para aplicar a un cargo|>Aplicar<\/button>/);
});

test('las citas sin cobrar usan las mismas filas y nunca desaparecen sin aviso', () => {
  const start = src.indexOf('function renderVisits(){'), visits = src.slice(start, src.indexOf('function openNoCharge(', start));
  assert.ok(start > 0 && visits.length > 500);
  assert.match(visits, /<article class="finance-line" data-cols="visits" data-visit-state="/);
  assert.match(visits, /inView=Boolean\(search\)\|\|state\.accountFilter==='open'/);
  assert.match(visits, /class="finance-visits-peek" data-visits-show>'\+plural\(pending\.length,'cita atendida sin cobrar','citas atendidas sin cobrar'\)\+' · <b>Ver<\/b><\/button>/);
  assert.match(visits, /if\(peek\)peek\.onclick=function\(\)\{setAccountFilter\('open'\);\}/);
  assert.match(visits, /rows=search\?pending\.filter\(function\(a\)\{return fold\(name\(a\.patient_id\)\)\.indexOf\(search\)!==-1;\}\):pending/, 'al buscar, también se filtran las citas');
  assert.doesNotMatch(visits, /btn-primary|finance-visit-row|finance-badge/);
});

test('«Pagos»: periodo, forma de pago y exportación arriba; pagos y reembolsos en una sola lista', () => {
  assert.match(src, /<div class="finance-segment" role="group" aria-label="Periodo">'\+PAY_PERIODS\.map\(/);
  // El texto del filtro es corto a propósito: «Todas las formas de pago» se cortaba junto a «Exportar» en celulares de menos de 410 px.
  assert.match(src, /<select id="finance-pay-method" aria-label="Forma de pago"><option value="">Todas las formas<\/option>'\+METHOD_ORDER\.map\(/);
  assert.doesNotMatch(src, /Todas las formas de pago/);
  assert.match(src, /<button type="button" class="btn btn-secondary" id="finance-pay-export"[^>]*>Exportar<\/button>/);
  assert.match(src, /<div class="finance-date-range" id="finance-pay-range" hidden><label>Del <input type="date" id="finance-pay-from"><\/label><label>al <input type="date" id="finance-pay-to"><\/label><\/div>/);
  assert.match(src, /<div class="finance-cols" data-cols="payments" aria-hidden="true"><span>Fecha<\/span><span>Paciente y concepto<\/span><span>Forma de pago<\/span><span>Importe<\/span><span><\/span><\/div>/);
  // «Fechas» empieza en el mes anterior; si una fecha rebasa a la otra, la otra la acompaña.
  assert.match(src, /state\.payFrom=dayKey\(new Date\(now\.getFullYear\(\),now\.getMonth\(\)-1,1\)\);state\.payTo=dayKey\(new Date\(now\.getFullYear\(\),now\.getMonth\(\),0\)\);/);
  assert.match(src, /if\(state\.payFrom>state\.payTo\)state\[k\[0\]==='from'\?'payTo':'payFrom'\]=e\.currentTarget\.value;/);
  // Etiquetas con nombre: Abono, Anticipo y Reembolso (el pago completo no lleva etiqueta).
  const list = src.slice(src.indexOf('function renderPayments(){'), src.indexOf('async function exportPayments('));
  for (const tag of ['<span class="finance-tag" data-tone="ok">Anticipo</span>', '<span class="finance-tag">Abono</span>', '<span class="finance-tag" data-tone="danger">Reembolso</span>']) assert.ok(list.includes(tag), tag);
  assert.match(list, /Queda como saldo a favor/); assert.match(list, /Reembolsado '\+money\(f\.refundedCents\/100\)/);
  // El recibo se abre desde su pago; reembolsar sigue reservado a quien tiene ese permiso y solo si queda algo por reembolsar.
  assert.match(list, /data-open-receipt="'\+receipt\.id\+'"/);
  assert.match(list, /state\.canManage&&state\.canRefund&&left>0\?'<details class="finance-row-menu">/);
  assert.doesNotMatch(list, /btn-primary|finance-badge|Listo para preparar|Pago por aplicar/, 'la lista de pagos ya no carga el estado fiscal de cada recibo');
  assert.match(list, /Los reembolsos aparecen en esta misma lista, en rojo y con su motivo\./);
  assert.doesNotMatch(src, /function renderReceipts|finance-fiscal-receipt-list|data-receipt-filter|fiscalReceiptFilter/);
  // Un solo menú de fila abierto a la vez, y siempre a la vista.
  assert.match(src, /page\.addEventListener\('toggle',function\(e\)\{var menu=e\.target;if\(!menu\.classList\|\|!menu\.classList\.contains\('finance-row-menu'\)\|\|!menu\.open\)return;/);
  assert.match(src, /if\(box\)box\.scrollIntoView\(\{block:'nearest'\}\);\},true\);/);
});

test('los estilos: columnas alineadas, color solo donde hace falta y acomodo por espacio disponible', () => {
  const block = css.slice(css.indexOf('/* Finanzas v6 · paso 2'));
  assert.ok(block.length > 0);
  assert.match(block, /#p-caja :is\(\.finance-cols,\.finance-line\)\[data-cols=accounts\]\{grid-template-columns:minmax\(0,1\.5fr\) minmax\(0,1\.15fr\) 124px 164px\}/);
  assert.match(block, /#p-caja :is\(\.finance-cols,\.finance-line\)\[data-cols=payments\]\{grid-template-columns:132px minmax\(0,1\.7fr\) minmax\(0,\.9fr\) 112px 104px\}/);
  assert.match(block, /#p-caja \.finance-line-amount\{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums\}/);
  assert.match(block, /#p-caja \.finance-line\[data-kind=refund\] \.finance-line-amount strong\{color:var\(--smyl-danger,#b42318\)\}/);
  // El menú de fila abre hacia adentro de la pantalla en cualquier tamaño.
  assert.match(block, /#p-caja \.finance-line \.finance-row-menu>div\{right:0;left:auto;scroll-margin:12px 0 96px\}/);
  // Tres acomodos: medio (tableta), celular y celular angosto. Cada regla angosta vive en un @media para que el generador la copie al contenedor.
  for (const width of [820, 720, 560, 420]) {
    assert.match(block, new RegExp('@media\\(max-width:' + width + 'px\\)\\{'));
    assert.match(block, new RegExp('/\\*contenedor\\*/@container finance-workspace \\(max-width:' + width + 'px\\)\\{'));
  }
  assert.match(block, /#p-caja \.finance-line\[data-cols=accounts\]\{grid-template-columns:minmax\(0,1fr\) auto 160px;grid-template-areas:"who amount actions" "paid amount actions"\}/);
  assert.match(block, /#p-caja \.finance-line\[data-cols=payments\]\{grid-template-columns:112px minmax\(0,1fr\) auto 108px;grid-template-areas:"when who amount actions" "when who how actions";row-gap:0\}/);
  // En pantallas táctiles todo mide al menos 44 px, también las opciones del menú de una fila.
  assert.match(block, /#p-caja :is\(\.finance-chips>button,\.finance-segment>button,\.finance-line-actions \.btn,\.finance-tools-end \.btn,\.finance-visits-peek,button\.finance-line-who\)\{min-height:44px\}/);
  assert.match(block, /#p-caja \.finance-line \.finance-row-menu button\{min-height:44px\}/);
  // La barra de «Pagos»: periodos, filtro y «Exportar» miden lo mismo (42 px) y el filtro nunca se recorta:
  // en celular crece hasta llenar el renglón y, si no cabe junto a «Exportar», el botón baja a su propio renglón.
  assert.match(block, /#p-caja \.finance-segment\{[^}]*padding:3px;border:1px solid/); assert.match(block, /#p-caja \.finance-segment>button\{min-height:34px;/);
  assert.match(block, /#p-caja \.finance-tools-end\{display:flex;flex-wrap:wrap;align-items:center;gap:8px\}/);
  assert.match(block, /#p-caja \.finance-tools-end \.btn\{min-height:42px\}/);
  assert.match(block, /#p-caja \.finance-tools-end\{flex:1 0 100%\}/);
  assert.match(block, /#p-caja \.finance-tools-end select\{flex:999 1 auto;max-width:100%\}/);
  assert.match(block, /#p-caja \.finance-tools-end \.btn\{flex:1 0 auto;justify-content:center\}/);
  assert.doesNotMatch(block, /finance-tools-end\{[^}]*nowrap|finance-tools-end select\{[^}]*min-width:0/);
  // En celular los periodos se reparten según su texto («Este mes» no cabe en un cuarto exacto de 320 px).
  assert.match(block, /@media\(max-width:420px\)\{[^@]*#p-caja \.finance-segment>button\{flex:1 1 auto\}/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12);
  assert.equal(tiny.length, 0, 'sin texto menor a 12 px');
  // La limpieza se llevó las reglas de las listas viejas.
  assert.doesNotMatch(css, /finance-account-identity|finance-account-progress|finance-today-row|finance-ledger-total|finance-row-pay|finance-visit-row|finance-fiscal-receipt-list|finance-account-filters|finance-more-filters/);
});

test('versiones publicadas y copias de la app móvil al día', () => {
  const app = read('app.html'), sw = read('sw.js');
  assert.match(app, /smyl-finance\.css\?v=56/); assert.match(app, /smyl-finance\.js\?v=73/);
  assert.match(sw, /smyl-finance\.js\?v=73/); assert.match(sw, /smyl-finance\.css\?v=56/); assert.match(sw, /finanzas-cobrar-pagos-v7-pagos-filtro-v8/);
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-xlsx.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), file);
});
