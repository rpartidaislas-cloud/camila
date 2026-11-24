// Costo de proveedores de IA: cálculo puro (mismo resultado que la función SQL de la migración 20261124120000).
// Los precios de aquí son FICTICIOS, solo para comprobar la matemática; los reales los captura el dueño de SMYL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unitPriceMxn, usageCostMxn, operationCostMxn, creditsForCost } from '../supabase/functions/_shared/provider-cost.mjs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const settings = { fx_usd_mxn: 20, fx_buffer_pct: 10, credit_value_mxn: 0.5 };
const today = '2026-11-24';
const prices = [
  { provider: 'openai', model: 'gpt-5-mini', metric: 'input_tokens', per_units: 1000000, price: 2, currency: 'USD', effective_from: '2026-01-01' },
  { provider: 'openai', model: 'gpt-5-mini', metric: 'output_tokens', per_units: 1000000, price: 8, currency: 'USD', effective_from: '2026-01-01' },
  { provider: 'openai', model: 'gpt-image-2', metric: 'image', per_units: 1, price: 0.1, currency: 'USD', effective_from: '2026-01-01' },
  { provider: 'openai', model: 'gpt-transcribe', metric: 'audio_seconds', per_units: 60, price: 0.006, currency: 'USD', effective_from: '2026-01-01' },
  { provider: 'other', model: 'timbres', metric: 'request', per_units: 1, price: 0.6, currency: 'MXN', effective_from: '2026-01-01' },
];

test('reescritura de mensaje: mismo costo que la verificación manual de la migración (0.0616 MXN)', () => {
  const part = [{ provider: 'openai', model: 'gpt-5-mini', metric: 'input_tokens', quantity: 600 }, { provider: 'openai', model: 'gpt-5-mini', metric: 'output_tokens', quantity: 200 }];
  const out = operationCostMxn(prices, settings, part, today);
  assert.equal(out.cost_mxn, 0.0616); assert.equal(out.complete, true); assert.equal(out.credits_suggested, 1);
});

test('un precio en MXN no usa tipo de cambio ni margen; un timbre cuesta $0.60', () => {
  assert.equal(unitPriceMxn(prices, settings, 'other', 'timbres', 'request', today), 0.6);
  assert.equal(usageCostMxn(prices, settings, 'other', 'timbres', { request: 50 }, today).cost_mxn, 30);
  assert.equal(usageCostMxn(prices, settings, 'other', 'timbres', { request: 150 }, today).cost_mxn, 90);
});

test('sin precio o sin tipo de cambio NO se inventa el costo: queda pendiente y dice qué falta', () => {
  const out = usageCostMxn(prices, settings, 'openai', 'gpt-4o', { input_tokens: 1000, output_tokens: 100 }, today);
  assert.equal(out.complete, false); assert.equal(out.cost_mxn, null);
  assert.deepEqual(out.missing, ['openai/gpt-4o/input_tokens', 'openai/gpt-4o/output_tokens']);
  assert.equal(unitPriceMxn(prices, { fx_usd_mxn: null, fx_buffer_pct: 5 }, 'openai', 'gpt-5-mini', 'input_tokens', today), null, 'precio en USD sin tipo de cambio');
  const partial = usageCostMxn(prices, settings, 'openai', 'gpt-5-mini', { input_tokens: 100, cached_input_tokens: 500 }, today);
  assert.equal(partial.complete, false, 'se usó algo cuyo precio falta');
});

test('solo cuentan las métricas realmente usadas', () => {
  const out = usageCostMxn(prices, settings, 'openai', 'gpt-5-mini', { input_tokens: 1000000, output_tokens: 0 }, today);
  assert.equal(out.cost_mxn, 44, '1M de tokens de entrada: 2 USD × 20 × 1.10');
});

test('vigencia: el precio futuro no aplica hoy y el posterior reemplaza al anterior', () => {
  const withFuture = prices.concat([{ provider: 'openai', model: 'gpt-5-mini', metric: 'output_tokens', per_units: 1000000, price: 100, currency: 'USD', effective_from: '2026-12-24' }]);
  assert.equal(Math.round(unitPriceMxn(withFuture, settings, 'openai', 'gpt-5-mini', 'output_tokens', '2026-11-24') * 1e6), 176);
  assert.equal(Math.round(unitPriceMxn(withFuture, settings, 'openai', 'gpt-5-mini', 'output_tokens', '2026-12-25') * 1e6), 2200);
});

test('créditos sugeridos: una simulación vale muchas veces una reescritura, ya no 1 = 1', () => {
  const sim = operationCostMxn(prices, settings, [{ provider: 'openai', model: 'gpt-image-2', metric: 'image', quantity: 1 }, { provider: 'openai', model: 'gpt-5-mini', metric: 'input_tokens', quantity: 2500 }, { provider: 'openai', model: 'gpt-5-mini', metric: 'output_tokens', quantity: 600 }], today);
  const msg = operationCostMxn(prices, settings, [{ provider: 'openai', model: 'gpt-5-mini', metric: 'input_tokens', quantity: 600 }], today);
  assert.ok(sim.credits_suggested >= 4 && msg.credits_suggested === 1);
  assert.equal(creditsForCost(0.0001, settings), 1, 'mínimo 1 crédito');
  assert.equal(creditsForCost(1.01, settings), 3);
  assert.equal(creditsForCost('x', settings), null);
});

test('la migración no trae ningún precio cargado y es interna (ninguna clínica la lee)', () => {
  const sql = read('supabase/migrations/20261124120000_smyl_provider_pricing.sql');
  assert.doesNotMatch(sql, /price\s*,\s*currency\s*\)\s*values[^;]*\d+\.\d+/i, 'no se siembran precios');
  assert.match(sql, /revoke all on public\.smyl_provider_prices, public\.smyl_cost_settings, public\.smyl_ai_operations from public, anon, authenticated/);
  assert.match(sql, /revoke all on public\.smyl_operation_costs from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /grant [^;]* to authenticated/i);
});
