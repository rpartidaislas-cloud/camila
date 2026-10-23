import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013070000_smyl_treatment_activation_v1.sql');
const proposals=read('smyl-proposals.js');
const schedule=read('smyl-schedule.js');
const finance=read('smyl-finance.js');
const css=read('smyl-proposals.css');
const app=read('app.html');
const sw=read('sw.js');

test('los cargos nuevos exigen aceptación de la revisión vigente en servidor',()=>{
  assert.match(sql,/smyl_proposal_events/);
  assert.match(sql,/proposal_revision=p_proposal_revision and event_type='accepted'/);
  assert.match(sql,/Registra la aceptación del paciente para esta versión antes de crear cargos/);
  assert.match(sql,/Preserve idempotency for batches created before this rule/);
  assert.match(sql,/public\.smyl_has_permission\(v_tenant,'finance\.manage'\)/);
});

test('la activación separa aceptación, caja y agenda',()=>{
  for(const text of ['ACTIVACIÓN','Iniciar tratamiento','Crear cargos en Caja','Agendar primera cita','Aprobar internamente no autoriza cargos ni citas'])assert.match(proposals,new RegExp(text));
  assert.match(proposals,/function acceptedCurrent/);
  assert.match(proposals,/SmylFinance\.fromProposal\(ctx\.row\.id\)/);
  assert.match(proposals,/SmylSchedule\.forPatient\(ctx\.row\.patient_id\)/);
  assert.match(proposals,/La aceptación no sustituye el consentimiento informado/);
  assert.match(css,/proposal-activation/);
});

test('agenda recibe al paciente pero vuelve a validar permiso y disponibilidad',()=>{
  assert.match(schedule,/forPatient:function\(patientId\)/);
  assert.match(schedule,/if\(!state\.canManage\)return notify\('Tu rol no permite confirmar citas/);
  assert.match(schedule,/p_source:patientId\?'accepted_proposal':'manual'/);
  assert.match(schedule,/Viene de una cotización aceptada/);
});

test('caja sólo muestra cotizaciones aceptadas o lotes ya existentes',()=>{
  assert.match(finance,/event_type','accepted'/);
  assert.match(finance,/acceptedKeys\.has\(p\.id\+'[:]'\+p\.revision\)\|\|proposalBatch\(p\)/);
  assert.match(finance,/La versión seleccionada todavía no tiene una aceptación registrada/);
  assert.match(finance,/Crear cargos desde cotización aceptada/);
});

test('web, móvil y PWA distribuyen la activación de tratamiento',()=>{
  assert.match(app,/smyl-proposals\.css\?v=9/);
  assert.match(app,/smyl-proposals\.js\?v=12/);
  assert.match(app,/smyl-schedule\.js\?v=(?:1[1-9]|[2-9][0-9])/);
  assert.match(app,/smyl-finance\.js\?v=8/);
  assert.match(sw,/smyl-v260-usage-history/);
  for(const file of ['app.html','sw.js','smyl-proposals.js','smyl-proposals.css','smyl-schedule.js','smyl-finance.js'])assert.equal(read(file),read('mobile/www/'+file));
});
