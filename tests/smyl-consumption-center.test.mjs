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

test('Web and mobile consumption assets stay identical', () => {
  for (const path of ['consumos.html', 'smyl-consumption.js', 'smyl-consumption.css']) {
    assert.equal(read(path), read(`mobile/www/${path}`), path);
  }
});
