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

test('Facturación comienza con los recibos y conserva su ciclo visible', () => {
  assert.match(js, /fiscalReceiptFilter:'pending'/);
  for (const copy of ['Recibos y facturación', 'Recibos para facturar', 'Por facturar', 'En preparación', 'Facturados', 'Preparar factura', 'Ver recibo']) {
    assert.match(js, new RegExp(copy));
  }
  assert.match(js, /state\.receipts\.map\(fiscalReceiptItem\)/);
  assert.match(js, /data-receipt-filter=/);
  assert.match(js, /data-invoice-payment=/);
});

test('un recibo con borrador no vuelve a ofrecer preparar factura', () => {
  assert.match(js, /draft=state\.drafts\.find\(function\(d\)\{return d\.payment_id===receipt\.payment_id;\}\)/);
  assert.match(js, /bucket=draft\?\(draft\.status==='issued'\?'issued':'draft'\):'pending'/);
  assert.match(js, /if\(item\.code==='ready'\)action='<button[^']*data-invoice-payment=/);
  assert.match(js, /else if\(item\.draft\)action='<button[^']*data-show-draft=/);
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
  assert.match(draftMigration, /Un pago con reembolso requiere revisión contable antes del CFDI/);
  assert.match(draftMigration, /El pago debe estar aplicado por completo antes de preparar el CFDI/);
});

test('preparar factura reutiliza la operación fiscal segura existente', () => {
  assert.match(js, /function prepareCfdi\(payment\)/);
  assert.match(js, /rpc\('smyl_prepare_cfdi_draft_v3'/);
  assert.match(js, /data-invoice-payment/);
  assert.match(js, /prepareCfdi\(by\(state\.payments,b\.dataset\.invoicePayment\)\)/);
  assert.doesNotMatch(js, /from\('smyl_cfdi_drafts'\)\.insert/);
});

test('la bandeja de recibos se adapta a PWA sin microtexto', () => {
  const block = css.slice(css.indexOf('/* Facturación v2'));
  assert.ok(block.length > 0);
  assert.match(block, /finance-fiscal-receipt-list>article/);
  assert.match(block, /grid-template-areas:"folio amount" "copy copy" "actions actions"/);
  assert.match(block, /finance-fiscal-receipt-filters\{[\s\S]*?overflow-x:auto/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12);
  assert.equal(tiny.length, 0);
});

test('web y PWA publican la misma bandeja fiscal versionada', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.css\?v=29/);
  assert.match(read('app.html'), /smyl-finance\.js\?v=36/);
  assert.match(read('sw.js'), /fiscal-receipts-v1/);
});
