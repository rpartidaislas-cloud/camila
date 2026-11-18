// Equipo — migraciones 20261118120000 (teléfono interno) y 20261118130000 (traslado entre sedes) en un Postgres real en memoria (PGlite).
// Verifica: formato y valor por omisión del teléfono; que un doctor no pueda tener horario en dos sedes a menos del margen
// (45 min por omisión, ajustable), por día y por doctor; permisos y auditoría del ajuste; aislamiento entre clínicas;
// y la lista de choques que ya existían.
//
// Requiere @electric-sql/pglite: SMYL_PGLITE_DIR=/ruta/con/node_modules node --test <este archivo>
// Si no está disponible, la suite se omite (y falla con SMYL_REQUIRE_PGLITE=1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
async function loadPglite() {
  try { return await import('@electric-sql/pglite'); } catch (e) {}
  const dir = process.env.SMYL_PGLITE_DIR;
  if (!dir) return null;
  try { return await import(pathToFileURL(createRequire(path.join(dir, 'noop.js')).resolve('@electric-sql/pglite')).href); } catch (e) { return null; }
}
const pglite = await loadPglite();
if (!pglite && process.env.SMYL_REQUIRE_PGLITE === '1') throw new Error('SMYL_REQUIRE_PGLITE=1 pero @electric-sql/pglite no está disponible.');
const skip = pglite ? false : 'Instala @electric-sql/pglite o define SMYL_PGLITE_DIR para correr esta suite.';

