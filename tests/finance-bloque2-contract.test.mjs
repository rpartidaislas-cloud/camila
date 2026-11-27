import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('smyl-finance.js');
const recon = read('supabase/migrations/20261127150000_smyl_cash_close_reconciliation.sql');
const summaries = read('supabase/migrations/20261127170000_smyl_finance_account_summaries.sql');
const check = read('supabase/migrations/20261127180000_smyl_finance_deploy_check.sql');

test('el cierre de caja manda la conciliación estructurada y la migración la recibe', () => {
  assert.match(js, /p_reconciliation:recon/);
  assert.match(recon, /close_reconciliation jsonb/);
  assert.match(recon, /smyl_close_cash_session\(uuid, ?integer, ?numeric, ?text\)/);
  assert.match(recon, /smyl_cash_expected/);
});

test('los saldos por servidor son SECURITY INVOKER (RLS) y solo para usuarios autenticados', () => {
  assert.equal((summaries.match(/security invoker/g) || []).length, 3);
  assert.doesNotMatch(summaries, /security definer/);
  assert.match(summaries, /revoke all on function public\.smyl_finance_account_summaries[^;]*from public, anon;/);
  for (const fn of ['smyl_finance_account_summaries', 'smyl_finance_account_counts']) assert.ok(js.includes("'" + fn + "'"), fn);
});

test('el modo servidor solo se activa cuando el navegador rebasó el tope', () => {
  assert.match(js, /function serverMode\(\)\{return state\.truncated\.length>0&&state\.canRead&&Boolean\(window\.sb\);\}/);
  assert.match(js, /window\.__smylFinancePageCap/);
});

test('el verificador de despliegue cubre las tres migraciones nuevas y solo lo usa service_role', () => {
  for (const m of ['20261127150000_smyl_cash_close_reconciliation', '20261127170000_smyl_finance_account_summaries']) assert.ok(check.includes(m), m);
  assert.match(check, /grant execute on function public\.smyl_finance_deploy_check\(\) to service_role;/);
  assert.match(check, /revoke all on function public\.smyl_finance_deploy_check\(\) from public, anon, authenticated;/);
});
