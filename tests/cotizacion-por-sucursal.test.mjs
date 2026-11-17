import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261116190000_smyl_proposal_branch.sql');
const ui = read('smyl-proposals.js');
const fin = read('smyl-finance.js');
const print = read('smyl-proposal-print.js');

test('migración: columna de sucursal fuera del documento y función v3 que envuelve a v2 en la misma transacción', () => {
  assert.match(sql, /add column if not exists branch_id uuid/);
  assert.match(sql, /foreign key \(tenant_id, branch_id\)/);
  assert.match(sql, /result := public\.smyl_save_proposal_v2\(p_id, p_tenant_id, p_patient_id, p_plan_revision, p_expected_revision, p_document, p_approve\);/);
  assert.match(sql, /if p_approve and v_active > 1 and p_branch_id is null then/);
  assert.match(sql, /smyl_has_permission\(p_tenant_id, 'proposal\.write'\)/);
  assert.doesNotMatch(sql, /grant execute[^;]* to anon/);
});
test('propuestas: precio de la sede si existe, si no el del plan; lo escrito a mano no se pisa', () => {
  const fn = new Function('ctx', ui.match(/function branchUnitCents\(item,branchId\)\{[\s\S]*?\n  \}\n/)[0] + ';return branchUnitCents;');
  const f = fn({ branchPrices: [{ service_id: 's1', branch_id: 'norte', price: '950.00' }] });
  const item = { service_id: 's1', service_snapshot: { reference_price: 800 } };
  assert.equal(f(item, 'norte'), 95000);
  assert.equal(f(item, 'centro'), 80000);
  assert.equal(f({ service_id: null }, 'norte'), undefined);
  assert.match(ui, /if\(row\.dataset\.priceManual==='1'\)return;/);
  assert.match(ui, /if\(ev\.isTrusted\)row\.dataset\.priceManual='1';/);
});
test('propuestas: con varias sedes aprobar exige sucursal y guardar usa v3, con respaldo a v2 si falta la migración', () => {
  assert.match(ui, /Elige la sucursal donde se atenderá esta propuesta\./);
  assert.match(ui, /smyl_save_proposal_v3',Object\.assign\(\{\},args,\{p_branch_id:row\.branch_id\|\|null\}\)/);
  assert.match(ui, /return checked\(sb\.rpc\('smyl_save_proposal_v2',args\)\);/);
  assert.match(ui, /La sucursal no se guardó: falta actualizar la base de datos/);
});
test('vista del paciente y cobros usan la sucursal de la propuesta', () => {
  assert.match(ui, /withBranch\(row\);host\.replaceChildren/);
  assert.match(print, /row\.branch_label\?' · '\+row\.branch_label:''/);
  assert.match(fin, /document,branch_id'\)/);
  assert.match(fin, /opts\(state\.branches,'name',selected\.branch_id\|\|undefined\)/);
});

test('PDF y vista previa: dirección y teléfono de la sede, solo con varias sucursales', () => {
  assert.match(ui, /function withBranch\(row\)\{var multi=ctx&&ctx\.branches&&ctx\.branches\.length>1;row\.branch_label=multi\?branchLabel\(row\.branch_id\):'';row\.branch_detail=multi\?branchDetail\(row\.branch_id\):'';return row;\}/);
  assert.match(ui, /print\.replaceChildren|var print=document\.getElementById\('proposal-print'\);withBranch\(row\);/);
  assert.match(ui, /withBranch\(row\);host\.replaceChildren\(SmylProposalPrint\.render\(row,assets,false\)\);/);
  assert.match(ui, /select\('id,name,is_default,address_line,city,state,phone'\)/);
  assert.match(print, /Se atenderá en la sede '\+row\.branch_label\+\(row\.branch_detail\?' · '\+row\.branch_detail:''\)/);
});
