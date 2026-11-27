import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');
const draftMigration = read('supabase/migrations/20261013020000_smyl_proposal_finance_v1.sql');
const financeSchema = read('supabase/migrations/20261012330000_smyl_finance.sql');

test('Por cobrar es el inicio, Pagos sigue a las cuentas y Facturación conserva un espacio independiente', () => {
  assert.match(js, /tab:'accounts'/);
  assert.match(js, /\['accounts','Por cobrar'\],\['receipts','Pagos'\]/);
  assert.match(js, /<section data-finance-panel="receipts" id="finance-panel-receipts"/);
  // Facturación es una lista con sus filtros arriba; la pestaña ya la nombra, así que no repite un encabezado.
  assert.match(js, /<section data-finance-panel="fiscal" id="finance-panel-fiscal" role="tabpanel" aria-labelledby="finance-tab-fiscal" hidden><article class="finance-card finance-list-card finance-fiscal-card"><div id="finance-fiscal"><\/div><\/article><\/section>/);
  assert.match(js, /Una factura siempre nace de un recibo/);
  assert.match(js, /var INVOICE_FILTERS=\[\['drafts','Borradores'\],\['issued','Emitidas'\],\['cancelled','Canceladas'\],\['pending','Por facturar'\]\];/);
  assert.match(js, /function renderPayments\(\)/);
  assert.match(js, /function renderFiscal\(\)/);
});

test('cada recibo abre servicios, pago, responsable y acción fiscal contextual', () => {
  for (const copy of ['CONCEPTOS', 'Servicios cobrados', 'Total pagado', 'Registrado por', 'Saldo a favor']) {
    assert.match(js, new RegExp(copy));
  }
  // El recibo se abre desde su pago, en la lista de Pagos.
  assert.match(js, /<button type="button" class="finance-link-action" data-open-receipt="'\+receipt\.id\+'" aria-label="Recibo '/);
  assert.match(js, /b\.onclick=function\(\)\{openReceiptDetails\(by\(state\.receipts,b\.dataset\.openReceipt\)\);\}/);
  assert.match(js, /function receiptLines\(receipt\)/);
  assert.match(js, /acctIndex\(\)\.allocByPayment\.get\(payment\.id\)/);
  assert.match(js, /charge\.concept/);
  assert.match(js, /openReceiptDetails/);
  assert.match(js, /data-receipt-print/);
  assert.match(js, /data-receipt-share/);
});

test('un recibo con borrador no vuelve a ofrecer preparar factura', () => {
  assert.match(js, /draft=byKey\(state\.drafts,'payment_id',receipt\.payment_id\)/);
  assert.match(js, /bucket=draft\?\(draft\.status==='issued'\?'issued':'draft'\):'pending'/);
  assert.match(js, /if\(item\.code==='ready'\)fiscalAction='<button[^']*data-receipt-invoice/);
  assert.match(js, /else if\(item\.draft\)fiscalAction='<button[^']*data-receipt-fiscal/);
  assert.match(financeSchema, /unique\(tenant_id,payment_id\)/);
  assert.match(draftMigration, /idempotency_key=p_idempotency_key or payment_id=p_payment_id/);
});

test('la interfaz explica por qué un recibo todavía no puede facturarse', () => {
  for (const copy of ['Reembolso registrado', 'Pago por aplicar', 'Faltan datos fiscales', 'Falta revisar emisor']) {
    assert.match(js, new RegExp(copy));
  }
  assert.match(js, /refund>0/);
  assert.match(js, /!fullyApplied/);
  assert.match(js, /!profile/);
  assert.match(js, /state\.issuer\.fiscal_status!=='reviewed'/);
});

test('preparar factura reutiliza la operación fiscal segura existente', () => {
  assert.match(js, /function prepareCfdi\(payment\)/);
  assert.match(js, /if\(!state\.canInvoice\)/);
  assert.match(js, /rpc\('smyl_prepare_cfdi_draft_v3'/);
  assert.doesNotMatch(js, /from\('smyl_cfdi_drafts'\)\.insert/);
});

test('la lista de pagos y el detalle del recibo se adaptan a PWA sin microtexto', () => {
  const block = css.slice(css.indexOf('/* Facturación v2'));
  assert.ok(block.length > 0);
  // En celular cada pago acomoda paciente e importe arriba; fecha y recibo abajo.
  assert.match(block, /#p-caja \.finance-line\[data-cols=payments\]\{grid-template-columns:minmax\(0,1fr\) auto;grid-template-areas:"who amount" "who how" "when actions"\}/);
  assert.match(block, /finance-receipt-detail-body\{display:grid;grid-template-columns:1fr;align-content:start/);
  assert.doesNotMatch(css, /finance-fiscal-receipt-list|finance-fiscal-receipt-filters/, 'la bandeja vieja de recibos ya no existe');
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 11);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican la misma bandeja versionada', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=59/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=82/);
  assert.match(read('app.html'), /smyl-clinic-admin\.js\?v=31/);
  assert.match(read('sw.js'), /professional-finance-v1/);
  assert.match(read('sw.js'), /finanzas-workspace-v5/);
});