const U = { ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', admin: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', reader: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1' };
const BR = { a1: '11111111-1111-4111-8111-1111111111a1', a2: '11111111-1111-4111-8111-1111111111a2', a3: '11111111-1111-4111-8111-1111111111a3', b1: '22222222-2222-4222-8222-2222222222b1', b2: '22222222-2222-4222-8222-2222222222b2' };
const PRO = { dr1: '33333333-3333-4333-8333-333333333301', dr2: '33333333-3333-4333-8333-333333333302', drB: '33333333-3333-4333-8333-333333333303' };
const ROLE_ADMIN = 'f1000000-0000-4000-8000-000000000001', ROLE_READ = 'f1000000-0000-4000-8000-000000000002';

let db, exec, as, asServer;
const rows = async q => (await db.query(q)).rows;
const fails = async (q, re) => assert.rejects(() => exec(q), re);
const hours = (tenant, pro, branch, weekday, from, to, active = true) =>
  `insert into public.smyl_professional_hours(tenant_id,professional_id,branch_id,weekday,starts_at,ends_at,active) values ('${tenant}','${pro}','${branch}',${weekday},'${from}','${to}',${active})`;

if (!skip) {
  db = new pglite.PGlite();
  exec = q => db.exec(q);
  as = uid => exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  asServer = () => exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(`
    create or replace function public.camila_es_miembro(p_tenant uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select exists (select 1 from public.camila_tenants ct where ct.id = p_tenant and ct.id = auth.uid())
          or exists (select 1 from public.camila_usuarios cu where cu.id = auth.uid() and cu.tenant_id = p_tenant and cu.activo) $$;
    grant execute on function public.camila_es_miembro(uuid) to authenticated;
    create table public.smyl_professional_hours (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, professional_id uuid not null, branch_id uuid not null,
      weekday smallint not null check (weekday between 0 and 6), starts_at time not null, ends_at time not null,
      active boolean not null default true, check (ends_at > starts_at));
    grant select on public.smyl_professional_hours to authenticated;
  `);
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${U.admin}','${U.ownerA}','staff',true),('${U.reader}','${U.ownerA}','staff',true);
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${ROLE_ADMIN}','${U.ownerA}','admin','Administración',true),('${ROLE_READ}','${U.ownerA}','lectura','Lectura',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values ('${U.ownerA}','${ROLE_ADMIN}','clinic.manage'),('${U.ownerA}','${ROLE_READ}','schedule.read');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${U.ownerA}','${U.admin}','${ROLE_ADMIN}'),('${U.ownerA}','${U.reader}','${ROLE_READ}');
    insert into public.smyl_branches(id,tenant_id,name) values ('${BR.a1}','${U.ownerA}','Centro'),('${BR.a2}','${U.ownerA}','Lomas Verdes'),('${BR.a3}','${U.ownerA}','Plaza Sol'),('${BR.b1}','${U.ownerB}','Norte'),('${BR.b2}','${U.ownerB}','Sur');
    insert into public.smyl_professionals(id,tenant_id,display_name) values ('${PRO.dr1}','${U.ownerA}','Dr. Uno'),('${PRO.dr2}','${U.ownerA}','Dra. Dos'),('${PRO.drB}','${U.ownerB}','Dr. B');
  `);
  await exec(read('supabase/migrations/20261118120000_smyl_professional_internal_phone.sql'));
  await exec(read('supabase/migrations/20261118120000_smyl_professional_internal_phone.sql')); // idempotente
  await exec(read('supabase/migrations/20261118130000_smyl_professional_travel_margin.sql'));
  await exec(read('supabase/migrations/20261118130000_smyl_professional_travel_margin.sql')); // idempotente
}

test('el teléfono interno nace vacío y sólo acepta dígitos y signos de teléfono', { skip }, async () => {
  assert.deepEqual((await rows(`select phone from public.smyl_professionals where id = '${PRO.dr1}'`))[0], { phone: '' });
  for (const ok of ['+52 33 1234 5678', '(33) 1234-5678', '3312345678', '']) {
    await exec(`update public.smyl_professionals set phone = '${ok}' where id = '${PRO.dr1}'`);
  }
  for (const bad of ['llámame', '<b>33</b>', '33; drop table x', 'x'.repeat(41), '3'.repeat(41)]) {
    await fails(`update public.smyl_professionals set phone = '${bad}' where id = '${PRO.dr1}'`, /smyl_professionals_phone_check/);
  }
  await exec(`update public.smyl_professionals set phone = '' where id = '${PRO.dr1}'`);
});

test('un doctor no puede tener horario en otra sede a menos de 45 minutos del anterior', { skip }, async () => {
  await exec(hours(U.ownerA, PRO.dr1, BR.a1, 1, '09:00', '13:00'));
  await fails(hours(U.ownerA, PRO.dr1, BR.a2, 1, '13:30', '17:00'), /al menos 45 minutos de traslado/);
  await fails(hours(U.ownerA, PRO.dr1, BR.a2, 1, '13:44', '17:00'), /al menos 45 minutos/);
  await exec(hours(U.ownerA, PRO.dr1, BR.a2, 1, '13:45', '17:00')); // justo el margen: permitido
  await fails(hours(U.ownerA, PRO.dr1, BR.a3, 1, '12:00', '15:00'), /al menos 45 minutos/); // traslape directo con una sede distinta
  await fails(hours(U.ownerA, PRO.dr1, BR.a3, 1, '07:00', '08:30'), /al menos 45 minutos/); // por la mañana, también cuenta
  await exec(hours(U.ownerA, PRO.dr1, BR.a3, 1, '07:00', '08:15'));
});

test('la regla es por doctor, por día y sólo para horarios activos', { skip }, async () => {
  await exec(hours(U.ownerA, PRO.dr2, BR.a1, 3, '09:00', '13:00')); // otro doctor: sin relación con Dr. Uno
  await exec(hours(U.ownerA, PRO.dr2, BR.a2, 4, '09:00', '13:00')); // otro día
  await exec(hours(U.ownerA, PRO.dr2, BR.a2, 3, '13:10', '15:00', false)); // inactivo: no se revisa
  await fails(`update public.smyl_professional_hours set active = true where professional_id = '${PRO.dr2}' and branch_id = '${BR.a2}' and weekday = 3`, /al menos 45 minutos/);
  await exec(`update public.smyl_professional_hours set starts_at = '13:45' where professional_id = '${PRO.dr2}' and branch_id = '${BR.a2}' and weekday = 3`);
  await exec(`update public.smyl_professional_hours set active = true where professional_id = '${PRO.dr2}' and branch_id = '${BR.a2}' and weekday = 3`);
  // Mover un bloque a un choque también se rechaza.
  await fails(`update public.smyl_professional_hours set starts_at = '13:15' where professional_id = '${PRO.dr2}' and branch_id = '${BR.a2}' and weekday = 3 and active`, /al menos 45 minutos/);
});

test('el margen se cambia con permiso de administración, se audita y se valida', { skip }, async () => {
  await as(U.reader);
  await fails(`select public.smyl_set_professional_travel_margin(30)`, /Sin permiso/);
  await as(U.admin);
  await fails(`select public.smyl_set_professional_travel_margin(-1)`, /entre 0 y 240/);
  await fails(`select public.smyl_set_professional_travel_margin(241)`, /entre 0 y 240/);
  assert.equal((await rows(`select public.smyl_set_professional_travel_margin(20) as m`))[0].m, 20);
  await asServer();
  // Con 20 minutos, 13:30 después de 13:00 ya cabe; con 45 no cabía.
  await exec(hours(U.ownerA, PRO.dr1, BR.a2, 2, '13:30', '16:00'));
  await exec(hours(U.ownerA, PRO.dr1, BR.a1, 2, '09:00', '13:00'));
  await fails(hours(U.ownerA, PRO.dr1, BR.a3, 2, '13:10', '14:00'), /al menos 20 minutos/);
  await as(U.ownerA);
  await exec(`select public.smyl_set_professional_travel_margin(0)`);
  await asServer();
  await exec(hours(U.ownerA, PRO.dr1, BR.a3, 5, '10:00', '12:00'));
  await exec(hours(U.ownerA, PRO.dr1, BR.a1, 5, '12:00', '14:00')); // con 0 min pueden quedar pegados
  await fails(hours(U.ownerA, PRO.dr1, BR.a2, 5, '11:00', '13:00'), /al menos 0 minutos/); // pero no encimados
  await as(U.ownerA);
  await exec(`select public.smyl_set_professional_travel_margin(45)`);
  await asServer();
  const audit = await rows(`select action, before_data, after_data from public.smyl_audit_events where entity_type = 'professional_travel_margin' order by id`);
  assert.equal(audit.length, 3);
  assert.deepEqual(audit[0].after_data, { minutes: 20 });
  assert.equal(audit[0].action, 'insert');
  assert.deepEqual(audit[2].before_data, { minutes: 0 });
});

test('cada clínica tiene su propio margen y nadie lee el de otra', { skip }, async () => {
  await exec(hours(U.ownerB, PRO.drB, BR.b1, 1, '09:00', '13:00'));
  await fails(hours(U.ownerB, PRO.drB, BR.b2, 1, '13:30', '17:00'), /al menos 45 minutos/); // B sigue en 45 aunque A cambió
  await as(U.ownerA);
  assert.deepEqual((await rows(`select tenant_id from public.smyl_schedule_rules`)).map(r => r.tenant_id), [U.ownerA]);
  await as(U.ownerB);
  assert.deepEqual(await rows(`select tenant_id from public.smyl_schedule_rules`), []); // B nunca guardó un ajuste
  await asServer();
});

test('las funciones sólo las ejecuta quien inició sesión y el trigger no se llama a mano', { skip }, async () => {
  await exec(`reset role; set role anon;`);
  await fails(`select public.smyl_set_professional_travel_margin(30)`, /permission denied/);
  await fails(`select * from public.smyl_professional_travel_conflicts()`, /permission denied/);
  await asServer();
  await as(U.admin);
  await fails(`select public.smyl_prevent_professional_branch_conflict()`, /permission denied/);
  await asServer();
});

test('la lista de choques muestra lo que ya existía, sólo a la clínica correspondiente', { skip }, async () => {
  // Horarios guardados antes de la regla: se insertan con el trigger apagado.
  await exec(`alter table public.smyl_professional_hours disable trigger smyl_professional_hours_travel_margin;`);
  await exec(hours(U.ownerA, PRO.dr2, BR.a3, 6, '09:00', '12:00'));
  await exec(hours(U.ownerA, PRO.dr2, BR.a1, 6, '12:20', '15:00')); // 20 min de separación
  await exec(hours(U.ownerA, PRO.dr2, BR.a2, 6, '11:00', '13:00')); // traslape directo con Plaza Sol
  await exec(`alter table public.smyl_professional_hours enable trigger smyl_professional_hours_travel_margin;`);
  await as(U.reader);
  const found = await rows(`select professional_id, weekday, gap_minutes, required_minutes from public.smyl_professional_travel_conflicts() where weekday = 6 order by gap_minutes`);
  assert.ok(found.length >= 2, JSON.stringify(found));
  assert.ok(found.every(r => r.professional_id === PRO.dr2 && r.required_minutes === 45));
  assert.ok(found.some(r => r.gap_minutes === 20) && found.some(r => r.gap_minutes < 0), 'incluye separación corta y traslape: ' + JSON.stringify(found));
  assert.ok(!found.some(r => r.professional_id === PRO.drB), 'no mezcla otra clínica');
  await as(U.ownerB);
  const other = await rows(`select * from public.smyl_professional_travel_conflicts()`);
  assert.ok(other.every(r => r.professional_id === PRO.drB), 'la clínica B sólo ve lo suyo');
  await asServer();
});

test('la lista de choques exige permiso de agenda', { skip }, async () => {
  await as(U.admin); // sólo tiene clinic.manage: no puede leer horarios
  await fails(`select * from public.smyl_professional_travel_conflicts()`, /Sin permiso/);
  await asServer();
});

test('las migraciones nuevas están registradas y no tocan datos existentes', () => {
  const phone = read('supabase/migrations/20261118120000_smyl_professional_internal_phone.sql');
  const margin = read('supabase/migrations/20261118130000_smyl_professional_travel_margin.sql');
  assert.doesNotMatch(phone, /\b(delete|truncate|drop table|update public)\b/i);
  assert.doesNotMatch(margin, /\b(delete from|truncate|drop table|update public\.smyl_professional_hours)\b/i);
  assert.match(margin, /smyl_set_professional_travel_margin/);
  assert.match(margin, /revoke all on function public\.smyl_prevent_professional_branch_conflict\(\) from public, anon, authenticated/);
});
