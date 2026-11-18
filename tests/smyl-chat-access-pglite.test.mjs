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

test('chat profiles, private ownership and team handoffs', { skip: !engine && 'Requiere PGlite' }, async t => {
  const db = new engine.PGlite();
  t.after(() => db.close());
  await db.exec(await read('./fixtures/radiograph-contracts/pglite-base.sql'));
  await db.exec(await read('../supabase/migrations/20261116100000_smyl_conversation_branches.sql'));
  await db.exec(`
    alter role service_role bypassrls;
    create table camila_conversaciones(id uuid primary key,tenant_id uuid not null);
    create table camila_mensajes(conversacion_id uuid not null);
    alter table camila_lana_handoffs add column lana_conversation_id uuid;
    alter table camila_lana_clinical_links add column lana_conversation_id uuid;
    create table smyl_radiograph_sources(id uuid,tenant_id uuid,patient_id uuid,study_id uuid,created_at timestamptz);
    create table smyl_radiograph_reports(id uuid,tenant_id uuid,patient_id uuid,source_id uuid,status text,revision int,signed_at timestamptz,updated_at timestamptz);
    create function smyl_radiograph_effective_study_type(uuid,uuid) returns text language sql as 'select null::text';
  `);
  const guarded = ['camila_conversaciones','camila_mensajes','camila_lana_handoffs','camila_lana_clinical_links'];
  for (const table of guarded) await db.exec(`alter table ${table} enable row level security;
    create policy legacy_broad on ${table} for select to authenticated using(true); grant select on ${table} to authenticated;`);
  const migration = await read('../supabase/migrations/20261118150000_smyl_chat_access_and_private_handoff.sql');
  await db.exec(migration);
  await db.exec(migration);
  const [a,b,ana,luis,coord,manager,doctor,role,clinicalRole,patient,branch,chat,branchChat,foreignChat] =
    Array.from({ length:14 }, () => randomUUID());
  const query = (sql,args=[]) => db.query(sql,args);
  const value = async (sql,args=[]) => (await query(sql,args)).rows[0].v;
  const as = async (user,dbrole='authenticated') => {
    await db.exec('reset role');
    await query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    if (dbrole) await db.exec('set role '+dbrole);
  };
  const setAccess = (id,mode,from,choice=null,target=null) => value('select smyl_set_chat_access($1,$2,$3,$4,$5) v',[id,mode,from,choice,target]);
  const transfer = (actor,target,version,conv=chat,tenant=a,note='') => value(
    'select smyl_transfer_chat($1,$2,$3,$4,$5,$6) v',[tenant,actor,conv,target,note,version]);
  const visible = (conv=chat,tenant=a) => value('select smyl_my_chat_visible($1,$2) v',[tenant,conv]);
  const denial = promise => assert.rejects(promise,{code:'42501'});
  const invalid = promise => assert.rejects(promise,{code:'22023'});
  const allModes = () => value('select smyl_chat_team_settings() v');
  const count = table => value(`select count(*)::int v from ${table}`);

  await query('insert into auth.users(id) select unnest($1::uuid[])',[[a,b,ana,luis,coord,manager,doctor]]);
  await query('insert into camila_tenants(id) values ($1),($2)',[a,b]);
  await query('insert into camila_usuarios(id,tenant_id) select unnest($1::uuid[]),$2',[[ana,luis,coord,manager,doctor],a]);
  await query("insert into smyl_roles(id,tenant_id,code,name) values ($1,$2,'manager','Equipo'),($3,$2,'legacy','Mensajería anterior')",[role,a,clinicalRole]);
  await query("insert into smyl_role_permissions values ($1,$2,'team.manage'),($1,$3,'messages.read'),($1,$3,'clinical.read')",[a,role,clinicalRole]);
  await query('insert into smyl_member_roles values ($1,$2,$3),($1,$4,$5)',[a,manager,role,luis,clinicalRole]);
  await query("insert into smyl_role_scopes values ($1,$2,'messages','clinic'),($1,$2,'clinical','clinic')",[a,clinicalRole]);
  await query('insert into smyl_professionals(tenant_id,user_id,display_name) values ($1,$2,$3)',[a,luis,'Dr. Luis']);
  await query('insert into smyl_branches(id,tenant_id) values ($1,$2)',[branch,a]);
  await query('insert into smyl_member_branches(tenant_id,user_id,branch_id) values ($1,$2,$3)',[a,coord,branch]);
  await query('insert into smyl_conversation_branches(tenant_id,conversation_id,branch_id) values ($1,$2,$3)',[a,branchChat,branch]);
  await query('insert into camila_pacientes(tenant_id,id) values ($1,$2)',[a,patient]);
  for (const [tenant,id] of [[a,chat],[a,branchChat],[b,foreignChat]]) {
    await query('insert into camila_conversaciones values ($1,$2)',[id,tenant]);
    await query('insert into camila_mensajes values ($1)',[id]);
    for (const tbl of guarded.slice(2)) await query(`insert into ${tbl}(tenant_id,patient_id,lana_conversation_id) values ($1,$2,$3)`,[tenant,patient,id]);
  }

  await t.test('Equipo is independent from chat, old permissions are inert, owner can turn off and recover',async () => {
    await as(luis);
    assert.equal(await value('select smyl_my_chat_mode() v'),'none');
    assert.equal(await value("select smyl_has_permission($1,'messages.read') v",[a]),false);
    assert.equal(await value("select count(*)::int v from smyl_tenants_with_permission('messages.read')"),0);
    await denial(allModes());
    await denial(setAccess(luis,'coordinator','none'));
    await as(manager);
    assert.equal((await allModes()).length,6);
    await invalid(setAccess(b,'agent','none'));
    await setAccess(a,'none','coordinator');
    await as(a);
    assert.equal(await visible(),false);
    await setAccess(a,'coordinator','none');
    await setAccess(ana,'agent','none');
    await setAccess(luis,'agent','none');
    await setAccess(coord,'coordinator','none');
    await assert.rejects(setAccess(coord,'none','agent'),{code:'40001'});
    await as(null,'service_role');
    const roster=(await query('select * from smyl_chat_assistants($1)',[a])).rows;
    assert.equal(roster.length,4);
    assert.equal(roster.find(row=>row.id===luis).kind,'professional');
    assert.equal(roster.find(row=>row.id===ana).kind,'staff');
    await as(null,'anon');
    await denial(allModes());
    await denial(setAccess(ana,'coordinator','agent'));
    await denial(transfer(a,ana,0));
  });
  await t.test('scope, concurrent version and restricted legacy row readers',async () => {
    await as(coord);
    assert.equal(await visible(),false);
    assert.equal(await visible(branchChat),true);
    assert.equal(await visible(foreignChat,b),false);
    await as(null,'service_role');
    assert.deepEqual(await value('select smyl_chat_visible_ids($1,$2,$3) v',[a,coord,[chat,branchChat]]),[branchChat]);
    await denial(transfer(coord,ana,0));
    await denial(transfer(a,luis,0,foreignChat,b));
    await invalid(transfer(a,b,0));
    await invalid(transfer(a,doctor,0));
    await invalid(transfer(a,luis,0,chat,a,'x'.repeat(1001)));
    const saved=await transfer(a,ana,0);
    assert.equal(saved.version,1);
    await assert.rejects(transfer(a,luis,0),{code:'40001'});
    await as(ana);
    assert.equal(await visible(),true);
    assert.equal(await visible(branchChat),false);
    for (const table of guarded) assert.equal(await count(table),1);
    await denial(transfer(ana,luis,1));
    await as(luis);
    for (const table of guarded) assert.equal(await count(table),0);
    await as(null,'service_role');
    await denial(transfer(luis,coord,1));
    await denial(transfer(ana,null,1));
    assert.equal((await transfer(ana,luis,1,chat,a,'  Llamar mañana  ')).version,2);
    assert.equal(await value('select note v from smyl_chat_handoffs where version=2'),'Llamar mañana');
    await as(ana);
    assert.equal(await visible(),false);
    await as(luis);
    for (const table of guarded) assert.equal(await count(table),1);
    await denial(count('smyl_chat_handoffs'));
    await denial(count('smyl_chat_assignments'));
    assert.equal(await value("select count(*)::int v from smyl_patient_timeline($1) where event_type like 'conversation_%'",[patient]),2);
    await as(doctor);
    for(const table of guarded) assert.equal(await count(table),0);
  });
  await t.test('revocation and account deactivation move all ownership atomically',async () => {
    await as(manager);
    await invalid(setAccess(luis,'none','agent'));
    await invalid(setAccess(luis,'none','agent','transfer',doctor));
    assert.equal((await allModes()).find(row=>row.user_id===luis).assigned_count,1);
    assert.equal((await setAccess(luis,'none','agent','transfer',ana)).moved,1);
    await as(luis);
    assert.equal(await visible(),false);
    assert.equal(await value("select count(*)::int v from smyl_patient_timeline($1) where event_type like 'conversation_%'",[patient]),0);
    await as(manager);
    assert.equal((await setAccess(ana,'none','agent','queue')).moved,1);
    await setAccess(luis,'agent','none');
    await as(null,'service_role');
    await transfer(a,luis,4);
    await as(null,null);
    await query('update camila_usuarios set activo=false where id=$1',[luis]);
    assert.equal(await value('select version v from smyl_chat_assignments where conversation_id=$1 and assignee_id is null',[chat]),6);
    assert.equal(await value("select reason v from smyl_chat_handoffs where conversation_id=$1 and version=6",[chat]),'account_disabled');
    await as(manager);
    await invalid(setAccess(luis,'agent','none'));
    await as(null,null);
    await query('update camila_usuarios set activo=true where id=$1',[luis]);
    await as(luis);
    assert.equal(await value('select smyl_my_chat_mode() v'),'none');
    await as(b);
    assert.equal((await allModes()).length,1);
    await invalid(setAccess(luis,'agent','none'));
    await as(null,null);
    await query("insert into camila_usuarios(id,tenant_id,activo) values ($1,$1,false)",[b]);
    await as(b);
    await denial(allModes());
    await denial(setAccess(b,'coordinator','none'));
  });
});
