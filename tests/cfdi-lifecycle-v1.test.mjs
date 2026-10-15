import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),read=p=>readFileSync(resolve(root,p),'utf8');
const sql=read('supabase/migrations/20261013030000_smyl_cfdi_lifecycle_v1.sql');
const ui=read('smyl-finance.js');

test('el centro fiscal separa emisor, receptor y preparación PAC',()=>{
  for(const table of ['smyl_issuer_fiscal_profiles','smyl_cfdi_pac_readiness','smyl_cfdi_cancellation_plans'])assert.match(sql,new RegExp(`create table public\\.${table}`));
  assert.match(sql,/add column issuer_snapshot/);
  assert.match(sql,/smyl_prepare_cfdi_draft_v3/);
  assert.match(sql,/Completa y revisa los datos fiscales del emisor/);
  assert.match(sql,/smyl_cfdi_readiness_report/);
});

test('la preparación PAC no almacena secretos ni afirma conexión',()=>{
  assert.match(sql,/stores no secrets or certificates/i);
  assert.doesNotMatch(sql,/client_secret|private_key|certificate_pem|password|api_key/i);
  assert.match(ui,/Las credenciales y certificados nunca deben capturarse aquí/);
  assert.match(ui,/No se conectó ni se enviaron credenciales a un PAC/);
});

test('cancelación exige CFDI emitido y reglas SAT de motivo 01',()=>{
  assert.match(sql,/status<>'issued'/);
  assert.match(sql,/reason_code in \('01','02','03','04'\)/);
  assert.match(sql,/reason_code='01' and replacement_uuid is not null/);
  assert.match(sql,/Creates a local cancellation plan only\. No PAC\/SAT transmission/);
  assert.match(ui,/Planear cancelación/);
  assert.match(ui,/esto no cancela el CFDI/i);
});

test('la prevalidación v2 incluye datos del emisor y mantiene frontera local',()=>{
  assert.match(sql,/smyl_local_cfdi_4_rules_v2/);
  for(const field of ['issuer_rfc','issuer_name','issuer_postal','issuer_regime'])assert.match(sql,new RegExp(field));
  assert.match(sql,/requires_pac_catalog_validation',true/);
  assert.doesNotMatch(sql,/https?:\/\//i);
});

test('web y móvil conservan paridad fiscal',()=>{
  for(const file of ['app.html','sw.js','smyl-finance.js','smyl-finance.css'])assert.equal(read(file),read('mobile/www/'+file));
});
