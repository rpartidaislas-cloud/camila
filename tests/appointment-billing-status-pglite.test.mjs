// Etiqueta de cobro en la Agenda — smyl_appointment_billing (migración 20261108150000) en un Postgres real en memoria (PGlite).
// Verifica el estado de cada cita (pending / due / paid / no_charge / free), la precedencia entre ellos, que sólo se vean
// citas en las que el paciente ya llegó, que sin finance.read no se devuelva nada, el aislamiento entre clínicas y que sea sólo lectura.
//
// Requiere @electric-sql/pglite: SMYL_PGLITE_DIR=/ruta/con/node_modules node --test <este archivo>   (se omite si no está; falla con SMYL_REQUIRE_PGLITE=1)
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

const U = { ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', reader: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', dentist: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' };
const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';
const S_PAID = '50000000-0000-4000-8000-000000000001', S_FREE = '50000000-0000-4000-8000-000000000002';
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { pending: id(1), due: id(2), paid: id(3), noCharge: id(4), free: id(5), confirmed: id(6), refunded: id(7), voidedOnly: id(8), chargeBeatsNoCharge: id(9), twoCharges: id(10), other: id(99) };
const ROLE_READ = 'f1000000-0000-4000-8000-000000000002', ROLE_DENT = 'f1000000-0000-4000-8000-000000000003';

let db, exec, as, asServer;
const billing = async ids => Object.fromEntries((await db.query(`select * from public.smyl_appointment_billing(array[${ids.map(i => `'${i}'::uuid`).join(',')}]::uuid[])`)).rows.map(r => [r.appointment_id, [r.billing_state, Number(r.charged_amount), Number(r.due_amount)]]));

if (!skip) {
  db = new pglite.PGlite();
  exec = q => db.exec(q);
  as = uid => exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  asServer = () => exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(`
    alter table public.smyl_appointments add column if not exists status text not null default 'confirmed', add column if not exists starts_at timestamptz not null default now(), add column if not exists service_id uuid;
    do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.smyl_appointments'::regclass and contype in ('u','p') and array_length(conkey,1) = 2) then alter table public.smyl_appointments add unique (tenant_id, id); end if; end $$;
    do $$ begin if not exists (select 1 from pg_constraint where conrelid = 'public.camila_pacientes'::regclass and contype in ('u','p') and array_length(conkey,1) = 2) then alter table public.camila_pacientes add unique (tenant_id, id); end if; end $$;
    alter table public.smyl_finance_charges add column if not exists appointment_id uuid, add column if not exists total_amount numeric(12,2) not null default 0;
    create table public.smyl_services (id uuid primary key, tenant_id uuid not null, reference_price numeric(12,2));
    create table public.smyl_finance_payment_allocations (tenant_id uuid not null, payment_id uuid not null, charge_id uuid not null, amount numeric(12,2) not null);
    create table public.smyl_finance_refund_allocations (tenant_id uuid not null, refund_id uuid not null, charge_id uuid not null, amount numeric(12,2) not null);
    create or replace function public.smyl_tenants_with_permission(p_permission text) returns setof uuid language sql stable security definer set search_path = pg_catalog, public as $$
      select ct.id from public.camila_tenants ct where ct.id = auth.uid() and ct.activo
      union select cu.tenant_id from public.camila_usuarios cu
        join public.smyl_member_roles mr on mr.tenant_id = cu.tenant_id and mr.user_id = cu.id
        join public.smyl_roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
        join public.smyl_role_permissions rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
        where cu.id = auth.uid() and cu.activo and rp.permission_key = p_permission $$;
    grant execute on function public.smyl_tenants_with_permission(text) to authenticated;
  `);
  await exec(read('supabase/migrations/20261108140000_smyl_appointment_no_charge.sql'));
  const migration = read('supabase/migrations/20261108150000_smyl_appointment_billing_status.sql');
  await exec(migration);
  await exec(migration); // idempotente
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${U.reader}','${U.ownerA}','staff',true),('${U.dentist}','${U.ownerA}','staff',true);
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${ROLE_READ}','${U.ownerA}','lectura','Lectura',true),('${ROLE_DENT}','${U.ownerA}','dentista','Dentista',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values ('${U.ownerA}','${ROLE_READ}','finance.read');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${U.ownerA}','${U.reader}','${ROLE_READ}'),('${U.ownerA}','${U.dentist}','${ROLE_DENT}');
    insert into public.camila_pacientes(id,tenant_id,nombre) values ('${P1}','${U.ownerA}','P1'),('${P3}','${U.ownerB}','P3');
    insert into public.smyl_services(id,tenant_id,reference_price) values ('${S_PAID}','${U.ownerA}',800),('${S_FREE}','${U.ownerA}',0);
    insert into public.smyl_appointments(id,tenant_id,patient_id,status,service_id) values
      ('${A.pending}','${U.ownerA}','${P1}','arrived','${S_PAID}'),('${A.due}','${U.ownerA}','${P1}','in_progress','${S_PAID}'),
      ('${A.paid}','${U.ownerA}','${P1}','completed','${S_PAID}'),('${A.noCharge}','${U.ownerA}','${P1}','arrived','${S_PAID}'),
      ('${A.free}','${U.ownerA}','${P1}','arrived','${S_FREE}'),('${A.confirmed}','${U.ownerA}','${P1}','confirmed','${S_PAID}'),
      ('${A.refunded}','${U.ownerA}','${P1}','completed','${S_PAID}'),('${A.voidedOnly}','${U.ownerA}','${P1}','completed','${S_PAID}'),
      ('${A.chargeBeatsNoCharge}','${U.ownerA}','${P1}','completed','${S_PAID}'),('${A.twoCharges}','${U.ownerA}','${P1}','completed','${S_PAID}'),
      ('${A.other}','${U.ownerB}','${P3}','arrived','${S_PAID}');
    insert into public.smyl_finance_charges(id,tenant_id,appointment_id,status,total_amount) values
      ('c0000000-0000-4000-8000-000000000001','${U.ownerA}','${A.due}','open',1000),
      ('c0000000-0000-4000-8000-000000000002','${U.ownerA}','${A.paid}','open',500),
      ('c0000000-0000-4000-8000-000000000003','${U.ownerA}','${A.refunded}','open',400),
      ('c0000000-0000-4000-8000-000000000004','${U.ownerA}','${A.voidedOnly}','voided',300),
      ('c0000000-0000-4000-8000-000000000005','${U.ownerA}','${A.chargeBeatsNoCharge}','open',200),
      ('c0000000-0000-4000-8000-000000000006','${U.ownerA}','${A.twoCharges}','open',600),
      ('c0000000-0000-4000-8000-000000000007','${U.ownerA}','${A.twoCharges}','open',400);
    insert into public.smyl_finance_payment_allocations(tenant_id,payment_id,charge_id,amount) values
      ('${U.ownerA}',gen_random_uuid(),'c0000000-0000-4000-8000-000000000001',300),
      ('${U.ownerA}',gen_random_uuid(),'c0000000-0000-4000-8000-000000000002',500),
      ('${U.ownerA}',gen_random_uuid(),'c0000000-0000-4000-8000-000000000003',400),
      ('${U.ownerA}',gen_random_uuid(),'c0000000-0000-4000-8000-000000000006',600);
    insert into public.smyl_finance_refund_allocations(tenant_id,refund_id,charge_id,amount) values ('${U.ownerA}',gen_random_uuid(),'c0000000-0000-4000-8000-000000000003',150);
    insert into public.smyl_appointment_no_charge(tenant_id,appointment_id,reason) values ('${U.ownerA}','${A.noCharge}','review'),('${U.ownerA}','${A.chargeBeatsNoCharge}','courtesy');
  `);
}

const ALL = Object.values(A);

test('cada cita que ya llegó recibe su estado de cobro con montos', { skip }, async () => {
  await as(U.ownerA);
  const r = await billing(ALL);
  await asServer();
  assert.deepEqual(r[A.pending], ['pending', 0, 0], 'llegó y no hay cargo ni decisión');
  assert.deepEqual(r[A.due], ['due', 1000, 700], 'cargo de 1000 con 300 pagados');
  assert.deepEqual(r[A.paid], ['paid', 500, 0], 'liquidado');
  assert.deepEqual(r[A.noCharge], ['no_charge', 0, 0]);
  assert.deepEqual(r[A.free], ['free', 0, 0], 'servicio de $0: sin etiqueta');
  assert.deepEqual(r[A.refunded], ['due', 400, 150], 'un reembolso devuelve saldo');
  assert.deepEqual(r[A.voidedOnly], ['pending', 0, 0], 'un cargo anulado no cuenta');
  assert.deepEqual(r[A.chargeBeatsNoCharge], ['due', 200, 200], 'con cargo vigente manda el cargo sobre «sin cargo»');
  assert.deepEqual(r[A.twoCharges], ['due', 1000, 400], 'varios cargos de una cita se suman');
});

test('sólo se devuelven citas en las que el paciente ya llegó y de la propia clínica', { skip }, async () => {
  await as(U.ownerA);
  const r = await billing(ALL);
  await asServer();
  assert.equal(A.confirmed in r, false, 'una cita confirmada no tiene etiqueta');
  assert.equal(A.other in r, false, 'otra clínica no se ve');
});

test('sin finance.read no se devuelve nada; con finance.read sí; otra clínica no ve estas citas', { skip }, async () => {
  await as(U.dentist); assert.deepEqual(await billing(ALL), {});
  await as(U.reader); assert.equal(Object.keys(await billing(ALL)).length, 9);
  await as(U.ownerB); assert.deepEqual(Object.keys(await billing(ALL)), [A.other]);
  await asServer();
});

test('entradas vacías no fallan y más de 300 citas se rechazan', { skip }, async () => {
  await as(U.ownerA);
  assert.deepEqual(await billing([]), {});
  await assert.rejects(() => db.query(`select * from public.smyl_appointment_billing(array(select gen_random_uuid() from generate_series(1,301)))`), /Demasiadas citas/);
  await asServer();
});

test('es sólo de lectura: no cambia cargos, pagos ni citas', { skip }, async () => {
  const sql = read('supabase/migrations/20261108150000_smyl_appointment_billing_status.sql');
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public|delete\s+from|alter\s+table|drop\s+table)\b/i);
  assert.match(sql, /\bstable\b/);
});
