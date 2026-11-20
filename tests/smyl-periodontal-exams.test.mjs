import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import M from '../smyl-dental-model.js';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dentist='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherOwner='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const patient='11111111-1111-4111-8111-111111111111';
const restrictedPatient='22222222-2222-4222-8222-222222222222';
const examWithMeasurements=()=>({
  ...M.createPeriodontalExam('2026-11-20'),
  teeth:{16:{MB:{depth:3,margin:null,bleeding:false},L:{depth:null,margin:-1,bleeding:null}}}
});
const read=file=>readFile(new URL('../'+file,import.meta.url),'utf8');

test('El modelo conserva datos parciales, seis sitios por pieza y el documento anterior',()=>{
  const draft=examWithMeasurements();
  assert.equal(M.validPeriodontalExam(draft),true);
  assert.equal(M.validate(M.empty(),owner,patient),true);
  assert.equal(M.validate({...M.empty(),periodontogram:draft},owner,patient),true);
  const complete=M.createPeriodontalExam('2024-02-29');
  for(const tooth of M.teeth){
    complete.teeth[tooth]=Object.fromEntries(M.periodontalSites.map(site=>[site,{depth:0,margin:0,bleeding:false}]));
  }
  assert.equal(Object.values(complete.teeth).flatMap(Object.keys).length,192);
  assert.equal(M.validPeriodontalExam({...complete,status:'closed'}),true);
  assert.notEqual(complete.id,draft.id);
  for(const invalid of [
    {...draft,date:'2025-02-29'}, {...draft,date:'0000-01-01'}, {...draft,status:'closed',teeth:{}},
    {...draft,teeth:{'51':draft.teeth['16']}}, {...draft,summary:'a'.repeat(2001)},
    {...draft,teeth:{'16':{}}}, {...draft,teeth:{'16':{O:draft.teeth['16'].MB}}},
    ...[{depth:1.5,margin:0,bleeding:false},{depth:-1,margin:0,bleeding:false},
      {depth:21,margin:null,bleeding:null},{depth:null,margin:-21,bleeding:false},
      {depth:null,margin:null,bleeding:null},{depth:null,margin:null,bleeding:'false'},
      {depth:3,bleeding:false},{depth:3,margin:null,bleeding:false,diagnosis:'invented'}]
        .map(values=>({...draft,teeth:{'16':{MB:values}}}))
  ]){
    assert.equal(M.validate({...M.empty(),periodontogram:invalid},owner,patient),false);
  }
});

const require=createRequire(import.meta.url);
let pgliteEntry;
try{
  pgliteEntry=require.resolve('@electric-sql/pglite',{paths:[
    ...(process.env.SMYL_PGLITE_DIR?[resolve(process.env.SMYL_PGLITE_DIR)]:[]),
    resolve('.')
  ]});
}catch(err){
  if(err.code!=='MODULE_NOT_FOUND'||process.env.SMYL_REQUIRE_PGLITE==='1')throw err;
}

