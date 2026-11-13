import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const finance = read('../smyl-finance.js');
const styles = read('../smyl-finance.css');
const dialogSystem = read('../smyl-dialog-system.js');

test('la cartera prioriza vencimientos, créditos y cortes verificables', () => {
  assert.match(finance, /Cuenta vencida/);
  assert.match(finance, /Saldo a favor/);
  assert.match(finance, /sin aplicar/);
  assert.match(finance, /Corte pendiente/);
  assert.match(finance, /finance-alert/);
  assert.match(finance, /accountSnapshot/);
  assert.match(finance, /dueLabel/);
  assert.match(finance, /ningún cobro se ejecuta automáticamente/i);
});

test('cada cuenta comunica avance sin inventar estados financieros', () => {
  assert.match(finance, /Requieren acción/);
  assert.match(finance, /Pendientes/);
  assert.match(finance, /A favor/);
  assert.match(finance, /Liquidadas/);
  assert.match(finance, /Total cargado/);
  assert.doesNotMatch(finance, /Total de tratamiento/);
  assert.match(finance, /Pagado/);
  assert.match(finance, /Pendiente/);
  assert.match(styles, /\.finance-account-progress/);
});

test('el pago se revisa antes de enviarse a la operación atómica', () => {
  assert.match(finance, /Listo para registrar/);
  assert.match(finance, /Se aplicará/);
  assert.match(finance, /Saldo a favor/);
  assert.match(finance, /Abre una caja para esta sucursal antes de recibir efectivo/);
  assert.match(finance, /rpc\('smyl_post_payment'/);
  assert.doesNotMatch(finance, /from\('smyl_finance_payments'\)\.insert/);
});

test('el registro profesional guía paciente, importe, método, aplicación y recibo', () => {
  for (const copy of ['CUENTA DEL PACIENTE', 'Liquidar ', 'Registrar anticipo', 'Forma de pago', 'Aplicar a cargos', 'PAGO REGISTRADO', 'Imprimir recibo', 'Compartir']) {
    assert.match(finance, new RegExp(copy));
  }
  assert.match(finance, /data-allocation/);
  assert.match(finance, /paymentReference/);
  assert.match(finance, /navigator\.share/);
  assert.match(styles, /\.finance-payment-layout/);
  assert.match(styles, /\.finance-payment-success/);
  assert.match(dialogSystem, /finance-payment-form/);
  assert.doesNotMatch(finance, /Preparar CFDI|Preparar factura|data-cfdi|data-success-cfdi/);
  assert.match(finance, /Ver recibo/);
  assert.match(finance, /finance-row-menu/);
  assert.match(finance, /Reembolsar pago/);
});

test('el cobro cotidiano parte del paciente y decide la operación sin mezclar movimientos', () => {
  for (const copy of ['Cobrar a paciente', 'Cobrar saldo', 'Servicio de hoy', 'Cotización aceptada', 'Registrar anticipo', 'Agregar cargo sin pago']) {
    assert.match(finance, new RegExp(copy));
  }
  assert.match(finance, /function openGuidedCollection\(patientId\)/);
  assert.match(finance, /openPayment\(id,\{mode:'balance'\}\)/);
  assert.match(finance, /openCharge\(id,\{due:'0',mode:'pay'\}\)/);
  assert.match(finance, /openProposalCharge\(null,id\)/);
  assert.match(finance, /openPayment\(id,\{mode:'advance'\}\)/);
  assert.match(finance, /allocationMode==='debt'\?' checked':''/);
  assert.doesNotMatch(finance, /Paso 1 de 2|Paso 2 de 2/, 'el cobro guiado es de un solo paso (maqueta aprobada)');
  assert.match(finance, /function financeGuideIcon\(type\)/);
  assert.match(finance, /data-guide-change/);
  assert.match(finance, /if\(pick\)requestAnimationFrame\(function\(\)\{var first=suggested\.querySelector/);
  assert.match(styles, /\.finance-collection-guide/);
  assert.match(styles, /\.finance-more-actions/);
  assert.match(styles, /Cobro guiado v4/);
  assert.match(styles, /grid-auto-rows:max-content/);
  assert.match(styles, /finance-guide-route-icon svg/);
  assert.match(styles, /finance-patient-picker input\[type=search\]:focus-visible/);
});

test('web, móvil y PWA publican la etapa cinco sincronizada', () => {
  assert.match(app, /smyl-finance\.css\?v=28/);
  assert.match(app, /smyl-finance\.js\?v=35/);
  assert.match(worker, /collection-visual-v1/);
  assert.match(worker, /smyl-v267-guided-collection-sentry-v1/);
  for (const file of ['app.html', 'sw.js', 'smyl-finance.js', 'smyl-finance.css', 'smyl-dialog-system.js']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
