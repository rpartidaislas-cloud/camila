import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const fin = read('smyl-finance.js');

// Ejecuta el cálculo real de la ventana «Registrar cargo».
const calc = (() => {
  const pick = (re) => { const m = fin.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
  const code = [pick(/function chargeNum\(v\)\{[^\n]*\n/), pick(/function chargeMath\(f,service\)\{[^\n]*\n/), pick(/function chargeInvoiceable\(s\)\{[^\n]*\n/), pick(/function chargeTaxLabel\(s\)\{[^\n]*\n/)].join('\n');
  return new Function(code + ';return {chargeMath,chargeInvoiceable,chargeTaxLabel,chargeNum};')();
})();
const form = (v) => ({ elements: { quantity: { value: v.q ?? '1' }, price: { value: v.p ?? '' }, discount: { value: v.d ?? '0' }, discountMode: { value: v.mode ?? 'amount' }, addIva: { checked: !!v.iva } } });

test('total en vivo: descuento en $ o %, precio con comas y signo de pesos', () => {
  assert.equal(calc.chargeNum('$1,500.50'), 1500.5);
  const pct = calc.chargeMath(form({ p: '1,500', d: '10', mode: 'pct' }), null);
  assert.deepEqual([pct.gross, pct.disc, pct.base, pct.tax, pct.total], [1500, 150, 1350, 0, 1350]);
  const amt = calc.chargeMath(form({ q: '2', p: '300', d: '100' }), null);
  assert.deepEqual([amt.gross, amt.disc, amt.total], [600, 100, 500]);
});

test('IVA: lo decide la política del servicio; sólo concepto libre o servicio pendiente permiten marcar 16%', () => {
  const exento = { tax_treatment: 'exempt', fiscal_status: 'reviewed', sat_product_service_code: '85121800' };
  const tasa = { tax_treatment: 'rate', tax_rate: 0.16, fiscal_status: 'reviewed', sat_product_service_code: '85121800' };
  const pendiente = { tax_treatment: 'pending', fiscal_status: 'pending' };
  let m = calc.chargeMath(form({ p: '800', iva: true }), exento);
  assert.deepEqual([m.tax, m.total, m.autoTax], [0, 800, true], 'exento ignora la casilla');
  m = calc.chargeMath(form({ p: '3000', d: '100' }), tasa);
  assert.deepEqual([m.tax, m.total], [464, 3364], 'igual que el servidor: (3000-100)×16%');
  m = calc.chargeMath(form({ p: '100', q: '2', iva: true }), pendiente);
  assert.deepEqual([m.tax, m.total, m.autoTax], [32, 232, false]);
  m = calc.chargeMath(form({ p: '500' }), null);
  assert.deepEqual([m.tax, m.total], [0, 500]);
  assert.equal(calc.chargeTaxLabel(exento), 'IVA exento (servicio dental)');
  assert.equal(calc.chargeTaxLabel(tasa), 'IVA 16%');
});

test('facturable sólo con servicio revisado, clave SAT y política de IVA definida', () => {
  assert.equal(calc.chargeInvoiceable({ fiscal_status: 'reviewed', sat_product_service_code: '85121800', tax_treatment: 'exempt' }), true);
  assert.equal(calc.chargeInvoiceable({ fiscal_status: 'pending', sat_product_service_code: '85121800', tax_treatment: 'exempt' }), false);
  assert.equal(calc.chargeInvoiceable({ fiscal_status: 'reviewed', sat_product_service_code: null, tax_treatment: 'exempt' }), false);
  assert.equal(calc.chargeInvoiceable(null), false);
});

test('la ventana: errores dentro, citas del paciente, sucursal automática, vencimiento rápido y continuidad al pago (web y móvil)', () => {
  for (const base of ['', 'mobile/www/']) {
    const f = read(base + 'smyl-finance.js');
    assert.match(f, /data-form-error hidden/);
    assert.match(f, /catch\(err\)\{fail\(message\(err\)\);\}/);
    assert.match(f, /a\.patient_id===pid&&a\.status!=='cancelled'/);
    assert.match(f, /branches\.length<=1\?' hidden':''/);
    assert.match(f, /data-due="0">Hoy<\/button><button type="button" data-due="15">15 días/);
    assert.match(f, /Sin fecha: nunca aparecerá como vencido ni en «Por cobrar hoy»\./);
    assert.match(f, /data-mode="pay">Guardar y continuar al pago<\/button>/);
    assert.match(f, /if\(mode==='pay'&&state\.canManage\)openPayment\(pid\)/);
    assert.match(f, /p_tax_amount:m\.autoTax\?0:m\.tax/);
    assert.match(f, /select\('id,name,reference_price,fiscal_status,sat_product_service_code,tax_treatment,tax_rate'\)/);
  }
});

test('migración: el cargo guarda el snapshot fiscal del servicio, el servidor decide el IVA y respeta la firma original', () => {
  const mig = read('supabase/migrations/20261108110000_smyl_charge_fiscal_snapshot.sql');
  assert.match(mig, /p_discount_amount numeric default 0,p_tax_amount numeric default 0,p_due_on date default null\)/);
  assert.match(mig, /'sat_product_service_code',v_service\.sat_product_service_code/);
  assert.match(mig, /'tax_object_code',v_service\.tax_object_code,'fiscal_status',v_service\.fiscal_status/);
  assert.match(mig, /tax_treatment in \('exempt','non_object'\) then v_tax:=0/);
  assert.match(mig, /v_tax:=round\(v_base\*v_service\.tax_rate,2\)/);
  assert.match(mig, /El descuento no puede ser mayor que el importe/);
  assert.match(mig, /smyl_has_permission\(v_tenant,'finance\.manage'\)/);
  const wf = read('.github/workflows/smyl-cobros-migracion.yml');
  assert.match(wf, /20261108110000/);
  assert.match(wf, /cargo_fiscal_ok/);
});

test('buscador de pacientes en «Registrar cargo» y «Registrar pago», con búsqueda en el servidor y respaldo local (web y móvil)', () => {
  for (const base of ['', 'mobile/www/']) {
    const f = read(base + 'smyl-finance.js');
    assert.match(f, /function mountPatientPicker\(f\)\{/);
    assert.match(f, /window\.sb\.rpc\('smyl_search_patients',\{p_tenant_id:state\.tenant,p_query:query,p_limit:8\}\)/);
    assert.match(f, /show\(Array\.isArray\(rows\)\?rows:local\(query\),query\)/);
    assert.match(f, /mode=options\.mode==='charge'\?'charge':'pay';mountPatientPicker\(f\);/);
    assert.match(f, /allocationMode=options\.mode==='advance'\?'advance':'debt';mountPatientPicker\(f\);/);
    assert.match(f, /function openCharges\(\)/);
    assert.match(f, /input\.setCustomValidity\('Elige al paciente de la lista\.'\)/);
  }
});

test('Cobros ya no se limita a los primeros 500 pacientes: completa los nombres de quien tiene cargos, pagos o citas', () => {
  for (const base of ['', 'mobile/www/']) {
    const f = read(base + 'smyl-finance.js');
    assert.match(f, /async function ensurePatientNames\(\)\{/);
    assert.match(f, /\[state\.charges,state\.payments,state\.appointments,state\.proposals,state\.fiscal\]/);
    assert.match(f, /\.in\('id',ids\.slice\(i,i\+100\)\)/);
    assert.match(f, /state\.fiscalReadiness=rows\[19\]\|\|null;await ensurePatientNames\(\);state\.loaded=true;/);
  }
});
