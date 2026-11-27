import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8');
const fn = (name) => { const m = js.match(new RegExp('function ' + name + '\\([^)]*\\)\\{[^\\n]*\\n')); assert.ok(m, name); return m[0]; };

test('la tarjeta de Pagos usa el periodo del panel y se refresca al cambiarlo', () => {
  assert.match(js, /function periodFacts\(\)/);
  assert.match(js, /put\('receipts',money\(pf\.totalCents\/100\),pf\.label\+' · '/);
  assert.match(js, /state\.shown\.payments=PAGE_ROWS;renderPayments\(\);renderTabs\(\);/);
});

test('message(): distingue los permisos en lugar de un solo texto genérico', () => {
  const message = new Function(fn('message') + 'return message;')();
  assert.match(message(new Error('Sin permiso.')), /Tu rol no permite.*administra los roles/);
  assert.equal(message({ code: '42501', message: 'Esa caja es de una sucursal fuera de tu alcance.' }), 'Esa caja es de una sucursal fuera de tu alcance.');
  assert.equal(message(new Error('No tienes permiso para reembolsar pagos.')), 'No tienes permiso para reembolsar pagos.');
  assert.equal(message(new Error('No puedes registrar efectivo en la caja de otra persona.')), 'No puedes registrar efectivo en la caja de otra persona.');
  assert.match(message(new Error('new row violates row-level security policy')), /otra sucursal o de otra persona/);
  assert.match(message(new Error('La caja cambió en otra sesión.')), /cambió en otra sesión/);
});

test('una caja ajena dice de quién es y quién puede operarla', () => {
  assert.match(js, /Esta caja es de '\+actorName\(s\.opened_by\)\+': solo su responsable o un supervisor puede registrar movimientos\./);
  assert.match(js, /solo su responsable o un supervisor puede cerrarla\./);
  assert.match(js, /Solo un supervisor financiero puede reembolsar\./);
});

test('Cobrar: el importe por cargo se reparte solo y avisa cuando sobra dinero', () => {
  assert.match(js, /<input data-allocation type="number"[^>]*readonly tabindex="-1"/);
  assert.match(js, /el importe se reparte solo, del más antiguo al más reciente/);
  assert.match(js, /finance-payment-surplus/);
  assert.match(js, /Quedarán como saldo a favor porque hay cargos sin marcar/);
});