test('Postgres conserva controles cerrados, su autor y el alcance clínico por paciente',{
  skip:pgliteEntry?false:'Define SMYL_PGLITE_DIR para ejecutar el contrato en PostgreSQL.'
},async t=>{
  const {PGlite}=await import(pathToFileURL(pgliteEntry).href);
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(await read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  // The shared fixture only models the four columns used in the radiograph timeline.
  // Use the actual clinical version layout for the canonical save below.
  await db.exec(`
    drop table public.smyl_dental_versions;
    create table public.smyl_dental_versions (like public.smyl_dental_records,primary key(patient_id,revision));
    create schema storage;
    create table storage.objects(bucket_id text,name text,metadata jsonb);
    create table public.smyl_clinical_evidence_findings(id uuid,tenant_id uuid,patient_id uuid);
    insert into auth.users(id) values('${owner}'),('${dentist}'),('${otherOwner}');
    insert into public.camila_tenants(id) values('${owner}'),('${otherOwner}');
    insert into public.camila_usuarios(id,tenant_id,rol,nombre) values
      ('${owner}','${owner}','dueño','owner@example.invalid'),
      ('${otherOwner}','${otherOwner}','dueño','Otra clínica'),
      ('${dentist}','${owner}','staff','Profesional de prueba');
    insert into public.camila_pacientes(id,tenant_id) values('${patient}','${owner}'),('${restrictedPatient}','${owner}');
    insert into public.smyl_roles(id,tenant_id,code,name) values('${dentist}','${owner}','dentist','Dentista');
    insert into public.smyl_member_roles values('${owner}','${dentist}','${dentist}');
    insert into public.smyl_role_permissions values('${owner}','${dentist}','clinical.write'),('${owner}','${dentist}','clinical.read');
    insert into public.smyl_professionals(id,tenant_id,user_id,display_name) values('${dentist}','${owner}','${dentist}','Dra. Prueba');
    insert into public.smyl_patient_care_team(tenant_id,patient_id,professional_id) values('${owner}','${patient}','${dentist}');
  `);
  await db.exec(await read('supabase/migrations/20261122140000_smyl_periodontal_exams.sql'));
  const as=async actor=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await db.exec('set role authenticated');
  };
  const save=async(doc,rev,id=patient)=>(await db.query(
    'select revision from public.smyl_save_dental_record($1,$2,$3::jsonb)',[id,rev,JSON.stringify(doc)]
  )).rows[0].revision;
  const history=async(id=patient,cursor=null,limit=20)=>(await db.query(
    'select * from public.smyl_periodontal_history($1,$2,$3)',[id,cursor,limit]
  )).rows;
  const errorCode=code=>err=>err.code===code;

  await as(owner);
  const doc={schema:1,teeth:{},studies:[]};
  assert.equal(await save(doc,0),1);
  assert.deepEqual(await history(),[]);
  const exam=examWithMeasurements();
  const current={...doc,periodontogram:exam};
  assert.equal(await save(current,1),2);
  assert.equal(await save(current,1),2); // response lost, retry
  await assert.rejects(save(doc,2),errorCode('40001')); // a legacy client cannot erase it
  await assert.rejects(save({...current,periodontogram:examWithMeasurements()},2),errorCode('22023'));
  await assert.rejects(save({...current,periodontogram:{...exam,date:'2026-02-29'}},2),errorCode('22023'));
  for(const malformed of [
    {depth:null,margin:null,bleeding:null},{depth:-1,margin:null,bleeding:true},
    {depth:20.5,margin:0,bleeding:null},{depth:null,margin:21,bleeding:null},{depth:'3',margin:null,bleeding:false}
  ]){
    await assert.rejects(save({...current,periodontogram:{...exam,teeth:{16:{MB:malformed}}}},2),errorCode('22023'));
  }
  assert.deepEqual(await history(),[]);
  await as(dentist);
  const closed={...current,periodontogram:{...exam,status:'closed',summary:'Síntesis revisada.'}};
  await assert.rejects(save(closed,1),errorCode('40001'));
  assert.equal(await save(closed,2),3);
  assert.equal(await save(closed,2),3);
  await assert.rejects(save(current,3),errorCode('22023'));
  await assert.rejects(save({...closed,periodontogram:{...closed.periodontogram,summary:'Edición posterior'}},3),errorCode('22023'));
  const scoped=await history();
  assert.equal(scoped.length,1);
  assert.equal(scoped[0].professional_name,'Dra. Prueba');
  assert.equal(scoped[0].updated_by,dentist);
  assert.deepEqual(scoped[0].exam,closed.periodontogram);
  await assert.rejects(history(restrictedPatient),errorCode('42501'));
  await assert.rejects(save(current,0,restrictedPatient),errorCode('42501'));
  await as(otherOwner);
  await assert.rejects(history(),errorCode('42501'));
  await assert.rejects(save(closed,3),errorCode('42501'));

  await as(owner);
  closed.teeth={'16':{observation:'Control',action:'',status:'following'}};
  assert.equal(await save(closed,3),4); // unrelated dental edit after the first clinician closed this visit
  const second={...closed,periodontogram:{...examWithMeasurements(),status:'closed'}};
  assert.equal(await save(second,4),5);
  const rows=await history();
  assert.deepEqual(rows.map(r=>[r.revision,r.updated_by,r.professional_name]),[[5,owner,null],[3,dentist,'Dra. Prueba']]);
  assert.deepEqual((await history(patient,5,1)).map(r=>r.revision),[3]);
  assert.deepEqual((await history(patient,3,1)),[]);
  await assert.rejects(save(closed,5),errorCode('22023')); // cannot reopen a historical exam id
  const third=M.createPeriodontalExam('2026-11-21');
  for(const tooth of M.teeth){
    third.teeth[tooth]=Object.fromEntries(M.periodontalSites.map(site=>[site,{depth:20,margin:-20,bleeding:false}]));
  }
  assert.equal(await save({...second,periodontogram:third},5),6);
  assert.deepEqual((await history()).map(r=>r.revision),[5,3]);
  await db.exec('reset role');
  await db.query('delete from public.smyl_role_permissions where permission_key=$1',['clinical.read']);
  await as(dentist);
  await assert.rejects(history(),errorCode('42501'));
  await db.exec('reset role; set role anon');
  await assert.rejects(history(),errorCode('42501'));
});
