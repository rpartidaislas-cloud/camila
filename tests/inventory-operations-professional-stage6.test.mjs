import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const mobileApp = read('../mobile/www/app.html');
const script = read('../smyl-inventory.js');
const mobileScript = read('../mobile/www/smyl-inventory.js');
const styles = read('../smyl-inventory.css');
const mobileStyles = read('../mobile/www/smyl-inventory.css');
const worker = read('../sw.js');

test('la bandeja operativa prioriza faltantes, caducidades y recepciones', () => {
  assert.match(script, /CONTROL OPERATIVO/);
  assert.match(script, /REPONER AHORA/);
  assert.match(script, /NO UTILIZAR/);
  assert.match(script, /CADUCIDAD PRÓXIMA/);
  assert.match(script, /POR RECIBIR/);
  assert.match(script, /sin modificar existencias automáticamente/);
  assert.match(styles, /\.inventory-focus-list/);
});

test('existencias muestran filtros y una reposición sugerida verificable', () => {
  for (const filter of ['attention', 'low', 'expiry', 'all']) {
    assert.match(script, new RegExp(`data-stock-filter=\\"${filter}\\"`));
  }
  assert.match(script, /function suggestedPurchase/);
  assert.match(script, /target_quantity/);
  assert.match(script, /Sugerido pedir/);
  assert.match(script, /Trazabilidad por paciente/);
  assert.match(script, /No utilizar/);
});

test('consumo clínico revisa lote vigente y paciente antes del RPC', () => {
  assert.match(script, /CONTROL DE TRAZABILIDAD/);
  assert.match(script, /Los lotes caducados no se ofrecen para consumo/);
  assert.match(script, /Selecciona un lote vigente para este consumo/);
  assert.match(script, /Este insumo requiere vincular al paciente/);
  const validations = script.indexOf("item.requires_patient_trace&&!patient");
  const rpc = script.indexOf("rpc('smyl_post_inventory_movement'");
  assert.ok(validations > -1 && rpc > validations);
});

test('compras comunican avance de recepción sin alterar el libro', () => {
  assert.match(script, /inventory-order-progress/);
  assert.match(script, /unidades recibidas/);
  assert.match(script, /received_quantity/);
  assert.match(script, /Los confirmados no se editan/);
  assert.doesNotMatch(script, /\.update\([^)]*smyl_inventory_movements/);
});

test('web, móvil y PWA distribuyen la etapa seis sincronizada', () => {
  assert.equal(app, mobileApp);
  assert.equal(script, mobileScript);
  assert.equal(styles, mobileStyles);
  assert.match(app, /smyl-inventory\.js\?v=6/);
  assert.match(app, /smyl-inventory\.css\?v=5/);
  assert.match(worker, /smyl-v245-server-costing/);
  assert.match(worker, /smyl-inventory\.js\?v=6/);
  assert.match(worker, /smyl-inventory\.css\?v=5/);
});
