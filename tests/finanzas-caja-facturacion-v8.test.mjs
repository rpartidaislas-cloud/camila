// Finanzas v6 · paso 3: Caja con su historia (desglose, movimientos del turno y cortes anteriores), corte de caja sin columnas
// cortadas, cobro con pasos 1, 2 y 3, y Facturación en una sola lista con un botón por fila.
// La primera parte ejecuta el código real del módulo; la segunda comprueba el contrato de las pantallas, las ventanas y sus estilos.
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
  line('esc'), line('money'), line('date'), line('name'), line('actorName'), line('plural'), line('dayOf'), line('whenLabel'), line('relDay'), line('signed'),
  pick(/function cashFlow\(s\)\{[\s\S]*?return out;\}/), line('cashExpected'), block('cashMoves'),
  line('atClock'), line('clock'), line('moveWhen'), line('openedLabel'), line('dayLabel'), line('shiftSpan'),
  line('ledgerRow'), block('cashLedger'), line('ledgerTotal'), block('moveLine'), block('cutNotes'), line('cutTag'), line('foldRow'), block('cutRow'), block('teamRow'), block('turnBlock'),
  line('receiptConcept'), block('paymentFacts'), block('fiscalReceiptItem'), line('pacConnected'), line('st_armed'),
  pick(/var INVOICE_FILTERS=[^\n]*\n/), line('invoiceBucket'), line('invoiceIsReal'), 'var chatLinks={};', line('waLink'), line('rowMenu'), block('invoiceLine'), block('pendingLine'), block('fiscalStatusStrip'),
].join('\n');
const build = (state, steps) => new Function('state', 'billingSteps', code + ';return {cashFlow,cashExpected,cashMoves,atClock,openedLabel,dayLabel,cashLedger,moveLine,cutNotes,cutTag,cutRow,teamRow,turnBlock,fiscalReceiptItem,invoiceBucket,invoiceIsReal,invoiceLine,pendingLine,fiscalStatusStrip,INVOICE_FILTERS};')(state, () => steps || [{ done: true }, { done: false }, { done: false }, { done: false }]);

