// Cobro por «No vino» — migración 20261108160000 en un Postgres real en memoria (PGlite).
// Verifica: monto fijo de la clínica (permisos, validación, auditoría, aislamiento), que una inasistencia sólo se ofrezca para cobrar si hay monto,
// «Perdonar» (motivo waived), que nunca se cobre sola y que las citas no vistas sigan igual que antes.
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

const U = { ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', reception: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', reader: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', dentist: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1' };
const P1 = '11111111-1111-4111-8111-111111111111', P3 = '33333333-3333-4333-8333-333333333333';
const SVC = '50000000-0000-4000-8000-000000000001';
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { noShow: id(1), noShowCharged: id(2), noShowWaived: id(3), confirmed: id(4), noShow2: id(5), other: id(99) };
const ROLE_FIN = 'f1000000-0000-4000-8000-000000000001', ROLE_READ = 'f1000000-0000-4000-8000-000000000002', ROLE_DENT = 'f1000000-0000-4000-8000-000000000003';

let db, exec, as, asServer;
const rows = async q => (await db.query(q)).rows;
const fails = async (q, re) => assert.rejects(() => exec(q), re);
const billing = async ids => Object.fromEntries((await rows(`select * from public.smyl_appointment_billing(array[${ids.map(i => `'${i}'::uuid`).join(',')}]::uuid[])`)).map(r => [r.appointment_id, [r.billing_state, Number(r.charged_amount), Number(r.due_amount)]]));
const ALL = Object.values(A);

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
  for (const file of ['20261108140000_smyl_appointment_no_charge.sql', '20261108150000_smyl_appointment_billing_status.sql']) await exec(read('supabase/migrations/' + file));
  const migration = read('supabase/migrations/20261108160000_smyl_no_show_fee.sql');
  await exec(migration);
  await exec(migration); // idempotente (incluye volver a crear la restricción del motivo)
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${U.reception}','${U.ownerA}','staff',true),('${U.reader}','${U.ownerA}','staff',true),('${U.dentist}','${U.ownerA}','staff',true);
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${ROLE_FIN}','${U.ownerA}','recepcion','Recepción',true),('${ROLE_READ}','${U.ownerA}','lectura','Lectura',true),('${ROLE_DENT}','${U.ownerA}','dentista','Dentista',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values ('${U.ownerA}','${ROLE_FIN}','finance.manage'),('${U.ownerA}','${ROLE_FIN}','finance.read'),('${U.ownerA}','${ROLE_READ}','finance.read');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${U.ownerA}','${U.reception}','${ROLE_FIN}'),('${U.ownerA}','${U.reader}','${ROLE_READ}'),('${U.ownerA}','${U.dentist}','${ROLE_DENT}');
    insert into public.camila_pacientes(id,tenant_id,nombre) values ('${P1}','${U.ownerA}','P1'),('${P3}','${U.ownerB}','P3');
    insert into public.smyl_services(id,tenant_id,reference_price) values ('${SVC}','${U.ownerA}',800);
    insert into public.smyl_appointments(id,tenant_id,patient_id,status,service_id) values
      ('${A.noShow}','${U.ownerA}','${P1}','no_show','${SVC}'),('${A.noShowCharged}','${U.ownerA}','${P1}','no_show','${SVC}'),
      ('${A.noShowWaived}','${U.ownerA}','${P1}','no_show','${SVC}'),('${A.confirmed}','${U.ownerA}','${P1}','confirmed','${SVC}'),
      ('${A.noShow2}','${U.ownerA}','${P1}','no_show','${SVC}'),('${A.other}','${U.ownerB}','${P3}','no_show','${SVC}');
    insert into public.smyl_finance_charges(id,tenant_id,appointment_id,status,total_amount) values ('c0000000-0000-4000-8000-000000000001','${U.ownerA}','${A.noShowCharged}','open',200);
  `);
}

test('sin monto configurado las inasistencias no se ofrecen para cobrar (apagado por omisión)', { skip }, async () => {
  await as(U.ownerA);
  const r = await billing(ALL);
  await asServer();
  assert.deepEqual(r[A.noShow], ['free', 0, 0], 'sin monto: sin etiqueta ni pendiente');
  assert.equal(A.confirmed in r, false);
  assert.deepEqual(r[A.noShowCharged], ['due', 200, 200], 'un cargo ya hecho siempre se ve');
});

test('sólo quien gestiona cobros cambia el monto; se valida y queda en auditoría; se lee con finance.read', { skip }, async () => {
  await as(U.dentist); await fails(`select public.smyl_set_no_show_fee(200)`, /Sin permiso/);
  await as(U.reader); await fails(`select public.smyl_set_no_show_fee(200)`, /Sin permiso/);
  await as(U.reception);
  await fails(`select public.smyl_set_no_show_fee(-5)`, /no es válido/);
  await fails(`select public.smyl_set_no_show_fee(2000000)`, /no es válido/);
  assert.equal(Number((await rows(`select public.smyl_set_no_show_fee(200) as v`))[0].v), 200);
  assert.equal(Number((await rows(`select public.smyl_set_no_show_fee(250.5) as v`))[0].v), 250.5);
  await as(U.reader); assert.equal(Number((await rows(`select no_show_fee from public.smyl_finance_settings`))[0].no_show_fee), 250.5);
  await as(U.dentist); assert.equal((await rows(`select 1 from public.smyl_finance_settings`)).length, 0, 'sin finance.read no se ve');
  await as(U.ownerB); assert.equal((await rows(`select 1 from public.smyl_finance_settings`)).length, 0, 'otra clínica no se ve');
  await as(U.ownerA); await fails(`update public.smyl_finance_settings set no_show_fee = 1`, /permission denied/);
  await asServer();
  const audit = await rows(`select action, before_data, after_data from public.smyl_audit_events where entity_type='no_show_fee' order by id`);
  assert.deepEqual(audit.map(a => a.action), ['insert', 'update']);
  assert.deepEqual(audit[1].before_data, { no_show_fee: 200 });
  assert.deepEqual(audit[1].after_data, { no_show_fee: 250.5 });
});

test('con monto configurado la inasistencia queda por cobrar; con cargo manda el cargo; perdonada se cierra', { skip }, async () => {
  await as(U.reception); await exec(`select public.smyl_mark_appointment_no_charge('${A.noShowWaived}','waived','Avisó tarde')`);
  const r = await billing(ALL);
  await asServer();
  assert.deepEqual(r[A.noShow], ['no_show_pending', 0, 0]);
  assert.deepEqual(r[A.noShowCharged], ['due', 200, 200]);
  assert.deepEqual(r[A.noShowWaived], ['no_charge', 0, 0]);
  assert.equal(A.other in r, false, 'otra clínica no se ve');
  assert.equal(A.confirmed in r, false);
});

test('«Perdonar» sólo la decide quien gestiona cobros, sólo sobre citas vistas o no vistas, y se puede reabrir', { skip }, async () => {
  await as(U.dentist); await fails(`select public.smyl_mark_appointment_no_charge('${A.noShow2}','waived')`, /Sin permiso/);
  await as(U.reception);
  await fails(`select public.smyl_mark_appointment_no_charge('${A.confirmed}','waived')`, /ya llegó, o a las que no vino/);
  await fails(`select public.smyl_mark_appointment_no_charge('${A.noShowCharged}','waived')`, /ya tiene un cargo/);
  await fails(`select public.smyl_mark_appointment_no_charge('${A.noShow2}','otro-motivo')`, /Elige el motivo/);
  await exec(`select public.smyl_mark_appointment_no_charge('${A.noShow2}','waived')`);
  assert.equal((await billing([A.noShow2]))[A.noShow2][0], 'no_charge');
  await exec(`select public.smyl_reopen_appointment_charge('${A.noShow2}')`);
  assert.equal((await billing([A.noShow2]))[A.noShow2][0], 'no_show_pending', 'reabrir la devuelve a pendiente');
  await asServer();
});

test('apagar el monto (0) vuelve a ocultar las inasistencias sin cargo', { skip }, async () => {
  await as(U.ownerA); await exec(`select public.smyl_set_no_show_fee(0)`);
  const r = await billing([A.noShow, A.noShowWaived, A.noShowCharged]);
  await asServer();
  assert.equal(r[A.noShow][0], 'free');
  assert.equal(r[A.noShowWaived][0], 'no_charge', 'lo ya perdonado se conserva');
  assert.equal(r[A.noShowCharged][0], 'due', 'lo ya cobrado se conserva');
});

test('la migración es aditiva: no toca citas, cargos ni pagos', { skip }, () => {
  const sql = read('supabase/migrations/20261108160000_smyl_no_show_fee.sql');
  assert.doesNotMatch(sql, /\b(update|delete from|drop table|truncate)\s+public\.(smyl_appointments|smyl_finance_(charges|payments|payment_allocations|refund))/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.smyl_finance_charges/i, 'nunca crea cargos por su cuenta');
});
