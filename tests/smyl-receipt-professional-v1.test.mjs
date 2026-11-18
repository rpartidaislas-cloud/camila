import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-finance.js');
const css = read('smyl-finance.css');
const detail = js.slice(js.indexOf('function openReceiptDetails('), js.indexOf('async function printReceipt('));

test('el recibo prioriza pago, total, conceptos y seguimiento fiscal', () => {
  for (const copy of ['Pago confirmado', 'TOTAL RECIBIDO', 'SERVICIOS COBRADOS', 'Conceptos del recibo', 'FACTURACIÓN', 'Comprobante interno de pago. No sustituye un CFDI.']) {
    assert.match(detail, new RegExp(copy));
  }
  assert.match(detail, /finance-receipt-total/);
  assert.match(detail, /finance-receipt-meta/);
  assert.match(detail, /finance-receipt-fiscal/);
  assert.equal((detail.match(/data-close/g) || []).length, 1, 'el recibo debe tener un solo cierre visible');
});

test('imprimir y compartir ofrecen confirmación visible sin cambiar la operación existente', () => {
  assert.match(js, /function receiptActionFeedback\(button,text,tone\)/);
  assert.match(js, /Recibo compartido correctamente/);
  assert.match(js, /Datos del recibo copiados/);
  assert.match(detail, /data-receipt-feedback aria-live="polite"/);
  assert.match(detail, /printReceipt\(receipt\)/);
  assert.match(detail, /shareReceipt\(payment,receipt,share\)/);
});

test('la ventana es compacta en escritorio y una hoja completa en PWA', () => {
  const block = css.slice(css.indexOf('.finance-receipt-dialog'));
  assert.match(block, /width:min\(820px,calc\(100vw - 32px\)\)/);
  assert.match(block, /finance-receipt-detail-body\{display:grid;grid-template-columns:minmax\(0,1\.35fr\) minmax\(240px,\.65fr\)/);
  assert.match(block, /finance-receipt-dialog\{width:100%;max-width:none;height:100dvh/);
  assert.match(block, /finance-receipt-detail\{height:100dvh;max-height:none\}/);
  const tiny = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 11);
  assert.equal(tiny.length, 0);
});

test('web y PWA entregan la misma versión del recibo', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'app.html', 'sw.js']) {
    assert.equal(read('mobile/www/' + file), read(file), file);
  }
  assert.match(read('app.html'), /smyl-finance\.js\?v=57/);
  assert.match(read('app.html'), /smyl-finance\.css\?v=42/);
  assert.match(read('sw.js'), /receipt-professional-v1/);
});
