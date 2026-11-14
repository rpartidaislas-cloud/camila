// Pacientes pendientes de cargo — migración 20261108140000 en un Postgres real en memoria (PGlite).
// Verifica: permisos (sólo finance.manage escribe, finance.read lee), aislamiento entre clínicas, que sólo se cierren
// sin cargo citas en las que el paciente ya llegó y que no tienen cargo vigente, reapertura, auditoría e idempotencia.
//
// Requiere @electric-sql/pglite (como radiograph-pglite-stage1): SMYL_PGLITE_DIR=/ruta/con/node_modules node --test <este archivo>
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

const U = { ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', reception: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', reader: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', dentist: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' };
const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';
const A = { arrived: 'a0000000-0000-4000-8000-000000000001', confirmed: 'a0000000-0000-4000-8000-000000000002', charged: 'a0000000-0000-4000-8000-000000000003', completed: 'a0000000-0000-4000-8000-000000000004', otherTenant: 'a0000000-0000-4000-8000-000000000009' };
const ROLE_FIN = 'f1000000-0000-4000-8000-000000000001', ROLE_READ = 'f1000000-0000-4000-8000-000000000002', ROLE_DENT = 'f1000000-0000-4000-8000-000000000003';

let db, exec, as, asServer;
const rows = async q => (await db.query(q)).rows;
const fails = async (q, re) => assert.rejects(() => exec(q), re);

