import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('del plan al presupuesto pasa solo lo que tiene servicio del catálogo, con su etapa', () => {
  const M = require('../smyl-proposal-model.js');
  const svc = (price, mode) => ({ name: 'S', patient_name: 'S', reference_price: price, pricing_mode: mode });
  const plan = { document: { schema: 2, assessment: 'x', treatments: [
    { id: 'a', name: 'Limpieza', phase: 'prevent', service_id: '11111111-1111-4111-8111-111111111111', service_revision: 1, service_snapshot: svc(800, 'fixed'), teeth: [], surfaces: [] },
    { id: 'b', name: 'Control en 6 meses', phase: 'maintain', service_id: null, teeth: [], surfaces: [] },
    { id: 'c', name: 'Implante', phase: 'treat', service_id: '22222222-2222-4222-8222-222222222222', service_revision: 2, service_snapshot: svc(18000, 'per_tooth'), teeth: ['36'], surfaces: [] }] } };
  const doc = M.fromPlan(plan);
  assert.equal(doc.items.length, 2);
  assert.deepEqual(doc.items.map(i => i.phase), ['prevent', 'treat']);
  assert.deepEqual(doc.items.map(i => i.unit_cents), [80000, 1800000]);
});

test('el plan muestra precio por tratamiento, total vivo y agrega servicios del catálogo', () => {
  const js = read('smyl-clinic.js'), proposals = read('smyl-proposals.js');
  assert.match(js, /function planTotals\(\)/);
  assert.match(js, /function openServicePicker\(\)/);
  assert.match(js, /\+ Agregar servicio/);
  assert.match(js, /\+ Indicación sin cobro/);
  assert.match(js, /Indicación sin cobro \(no pasa al presupuesto\)/);
  assert.match(js, /smyl_service_branch_prices/);
  assert.match(proposals, /Este plan no tiene servicios con cobro/);
});

test('web, PWA y móvil publican la misma versión', () => {
  for (const f of ['smyl-clinic.js', 'smyl-clinic.css', 'smyl-proposal-model.js', 'smyl-proposals.js', 'app.html', 'sw.js'])
    assert.equal(read(f), read('mobile/www/' + f), f);
  assert.match(read('app.html'), /smyl-clinic\.js\?v=32/);
  assert.match(read('sw.js'), /plan-con-precios-v1/);
});
