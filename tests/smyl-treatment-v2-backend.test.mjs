import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261128130000_smyl_treatment_v2.sql');

test('plan, versiones y propuesta comparten un capítulo canónico sin forzar backfill ambiguo',()=>{
  for(const table of ['smyl_clinical_plans','smyl_clinical_versions','smyl_proposals','smyl_proposal_versions'])
    assert.match(sql,new RegExp(`alter table public\\.${table} add column if not exists treatment_id uuid`));
  assert.match(sql,/group by v\.patient_id,v\.revision[\s\S]*?having count\(\*\)=1/);
  assert.doesNotMatch(sql,/alter column treatment_id set not null/);
  assert.match(sql,/smyl_save_clinical_plan_v3/);
  assert.match(sql,/smyl_save_proposal_v4/);
  assert.match(sql,/smyl_can_access_patient\(p_tenant_id,p_patient_id,'clinical'\)/);
  assert.match(sql,/smyl_bind_active_treatment_plan/);
  assert.match(sql,/smyl_treatment_bind_current_plan after insert on public\.smyl_treatments/);
  assert.match(sql,/smyl_proposal_bind_treatment before insert or update/);
  assert.match(sql,/smyl_proposal_version_bind_treatment before insert or update/);
  assert.match(sql,/new\.status='approved' and new\.treatment_id is null/);
  assert.match(sql,/pv\.snapshot->>'plan_revision'/);
  assert.match(sql,/count\(distinct v\.treatment_id\) as match_count/);
  assert.match(sql,/where m\.match_count=1/);
  assert.doesNotMatch(sql,/update public\.smyl_proposal_versions pv set treatment_id=p\.treatment_id/);
});