if (!skip) {
  db = new pglite.PGlite();
  exec = q => db.exec(q);
  as = uid => exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  asServer = () => exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(`
    alter table public.smyl_appointments add column if not exists status text not null default 'confirmed', add column if not exists starts_at timestamptz not null default now();
    do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.smyl_appointments'::regclass and contype in ('u','p') and array_length(conkey,1) = 2) then alter table public.smyl_appointments add unique (tenant_id, id); end if; end $$;
    alter table public.smyl_finance_charges add column if not exists appointment_id uuid;
    do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.camila_pacientes'::regclass and contype in ('u','p') and array_length(conkey,1) = 2) then alter table public.camila_pacientes add unique (tenant_id, id); end if; end $$;
    create or replace function public.smyl_tenants_with_permission(p_permission text) returns setof uuid language sql stable security definer set search_path = pg_catalog, public as $$
      select ct.id from public.camila_tenants ct where ct.id = auth.uid() and ct.activo
      union select cu.tenant_id from public.camila_usuarios cu
        join public.smyl_member_roles mr on mr.tenant_id = cu.tenant_id and mr.user_id = cu.id
        join public.smyl_roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
        join public.smyl_role_permissions rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
        where cu.id = auth.uid() and cu.activo and rp.permission_key = p_permission $$;
    grant execute on function public.smyl_tenants_with_permission(text) to authenticated;
    grant select on public.smyl_appointments, public.smyl_finance_charges to authenticated;
  `);
  const migration = read('supabase/migrations/20261108140000_smyl_appointment_no_charge.sql');
  await exec(migration);
  await exec(migration); // idempotente
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${U.reception}','${U.ownerA}','staff',true),('${U.reader}','${U.ownerA}','staff',true),('${U.dentist}','${U.ownerA}','staff',true);
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${ROLE_FIN}','${U.ownerA}','recepcion','Recepción',true),('${ROLE_READ}','${U.ownerA}','lectura','Lectura',true),('${ROLE_DENT}','${U.ownerA}','dentista','Dentista',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values ('${U.ownerA}','${ROLE_FIN}','finance.manage'),('${U.ownerA}','${ROLE_FIN}','finance.read'),('${U.ownerA}','${ROLE_READ}','finance.read');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${U.ownerA}','${U.reception}','${ROLE_FIN}'),('${U.ownerA}','${U.reader}','${ROLE_READ}'),('${U.ownerA}','${U.dentist}','${ROLE_DENT}');
    insert into public.camila_pacientes(id,tenant_id,nombre) values ('${P1}','${U.ownerA}','P1'),('${P3}','${U.ownerB}','P3');
    insert into public.smyl_appointments(id,tenant_id,patient_id,status) values
      ('${A.arrived}','${U.ownerA}','${P1}','arrived'),('${A.confirmed}','${U.ownerA}','${P1}','confirmed'),
      ('${A.charged}','${U.ownerA}','${P1}','completed'),('${A.completed}','${U.ownerA}','${P1}','completed'),
      ('${A.otherTenant}','${U.ownerB}','${P3}','arrived');
    insert into public.smyl_finance_charges(tenant_id,appointment_id,status) values ('${U.ownerA}','${A.charged}','open');
  `);
}

const mark = (id, reason = 'review', note = '') => `select public.smyl_mark_appointment_no_charge('${id}','${reason}','${note}')`;

test('sólo quien gestiona cobros puede cerrar una visita sin cargo', { skip }, async () => {
  await as(U.dentist); await fails(mark(A.arrived), /Sin permiso/);
  await as(U.reader); await fails(mark(A.arrived), /Sin permiso/);
  await as(U.reception); await exec(mark(A.arrived, 'review', 'Solo revisión')); await asServer();
  const saved = await rows(`select reason, note, decided_by from public.smyl_appointment_no_charge where appointment_id='${A.arrived}'`);
  assert.deepEqual(saved.map(r => [r.reason, r.note, r.decided_by]), [['review', 'Solo revisión', U.reception]]);
});

test('la lectura exige finance.read y no cruza clínicas', { skip }, async () => {
  await as(U.reader); assert.equal((await rows(`select 1 from public.smyl_appointment_no_charge`)).length, 1);
  await as(U.dentist); assert.equal((await rows(`select 1 from public.smyl_appointment_no_charge`)).length, 0, 'sin finance.read no ve nada');
  await as(U.ownerB); assert.equal((await rows(`select 1 from public.smyl_appointment_no_charge`)).length, 0, 'otra clínica no ve la decisión');
  await asServer();
});

test('el navegador no puede escribir en la tabla directamente', { skip }, async () => {
  await as(U.ownerA);
  await fails(`insert into public.smyl_appointment_no_charge(tenant_id,appointment_id,reason) values ('${U.ownerA}','${A.completed}','other')`, /permission denied/);
  await fails(`delete from public.smyl_appointment_no_charge`, /permission denied/);
  await asServer();
});

test('sólo se cierran citas en las que el paciente ya llegó y sin cargo vigente', { skip }, async () => {
  await as(U.reception);
  await fails(mark(A.confirmed), /ya llegó/);
  await fails(mark(A.charged), /ya tiene un cargo/);
  await fails(mark(A.otherTenant), /no existe en tu clínica/);
  await fails(mark(A.completed, 'inventado'), /Elige el motivo/);
  await exec(mark(A.completed, 'courtesy')); // una cita terminada también puede cerrarse
  await exec(mark(A.completed, 'warranty')); // repetir sólo cambia el motivo
  await asServer();
  assert.deepEqual((await rows(`select reason from public.smyl_appointment_no_charge where appointment_id='${A.completed}'`)).map(r => r.reason), ['warranty']);
});

test('un cargo anulado no impide cerrar la visita sin cargo', { skip }, async () => {
  await asServer();
  await exec(`update public.smyl_finance_charges set status='voided' where appointment_id='${A.charged}'`);
  await as(U.reception); await exec(mark(A.charged, 'other', 'Cargo anulado')); await asServer();
  assert.equal((await rows(`select 1 from public.smyl_appointment_no_charge where appointment_id='${A.charged}'`)).length, 1);
});

test('reabrir vuelve a dejar la cita pendiente y todo queda en auditoría sin datos clínicos', { skip }, async () => {
  await as(U.dentist); await fails(`select public.smyl_reopen_appointment_charge('${A.arrived}')`, /Sin permiso/);
  await as(U.reception); await exec(`select public.smyl_reopen_appointment_charge('${A.arrived}')`);
  await exec(`select public.smyl_reopen_appointment_charge('${A.arrived}')`); // idempotente
  await asServer();
  assert.equal((await rows(`select 1 from public.smyl_appointment_no_charge where appointment_id='${A.arrived}'`)).length, 0);
  const audit = await rows(`select action, entity_type, before_data, after_data from public.smyl_audit_events where entity_type='appointment_no_charge' and entity_id='${A.arrived}' order by id`);
  assert.deepEqual(audit.map(r => r.action), ['insert', 'delete']);
  assert.doesNotMatch(JSON.stringify(audit), /Solo revisión/, 'la nota libre no se copia a la auditoría');
});

test('la migración es sólo aditiva y no toca citas ni cargos', () => {
  const sql = read('supabase/migrations/20261108140000_smyl_appointment_no_charge.sql');
  assert.doesNotMatch(sql, /\b(update|delete from|alter table|drop table|truncate)\s+public\.(smyl_appointments|smyl_finance_)/i);
});
