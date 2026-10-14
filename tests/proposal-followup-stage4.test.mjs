import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013060000_smyl_proposal_followup_v1.sql');
const ui=read('smyl-proposals.js');
const css=read('smyl-proposals.css');
const app=read('app.html');
const sw=read('sw.js');

test('el seguimiento separa aprobación profesional y decisión del paciente',()=>{
  assert.match(sql,/proposal\.followup/);
  assert.match(sql,/event_type in \('presented','accepted','declined','changes_requested'\)/);
  assert.match(sql,/Record presentation before the patient decision/);
  assert.match(sql,/not a digital signature or consent form/);
});

test('los eventos son append-only, idempotentes y protegidos por tenant',()=>{
  assert.match(sql,/create table public\.smyl_proposal_events/);
  assert.match(sql,/public\.smyl_has_permission\(tenant_id,'proposal\.read'\)/);
  assert.match(sql,/public\.smyl_has_permission\(v_tenant,'proposal\.followup'\)/);
  assert.match(sql,/where tenant_id=v_tenant and id=p_event_id/);
  assert.match(sql,/Only the current approved proposal can be followed up/);
  assert.match(sql,/revoke all on table public\.smyl_proposal_events from public,anon,authenticated/);
  assert.doesNotMatch(sql,/grant (insert|update|delete) on table public\.smyl_proposal_events/i);
});

test('la interfaz registra medio, nota y estado sin afirmar consentimiento',()=>{
  for(const text of ['Presentada al paciente','Aceptada por el paciente','No aceptada','Solicitó cambios','Registrar seguimiento'])assert.match(ui,new RegExp(text));
  assert.match(ui,/smyl_record_proposal_event/);
  assert.match(ui,/No sustituye firma, consentimiento informado ni autorización clínica/);
  assert.match(ui,/proposal-decision-state/);
  assert.match(css,/proposal-tracking/);
  assert.match(css,/data-state="accepted"/);
});

test('web, móvil y PWA publican la misma etapa de seguimiento',()=>{
  assert.match(app,/smyl-proposals\.css\?v=5/);
  assert.match(app,/smyl-proposals\.js\?v=9/);
  assert.match(sw,/smyl-v204-proposal-followup/);
  assert.equal(app,read('mobile/www/app.html'));
  assert.equal(ui,read('mobile/www/smyl-proposals.js'));
  assert.equal(css,read('mobile/www/smyl-proposals.css'));
  assert.equal(sw,read('mobile/www/sw.js'));
});
