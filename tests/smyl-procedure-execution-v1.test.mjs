import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261128150000_smyl_procedure_execution_v1.sql');

test('la aceptación no completa el procedimiento y la firma sí lo concluye',()=>{
  assert.match(sql,/item_status = 'accepted'/);
  assert.match(sql,/status in \('accepted','in_progress','deferred','cancelled','completed'\)/);
  assert.match(sql,/Firma la nota clínica antes de completar el procedimiento/);
  assert.match(sql,/smyl_complete_procedure_on_note_signature/);
  assert.match(sql,/old\.status is distinct from 'signed' and new\.status = 'signed'/);
  assert.doesNotMatch(sql,/item_status = 'pending'[\s\S]*insert into public\.smyl_procedure_executions/);
});

test('el origen aceptado es inmutable y el consentimiento se comprueba en servidor',()=>{
  assert.match(sql,/El origen aceptado del procedimiento es inmutable/);
  assert.match(sql,/smyl_informed_consents c[\s\S]*c\.revoked_at is null/);
  assert.match(sql,/coalesce\(v_procedure->>'type', ''\) = 'surgery'/);
  assert.match(sql,/Vincula un consentimiento informado vigente/);
  assert.match(sql,/accepted_item', v_execution\.item_snapshot/);
});

test('la evidencia se vincula por referencia, sin copiar el archivo',()=>{
  assert.match(sql,/procedure_execution/);
  assert.match(sql,/smyl_link_procedure_evidence_v1/);
  assert.match(sql,/v_study\.patient_id = v_execution\.patient_id|patient_id = v_execution\.patient_id/);
  assert.doesNotMatch(sql,/insert into public\.smyl_patient_files/);
});

test('la UI muestra estados, usa consentimiento real y crea nota atómica',()=>{
  const ui=read('smyl-procedure-safety.js'),caseUi=read('smyl-case-workspace.js');
  assert.match(ui,/smyl_sync_procedure_executions_v1/);
  assert.match(ui,/smyl_create_procedure_note_v1/);
  assert.match(ui,/smyl_list_informed_consents/);
  assert.match(ui,/p_expected_revision: row\.revision/);
  assert.match(ui,/Borrador pendiente de firma/);
  assert.doesNotMatch(ui,/type="checkbox" data-ps="consent"/);
  assert.match(caseUi,/renderAccepted/);
  assert.match(caseUi,/Registrar siguiente procedimiento/);
});

const require=createRequire(import.meta.url);let pgliteEntry;
try{pgliteEntry=require.resolve('@electric-sql/pglite',{paths:[...(process.env.SMYL_PGLITE_DIR?[resolve(process.env.SMYL_PGLITE_DIR)]:[]),resolve('.')]});}
catch(error){if(error.code!=='MODULE_NOT_FOUND'||process.env.SMYL_REQUIRE_PGLITE==='1')throw error;}

test('PostgreSQL materializa sólo aceptados y completa al firmar',{skip:pgliteEntry?false:'Define SMYL_PGLITE_DIR para ejecutar el contrato.'},async t=>{
  const {PGlite}=await import(pathToFileURL(pgliteEntry).href);const db=new PGlite();t.after(()=>db.close());
  await db.exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await db.exec(read('tests/fixtures/treatment-v2-stubs.sql'));
  await db.exec(read('supabase/migrations/20261128140000_smyl_treatment_v2.sql'));
  await db.exec(read('tests/fixtures/procedure-execution-v1-stubs.sql'));
  await db.exec(sql);
  const {SENTINELAS}=await import('../scripts/migration-sentinels.mjs');
  assert.equal((await db.query(SENTINELAS['20261128150000'].sentinel)).rows[0].ok,true);
  await db.exec(read('tests/fixtures/treatment-v2-scenarios.sql'));
  await db.exec(`select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false); set role authenticated;`);
  const synced=await db.query(`select * from public.smyl_sync_procedure_executions_v1(
    '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')`);
  assert.equal(synced.rows.length,1);assert.equal(synced.rows[0].proposal_item_id,'quote-a');assert.equal(synced.rows[0].status,'accepted');
  const id=synced.rows[0].id;
  const created=await db.query(`select public.smyl_create_procedure_note_v1(
    '${id}','abababab-1111-4111-8111-abababababab',null,null,null,
    '{"assessment":"Control","plan":"Indicaciones","procedure":{"type":"none","site":{"tooth":"36"}}}'::jsonb) result`);
  assert.equal(created.rows[0].result.execution.status,'in_progress');
  await db.exec('reset role');
  await db.exec(`update public.smyl_clinical_notes set status='signed',signed_by='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',signed_at=now() where id='abababab-1111-4111-8111-abababababab'`);
  const final=(await db.query(`select status,completed_at is not null done from public.smyl_procedure_executions where id='${id}'`)).rows[0];
  assert.deepEqual(final,{status:'completed',done:true});
});
