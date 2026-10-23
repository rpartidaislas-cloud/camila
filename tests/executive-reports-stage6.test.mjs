import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sql=read('../supabase/migrations/20261012350000_smyl_executive_reports.sql');
const ui=read('../smyl-reports.js');
const css=read('../smyl-reports.css');
const app=read('../app.html');
const sw=read('../sw.js');

test('stage 6 aggregates without exposing patient records',()=>{
  assert.match(sql,/function public\.smyl_executive_dashboard\(p_from date,p_to date,p_branch_id uuid/);
  assert.match(sql,/p_to-p_from>366/);
  for(const permission of ['clinic.read','schedule.read','finance.read','inventory.read']) assert.match(sql,new RegExp(permission.replace('.','\\.')));
  assert.match(sql,/security definer stable set search_path=pg_catalog,public/);
  assert.doesNotMatch(sql,/select \* from public\.camila_pacientes/i);
  assert.match(sql,/revoke all on function[\s\S]*from public,anon/);
});

test('stage 6 reports agenda, finance and inventory with explicit permission states',()=>{
  assert.match(ui,/Ingresos netos/);
  assert.match(ui,/Asistencia/);
  assert.match(ui,/Insumos bajo mínimo/);
  assert.match(ui,/No expone|sin exponer expedientes clínicos/i);
  assert.match(ui,/requiere finance\.read/);
  assert.match(ui,/Exportar CSV/);
  assert.match(css,/@media\(max-width:680px\)/);
});

test('stage 6 web, mobile and offline assets stay synchronized',()=>{
  assert.match(app,/smyl-reports\.js\?v=4/);
  assert.match(sw,/smyl-v261-secure-checkout/);
  assert.match(sw,/smyl-reports\.css\?v=4/);
  assert.equal(app,read('../mobile/www/app.html'));
  assert.equal(ui,read('../mobile/www/smyl-reports.js'));
  assert.equal(css,read('../mobile/www/smyl-reports.css'));
});
