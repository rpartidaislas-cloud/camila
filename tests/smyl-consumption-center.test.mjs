import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Plan y consumo separates the four commercial resources', () => {
  const html = read('consumos.html');
  assert.match(html, /Plan y consumo/);
  assert.match(html, /MILA e IA/);
  assert.match(html, /Canales de Meta/);
  assert.match(html, /Almacenamiento/);
  assert.match(html, /Historial de consumo/);
});

test('The consumption center preserves honest integration boundaries', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  assert.match(html, /No mostraremos un “0 GB” engañoso/);
  assert.match(html, /LANA continuará administrando credenciales/);
  assert.match(script, /Instagram.*pendientes/);
  assert.match(script, /tokens de entrada, salida y caché/);
});

test('History is server-backed, filterable and mobile-ready', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  const css = read('smyl-consumption.css');
  assert.match(script, /from\('smyl_usage_ledger'\)/);
  assert.match(script, /limit\(100\)/);
  assert.match(html, /id="history-resource"/);
  assert.match(html, /id="history-kind"/);
  assert.match(css, /@media\(max-width:580px\)/);
});

test('Consumption center prefers consolidated RPCs and preserves the legacy fallback', () => {
  const script = read('smyl-consumption.js');
  assert.match(script, /rpc\('smyl_usage_overview'/);
  assert.match(script, /rpc\('smyl_usage_history'/);
  assert.match(script, /dataSource='consolidated'/);
  assert.match(script, /from\('smyl_wallets'\)/);
  assert.match(script, /from\('smyl_usage_ledger'\)/);
  assert.match(script, /meta_messages/);
});

test('Usage warnings require a confirmed server quota and remain non-blocking in pilot mode', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  const css = read('smyl-consumption.css');
  assert.match(html, /id="usage-alerts"[^>]*hidden/);
  assert.match(script, /item\.limit_units==null/);
  assert.match(script, /percent>=70/);
  assert.match(script, /percent>=85/);
  assert.match(script, /percent>=100/);
  assert.match(script, /modo de medición no bloqueará el servicio/i);
  assert.match(script, /params\.has\('usage-alerts'\)/);
  assert.match(css, /usage-consumption-alert\.is-exhausted/);
});

test('History supports server filters, cursor pagination and a safe clinical-free CSV', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  assert.match(html, /id="history-period"/);
  assert.match(html, /id="history-export"/);
  assert.match(html, /id="history-more"/);
  assert.match(script, /p_cursor:reset\?null:state\.nextCursor/);
  assert.match(script, /p_filters:historyFilters\(\)/);
  assert.match(script, /new Blob\(/);
  assert.match(script, /smyl-consumo-/);
  assert.match(script, /\^\[=\+\\-@\]/);
  const exporter = script.slice(script.indexOf('function exportHistory'), script.indexOf('function renderCloud'));
  assert.doesNotMatch(exporter, /patient|prompt|transcript|provider_cost|source_id/);
});

test('Package checkout trusts only an active server product and a signed webhook', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  assert.match(html, /id="usage-purchase-dialog"/);
  assert.match(html, /webhook seguro/);
  assert.match(script, /row\.active&&row\.price_minor!=null&&row\.id/);
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /functions\.invoke\('smyl-consumables-checkout'/);
  assert.match(script, /url\.protocol!==\'https:\'/);
  const checkout = script.slice(script.indexOf('async function requestCheckout'), script.indexOf('function renderCloud'));
  assert.match(checkout, /product_id:product\.id/);
  assert.match(checkout, /idempotency_key:state\.checkoutKey/);
  assert.doesNotMatch(checkout, /tenant_id|price_minor:|currency:/);
});

test('Checkout return is verified by the server before any balance refresh', () => {
  const html = read('consumos.html');
  const script = read('smyl-consumption.js');
  assert.match(html, /id="usage-payment-result"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(script, /functions\.invoke\('smyl-consumables-checkout-status'/);
  assert.match(script, /body:\{checkout_id:id\}/);
  assert.match(script, /sessionStorage\.setItem\('smyl_checkout_pending',String\(checkout\)\)/);
  assert.match(script, /history\.replaceState/);
  assert.match(script, /status==='completed'/);
  assert.match(script, /status==='failed'\|\|status==='expired'/);
  assert.match(script, /status==='refunded'/);
  const handler = script.slice(script.indexOf('async function handleCheckoutReturn'), script.indexOf('function icon'));
  assert.doesNotMatch(handler, /balance_units\s*=|wallets\.push|from\('smyl_wallets'\).*update/);
  assert.match(handler, /await verifyCheckout\(id\)/);
});

test('Web and mobile consumption assets stay identical', () => {
  for (const path of ['consumos.html', 'smyl-consumption.js', 'smyl-consumption.css']) {
    assert.equal(read(path), read(`mobile/www/${path}`), path);
  }
});
