import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const migration=read('supabase/migrations/20261013020000_smyl_proposal_finance_v1.sql');
const finance=read('smyl-finance.js');
const proposals=read('smyl-proposals.js');

test('la conversión de propuesta es atómica e idempotente por versión',()=>{
  assert.match(migration,/create table public\.smyl_proposal_charge_batches/);
  assert.match(migration,/unique\(tenant_id,proposal_id,proposal_revision\)/);
  assert.match(migration,/create function public\.smyl_post_proposal_charges/);
  assert.match(migration,/status<>'approved'/);
  assert.match(migration,/proposal_item_id/);
  assert.match(migration,/source_snapshot/);
  assert.match(migration,/service_snapshot/);
  assert.match(migration,/for update/);
});

test('el borrador CFDI 4.0 congela receptor y conceptos pagados',()=>{
  assert.match(migration,/create function public\.smyl_prepare_cfdi_draft_v2/);
  assert.match(migration,/concepts_snapshot/);
  assert.match(migration,/'cfdi_version'[\s\S]*'4\.0'|cfdi_version text not null default '4\.0'/);
  for(const field of ['legal_name','rfc','fiscal_regime','tax_postal_code','cfdi_use','product_service_code','unit_code','tax_object_code'])assert.match(migration,new RegExp(field));
  assert.match(migration,/El pago debe estar aplicado por completo/);
});

test('la prevalidación permanece local y exige revisión posterior del PAC',()=>{
  assert.match(migration,/create function public\.smyl_validate_cfdi_draft_sandbox/);
  assert.match(migration,/requires_pac_catalog_validation',true/);
  assert.match(migration,/Local CFDI 4\.0 preflight only/);
  assert.doesNotMatch(migration,/https?:\/\//i);
  assert.doesNotMatch(migration,/status\s*=\s*'(issued|stamped|submitted)'/i);
});

test('la interfaz conecta propuesta, caja y revisión fiscal sin transmisión automática',()=>{
  assert.match(finance,/Desde aceptada/);
  assert.match(finance,/smyl_post_proposal_charges/);
  assert.match(finance,/smyl_prepare_cfdi_draft_v3/);
  assert.match(finance,/smyl_validate_cfdi_draft_sandbox/);
  assert.match(finance,/no consulta, timbra ni envía información al SAT o a un PAC/i);
  assert.match(proposals,/Crear cargos en Caja/);
  assert.match(proposals,/SmylFinance\.fromProposal/);
});

test('web y móvil publican exactamente la misma etapa',()=>{
  for(const file of ['app.html','sw.js','smyl-finance.js','smyl-finance.css','smyl-proposals.js'])assert.equal(read(file),read('mobile/www/'+file));
});
