import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261012360000_smyl_operational_readiness.sql');
const ui=read('../smyl-readiness.js');
const css=read('../smyl-readiness.css');
const docs=read('../docs/SMYL_OPERATIONS_RUNBOOK.md');
const app=read('../app.html');
const sw=read('../sw.js');

test('stage 7 readiness is tenant scoped, permissioned and contains no PHI',()=>{
  assert.match(sql,/function public\.smyl_operational_readiness_report\(\)/);
  assert.match(sql,/settings\.manage/g);
  assert.match(sql,/security definer[\s\S]*set search_path=pg_catalog,public/);
  assert.match(sql,/'contains_phi',false/);
  assert.match(sql,/revoke all on function[\s\S]*from public,anon/);
  assert.doesNotMatch(sql,/select \* from public\.camila_pacientes/i);
});

test('stage 7 approval is gated and auditable',()=>{
  for(const check of ['default_branch','branch_contact','licensed_professional','team_roles','cash_current','reminders_healthy']) assert.match(sql,new RegExp(check));
  assert.match(sql,/Completa los controles automáticos y manuales antes de aprobar/);
  assert.match(sql,/smyl_operational_readiness_audit/);
  assert.match(ui,/Centro de lanzamiento/);
  assert.match(ui,/Confirmaciones de la clínica/);
  assert.match(docs,/El Centro de lanzamiento no sustituye monitoreo externo/);
});

test('stage 7 web, mobile and offline assets stay synchronized',()=>{
  assert.match(app,/smyl-readiness\.js\?v=1/);
assert.match(sw,/smyl-v244-treatment-costs/);
  assert.match(sw,/smyl-readiness\.css\?v=1/);
  assert.equal(app,read('../mobile/www/app.html'));
  assert.equal(ui,read('../mobile/www/smyl-readiness.js'));
  assert.equal(css,read('../mobile/www/smyl-readiness.css'));
});
