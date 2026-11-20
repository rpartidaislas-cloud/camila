import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const M=require('../smyl-proposal-model.js');
const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('smyl-proposals.js');
const today='2026-11-20';
const plan={revision:3,status:'reviewed'};
const row=(over={})=>({id:'p1',patient_id:'pt1',plan_revision:3,revision:1,status:'approved',document:{valid_until:'2026-12-31'},...over});
const ev=(type)=>({event_type:type,occurred_at:'2026-11-10T18:00:00Z'});
const key=(input)=>M.stage({today,plan,...input}).key;

test('borrador, lista, presentada y vencida conservan su significado',()=>{
  assert.equal(key({row:row({status:'draft'})}),'draft');
  assert.equal(key({row:row()}),'ready');
  assert.equal(key({row:row(),event:ev('presented')}),'awaiting');
  assert.equal(key({row:row({document:{valid_until:'2026-11-01'}}),event:ev('presented')}),'expired');
  assert.equal(key({row:row(),event:ev('changes_requested')}),'changes_requested');
});

test('si el plan cambió después de cotizar, la cotización abierta pide actualizarse',()=>{
  assert.equal(key({row:row({plan_revision:2})}),'stale');
  assert.equal(key({row:row({status:'draft',plan_revision:2})}),'stale');
  assert.equal(M.stage({today,row:row(),plan:{revision:3,status:'draft'}}).key,'stale');
  // Una decisión ya registrada no se reabre por un cambio posterior del plan.
  assert.equal(key({row:row({plan_revision:2}),event:ev('accepted')}),'accepted');
  assert.equal(key({row:row({plan_revision:2}),event:ev('declined')}),'declined');
  // Sin datos del plan no se inventa el aviso.
  assert.equal(M.stage({today,row:row({plan_revision:2})}).key,'ready');
});

test('las respuestas en el enlace compartido piden acción del equipo',()=>{
  assert.equal(key({row:row(),share:{accepted:'2026-11-19T10:00:00Z'}}),'link_accepted');
  assert.equal(key({row:row(),event:ev('presented'),share:{interested:'2026-11-19T10:00:00Z'}}),'interested');
  assert.equal(key({row:row({document:{valid_until:'2026-11-01'}}),share:{interested:'2026-11-19T10:00:00Z'}}),'interested');
  assert.equal(key({row:row(),event:ev('accepted'),share:{accepted:'2026-11-19T10:00:00Z'}}),'accepted');
});

test('aceptada pasa a "en tratamiento" cuando ya hay cargos en Finanzas',()=>{
  const accepted=M.stage({today,plan,row:row(),event:ev('accepted')});
  assert.equal(accepted.key,'accepted');assert.equal(accepted.action,true);assert.match(accepted.detail,/iniciar el tratamiento/);
  const converted=M.stage({today,plan,row:row(),event:ev('accepted'),batch:{created_at:'2026-11-12T16:00:00Z'}});
  assert.equal(converted.key,'converted');assert.equal(converted.action,false);
  const noFinance=M.stage({today,plan,row:row(),event:ev('accepted'),financeVisible:false});
  assert.equal(noFinance.action,false);assert.doesNotMatch(noFinance.detail,/iniciar el tratamiento/);
});

test('el módulo crea cotizaciones solo eligiendo paciente y respeta el plan revisado',()=>{
  assert.match(ui,/SmylCareTasks\.open\('quote'\)/);
  assert.match(ui,/proposal-new/);
  assert.match(ui,/proposal-plan-gate/);
  assert.match(ui,/window\.verPaciente\(patient\.id\)/);
  assert.match(ui,/M\.stage\(/);
  assert.match(ui,/smyl_proposal_charge_batches/);
  assert.match(ui,/finance:perms\.has\('finance\.read'\)/);
});

test('confirmar una aceptación por enlace registra presentada y aceptada, con confirmación humana',()=>{
  const fn=ui.slice(ui.indexOf('async function confirmLinkAcceptance'),ui.indexOf('function actionsFor'));
  assert.match(fn,/confirm\(/);
  assert.match(fn,/record\(item,'presented'/);
  assert.match(fn,/record\(item,'accepted'/);
  assert.match(fn,/No sustituye el consentimiento informado/);
});

// ── Fase 6: iniciar tratamiento en un solo recorrido ──
const finance=read('smyl-finance.js');
test('aceptada: «Iniciar tratamiento» crea cargos y guía a anticipo y primera cita',()=>{
  assert.match(ui,/b\('Iniciar tratamiento',function\(\)\{window\.SmylFinance\.fromProposal\(item\.row\.id,\{guided:true\}\)/);
  assert.match(ui,/key==='converted'&&access\.finance/);
  assert.match(finance,/fromProposal:function\(id,options\)/);
  assert.match(finance,/if\(options\.guided\)treatmentSteps\(proposal,batch,false\);else openAccount/);
  const steps=finance.slice(finance.indexOf('function treatmentSteps'),finance.indexOf('async function openProposalCharge'));
  for(const text of ['Cobrar anticipo','Agendar primera cita','Ver cuenta','Terminar'])assert.match(steps,new RegExp(text));
  assert.match(steps,/openPayment\(pid,\{mode:'balance',after:canSchedule\?'schedule':''\}\)/);
  assert.match(steps,/if\(!state\.canManage\)pay\.disabled=true/);
});
test('el cobro guiado ofrece agendar como siguiente paso, sin hacerlo solo',()=>{
  assert.match(finance,/function paymentSuccess\(payment,receipt,snapshot,after\)/);
  assert.match(finance,/after==='schedule'\?'<button type="button" class="btn btn-primary" data-success-schedule>Siguiente: agendar primera cita/);
  assert.match(finance,/receipt,snapshot,options\.after\);/);
});
test('una cotización ya convertida no duplica cargos al reabrir el recorrido',()=>{
  assert.match(finance,/if\(existing&&options\.guided&&existing\.proposal_id===proposalId\)\{treatmentSteps\(selected,existing,true\);return;\}/);
});
