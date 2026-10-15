import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const read=(path)=>readFileSync(resolve(here,path),'utf8');
const migration=read('../supabase/migrations/20261013080000_smyl_treatment_operations_v1.sql');
const reports=read('../smyl-reports.js');
const css=read('../smyl-reports.css');
const app=read('../app.html');
const sw=read('../sw.js');

test('agenda acepta el origen de una cotización aceptada',()=>{
  assert.match(migration,/smyl_appointments_source_check/);
  assert.match(migration,/accepted_proposal/);
});

test('el recorrido operativo es agregado, acotado y respeta permisos',()=>{
  assert.match(migration,/smyl_treatment_operations\(p_from date,p_to date\)/);
  assert.match(migration,/p_to-p_from>366/);
  for(const permission of ['clinic.read','proposal.read','finance.read','schedule.read','clinical.read']) assert.match(migration,new RegExp(permission.replace('.','\\.')));
  assert.match(migration,/'scope','milestones_in_period'/);
  assert.doesNotMatch(migration,/patient_name|patient_email|phone|diagnosis/);
  assert.match(migration,/not a cohort conversion funnel/);
});

test('reportes explica cinco hitos sin presentarlos como conversión clínica',()=>{
  for(const label of ['Cotizaciones aceptadas','Lotes de cargos creados','Primeras citas agendadas','Citas completadas','Evoluciones firmadas']) assert.match(reports,new RegExp(label));
  assert.match(reports,/No es una cohorte ni mide resultados clínicos/);
  assert.match(reports,/requiere permiso del módulo/);
  assert.match(css,/reports-treatment-steps/);
  assert.match(css,/@media\(max-width:680px\)/);
});

test('cierre profesional mantiene paridad web, móvil y PWA',()=>{
  assert.match(app,/smyl-reports\.js\?v=4/);
  assert.match(app,/smyl-reports\.css\?v=3/);
  assert.match(sw,/smyl-v246-inbox-appointments/);
  assert.match(sw,/smyl-reports\.js\?v=4/);
  assert.equal(reports,read('../mobile/www/smyl-reports.js'));
  assert.equal(css,read('../mobile/www/smyl-reports.css'));
});
