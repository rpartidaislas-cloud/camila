import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261116160000_smyl_service_branch_prices.sql');
const fin = read('smyl-finance.js');
const cat = read('smyl-service-catalog.js');
const priceFor = new Function('state', fin.match(/function priceFor\(service,branchId\)\{[^\n]*\n/)[0] + ';return priceFor;');

test('migración: excepción de precio por sede con llave compuesta, lectura por permisos y escritura solo con catalog.prices', () => {
  assert.match(sql, /primary key \(tenant_id, service_id, branch_id\)/);
  assert.match(sql, /price numeric\(12,2\) not null check \(price >= 0\)/);
  assert.match(sql, /smyl_has_permission\(v_tenant, 'catalog\.prices'\)/);
  assert.match(sql, /grant select on public\.smyl_service_branch_prices to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]* to authenticated/);
  assert.match(sql, /if p_price is null then\s+delete from/);
});
test('cobros: el precio de la sede manda y, sin excepción, se usa el precio base', () => {
  const state = { branchPrices: [{ service_id: 's1', branch_id: 'norte', price: '950.00' }] };
  const f = priceFor(state);
  const svc = { id: 's1', reference_price: '800' };
  assert.equal(f(svc, 'norte'), 950);
  assert.equal(f(svc, 'centro'), 800);
  assert.equal(f(svc, null), 800);
  assert.equal(f({ id: 's2', reference_price: null }, 'norte'), null);
  assert.equal(f(null, 'norte'), null);
});
test('cobros: al cambiar de sucursal se actualiza el precio solo si la persona no lo editó a mano', () => {
  assert.match(fin, /if\(e\.isTrusted\)priceTouched=true;/);
  assert.match(fin, /f\.elements\.branch\.addEventListener\('change',function\(\)\{var s=service\(\);if\(!s\|\|priceTouched\)return;/);
  assert.match(fin, /Number\(priceFor\(sv,a\.branch_id\)\)/);
});
test('catálogo: bloque «Precio por sucursal» solo con permiso, con varias sedes y servicio ya guardado; guarda con el RPC', () => {
  assert.match(cat, /if\(!existing\|\|!state\.canPrices\|\|state\.branches\.length<2\)return '';/);
  assert.match(cat, /smyl_set_service_branch_price',\{p_service_id:existing\.id,p_branch_id:changes\[i\]\[0\],p_price:changes\[i\]\[1\]\}/);
  assert.match(cat, /varía por sede/);
});
