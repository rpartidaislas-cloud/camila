import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const sql = read('../supabase/migrations/20261123110500_smyl_simulation_billing.sql');

test('la simulación se cobra una vez, con el precio del catálogo y ligada a la simulación guardada', () => {
  assert.match(sql, /add column if not exists simulation_case_id uuid references public\.smyl_patient_case_archive\(id\)/);
  assert.match(sql, /smyl_finance_charges_simulation_case_open_idx[\s\S]{0,160}where simulation_case_id is not null and status = 'open'/);
  assert.match(sql, /function public\.smyl_post_simulation_charge\(p_id uuid, p_idempotency_key uuid, p_case_id uuid, p_branch_id uuid default null\)/);
  assert.match(sql, /smyl_has_permission\(v_tenant,'finance\.manage'\)/);
  assert.match(sql, /template_key='aesthetic-smile-simulation' and active/);
  assert.match(sql, /public\.smyl_post_charge\(p_id,p_idempotency_key,v_case\.patient_id/, 'reutiliza el cargo estándar (fiscal e impuestos)');
  assert.match(sql, /grant execute on function public\.smyl_post_simulation_charge\(uuid,uuid,uuid,uuid\) to authenticated/);
  assert.match(sql, /revoke all on function public\.smyl_is_veneer_service\(uuid,jsonb\) from public,anon,authenticated/);
});

test('el descuento de la simulación solo aplica a carillas y una sola vez', () => {
  const v2 = sql.slice(sql.indexOf('function public.smyl_post_proposal_charges_v2'));
  assert.match(v2, /p_simulation_charge_id uuid default null/);
  assert.match(v2, /v_sim\.patient_id<>v_proposal\.patient_id/, 'mismo paciente');
  assert.match(v2, /simulation_credit_charge_id=p_simulation_charge_id and status='open'/, 'no se usa dos veces');
  assert.match(v2, /La propuesta no incluye carillas/);
  assert.match(v2, /least\(v_left,v_line-0\.01\)/, 'ninguna línea queda en cero');
  assert.match(v2, /v_qty,v_unit,v_disc,0,v_line-v_disc/);
  assert.match(v2, /v_total-v_credit/, 'el lote registra el total ya descontado');
  // La aceptación del paciente sigue siendo obligatoria, como en la versión original.
  assert.match(v2, /Registra la aceptación del paciente/);
  assert.match(sql, /smyl_finance_charges_simulation_credit_open_idx[\s\S]{0,180}where simulation_credit_charge_id is not null and status = 'open'/);
  // La función original no se toca.
  assert.doesNotMatch(sql, /create or replace function public\.smyl_post_proposal_charges\(/);
});

test('ficha, cobros y catálogo usan el cobro y el descuento', () => {
  const catalog = read('../smyl-service-catalog-model.js');
  assert.match(catalog, /p\('aesthetic-smile-simulation','aesthetic','Simulación de diseño de sonrisa'/);
  assert.match(catalog, /p\('periodontic-gingivoplasty','periodontic','Gingivoplastia \/ contorneado gingival'/);
  const ficha = read('../smyl-patient-360.js');
  assert.match(ficha, /data-p360-tab="smile" data-p360-clinical>Diseño de sonrisa</);
  assert.match(ficha, /treatment:\[\],smile:\['simulations'\]/);
  assert.match(ficha, /if\(key==='simulations'\)key='smile';/);
  const cases = read('../smyl-patient-cases.js');
  assert.match(cases, /smyl_patient_simulation_billing/);
  assert.match(cases, /smyl_post_simulation_charge/);
  assert.match(cases, /Cobrar simulación/);
  const finance = read('../smyl-finance.js');
  assert.match(finance, /simCredit\?'smyl_post_proposal_charges_v2':'smyl_post_proposal_charges'/);
  assert.match(finance, /name="simcredit" type="checkbox"[^>]*checked/);
  for (const f of ['smyl-patient-360.js', 'smyl-patient-cases.js', 'smyl-patient-cases.css', 'smyl-finance.js', 'smyl-service-catalog-model.js', 'app.html', 'sw.js']) {
    assert.equal(read('../mobile/www/' + f), read('../' + f), f + ' sincronizado');
  }
});