// Momentos relativos a hoy, en la hora local de quien corre la prueba.
const at = (daysAgo, hour = 12, minute = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const pesos = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
// La conciliación tal como la escribe el corte en sus notas.
const audit = (cash, extra = '') => 'Cierre de turno. Conciliación: Efectivo esperado ' + pesos(cash[0]) + ', reportado ' + pesos(cash[1]) + ', diferencia ' + pesos(cash[1] - cash[0]) + '; Tarjetas esperado $1,200.00, reportado $1,150.00, diferencia -$50.00; Transferencias esperado $0.00, reportado $0.00, diferencia $0.00; Cheques esperado $0.00, reportado $0.00, diferencia $0.00; Otros esperado $0.00, reportado $0.00, diferencia $0.00' + extra;

function clinic() {
  return {
    actor: 'u1', canCash: true, canSuperviseCash: true, canInvoice: true, shown: { moves: 12, cuts: 5, invoices: 50 },
    team: [{ id: 'u1', nombre: 'Ana Torres' }, { id: 'u2', nombre: 'Luis Pérez' }],
    branches: [{ id: 'b1', name: 'Principal' }], services: [{ id: 's1', name: 'Limpieza dental' }],
    patients: [{ id: 'p1', nombre: 'Carlos', apellido: 'Aguilar' }, { id: 'p2', nombre: 'Elena', apellido: 'Castro' }, { id: 'p3', nombre: 'Sofía', apellido: 'Mendoza' }],
    sessions: [
      { id: 's1', branch_id: 'b1', opened_by: 'u1', opened_at: at(0, 8, 2), status: 'open', opening_cash: 500, revision: 1 },
      { id: 's2', branch_id: 'b1', opened_by: 'u2', opened_at: at(0, 9), status: 'open', opening_cash: 300, revision: 1 },
      { id: 'k1', branch_id: 'b1', opened_by: 'u1', closed_by: 'u1', opened_at: at(1, 8), closed_at: at(1, 18), status: 'closed', opening_cash: 500, expected_cash: 500, counted_cash: 480, variance: -20, close_notes: audit([500, 480], '. Motivo: Error de captura. Notas: Se dio cambio de más. Se avisó.') },
      { id: 'k2', branch_id: 'b1', opened_by: 'u2', closed_by: 'u1', opened_at: at(2, 8), closed_at: at(2, 18), status: 'closed', opening_cash: 300, expected_cash: 2450, counted_cash: 2450, variance: 0, close_notes: 'Todo en orden, sin novedades.' },
    ],
    charges: [
      { id: 'c1', patient_id: 'p1', status: 'open', total_amount: 800, service_id: 's1', concept: 'Limpieza dental', created_at: at(0, 9) },
      { id: 'c2', patient_id: 'p2', status: 'open', total_amount: 1200, concept: 'Resina', created_at: at(3) },
      { id: 'c3', patient_id: 'p3', status: 'open', total_amount: 1600, concept: 'Resina (3 piezas)', created_at: at(8) }],
    payments: [
      { id: 'y1', patient_id: 'p1', amount: 800, method: 'cash', cash_session_id: 's1', paid_at: at(0, 10, 30), branch_id: 'b1', created_by: 'u1' },
      { id: 'y2', patient_id: 'p2', amount: 500.5, method: 'cash', cash_session_id: 's1', paid_at: at(0, 11), branch_id: 'b1', created_by: 'u1' },
      { id: 'y3', patient_id: 'p2', amount: 999, method: 'card', cash_session_id: null, paid_at: at(0, 12), branch_id: 'b1', created_by: 'u1' },
      { id: 'y4', patient_id: 'p1', amount: 400, method: 'cash', cash_session_id: 's2', paid_at: at(0, 12), branch_id: 'b1', created_by: 'u2' },
      { id: 'y5', patient_id: 'p3', amount: 1600, method: 'card', paid_at: at(8), branch_id: 'b1', created_by: 'u1' }],
    allocations: [{ id: 'a1', payment_id: 'y1', charge_id: 'c1', amount: 800 }, { id: 'a2', payment_id: 'y2', charge_id: 'c2', amount: 500.5 }, { id: 'a5', payment_id: 'y5', charge_id: 'c3', amount: 1600 }],
    refunds: [{ id: 'r1', payment_id: 'y2', amount: 50, reason: 'Descuento aplicado después', refunded_at: at(0, 13), created_by: 'u1' }, { id: 'r2', payment_id: 'y3', amount: 99, reason: 'Tarjeta', refunded_at: at(0, 13), created_by: 'u1' }],
    refundAllocations: [{ id: 'ra1', refund_id: 'r1', charge_id: 'c2', amount: 50 }],
    adjustments: [
      { id: 'j1', cash_session_id: 's1', direction: 'out', amount: 120, reason: 'Compra de <guantes>', created_at: at(0, 12, 30), created_by: 'u1' },
      { id: 'j2', cash_session_id: 's1', direction: 'in', amount: 200.2, reason: 'Cambio para dar feria', created_at: at(0, 9), created_by: 'u2' },
      { id: 'j3', cash_session_id: 's2', direction: 'out', amount: 9, reason: 'Otra caja', created_at: at(0, 10), created_by: 'u2' }],
    receipts: [{ id: 'k-y1', payment_id: 'y1', folio: 105, issued_at: at(0, 10, 30) }, { id: 'k-y2', payment_id: 'y2', folio: 106, issued_at: at(0, 11) }, { id: 'k-y3', payment_id: 'y3', folio: 107, issued_at: at(0, 12) }, { id: 'k-y5', payment_id: 'y5', folio: 101, issued_at: at(8) }],
    fiscal: [{ patient_id: 'p3', legal_name: 'SOFIA MENDOZA', rfc: 'XAXX010101000' }],
    issuer: { fiscal_status: 'reviewed' }, drafts: [], cancellations: [], facturapi: { status: 'connected', environment: 'test' },
  };
}

test('el desglose de Caja cuadra y dice cuántos movimientos forman cada renglón', () => {
  const state = clinic(), f = build(state), flow = f.cashFlow(state.sessions[0]);
  // Solo cuenta el efectivo de ESTA caja: ni el pago con tarjeta, ni su reembolso, ni lo de la caja de otra persona.
  assert.deepEqual(flow, { opening: 50000, collected: 130050, refunded: 5000, added: 20020, removed: 12000, payments: 2, refunds: 1, ins: 1, outs: 1, expected: 183070 });
  assert.equal(flow.opening + flow.collected - flow.refunded + flow.added - flow.removed, flow.expected);
  const ledger = text(f.cashLedger(flow));
  assert.equal(ledger, 'Fondo inicial $500.00 Cobros en efectivo · 2 + $1,300.50 Reembolsos en efectivo · 1 − $50.00 Entradas · 1 + $200.20 Salidas · 1 − $120.00');
  // Sin movimientos no hay signos ni conteos, y los reembolsos no ocupan renglón.
  assert.equal(text(f.cashLedger(f.cashFlow({ id: 'vacía', opening_cash: 0 }))), 'Fondo inicial $0.00 Cobros en efectivo $0.00 Entradas $0.00 Salidas $0.00');
});

test('los movimientos del turno suman lo mismo que el desglose y van del más reciente al más antiguo', () => {
  const state = clinic(), f = build(state), moves = f.cashMoves(state.sessions[0]);
  assert.deepEqual(moves.map((m) => m.kind), ['refund', 'out', 'payment', 'payment', 'in', 'open']);
  assert.equal(moves.reduce((sum, m) => sum + m.cents, 0), f.cashFlow(state.sessions[0]).expected, 'la lista explica el efectivo que debe haber');
  assert.deepEqual(moves.map((m) => m.title), ['Reembolso · Elena Castro', 'Salida · Compra de <guantes>', 'Cobro · Elena Castro', 'Cobro · Carlos Aguilar', 'Entrada · Cambio para dar feria', 'Apertura']);
  assert.deepEqual(moves.map((m) => m.note), ['Descuento aplicado después', 'La registró Ana Torres', 'Recibo 000106', 'Recibo 000105', 'La registró Luis Pérez', 'Fondo inicial']);
  // Un cobro abre su recibo; lo que escribió una persona se muestra como texto, nunca como HTML.
  const pay = f.moveLine(moves[3]), out = f.moveLine(moves[1]);
  assert.match(pay, /<button type="button" class="finance-line-who" data-open-receipt="k-y1" title="Abrir el recibo">/);
  assert.match(pay, /<strong>\+ \$800\.00<\/strong>/);
  assert.match(out, /Salida · Compra de &lt;guantes&gt;/); assert.match(out, /<strong data-tone="neg">− \$120\.00<\/strong>/);
  assert.doesNotMatch(out, /<button/);
  assert.match(f.moveLine(moves[5]), /<strong>\$500\.00<\/strong>/, 'la apertura no lleva signo');
});

test('mi turno: quién, desde cuándo, los dos botones una sola vez, el desglose y cada movimiento', () => {
  const state = clinic(), f = build(state), html = f.turnBlock(state.sessions[0], true), plain = text(html);
  assert.match(plain, /^Abierta Mi caja · Principal La abriste hoy a las 8:02 a\.m\. Entrada o salida Hacer corte Fondo inicial/);
  assert.match(plain, /Efectivo que debe haber \$1,830\.70 Movimientos del turno 6 movimientos/);
  assert.equal((html.match(/>Entrada o salida</g) || []).length, 1); assert.equal((html.match(/>Hacer corte</g) || []).length, 1);
  assert.match(html, /<button type="button" class="btn btn-secondary" id="finance-adjust" data-adjust="s1">Entrada o salida<\/button><button type="button" class="btn btn-secondary" id="finance-close-cash" data-close-cash="s1">Hacer corte<\/button>/);
  assert.doesNotMatch(html, /btn-primary/, 'el único botón oscuro de la pantalla es «Cobrar»');
  // Una segunda caja mía (otra sucursal) se dibuja igual, sin repetir los ids.
  assert.doesNotMatch(f.turnBlock(state.sessions[0], false), / id="/);
  // Sin permiso de caja se ve el turno, sin botones. Con más de 18 horas abierta, lo avisa.
  state.canCash = false; assert.doesNotMatch(f.turnBlock(state.sessions[0], true), /<button type="button" class="btn/);
  state.sessions[0].opened_at = at(1, 8); assert.match(f.turnBlock(state.sessions[0], true), /class="finance-session-warn" role="status">Lleva más de 18 horas abierta\. Haz el corte para cerrar el turno\./);
  // Solo se dibujan los primeros movimientos; el resto se pide.
  state.shown.moves = 2; const few = f.turnBlock(state.sessions[0], true);
  assert.equal((few.match(/data-cols="moves"/g) || []).length, 2); assert.match(few, /Mostrando 2 de 6<\/span><button type="button" class="btn btn-secondary" data-more-moves>Ver todos<\/button>/);
});

test('horas en español: «a la 1:05», «a las 8:02», hoy, ayer y fechas', () => {
  const f = build(clinic());
  assert.equal(f.atClock(at(0, 13, 5)), 'a la 1:05 p.m.'); assert.equal(f.atClock(at(0, 1, 5)), 'a la 1:05 a.m.'); assert.equal(f.atClock(at(0, 8, 2)), 'a las 8:02 a.m.');
  assert.equal(f.openedLabel(at(0, 8, 2)), 'hoy a las 8:02 a.m.'); assert.equal(f.openedLabel(at(1, 18, 10)), 'ayer a las 6:10 p.m.');
  assert.match(f.openedLabel(at(9, 8, 2)), /^el \d{1,2} [a-zñ]{3,4}\.?( \d{4})? a las 8:02 a\.m\.$/);
  assert.equal(f.dayLabel(at(0)), 'Hoy'); assert.equal(f.dayLabel(at(1)), 'Ayer'); assert.match(f.dayLabel(at(9)), /^\d{1,2} [a-zñ]{3,4}/); assert.equal(f.dayLabel(''), '—');
  assert.match(src, /return d\.toDateString\(\)===new Date\(\)\.toDateString\(\)\?\(d\.getHours\(\)%12===1\?'la ':'las '\)\+time:/, 'la pestaña también dice «desde la 1:05»');
});

test('un corte anterior se lee de sus notas: conciliación, motivo y notas; un texto libre se muestra tal cual', () => {
  const f = build(clinic()), parsed = f.cutNotes(audit([2180, 2010], '. Motivo: Error de captura. Notas: Se dio cambio de más. Se avisó.'));
  assert.equal(parsed.kind, 'Cierre de turno'); assert.equal(parsed.reason, 'Error de captura'); assert.equal(parsed.notes, 'Se dio cambio de más. Se avisó.'); assert.equal(parsed.raw, '');
  assert.deepEqual(parsed.methods.map((m) => m.label), ['Efectivo', 'Tarjetas', 'Transferencias', 'Cheques', 'Otros']);
  assert.deepEqual(parsed.methods[0], { label: 'Efectivo', expected: '$2,180.00', declared: '$2,010.00', variance: '-$170.00' });
  assert.deepEqual(f.cutNotes(audit([500, 500]).replace('Cierre de turno', 'Cierre del día')), { kind: 'Cierre del día', methods: parsed.methods.map((m, i) => i ? m : { label: 'Efectivo', expected: '$500.00', declared: '$500.00', variance: '$0.00' }), reason: '', notes: '', raw: '' });
  // Solo motivo, solo notas, y notas que traen la palabra «Motivo».
  assert.deepEqual([f.cutNotes(audit([1, 1], '. Motivo: Otro')).reason, f.cutNotes(audit([1, 1], '. Motivo: Otro')).notes], ['Otro', '']);
  assert.deepEqual([f.cutNotes(audit([1, 1], '. Notas: Sin novedad. Motivo: ninguno')).reason, f.cutNotes(audit([1, 1], '. Notas: Sin novedad. Motivo: ninguno')).notes], ['', 'Sin novedad. Motivo: ninguno']);
  // Cortes antiguos o texto libre: sin conciliación reconocible, se conserva completo.
  for (const free of ['Todo en orden, sin novedades.', 'Cierre de turno. Conciliación: texto que no sigue el formato', '']) assert.deepEqual(f.cutNotes(free), { kind: '', methods: [], reason: '', notes: '', raw: free });
  assert.deepEqual(f.cutNotes(null).raw, '');
  // El corte sigue escribiendo sus notas con ese formato (es lo que «Cortes anteriores» sabe leer).
  assert.match(src, /var audit='Cierre '\+\(f\.elements\.closeType\.value==='day'\?'del día':'de turno'\)\+'\. Conciliación: '\+methods\.map\(function\(method\)\{return labels\[method\]\+' esperado '\+money\(expected\[method\]\)\+', reportado '\+money\(snap\.declared\[method\]\)\+', diferencia '\+money\(snap\.variances\[method\]\);\}\)\.join\('; '\)\+\(snap\.hasVariance&&reason\.value\?'\. Motivo: '\+reason\.options\[reason\.selectedIndex\]\.text:''\)\+\(notes\?'\. Notas: '\+notes:''\);/);
});

test('cortes anteriores: cuánto debía haber, cuánto se contó y la diferencia, con su detalle', () => {
  const state = clinic(), f = build(state), short = f.cutRow(state.sessions[2]), plain = text(short);
  assert.equal(text(f.cutTag(0)), 'Sin diferencia'); assert.equal(text(f.cutTag(-2000)), 'Faltaron $20.00'); assert.equal(text(f.cutTag(5050)), 'Sobraron $50.50');
  assert.match(f.cutTag(0), /data-tone="ok"/); assert.match(f.cutTag(-1), /data-tone="danger"/); assert.match(f.cutTag(1), /data-tone="warn"/);
  assert.match(short, /^<details class="finance-fold" data-cut="k1"><summary><b>Ayer · Ana Torres<\/b><span class="finance-tag" data-tone="danger">Faltaron \$20\.00<\/span><small>Debía haber \$500\.00 · Se contó \$480\.00<\/small><\/summary>/);
  assert.match(plain, /Cierre de turno 8:00 a\.m\. a 6:00 p\.m\. Fondo inicial \$500\.00 Cobros en efectivo \$0\.00 Entradas \$0\.00 Salidas \$0\.00 Debía haber \$500\.00 Se contó \$480\.00 Diferencia −\$20\.00/);
  assert.match(plain, /Otras formas de pago\. Tarjetas: debía haber \$1,200\.00 y se reportó \$1,150\.00 \(faltaron \$50\.00\) Motivo\. Error de captura Notas\. Se dio cambio de más\. Se avisó\./);
  // Quien cerró, si no fue quien la abrió. Con notas libres, se muestran tal cual. Si los movimientos cargados no explican el total, no se inventa un desglose.
  const other = f.cutRow(state.sessions[3]), otherPlain = text(other);
  assert.match(other, /<b>[^<]+ · Luis Pérez<\/b><span class="finance-tag" data-tone="ok">Sin diferencia<\/span>/);
  assert.match(otherPlain, /Turno 8:00 a\.m\. a 6:00 p\.m\. · lo cerró Ana Torres Fondo inicial \$300\.00 Debía haber \$2,450\.00 Se contó \$2,450\.00 Diferencia \$0\.00 Notas\. Todo en orden, sin novedades\./);
  assert.doesNotMatch(otherPlain, /Cobros en efectivo/);
  // El efectivo cuadró pero las tarjetas no: la fila lo avisa en lugar de decir «Sin diferencia».
  const cards = f.cutRow({ ...state.sessions[3], id: 'k3', close_notes: audit([2450, 2450]) });
  assert.match(cards, /<span class="finance-tag" data-tone="warn">Diferencia en tarjetas<\/span>/);
  // Sobrante con signo; con más de una sucursal, la fila dice cuál.
  assert.match(text(f.cutRow({ ...state.sessions[3], id: 'k4', counted_cash: 2500.5, variance: 50.5, close_notes: '' })), /Sobraron \$50\.50 .* Diferencia \+\$50\.50$/);
  state.branches.push({ id: 'b2', name: 'Norte' }); assert.match(f.cutRow(state.sessions[2]), /<small>Principal · Debía haber/);
});

test('la caja de otra persona se ve con su desglose; solo quien supervisa puede hacerle el corte', () => {
  const state = clinic(), f = build(state), row = f.teamRow(state.sessions[1]);
  assert.match(row, /^<details class="finance-fold" data-open-session="s2"><summary><b>Luis Pérez<\/b><strong class="finance-fold-amount">\$691\.00<\/strong><small>Principal · abierta hoy a las 9:00 a\.m\.<\/small><\/summary>/);
  assert.match(text(row), /Cobros en efectivo · 1 \+ \$400\.00 Entradas \$0\.00 Salidas · 1 − \$9\.00 Efectivo que debe haber \$691\.00 Hacer corte$/);
  assert.match(row, /<button type="button" class="btn btn-secondary" data-supervise-cash="s2">Hacer corte<\/button>/);
  state.canSuperviseCash = false; assert.doesNotMatch(f.teamRow(state.sessions[1]), /data-supervise-cash/);
  // Cada quien ve sus cortes; quien supervisa ve los de todos. La pestaña suma todas mis cajas abiertas.
  assert.match(src, /cuts=state\.sessions\.filter\(function\(s\)\{return s\.status==='closed'&&\(state\.canSuperviseCash\|\|s\.opened_by===state\.actor\|\|s\.closed_by===state\.actor\);\}\)/);
  assert.match(src, /cashCents:mine\.reduce\(function\(sum,x\)\{return sum\+cashFlow\(x\)\.expected;\},0\)/);
  assert.match(src, /f\.sessions>1\?f\.sessions\+' cajas abiertas'/);
});

test('cada factura dice su estado en palabras llanas, con un solo botón y lo demás en «•••»', () => {
  const state = clinic(), f = build(state);
  const draft = (more) => ({ id: 'd1', patient_id: 'p3', payment_id: 'y5', status: 'draft', sandbox_status: 'pending', fiscal_snapshot: { amount: 1600, rfc: 'XAXX010101000' }, ...more });
  const row = (more) => f.invoiceLine(draft(more)), main = (html) => (html.match(/<button type="button" class="btn btn-secondary"[^>]*>([^<]+)<\/button>/g) || []).map(text), menu = (html) => ((html.match(/<details class="finance-row-menu">[\s\S]*?<\/details>/) || [''])[0].match(/<button[^>]*>([^<]+)<\/button>/g) || []).map(text);
  assert.deepEqual(f.INVOICE_FILTERS.map((x) => x[1]), ['Borradores', 'Emitidas', 'Canceladas', 'Por facturar']);
  assert.deepEqual(['draft', 'rejected', 'submitted', 'issued', 'cancelled'].map((status) => f.invoiceBucket({ status })), ['drafts', 'drafts', 'drafts', 'issued', 'cancelled']);
  // Borrador sin validar → Validar. El nombre abre la cuenta; debajo, el recibo y el RFC.
  let html = row();
  assert.match(html, /<article class="finance-line" data-cols="invoices" data-draft-id="d1" data-invoice-state="drafts" role="listitem"><button type="button" class="finance-line-who" data-account="p3" title="Abrir la cuenta"><strong class="finance-line-name">Sofía Mendoza<\/strong><small>Recibo 000101 · XAXX010101000<\/small><\/button>/);
  assert.match(html, /<span class="finance-tag">Borrador sin validar<\/span>/); assert.match(html, /<strong>\$1,600\.00<\/strong>/);
  assert.deepEqual(main(html), ['Validar']); assert.deepEqual(menu(html), ['Ver recibo', 'Datos fiscales del paciente']);
  // Validado y con Facturapi conectado → Timbrar (validar de nuevo queda en el menú). Sin conexión, lo explica.
  html = row({ sandbox_status: 'passed' });
  assert.match(html, /<span class="finance-tag" data-tone="ok">Borrador validado<\/span>/); assert.deepEqual(main(html), ['Timbrar']); assert.deepEqual(menu(html), ['Validar de nuevo', 'Ver recibo', 'Datos fiscales del paciente']);
  state.facturapi = { status: 'disconnected', environment: 'test' }; html = row({ sandbox_status: 'passed' });
  assert.deepEqual(main(html), ['Validar de nuevo']); assert.match(html, /<small>Para timbrar, conecta Facturapi en la configuración\.<\/small>/);
  state.facturapi = { status: 'connected', environment: 'test' };
  // Con observaciones: se leen aquí mismo (antes solo se decía cuántas eran), como texto.
  html = row({ sandbox_status: 'blocked', sandbox_report: { errors: [{ field: 'rfc', message: 'RFC del receptor con formato <inválido>.' }, { message: 'Uso CFDI inválido.' }, { message: 'Faltan conceptos.' }, { message: 'Otra.' }] } });
  assert.match(html, /<span class="finance-tag" data-tone="warn">Con observaciones<\/span><small>RFC del receptor con formato &lt;inválido&gt;\.<\/small><small>Uso CFDI inválido\.<\/small><small>Faltan conceptos\.<\/small><small>y 1 más<\/small>/);
  assert.deepEqual(main(html), ['Validar de nuevo']);
  assert.deepEqual(main(row({ status: 'submitted', provider: 'facturapi' })), ['Verificar estado']); assert.match(row({ status: 'rejected' }), /data-tone="danger">Rechazada</);
  // Emitida: mientras la clínica no timbre en producción, es de prueba. Enviar/Reenviar al frente; descargas y cancelación en el menú.
  const issued = { status: 'issued', sandbox_status: 'passed', external_uuid: '6F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D', stamped_at: at(3), invoice_series: 'A', invoice_folio: 12 };
  html = row(issued);
  assert.match(html, /data-invoice-state="issued"/); assert.match(html, /<span class="finance-tag" data-tone="ok">Emitida de prueba<\/span><small>Folio fiscal 6F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D<\/small>/); assert.match(html, /<small>Recibo 000101 · Factura A-12 · XAXX010101000<\/small>/);
  assert.deepEqual(main(html), ['Enviar']); assert.deepEqual(menu(html), ['Descargar PDF', 'Descargar XML', 'Planear cancelación', 'Ver recibo', 'Datos fiscales del paciente']);
  html = row({ ...issued, last_emailed_at: at(2, 13, 40), last_emailed_to: 'sofia@correo.mx' });
  assert.deepEqual(main(html), ['Reenviar']); assert.match(html, /<small>Enviada a sofia@correo\.mx · [^<]+<\/small>/);
  // Cancelación planeada → «Enviar cancelación» (en rojo) en el menú; ya enviada → «Verificar» al frente.
  state.cancellations = [{ id: 'cp1', draft_id: 'd1', status: 'planned', reason_code: '02', created_at: at(1) }]; html = row(issued);
  assert.deepEqual(menu(html), ['Descargar PDF', 'Descargar XML', 'Enviar cancelación', 'Ver recibo', 'Datos fiscales del paciente']);
  assert.match(html, /<button type="button" class="finance-menu-danger" data-cancel-cfdi="d1">Enviar cancelación<\/button>/); assert.match(html, /<small>Cancelación planeada; aún no se envía \(motivo 02\)<\/small>/);
  state.cancellations[0].status = 'submitted'; html = row(issued);
  assert.deepEqual(main(html), ['Verificar']); assert.deepEqual(menu(html), ['Enviar por correo', 'Descargar PDF', 'Descargar XML', 'Ver recibo', 'Datos fiscales del paciente']);
  state.cancellations = [{ id: 'cp2', draft_id: 'd1', status: 'rejected', provider_message: 'El receptor la rechazó', created_at: at(1) }];
  assert.match(row(issued), /<small>Cancelación rechazada: El receptor la rechazó<\/small>/);
  state.cancellations = [];
  // Cancelada: el acuse al frente; lo demás, en el menú.
  html = row({ ...issued, status: 'cancelled' });
  assert.match(html, /<span class="finance-tag">Cancelada de prueba<\/span>/); assert.deepEqual(main(html), ['Acuse PDF']); assert.deepEqual(menu(html), ['Acuse XML', 'Factura PDF', 'Factura XML', 'Ver recibo', 'Datos fiscales del paciente']);
  assert.match(html, /<button type="button" class="btn btn-secondary" data-download-cfdi="d1" data-kind="acuse_pdf">Acuse PDF<\/button>/);
  // Sin permiso para facturar: se consulta, no se opera.
  state.canInvoice = false; html = row(issued); assert.deepEqual(main(html), []); assert.deepEqual(menu(html), ['Ver recibo', 'Datos fiscales del paciente']);
});

test('una factura es real solo si la clínica está en producción y se emitió después de activarla', () => {
  const state = clinic(), f = build(state), d = { stamped_at: at(1) };
  assert.equal(f.invoiceIsReal(d), false, 'en pruebas, todo es de prueba');
  // En producción el servidor timbra con la llave real o no timbra: la etiqueta no depende de un interruptor que puede cambiar después.
  state.facturapi = { status: 'connected', environment: 'live', live_stamping: false, live_enabled_at: at(5) }; assert.equal(f.invoiceIsReal(d), true, 'emitida en producción, aunque hoy el timbrado esté en pausa');
  state.facturapi.live_stamping = true; assert.equal(f.invoiceIsReal(d), true);
  state.facturapi.live_enabled_at = null; assert.equal(f.invoiceIsReal(d), false, 'sin fecha de activación no se afirma que sea real'); state.facturapi.live_enabled_at = at(5);
  assert.equal(f.invoiceIsReal({ stamped_at: at(9) }), false, 'se emitió antes de activar producción');
  assert.equal(f.invoiceIsReal({}), false); state.facturapi = null; assert.equal(f.invoiceIsReal(d), false);
  state.facturapi = { status: 'connected', environment: 'live', live_stamping: true, live_enabled_at: at(5) };
  assert.match(f.invoiceLine({ id: 'd9', patient_id: 'p3', payment_id: 'y5', status: 'issued', stamped_at: at(1), fiscal_snapshot: { amount: 10 } }), /<span class="finance-tag" data-tone="ok">Emitida<\/span>/);
});

test('«Por facturar»: solo los pagos que liquidan sus cargos completos y todavía no tienen factura', () => {
  const state = clinic(), f = build(state), item = (id) => f.fiscalReceiptItem(state.receipts.find((r) => r.id === id));
  // Pago completo de un cargo con datos fiscales: lista para facturar. Sin datos fiscales: se piden al facturar.
  assert.equal(item('k-y5').code, 'ready'); assert.equal(item('k-y1').code, 'profile');
  // Abono, pago con reembolso y pago sin aplicar no se facturan por separado: no entran a la lista.
  assert.equal(item('k-y2').code, 'review'); assert.equal(item('k-y3').code, 'review');
  assert.match(src, /var unbilled=state\.receipts\.filter\(function\(r\)\{return !byKey\(state\.drafts,'payment_id',r\.payment_id\);\}\)\.map\(fiscalReceiptItem\)\.filter\(function\(x\)\{return x\.payment&&x\.code!=='review';\}\);counts\.pending=unbilled\.length;/);
  const ready = f.pendingLine(item('k-y5')), missing = f.pendingLine(item('k-y1'));
  assert.match(ready, /<article class="finance-line" data-cols="invoices" data-invoice-state="pending" data-invoice-code="ready" role="listitem"><button type="button" class="finance-line-who" data-account="p3" title="Abrir la cuenta"><strong class="finance-line-name">Sofía Mendoza<\/strong><small>Recibo 000101 · [^<]+ · Resina \(3 piezas\)<\/small><\/button>/);
  assert.match(ready, /<div class="finance-line-state"><small>Datos fiscales completos<\/small><\/div><div class="finance-line-amount"><strong>\$1,600\.00<\/strong><\/div>/);
  assert.match(ready, /<button type="button" class="finance-link-action" data-open-receipt="k-y5" aria-label="Recibo 000101 de Sofía Mendoza">Recibo<\/button><button type="button" class="btn btn-secondary" data-invoice-payment="y5">Facturar<\/button>/);
  assert.match(missing, /<span class="finance-tag">Faltan datos fiscales<\/span><small>Se piden al facturar\.<\/small>/);
  state.issuer = { fiscal_status: 'draft' }; assert.match(f.pendingLine(item('k-y5')), /<span class="finance-tag" data-tone="warn">Falta configurar<\/span><small>Revisa primero los datos fiscales de la clínica\.<\/small>/);
  state.canInvoice = false; assert.doesNotMatch(f.pendingLine(item('k-y5')), /data-invoice-payment/);
  // «Facturar» sigue el mismo camino que el recibo; al preparar el borrador la pantalla queda en «Borradores».
  assert.match(src, /host\.querySelectorAll\('\[data-invoice-payment\]'\)\.forEach\(function\(b\)\{b\.onclick=function\(\)\{startInvoice\(by\(state\.payments,b\.dataset\.invoicePayment\)\);\};\}\);/);
  assert.match(src, /state\.tab='fiscal';state\.fiscalFilter='drafts';await reload\('Borrador fiscal preparado/);
  assert.match(src, /if\(fiscal\)fiscal\.onclick=function\(\)\{close\(\);state\.tab='fiscal';state\.fiscalFilter=invoiceBucket\(item\.draft\);render\(\);/);
});

test('el estado de la configuración fiscal cabe en una línea, con las palabras de la pestaña y un solo botón', () => {
  const state = clinic(), strip = (steps) => build(state, steps).fiscalStatusStrip(), all = [{ done: true }, { done: true }, { done: true }, { done: true }];
  let html = strip();
  assert.equal(text(html), 'Falta configurar 1 de 4 pasos listos Mientras esté en pruebas, las facturas no tienen validez fiscal. Terminar configuración');
  assert.match(html, /^<div class="finance-setup-strip" data-ready="false"><div><strong><span class="finance-tag" data-tone="warn">Falta configurar<\/span>/);
  assert.match(html, /<span class="finance-setup-steps" role="img" aria-label="1 de 4 pasos de configuración listos"><i class="on"><\/i><i><\/i><i><\/i><i><\/i><\/span>/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  html = strip(all);
  assert.equal(text(html), 'En pruebas Configuración completa Las facturas de prueba no tienen validez fiscal. Activa producción en la configuración. Ver configuración'); assert.doesNotMatch(html, /finance-setup-steps/);
  state.facturapi = { environment: 'live', live_stamping: false }; assert.match(text(strip(all)), /^Producción pendiente Falta habilitar el timbrado real /);
  state.facturapi = { environment: 'live', live_stamping: true }; assert.match(text(strip(all)), /^En producción Las facturas que emitas son reales Se timbran y llegan al SAT\. Ver configuración$/);
  assert.match(src, /id="finance-open-billing-setup">'\+\(ready\?'Ver configuración':'Terminar configuración'\)/);
});

test('Caja y Facturación: una tarjeta, sin encabezado repetido y cada cosa una sola vez', () => {
  assert.match(src, /<section data-finance-panel="cash" id="finance-panel-cash" role="tabpanel" aria-labelledby="finance-tab-cash" hidden><article class="finance-card finance-list-card finance-cash-card"><div id="finance-cash"><\/div><\/article><\/section>/);
  assert.match(src, /<section data-finance-panel="fiscal" id="finance-panel-fiscal" role="tabpanel" aria-labelledby="finance-tab-fiscal" hidden><article class="finance-card finance-list-card finance-fiscal-card"><div id="finance-fiscal"><\/div><\/article><\/section>/);
  const cash = src.slice(src.indexOf('  function renderCash(){'), src.indexOf('  function fiscalReceiptItem('));
  assert.match(cash, /<div class="finance-cash-grid"><div class="finance-cash-main">'\+main\+'<\/div><aside class="finance-cash-side" aria-label="Otras cajas y cortes anteriores">'\+team\+history\+'<\/aside><\/div>/);
  for (const copy of ['No tienes caja abierta', 'Ábrela para recibir efectivo. Quedas como responsable hasta el corte.', 'Tu rol puede consultar la caja, pero no abrirla ni operarla.', '>Abrir mi caja</button>', '<h2>Cajas abiertas del equipo</h2>', '<h2>Cortes anteriores</h2>', 'data-more-cuts>Ver todos los cortes</button>', 'Los pagos con tarjeta o transferencia no entran a la caja: se revisan al hacer el corte.']) assert.ok(cash.includes(copy), copy);
  assert.doesNotMatch(src, /Mi caja abierta|CONTROL POR RESPONSABLE|Revisar corte|¿Cómo funciona la caja\?|finance-cash-help|finance-team-cash|class="finance-session"/);
  const fiscal = src.slice(src.indexOf('  function renderFiscal(){'), src.indexOf('  // ── Configuración de facturación'));
  assert.match(fiscal, /host\.innerHTML=fiscalStatusStrip\(\)\+'<div class="finance-list-tools"><div class="finance-chips" role="group" aria-label="Estado de las facturas">'\+INVOICE_FILTERS\.map\(/);
  assert.match(fiscal, /<div class="finance-cols" data-cols="invoices" aria-hidden="true"><span>Paciente<\/span><span>Estado<\/span><span>Importe<\/span><span><\/span><\/div>/);
  assert.match(fiscal, /Una factura siempre nace de un recibo\. Los datos fiscales del paciente se editan en su ficha\./);
  assert.match(fiscal, /moreRows\(total,rows\.length,'invoices'\)/); assert.match(fiscal, /bindMoreRows\(host,'invoices',renderFiscal\);/);
  assert.doesNotMatch(src, /Proceso fiscal independiente|Borradores y ciclo fiscal|finance-fiscal-receivers|finance-draft-actions|finance-drafts|Timbrado en sandbox · |Cancelado en sandbox/);
  // El proceso fiscal no cambia: las mismas acciones, conectadas igual.
  for (const hook of ['data-validate-cfdi', 'data-stamp-cfdi', 'data-reconcile-cfdi', 'data-email-cfdi', 'data-download-cfdi', 'data-cancel-cfdi', 'data-cancelcheck-cfdi', 'data-plan-cancel', 'data-fiscal-patient']) assert.match(fiscal, new RegExp("host\\.querySelectorAll\\('\\[" + hook + "\\]'\\)"), hook);
});

test('ventanas de Caja: el corte en una tabla que cabe, «Entrada o salida» con su nombre y «Cancelar» que cierra', () => {
  const cut = src.slice(src.indexOf('  function openCloseCash(s){'), src.indexOf('  // Alta/edición de datos fiscales del paciente'));
  assert.match(cut, /<form class="finance-cut-form" novalidate><h2>Corte de caja<\/h2>/);
  assert.match(cut, /<div class="finance-cut-row finance-cut-head" role="row"><span role="columnheader">Forma de pago<\/span><span role="columnheader">Debe haber<\/span><span role="columnheader">Se contó<\/span><span role="columnheader">Diferencia<\/span><\/div>/);
  assert.match(cut, /<div class="finance-cut-row finance-cut-total" role="row"><strong role="cell">Total<\/strong><b role="cell" data-label="Debe haber">'\+money\(expectedTotal\)\+'<\/b><b role="cell" data-label="Se contó" data-close-declared>—<\/b><output role="cell" data-label="Diferencia" data-close-total>—<\/output><\/div>/);
  assert.match(cut, /<div class="finance-actions"><button type="button" data-close>Cancelar<\/button><button class="btn btn-primary" type="submit">Hacer corte<\/button><\/div><\/form>/);
  assert.doesNotMatch(cut, /CONCILIACIÓN|DIFERENCIA DETECTADA|finance-close-form|Sistema espera|Personal reporta/);
  // Una casilla vacía todavía no es una diferencia; las diferencias llevan el signo «−», no un guion.
  assert.match(cut, /blank=!Number\.isFinite\(value\)/); assert.match(cut, /if\(!blank\)\{varianceTotal\+=variances\[method\];if\(Math\.abs\(variances\[method\]\)>=\.01\)hasVariance=true;\}/);
  assert.match(cut, /function diff\(v\)\{return Math\.abs\(v\)<\.01\?money\(0\):\(v>0\?'\+':'−'\)\+money\(Math\.abs\(v\)\);\}/);
  assert.match(cut, /'Las diferencias se compensan entre sí':\(varianceTotal>0\?'Sobran ':'Faltan '\)\+money\(Math\.abs\(varianceTotal\)\)/);
  assert.match(cut, /await reload\('Corte guardado\. '\+\(!snap\.hasVariance\?'Sin diferencia\.':Math\.abs\(snap\.varianceTotal\)<\.01\?'Las diferencias se compensan entre sí\.':\(snap\.varianceTotal>0\?'Sobraron ':'Faltaron '\)\+money\(Math\.abs\(snap\.varianceTotal\)\)\+'\.'\)\);/);
  // Con una casilla vacía el navegador señala cuál falta (antes el botón no hacía nada); el motivo solo se guarda si hay diferencia.
  assert.match(cut, /var snap=snapshot\(\);if\(!f\.reportValidity\(\)\|\|!snap\.complete\)return;/); assert.match(cut, /\+\(snap\.hasVariance&&reason\.value\?'\. Motivo: '/);
  // Lo que se guarda no cambia.
  assert.match(cut, /rpc\('smyl_close_cash_session',\{p_session_id:s\.id,p_expected_revision:s\.revision,p_counted_cash:snap\.declared\.cash,p_notes:audit\.slice\(0,1000\)\}\)/);
  assert.match(src, /<form><h2>Entrada o salida<\/h2><p>Dinero que entra o sale de la caja sin ser un cobro\. Caja de '\+esc\(actorName\(s\.opened_by\)\)\+'\.<\/p>/);
  assert.match(src, /form\.querySelector\('\[data-adjust-submit\]'\)\.textContent=form\.elements\.direction\.value==='in'\?'Registrar entrada':'Registrar salida';/);
  assert.match(src, /rpc\('smyl_post_cash_adjustment',\{p_id:crypto\.randomUUID\(\),p_idempotency_key:crypto\.randomUUID\(\),p_cash_session_id:s\.id,p_direction:f\.get\('direction'\),p_amount:Number\(f\.get\('amount'\)\),p_reason:f\.get\('reason'\)\}\)/);
  assert.match(src, /<form><h2>Abrir mi caja<\/h2><p>Quedas como responsable de esta caja hasta hacer el corte\.<\/p>/);
  assert.doesNotMatch(src, /Movimiento de caja<\/h2>|Confirmar movimiento|Abrir sesión<\/button>/);
  // dialog() conectaba solo el PRIMER botón con data-close: en el corte y en el cobro ese era la «×», y «Cancelar» no hacía nada.
  assert.match(src, /d\.querySelectorAll\('\[data-close\]'\)\.forEach\(function\(c\)\{c\.onclick=function\(\)\{d\.close\(\);\};\}\);return d;\}/);
  assert.doesNotMatch(src, /var c=d\.querySelector\('\[data-close\]'\)/);
});

test('el cobro numera sus tres pasos: paciente, importe y forma de pago', () => {
  const pay = src.slice(src.indexOf('  function openPayment('), src.indexOf('  // Cuenta del paciente: estado y último pago arriba'));
  const steps = [...pay.matchAll(/<div class="finance-payment-section-head"><span>(\d)<\/span><div><strong>([^<]+)<\/strong>/g)].map((m) => m[1] + ' ' + m[2]);
  assert.deepEqual(steps, ['1 ¿A quién le cobras?', '2 ¿Cuánto recibió la clínica?', '3 Forma de pago']);
  assert.match(pay, /<label class="finance-payment-search"><span class="sr-only">Paciente<\/span><select name="patient" required>/);
  assert.match(pay, /<\/select><\/label><div data-payment-patient><\/div><\/div><div class="finance-payment-section">/, 'la tarjeta de la cuenta vive dentro del paso 1');
  assert.doesNotMatch(src, /COBRO SEGURO|finance-payment-patient-empty/);
  assert.match(src, /function paymentPatientCard\(form\)\{var id=form\.elements\.patient\.value,host=form\.querySelector\('\[data-payment-patient\]'\);if\(!id\)\{host\.innerHTML='';return;\}/);
});

test('los estilos del paso 3: mismas filas y etiquetas, acomodo por espacio y ventanas que caben', () => {
  const start = css.indexOf('/* Finanzas v6 · paso 3'); assert.ok(start > css.indexOf('/* Finanzas v6 · paso 2'));
  const blockCss = css.slice(start);
  assert.match(blockCss, /#p-caja \.finance-cash-grid\{display:grid;grid-template-columns:minmax\(0,1\.55fr\) minmax\(0,1fr\)\}/);
  assert.match(blockCss, /#p-caja \.finance-breakdown>\.is-total dd\{font-size:18px;font-weight:700;/);
  assert.match(blockCss, /#p-caja \.finance-line\[data-cols=moves\]\{grid-template-columns:88px minmax\(0,1fr\) auto;/);
  assert.match(blockCss, /#p-caja :is\(\.finance-cols,\.finance-line\)\[data-cols=invoices\]\{grid-template-columns:minmax\(0,1\.25fr\) minmax\(0,1\.5fr\) 112px 196px\}/);
  assert.match(blockCss, /#p-caja \.finance-tag\[data-tone=warn\]\{/);
  // Las reglas angostas van DESPUÉS de las de base (si no, la de cuatro columnas ganaba y el celular se desacomodaba).
  const base = blockCss.indexOf('#p-caja :is(.finance-cols,.finance-line)[data-cols=invoices]{grid-template-columns:minmax(0,1.25fr)'), narrow = blockCss.indexOf('#p-caja .finance-line[data-cols=invoices]{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who amount" "state state" "actions actions"');
  assert.ok(base > 0 && narrow > base);
  for (const width of [820, 720, 560]) {
    assert.match(blockCss, new RegExp('@media\\(max-width:' + width + 'px\\)\\{'));
    assert.match(blockCss, new RegExp('/\\*contenedor\\*/@container finance-workspace \\(max-width:' + width + 'px\\)\\{'));
  }
  assert.match(blockCss, /@media\(max-width:820px\)\{[^@]*#p-caja \.finance-cash-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(blockCss, /#p-caja :is\(\.finance-turn-actions \.btn,\.finance-fold-actions \.btn,\.finance-cash-main>\.finance-empty \.btn,\.finance-setup-strip \.btn\)\{min-height:44px\}/);
  // Las ventanas viven fuera de la página: sus reglas no llevan #p-caja y no se copian al contenedor.
  assert.match(blockCss, /\.finance-cut-row\{display:grid;grid-template-columns:minmax\(0,1\.3fr\) minmax\(84px,\.7fr\) minmax\(116px,\.85fr\) minmax\(84px,\.7fr\);/);
  assert.match(blockCss, /@media\(max-width:560px\)\{[^@]*\.finance-cut-row\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);/);
  assert.match(blockCss, /\.finance-cut-form \.smyl-dialog-body>\*\{flex:0 0 auto\}/, 'los bloques del corte no se encogen (el total quedaba cortado)');
  assert.doesNotMatch(css.split('\n').filter((l) => l.startsWith('/*contenedor*/')).join('\n'), /\.finance-cut-|\.finance-money-|#finance-dialog/);
  // Un solo recuadro por importe, y el cobro a pantalla completa en celular.
  assert.match(blockCss, /dialog\[data-smyl-dialog-system="true"\]\[open\] \.finance-money-box>input\[type\]\{width:100%;padding-left:24px!important;/);
  assert.match(blockCss, /dialog\[data-smyl-dialog-system="true"\] :is\(\.finance-payment-amount>span,\.finance-allocation-input\)\{position:relative;border:0;/);
  assert.match(blockCss, /@media\(max-width:640px\)\{\s*dialog#finance-dialog\[data-smyl-dialog-system="true"\]\[data-smyl-dialog-size="large"\]\{width:100vw!important\}[^@]*body>#finance-dialog \.smyl-dialog-footer button\{min-height:44px!important\}\s*\}/);
  // La página recorta lo que se sale por abajo: el menú «•••» de la última fila abre hacia arriba (quedaba cortado).
  assert.match(blockCss, /#p-caja \.finance-row-menu\.is-up>div\{top:auto;bottom:calc\(100% \+ 6px\)\}/);
  assert.match(src, /menu\.classList\.remove\('is-up'\);if\(box&&box\.getBoundingClientRect\(\)\.bottom>page\.getBoundingClientRect\(\)\.bottom-4&&menu\.getBoundingClientRect\(\)\.top-page\.getBoundingClientRect\(\)\.top>box\.offsetHeight\+12\)menu\.classList\.add\('is-up'\);if\(box\)box\.scrollIntoView\(\{block:'nearest'\}\);\},true\);/);
  const tiny = [...blockCss.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => Number(m[1]) < 12);
  assert.equal(tiny.length, 0, 'sin texto menor a 12 px');
  // La limpieza se llevó las reglas de las pantallas anteriores.
  assert.doesNotMatch(css, /finance-team-cash|finance-cash-help|finance-close-method|finance-close-period|finance-close-footer|finance-drafts|finance-fiscal-receivers|finance-fiscal-note|finance-fiscal-status|finance-draft-actions|finance-payment-patient-empty/);
});

test('versiones publicadas y copias de la app móvil al día', () => {
  const app = read('app.html'), sw = read('sw.js');
  assert.match(app, /smyl-finance\.css\?v=55/); assert.match(app, /smyl-finance\.js\?v=73/);
  assert.match(sw, /smyl-finance\.js\?v=73/); assert.match(sw, /smyl-finance\.css\?v=55/); assert.match(sw, /finanzas-caja-facturacion-v9/);
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), file);
});
