import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const inventoryCss = read('smyl-inventory.css');
const inventoryJs = read('smyl-inventory.js');
const consumptionCss = read('smyl-consumption.css');
const consumptionJs = read('smyl-consumption.js');
const fixture = read('tests/fixtures/smyl-operations-v33-preview.html');

test('Inventario adopta el contrato operativo v3.3 sin tocar su dominio clínico', () => {
  assert.match(inventoryCss, /Clinical Workspace v3\.3 · Inventario/);
  assert.match(inventoryCss, /tarea -> decisión -> detalle/);
  assert.match(inventoryCss, /--inv-v33-control:42px/);
  assert.match(inventoryCss, /--inv-v33-control:44px/);
  assert.match(inventoryCss, /font-size:12px/);
  assert.match(inventoryCss, /outline:3px solid/);
  assert.match(inventoryCss, /@media\(max-width:760px\)/);
  assert.match(inventoryCss, /@media\(max-width:480px\)/);
  assert.match(inventoryJs, /aria-busy','true/);
  assert.match(inventoryJs, /role="'\+liveRole\+'"/);
  assert.match(inventoryJs, /role','tablist/);
  assert.match(inventoryJs, /role','tabpanel/);
  assert.match(inventoryJs, /event\.key==='ArrowRight'/);
  assert.match(inventoryJs, /aria-controls/);
});

test('Inventario conserva permisos, trazabilidad y escrituras atómicas existentes', () => {
  assert.match(inventoryJs, /inventory\.read/);
  assert.match(inventoryJs, /inventory\.manage/);
  assert.match(inventoryJs, /smyl_post_inventory_movement/);
  assert.match(inventoryJs, /smyl_receive_purchase_order/);
  assert.match(inventoryJs, /smyl_reverse_inventory_movement/);
  assert.match(inventoryJs, /requires_patient_trace/);
  assert.match(inventoryJs, /Los lotes caducados no se ofrecen/);
});

test('Consumos adopta el contrato v3.3 con lectura, decisión y detalle', () => {
  assert.match(consumptionCss, /Clinical Workspace v3\.3 · Plan y consumo/);
  assert.match(consumptionCss, /lectura -> decisión -> detalle/);
  assert.match(consumptionCss, /--usage-v33-control:42px/);
  assert.match(consumptionCss, /--usage-v33-control:44px/);
  assert.match(consumptionCss, /font-size:12px/);
  assert.match(consumptionCss, /outline:3px solid/);
  assert.match(consumptionCss, /\.usage-table thead\{display:none\}/);
  assert.match(consumptionCss, /nth-child\(5\)::before\{content:'Saldo'\}/);
});

test('Consumos expone carga y errores persistentes sin alterar cobro ni conciliación', () => {
  assert.match(consumptionJs, /loadError:null/);
  assert.match(consumptionJs, /No pudimos actualizar todos los consumos/);
  assert.match(consumptionJs, /data-history-retry/);
  assert.match(consumptionJs, /state\.historyLoading/);
  assert.match(consumptionJs, /if\(state\.loading\)return/);
  assert.match(consumptionJs, /aria-busy','true/);
  assert.match(consumptionJs, /functions\.invoke\('smyl-consumables-checkout'/);
  assert.match(consumptionJs, /functions\.invoke\('smyl-consumables-checkout-status'/);
  assert.match(consumptionJs, /rpc\('smyl_usage_overview'/);
  assert.match(consumptionJs, /from\('smyl_usage_ledger'\)/);
});

test('La fixture sintética cubre superficies, decisiones y estados críticos', () => {
  assert.match(fixture, /surface.*inventory/);
  assert.match(fixture, /surface.*consumption/);
  assert.match(fixture, /REPONER AHORA/);
  assert.match(fixture, /No pudimos actualizar todos los consumos/);
  assert.match(fixture, /Cargando existencias/);
  assert.match(fixture, /Aún no hay movimientos registrados/);
  assert.match(fixture, /class="usage-table"/);
});

test('Los cambios v3.3 quedan limitados a presentación y estado de interfaz', () => {
  for (const source of [inventoryCss, consumptionCss]) {
    assert.doesNotMatch(source, /supabase|rpc\(|tenant_id|row level security/i);
  }
  assert.doesNotMatch(consumptionJs, /from\('smyl_wallets'\).*\.(?:insert|update|delete)\(/);
  assert.doesNotMatch(inventoryJs, /smyl_inventory_movements'\)\.update/);
});
