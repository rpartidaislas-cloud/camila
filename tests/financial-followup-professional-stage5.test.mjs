import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const finance = read('../smyl-finance.js');
const styles = read('../smyl-finance.css');

test('la cartera prioriza vencimientos, créditos y cortes verificables', () => {
  for (const label of ['SEGUIMIENTO FINANCIERO', 'CARTERA VENCIDA', 'SALDO A FAVOR', 'CORTE PENDIENTE']) {
    assert.match(finance, new RegExp(label));
  }
  assert.match(finance, /accountSnapshot/);
  assert.match(finance, /dueLabel/);
  assert.match(finance, /ningún cobro se ejecuta automáticamente/i);
});

test('cada cuenta comunica avance sin inventar estados financieros', () => {
  assert.match(finance, /Por atender/);
  assert.match(finance, /Con saldo/);
  assert.match(finance, /Liquidadas/);
  assert.match(finance, /Total de tratamiento/);
  assert.match(finance, /Pagado/);
  assert.match(finance, /Pendiente/);
  assert.match(styles, /\.finance-account-progress/);
});

test('el pago se revisa antes de enviarse a la operación atómica', () => {
  assert.match(finance, /CONTROL DE APLICACIÓN/);
  assert.match(finance, /Se aplicará/);
  assert.match(finance, /La diferencia quedará a favor del paciente/);
  assert.match(finance, /Abre una caja para esta sucursal antes de recibir efectivo/);
  assert.match(finance, /rpc\('smyl_post_payment'/);
  assert.doesNotMatch(finance, /from\('smyl_finance_payments'\)\.insert/);
});

test('web, móvil y PWA publican la etapa cinco sincronizada', () => {
  assert.match(app, /smyl-finance\.css\?v=6/);
  assert.match(app, /smyl-finance\.js\?v=8/);
  assert.match(worker, /smyl-v261-secure-checkout/);
  for (const file of ['app.html', 'sw.js', 'smyl-finance.js', 'smyl-finance.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