test('la decisión por concepto es inmutable, completa e idempotente',()=>{
  assert.match(sql,/create table public\.smyl_proposal_decisions/);
  assert.match(sql,/create table public\.smyl_proposal_decision_items/);
  assert.match(sql,/item_status in \('accepted','rejected','pending'\)/);
  assert.match(sql,/classifica|Clasifica exactamente todos los conceptos/);
  assert.match(sql,/request_hash<>v_hash/);
  assert.match(sql,/accepted_full','accepted_partial','declined','changes_requested/);
  assert.match(sql,/smyl_proposal_decisions_immutable before update or delete/);
  assert.match(sql,/p_accepted_item_ids text\[\],p_rejected_item_ids text\[\],p_pending_item_ids text\[\]/);
  assert.match(sql,/valid_until'\)\:\:date<\(now\(\) at time zone 'America\/Mexico_City'\)\:\:date/);
});

test('finanzas cobra exclusivamente items aceptados y detecta reintentos incompatibles',()=>{
  const fn=sql.match(/create or replace function public\.smyl_post_proposal_decision_charges_v1[\s\S]*?\nend \$\$;/)?.[0]||'';
  assert.match(fn,/item_status='accepted'/);
  assert.match(fn,/v_batch\.request_hash is distinct from v_hash/);
  assert.match(fn,/smyl_can_access_finance_patient\(v_tenant,v_decision\.patient_id,p_branch_id\)/);
  assert.match(fn,/proposal_item_id,proposal_batch_id/);
  assert.match(fn,/p_simulation_charge_id uuid default null/);
  assert.match(fn,/simulation_credit_charge_id/);
  assert.match(fn,/v_proposal\.branch_id is distinct from p_branch_id/);
  assert.match(fn,/v_sim\.branch_id is distinct from p_branch_id/);
  assert.match(fn,/valid_until'\)\:\:date<\(now\(\) at time zone 'America\/Mexico_City'\)\:\:date/);
  assert.doesNotMatch(fn,/jsonb_array_elements\(v_proposal\.document->'items'\)/);
});

test('RLS financiera consulta una función segura sin depender del RLS de propuestas',()=>{
  const helper=sql.match(/create or replace function public\.smyl_can_read_proposal_decision_finance[\s\S]*?\n\$\$;/)?.[0]||'';
  assert.match(helper,/security definer/);
  assert.match(helper,/smyl_can_access_finance_patient\(p\.tenant_id,p\.patient_id,p\.branch_id\)/);
  const policies=sql.slice(sql.indexOf('create policy smyl_proposal_decisions_finance_read'),sql.indexOf('revoke all on public.smyl_proposal_decisions'));
  assert.match(policies,/smyl_can_read_proposal_decision_finance\(tenant_id,id\)/);
  assert.match(policies,/smyl_can_read_proposal_decision_finance\(tenant_id,decision_id\)/);
  assert.doesNotMatch(policies,/from public\.smyl_proposals/);
});

test('la transición de capítulo es una sola transacción con carry y revisión optimista',()=>{
  const fn=sql.match(/create or replace function public\.smyl_transition_treatment_v1[\s\S]*?\nend \$\$;/)?.[0]||'';
  assert.match(fn,/p_expected_treatment_revision integer,p_expected_plan_revision integer/);
  assert.match(fn,/for update/);
  assert.match(fn,/v_current\.revision<>p_expected_treatment_revision/);
  assert.match(fn,/v_plan\.revision<>p_expected_plan_revision/);
  assert.match(fn,/update public\.smyl_treatments set status=p_outcome/);
  assert.match(fn,/insert into public\.smyl_treatments/);
  assert.match(fn,/jsonb_set\(v_item,'\{id\}',to_jsonb\(v_new_item_id\)\)/);
  assert.match(fn,/insert into public\.smyl_treatment_plan_carries/);
  assert.match(fn,/insert into public\.smyl_clinical_versions/);
});

test('el sentinel exige todos los contratos v2',()=>{
  const s=read('scripts/migration-sentinels.mjs');
  assert.match(s,/'20261128130000'/);
  for(const name of ['smyl_save_clinical_plan_v3','smyl_save_proposal_v4','smyl_record_proposal_decision_v1','smyl_post_proposal_decision_charges_v1','smyl_transition_treatment_v1'])
    assert.match(s,new RegExp(name));
});

const require=createRequire(import.meta.url);let pgliteEntry;
try{pgliteEntry=require.resolve('@electric-sql/pglite',{paths:[...(process.env.SMYL_PGLITE_DIR?[resolve(process.env.SMYL_PGLITE_DIR)]:[]),resolve('.')]});}
catch(error){if(error.code!=='MODULE_NOT_FOUND'||process.env.SMYL_REQUIRE_PGLITE==='1')throw error;}

test('PostgreSQL ejecuta decisión parcial, cargos selectivos y transición atómica',{skip:pgliteEntry?false:'Define SMYL_PGLITE_DIR para ejecutar el contrato.'},async t=>{
  const {PGlite}=await import(pathToFileURL(pgliteEntry).href);const db=new PGlite();t.after(()=>db.close());
  await db.exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await db.exec(read('tests/fixtures/treatment-v2-stubs.sql'));
  await db.exec(sql);
  const {SENTINELAS}=await import('../scripts/migration-sentinels.mjs');
  assert.equal((await db.query(SENTINELAS['20261128130000'].sentinel)).rows[0].ok,true);
  await db.exec(read('tests/fixtures/treatment-v2-scenarios.sql'));
  const row=(await db.query(`select
    (select count(*)::integer from public.smyl_proposal_decisions) decisions,
    (select count(*)::integer from public.smyl_finance_charges where proposal_batch_id is not null) charges,
    (select count(*)::integer from public.smyl_treatment_plan_carries) carries,
    (select count(*)::integer from public.smyl_treatments
      where patient_id='11111111-1111-4111-8111-111111111111' and status='active') active`)).rows[0];
  assert.deepEqual(row,{decisions:1,charges:1,carries:1,active:1});
});
