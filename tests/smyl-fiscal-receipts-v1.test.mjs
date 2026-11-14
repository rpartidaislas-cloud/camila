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

test('Recibos es el inicio y Facturación conserva un espacio independiente', () => {
  assert.match(js, /tab:'receipts'/);
  assert.match(js, /dataset\.financeTab='receipts'/);
  assert.match(js, /dataset\.financePanel='receipts'/);
  assert.match(js, /<h2>Facturación<\/h2>/);
  assert.match(js, /Proceso fiscal independiente/);
  assert.match(js, /Los procesos comienzan desde Recibos/);
  assert.match(js, /function renderReceipts\(\)/);
  assert.match(js, /function renderFiscal\(\)/);
});

test('cada recibo abre servicios, pago, responsable y acción fiscal contextual', () => {
  for (const copy of ['SERVICIOS COBRADOS', 'Conceptos del recibo', 'Total recibido', 'Registró', 'Saldo a favor', 'Abrir recibo']) {
    assert.match(js, new RegExp(copy));
  }
  assert.match(js, /function receiptLines\(receipt\)/);
  assert.match(js, /state\.allocations\.filter/);
  assert.match(js, /charge\.concept/);
  assert.match(js, /openReceiptDetails/);
  assert.match(js, /data-receipt-print/);
  assert.match(js, /data-receipt-share/);
});

test('un recibo con borrador no vuelve a ofrecer preparar factura', () => {
  assert.match(js, /draft=state\.drafts\.find\(function\(d\)\{return d\.payment_id===receipt\.payment_id;\}\)/);
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

test('la bandeja y el detalle se adaptan a PWA sin microtexto', () => {
  const block = css.slice(css.indexOf('/* Facturación v2'));
  assert.ok(block.length > 0);
  assert.match(block, /finance-fiscal-receipt-list>article/);
  assert.match(block, /grid-template-areas:"folio amount" "copy copy" "actions actions"/);
  assert.match(block, /finance-receipt-detail-body\{grid-template-columns:1fr/);
  assert.match(block, /finance-fiscal-receipt-filters\{[\s\S]*?overflow-x:auto/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 11);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican la misma bandeja versionada', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=30/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=37/);
  assert.match(read('app.html'), /smyl-clinic-admin\.js\?v=11/);
  assert.match(read('sw.js'), /professional-finance-v1/);
});
