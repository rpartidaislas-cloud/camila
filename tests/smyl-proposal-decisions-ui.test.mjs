import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const Model=require('../smyl-proposal-model.js');
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

const document={
  schema:2,title:'Plan',introduction:'',terms:'Condiciones',valid_until:'2030-01-01',photos:null,
  items:[
    {id:'quote-a',treatment_id:'T1',service_id:null,service_revision:null,service_snapshot:null,teeth:[],surfaces:[],label:'Limpieza',area:'',quantity:1,unit_cents:100000,currency:'MXN'},
    {id:'quote-b',treatment_id:'T2',service_id:null,service_revision:null,service_snapshot:null,teeth:[],surfaces:[],label:'Restauración',area:'',quantity:2,unit_cents:75000,currency:'MXN'},
    {id:'quote-c',treatment_id:null,service_id:null,service_revision:null,service_snapshot:null,teeth:[],surfaces:[],label:'Control',area:'',quantity:1,unit_cents:50000,currency:'MXN'}
  ]
};

test('treatment_id histórico se interpreta como línea del plan, no como capítulo',()=>{
  assert.equal(Model.planItemId(document.items[0]),'T1');
  assert.equal(Model.planItemId({plan_item_id:'T9',treatment_id:'legacy'}),'T9');
  const metadata=Model.metadata({plan_item_id:'T4'},0);
  assert.equal(metadata.treatment_id,'T4');
  assert.equal(Object.hasOwn(metadata,'plan_item_id'),false,'schema 2 conserva la clave serializada histórica');
});

test('el resumen separa importes aceptados, pendientes y rechazados',()=>{
  const rows=[
    {proposal_item_id:'quote-a',item_status:'accepted'},
    {proposal_item_id:'quote-b',item_status:'pending'},
    {proposal_item_id:'quote-c',item_status:'declined'}
  ];
  const summary=Model.decisionSummary(document,{id:'decision-1'},rows,null);
  assert.deepEqual({state:summary.state,accepted:summary.acceptedCents,pending:summary.pendingCents,rejected:summary.rejectedCents,canActivate:summary.canActivate},{state:'partial',accepted:100000,pending:150000,rejected:50000,canActivate:true});
  assert.deepEqual([summary.acceptedCount,summary.pendingCount,summary.rejectedCount],[1,1,1]);
});

test('eventos históricos completos siguen siendo compatibles',()=>{
  const accepted=Model.decisionSummary(document,null,[],{event_type:'accepted'});
  assert.equal(accepted.state,'accepted');
  assert.equal(accepted.acceptedCents,300000);
  assert.equal(accepted.canActivate,true);
});

test('la interfaz guarda una decisión por concepto y expone resumen canónico',()=>{
  const ui=read('smyl-proposals.js');
  assert.match(ui,/smyl_record_proposal_decision_v1/);
  for(const arg of ['p_accepted_item_ids','p_rejected_item_ids','p_pending_item_ids'])assert.match(ui,new RegExp(arg));
  assert.match(ui,/Guardar decisión/);
  assert.match(ui,/Solo lo aceptado podrá convertirse en cargos/);
  assert.match(ui,/input\.name='proposal-line-decision-'\+index/, 'cada concepto tiene su propio grupo de radio');
  assert.match(ui,/summary:function\(patientId,treatmentId\)/);
  assert.match(ui,/if\(treatmentId\)return null/, 'un capítulo explícito no hereda el resumen de otro');
  assert.match(ui,/primeSummary:primeSummary/, 'el expediente puede precargar la decisión sin abrir Cotizaciones');
  assert.match(ui,/proposalSummaryFreshness/, 'una cotización antigua no pisa el resumen más reciente');
  assert.match(ui,/smyl_clinical_versions/);
  assert.match(ui,/Histórica · solo lectura/);
  assert.match(ui,/smyl:proposal-decision-updated/);
  assert.match(ui,/smyl_save_proposal_v4/);
});

test('Finanzas usa la decisión y nunca convierte los conceptos pendientes',()=>{
  const finance=read('smyl-finance.js');
  assert.match(finance,/function proposalAcceptedItems/);
  assert.match(finance,/smyl_post_proposal_decision_charges_v1/);
  assert.match(finance,/p_decision_id:decision\.id/);
  assert.match(finance,/p_simulation_charge_id:simCredit\|\|null/);
  assert.match(finance,/options&&options\.decisionId&&!refreshed/);
  assert.match(finance,/Los pendientes y no aceptados no se cobrarán/);
  assert.match(finance,/items=proposalAcceptedItems\(selected\)\|\|/);
  assert.match(finance,/simulationCredit\(selected,items\)/, 'el crédito solo se ofrece si las carillas están aceptadas');
});

test('la presentación y la decisión tienen una jerarquía limpia y táctil',()=>{
  const css=read('smyl-proposals.css');
  for(const selector of ['proposal-line-decisions','proposal-line-decision','proposal-line-options','proposal-decision-totals'])assert.match(css,new RegExp(selector));
  assert.match(css,/proposal-line-option[^}]*min-height:44px/);
  assert.match(css,/data-state="partial"/);
});
