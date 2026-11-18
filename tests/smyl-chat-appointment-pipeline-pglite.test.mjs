import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(process.env.SMYL_PGLITE_DIR
  ? path.resolve(process.env.SMYL_PGLITE_DIR, 'loader.cjs') : import.meta.url);
let engine;
try { engine = require('@electric-sql/pglite'); } catch (error) {
  if (process.env.SMYL_REQUIRE_PGLITE === '1' || error.code !== 'MODULE_NOT_FOUND') throw error;
}
const read = file => readFile(new URL(file, import.meta.url), 'utf8');

test('Pipeline de chat usa la cita vigente; mover una tarjeta sólo cambia el chat', {skip:!engine && 'Requiere PGlite'}, async t=>{
  const db = new engine.PGlite();
  t.after(()=>db.close());
  await db.exec(await read('./fixtures/radiograph-contracts/pglite-base.sql'));
  await db.exec(`
    alter role service_role bypassrls;
    alter table smyl_branches add column active boolean default true, add column timezone text default 'America/Mexico_City';
    alter table camila_lana_handoffs add column lana_conversation_id uuid, add column updated_at timestamptz default now();
    alter table camila_lana_clinical_links add column lana_conversation_id uuid;
    alter table smyl_appointments add column notes text, add column created_at timestamptz default now(),add column ends_at timestamptz,
      add foreign key(tenant_id) references camila_tenants(id) on delete cascade;
    alter table smyl_professionals add column specialty text;
    create table smyl_services(tenant_id uuid,id uuid,name text,duration_minutes integer);
    create table smyl_appointment_requests(tenant_id uuid,appointment_id uuid,patient_id uuid,lana_conversation_id uuid,status text,
      id uuid default gen_random_uuid(),service_id uuid,preferred_branch_id uuid,preferred_professional_id uuid,
      requested_start timestamptz,requested_end timestamptz,created_at timestamptz default now(),decided_at timestamptz);
  `);
  await db.exec(await read('../supabase/migrations/20261116100000_smyl_conversation_branches.sql'));
  await db.exec(await read('../supabase/migrations/20261118150000_smyl_chat_access_and_private_handoff.sql'));
  const [a,b,agent,other,role,site,site2,foreignSite,patient,otherPatient,doc,thread,thread2,foreignThread,unlinked,custom] =
    Array.from({length:16},()=>randomUUID());
  const query=(sql,args=[])=>db.query(sql,args);
  const rows=async(sql,args=[]) => (await query(sql,args)).rows;
  const scalar=async(sql,args=[]) => (await rows(sql,args))[0].v;
  const ctx=async(actor= a,ids=[thread],tenant=a)=>rows('select * from smyl_chat_pipeline_context($1,$2,$3)',[tenant,actor,ids]);
  const current=async(actor=a,id=thread)=>(await ctx(actor,[id]))[0];
  const move=(actor,id,stage,revision)=>scalar('select smyl_chat_set_pipeline_stage($1,$2,$3,$4,$5) v',[a,actor,id,stage,revision]);
  const changed=(actor,ts)=>scalar('select smyl_chat_pipeline_changed($1,$2,$3,$4) v',[a,actor,[thread],ts]);
  const clock=()=>scalar('select clock_timestamp()::text v'); // retain PostgreSQL microseconds
  const visit=async(id,status,days,{tenant=a,atBranch=site,forPatient=patient}={})=>
    query(`insert into smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,starts_at,ends_at,status)
      values ($1,$2,$3,$4,$5,now()+make_interval(days=>$6),now()+make_interval(days=>$6)+interval '1 hour',$7)`,
      [id,tenant,atBranch,forPatient,doc,days,status]);
  const as=async(user,roleName='authenticated')=>{
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
    if(roleName) await db.exec('set role '+roleName);
  };
  await query('insert into auth.users(id) select unnest($1::uuid[])',[[a,b,agent,other]]);
  await query('insert into camila_tenants(id) values ($1),($2)',[a,b]);
  await query('insert into camila_usuarios(id,tenant_id) values ($1,$2),($3,$2)',[agent,a,other]);
  await query("insert into smyl_roles(id,tenant_id,code,name) values ($1,$2,'recepcion','Recepción')",[role,a]);
  await query('insert into smyl_member_roles values ($1,$2,$3)',[a,agent,role]);
  await query("insert into smyl_role_scopes values ($1,$2,'schedule','branches')",[a,role]);
  await query('insert into smyl_branches(tenant_id,id) values ($1,$2),($1,$3),($4,$5)',[a,site,site2,b,foreignSite]);
  await query('insert into smyl_member_branches(tenant_id,user_id,branch_id) values ($1,$2,$3),($1,$4,$3)',[a,agent,site,other]);
  await query('insert into camila_lana_handoffs(tenant_id,patient_id,lana_conversation_id) values ($1,$2,$3),($1,$2,$4),($5,$6,$7)',[a,patient,thread,thread2,b,otherPatient,foreignThread]);
  await as(a);
  await query("select smyl_set_chat_access($1,'agent','none'),smyl_set_chat_access($2,'agent','none')",[agent,other]);
  await as(null,'service_role');
  await query("select smyl_transfer_chat($1,$1,$2,$3,'',0)",[a,thread,agent]);
  await as(null,null);
  const [done,upcoming,future,forOtherThread,otherSite,foreignVisit,notLinked]=Array.from({length:7},()=>randomUUID());
  await visit(done,'completed',-3);
  await visit(upcoming,'confirmed',2);
  await visit(future,'confirmed',6);
  await visit(otherSite,'confirmed',4,{atBranch:site2});
  await visit(forOtherThread,'confirmed',1);
  await visit(notLinked,'confirmed',0,{forPatient:otherPatient});
  await visit(foreignVisit,'confirmed',0,{tenant:b,atBranch:foreignSite,forPatient:otherPatient});
  await query("insert into smyl_appointment_requests(tenant_id,appointment_id,patient_id,lana_conversation_id,status) values ($1,$2,$3,$4,'accepted')",[a,forOtherThread,patient,thread2]);
  const migration=await read('../supabase/migrations/20261118160000_smyl_chat_appointment_pipeline.sql');
  await db.exec(migration);
  await db.exec(migration);

  await t.test('agenda previa, paciente y canal correctos, lote y huso horario',async()=>{
    await as(null,'service_role');
    let cards=await ctx(a,[thread,thread2,unlinked,thread]);
    assert.equal(cards.length,3);
    const first=cards.find(c=>c.conversation_id===thread);
    assert.equal(first.appointment.id,upcoming);
    assert.equal(first.appointment.timezone,'America/Mexico_City');
    assert.equal(first.effective_stage_id,'smyl:confirmed');
    assert.equal(first.stage_source,'appointment');
    assert.equal(cards.find(c=>c.conversation_id===thread2).appointment.id,forOtherThread);
    assert.equal(cards.find(c=>c.conversation_id===unlinked).appointment,null);
    assert.deepEqual(await ctx(a,[foreignThread],b),[]);
    assert.deepEqual(await ctx(agent,[thread2]),[]);
    assert.deepEqual(await ctx(a,[]),[]);
    assert.equal((await current(agent)).appointment,null);
    await as(null,null);
    await query("insert into smyl_role_permissions values ($1,$2,'schedule.read')",[a,role]);
    await as(null,'service_role');
    assert.equal((await current(agent)).appointment.id,upcoming);
  });

  await t.test('manual persistente incluso Sin etapa, reintentos y cambios reales desde Agenda',async()=>{
    const saved=await move(agent,thread,null,0);
    assert.equal(saved.manual_active,true);
    assert.equal(saved.stage_source,'manual');
    assert.equal(saved.effective_stage_id,null);
    assert.equal((await move(agent,thread,null,0)).manual_revision,1);
    await assert.rejects(move(a,thread,custom,0),{code:'40001'});
    const manual=await move(a,thread,custom,1);
    assert.equal(manual.effective_stage_id,custom);
    const before=await clock();
    await as(null,null);
    await query("update smyl_appointments set notes='nota interna',status=status where id=$1",[upcoming]);
    await as(null,'service_role');
    assert.equal(await changed(agent,before),false);
    assert.equal((await current(agent)).effective_stage_id,custom);
    await as(null,null);
    await query("update smyl_appointments set status='no_show' where id=$1",[done]);
    await as(null,'service_role');
    assert.equal((await current(agent)).effective_stage_id,custom);
    assert.equal((await current(agent)).appointment.id,upcoming);
    await as(null,null);
    await query("update smyl_appointments set status='arrived',starts_at=now(),ends_at=now()+interval '1 hour' where id=$1",[upcoming]);
    await as(null,'service_role');
    const arrived=await current(agent);
    assert.equal(arrived.manual_active,false);
    assert.equal(arrived.manual_stage_id,null);
    assert.equal(arrived.effective_stage_id,'smyl:arrived');
    assert.equal(await changed(agent,before),true);
    await as(null,null);
    await query("update smyl_branches set timezone='Bogus/Zone' where id=$1",[site]);
    await query("update smyl_appointments set status='in_progress' where id=$1",[upcoming]);
    await as(null,'service_role');
    assert.equal((await current()).appointment.status,'in_progress');
    assert.equal((await current()).appointment.timezone,'UTC');
    await as(null,null);
    await query("update smyl_branches set timezone='America/Mexico_City' where id=$1",[site]);
    await query("update smyl_appointments set status='completed' where id=$1",[upcoming]);
    await query("update smyl_appointments set status='cancelled' where id in ($1,$2)",[future,otherSite]);
    await as(null,'service_role');
    assert.equal((await current()).effective_stage_id,'smyl:attended');
    assert.equal((await current()).appointment.id,upcoming);
    // Appointment from another thread must not signal sync or expire an override here.
    await move(a,thread,'smyl:confirmed',2);
    const since=await clock();
    await as(null,null);
    await query("update smyl_appointments set status='no_show' where id=$1",[forOtherThread]);
    await as(null,'service_role');
    assert.equal(await changed(a,since),false);
    assert.equal((await current()).effective_stage_id,'smyl:confirmed');
    assert.equal((await current()).appointment.status,'completed');
  });

  await t.test('alcances privados, cancelación, nueva visita, eliminación y permisos SQL',async()=>{
    await as(null,null);
    const onlyCancelled=randomUUID(),cancelThread=randomUUID(),cancelPatient=randomUUID();
    await query('insert into camila_lana_handoffs(tenant_id,patient_id,lana_conversation_id) values ($1,$2,$3)',[a,cancelPatient,cancelThread]);
    await visit(onlyCancelled,'no_show',-1,{forPatient:cancelPatient});
    await as(null,'service_role');
    let card=await current(a,cancelThread);
    assert.equal(card.appointment.status,'no_show');
    assert.equal(card.auto_stage_key,null);
    assert.equal(card.stage_source,'lana');
    await as(null,null);
    await query("update smyl_appointments set status='cancelled' where id=$1",[onlyCancelled]);
    await as(null,'service_role');
    assert.equal((await current(a,cancelThread)).auto_stage_key,null);
    const hiddenSince=await clock();
    await as(null,null);
    await query("update smyl_appointments set status='arrived' where id=$1",[otherSite]);
    await as(null,'service_role');
    assert.equal((await current(agent)).effective_stage_id,'smyl:confirmed');
    assert.equal(await changed(agent,hiddenSince),false);
    assert.equal((await current(a)).appointment.id,otherSite);
    await as(null,null);
    const next=randomUUID();
    await visit(next,'scheduled',1);
    await as(null,'service_role');
    assert.equal((await current(agent)).appointment.id,next);
    assert.equal((await current(agent)).auto_stage_key,null);
    await as(null,null);
    await query('delete from smyl_appointments where id=$1',[next]);
    await as(null,'service_role');
    assert.equal((await current(agent)).effective_stage_id,'smyl:attended');
    await assert.rejects(move(other,thread,'smyl:arrived',3),{code:'42501'});
    await assert.rejects(move(a,thread,'inventada',3),{code:'22023'});
    await as(agent);
    await assert.rejects(current(a),{code:'42501'});
    await assert.rejects(move(a,thread,custom,3),{code:'42501'});
    await assert.rejects(query('select * from smyl_chat_pipeline_overrides'),{code:'42501'});
    await as(null,'anon');
    await assert.rejects(query('select * from smyl_chat_appointment_ticks'),{code:'42501'});
  });
  await t.test('reprogramar o cancelar la cita de la tarjeta reactiva Agenda y la baja completa de la clínica limpia sus marcas',async()=>{
    const id=randomUUID(),person=randomUUID(),chat=randomUUID(),soon=randomUUID(),later=randomUUID();
    await as(null,null);
    await query('insert into camila_lana_handoffs(tenant_id,patient_id,lana_conversation_id) values ($1,$2,$3)',[a,person,chat]);
    await visit(soon,'confirmed',2,{forPatient:person});
    await visit(later,'confirmed',3,{forPatient:person});
    await as(null,'service_role');
    await move(a,chat,custom,0);
    await as(null,null);
    await query("update smyl_appointments set starts_at=starts_at+interval '2 hours',ends_at=ends_at+interval '2 hours' where id=$1",[soon]);
    await as(null,'service_role');
    assert.equal((await current(a,chat)).stage_source,'appointment');
    await move(a,chat,null,1);
    await as(null,null);
    await query("update smyl_appointments set status='cancelled' where id=$1",[soon]);
    await as(null,'service_role');
    assert.equal((await current(a,chat)).appointment.id,later);
    assert.equal((await current(a,chat)).stage_source,'appointment');
    await as(null,null);
    await visit(id,'confirmed',3,{tenant:b,atBranch:foreignSite,forPatient:otherPatient});
    await query('delete from camila_tenants where id=$1',[b]);
    assert.equal(await scalar('select count(*)::int v from smyl_chat_appointment_ticks where tenant_id=$1',[b]),0);
  });

  await t.test('la ficha permite elegir un horario pendiente y aparta solicitudes previas, ajenas o de otra sede', async () => {
    const request = randomUUID(), old = randomUUID(), hiddenRequest = randomUUID();
    const wrongVisitRequest = randomUUID(), elsewhereVisitRequest = randomUUID();
    const ownVisitRequest=randomUUID(), ownVisit=randomUUID(), elsewhereVisit=randomUUID(), wrongVisit=randomUUID();
    await as(null,null);
    await visit(ownVisit,'confirmed',3);
    await visit(elsewhereVisit,'confirmed',3,{atBranch:site2});
    await visit(wrongVisit,'confirmed',3,{forPatient:otherPatient});
    const add=(id,who,branch,appointment=null)=>query(
      'insert into smyl_appointment_requests (tenant_id,id,patient_id,lana_conversation_id,preferred_branch_id,preferred_professional_id,created_at,status,appointment_id) values ($1,$2,$3,$4,$5,$6,now(),$7,$8)',
      [a,id,who,thread,branch,doc,appointment?'accepted':'pending',appointment]);
    await add(request,patient,site);
    await add(ownVisitRequest,patient,site,ownVisit);
    await add(old,otherPatient,site);
    await add(hiddenRequest,patient,site2);
    await add(elsewhereVisitRequest,patient,site,elsewhereVisit);
    await add(wrongVisitRequest,patient,site,wrongVisit);
    await as(null,'service_role');
    const result = await scalar('select smyl_chat_request_context($1,$2,$3,20) v',[a,agent,thread]);
    assert.equal(result.linked,true);
    assert.deepEqual(result.items.map(row=>row.id).sort(),[ownVisitRequest,request].sort());
    assert.equal(result.items.find(row=>row.id===ownVisitRequest).appointment.id,ownVisit);
    for (const req of [old,hiddenRequest,elsewhereVisitRequest,wrongVisitRequest]) {
      await assert.rejects(query('select smyl_chat_confirm_request($1,$2,$3,$4,$5)',[a,agent,thread,req,randomUUID()]),{code:'42501'});
    }
    await assert.rejects(query('select smyl_chat_confirm_request($1,$2,$3,$4,$5)',[a,agent,thread2,request,randomUUID()]),{code:'42501'});
  });
});
