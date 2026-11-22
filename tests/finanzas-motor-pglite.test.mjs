// Finanzas · paso 4 «Motor» — migración 20261123130000 en un Postgres real en memoria (PGlite).
// Verifica los saldos calculados en la base de datos (misma regla que la pantalla) y «aplicar un saldo a favor a un cargo»:
// permisos, aislamiento entre clínicas, repartir de los pagos más antiguos, límites, idempotencia y auditoría.
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
const ROLE_FIN = 'f1000000-0000-4000-8000-000000000001', ROLE_READ = 'f1000000-0000-4000-8000-000000000002', ROLE_DENT = 'f1000000-0000-4000-8000-000000000003';
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', PB = '33333333-3333-4333-8333-333333333333';
const id = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BR = 'b0000000-0000-4000-8000-000000000001';

let db, exec, as, asServer;
const rows = async q => (await db.query(q)).rows;
const fails = async (q, re, label) => { try { await exec(q); } catch (e) { assert.match(String(e.message), re, label || q.slice(-90)); return; } assert.fail('no falló: ' + (label || q.slice(-90))); };
const apply = (n, patient, charge, amount, key) => `select * from public.smyl_apply_credit_to_charge('${id(n)}','${key || id(n + 500)}','${patient}','${charge}',${amount})`;
const balance = async patient => { const r = (await rows(`select * from public.smyl_finance_account_balances('${patient}'::uuid,'2026-11-23'::date)`))[0]; return r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])); };

if (!skip) {
  db = new pglite.PGlite();
  exec = q => db.exec(q);
  as = uid => exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
  asServer = () => exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(`
    alter table public.smyl_finance_charges add column if not exists total_amount numeric(12,2) not null default 0, add column if not exists due_on date;
    alter table public.smyl_finance_charges add unique(tenant_id,id);
    alter table public.smyl_finance_payments add column if not exists amount numeric(12,2) not null default 0;
    alter table public.smyl_finance_payments add unique(tenant_id,id);
    alter table public.smyl_finance_refunds add column if not exists amount numeric(12,2) not null default 0;
    create table public.smyl_finance_payment_allocations (tenant_id uuid not null, payment_id uuid not null, charge_id uuid not null, amount numeric(12,2) not null, primary key(tenant_id,payment_id,charge_id));
    create table public.smyl_finance_refund_allocations (tenant_id uuid not null, refund_id uuid not null, charge_id uuid not null, amount numeric(12,2) not null);
  `);
  const migration = read('supabase/migrations/20261123130000_smyl_finance_engine.sql');
  await exec(migration);
  await exec(migration); // idempotente
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${U.reception}','${U.ownerA}','staff',true),('${U.reader}','${U.ownerA}','staff',true),('${U.dentist}','${U.ownerA}','staff',true);
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${ROLE_FIN}','${U.ownerA}','recepcion','Recepción',true),('${ROLE_READ}','${U.ownerA}','lectura','Lectura',true),('${ROLE_DENT}','${U.ownerA}','dentista','Dentista',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values ('${U.ownerA}','${ROLE_FIN}','finance.manage'),('${U.ownerA}','${ROLE_FIN}','finance.read'),('${U.ownerA}','${ROLE_READ}','finance.read');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${U.ownerA}','${U.reception}','${ROLE_FIN}'),('${U.ownerA}','${U.reader}','${ROLE_READ}'),('${U.ownerA}','${U.dentist}','${ROLE_DENT}');
    insert into public.camila_pacientes(id,tenant_id,nombre) values ('${P1}','${U.ownerA}','P1'),('${P2}','${U.ownerA}','P2'),('${PB}','${U.ownerB}','PB');
    -- P1: cargo 1000 (vencido) con dos pagos de 600 (el 1.º aplicado 600 al cargo 1; el 2.º aplicado 100) → a favor 500... se ajusta abajo
    insert into public.smyl_finance_charges(id,tenant_id,patient_id,total_amount,due_on,status) values
      ('${id(1)}','${U.ownerA}','${P1}',1000,'2026-11-01','open'),
      ('${id(2)}','${U.ownerA}','${P1}',300,'2026-12-15','open'),
      ('${id(3)}','${U.ownerA}','${P1}',200,null,'voided'),
      ('${id(4)}','${U.ownerA}','${P2}',500,null,'open'),
      ('${id(5)}','${U.ownerB}','${PB}',100,null,'open');
    insert into public.smyl_finance_payments(id,tenant_id,patient_id,amount,paid_at) values
      ('${id(11)}','${U.ownerA}','${P1}',700,'2026-11-02T10:00:00Z'),
      ('${id(12)}','${U.ownerA}','${P1}',400,'2026-11-10T10:00:00Z'),
      ('${id(13)}','${U.ownerA}','${P2}',100,'2026-11-05T10:00:00Z');
    insert into public.smyl_finance_payment_allocations(tenant_id,payment_id,charge_id,amount) values
      ('${U.ownerA}','${id(11)}','${id(1)}',600),
      ('${U.ownerA}','${id(12)}','${id(2)}',100);
  `);
  // P1: pagos 1100, aplicado 700 → a favor 400 (100 del 1.º pago y 300 del 2.º). Cargo 1: debe 400 (vencido); cargo 2: debe 200.
}

test('los saldos salen de la base de datos con la misma regla que la pantalla', { skip }, async () => {
  await as(U.reader);
  const b = await balance(P1);
  assert.equal(b.total_amount, 1300, 'los cargos anulados no cuentan');
  assert.equal(b.paid_amount, 700);
  assert.equal(b.due_amount, 600);
  assert.equal(b.overdue_amount, 400, 'solo el cargo 1 está vencido');
  assert.equal(b.open_total_amount, 1300);
  assert.equal(b.credit_amount, 400);
  assert.equal(b.open_charges, 2);
  assert.equal(new Date(b.overdue_since).toISOString().slice(0, 10), '2026-11-01');
  const all = await rows(`select patient_id from public.smyl_finance_account_balances(null,'2026-11-23') order by 1`);
  assert.deepEqual(all.map(r => r.patient_id), [P1, P2], 'solo pacientes de mi clínica');
  await as(U.dentist); await fails(`select * from public.smyl_finance_account_balances()`, /Sin permiso/);
  await as(U.ownerB); assert.deepEqual((await rows(`select patient_id from public.smyl_finance_account_balances()`)).map(r => r.patient_id), [PB]);
  await asServer();
});

test('aplicar saldo a favor: permisos, validaciones y límites', { skip }, async () => {
  await as(U.reader); await fails(apply(1, P1, id(1), 50), /Sin permiso/);
  await as(U.dentist); await fails(apply(1, P1, id(1), 50), /Sin permiso/);
  await as(U.ownerB); await fails(apply(1, P1, id(1), 50), /no existe|otro paciente/);
  await as(U.reception);
  await fails(apply(1, P1, id(1), 0), /mayor a cero/);
  await fails(apply(1, P1, id(1), 10.005), /dos decimales/);
  await fails(apply(1, P1, id(3), 10), /anulado/);
  await fails(apply(1, P2, id(1), 10), /otro paciente/);
  await fails(apply(1, P1, id(1), 400.01), /supera el saldo del cargo/);
  await fails(apply(1, P1, id(2), 200.01), /supera el saldo del cargo/);
  await fails(apply(1, P2, id(4), 100.01), /supera el saldo a favor/, 'P2 solo tiene $100.00 a favor');
  await asServer();
  assert.equal((await rows(`select 1 from public.smyl_finance_credit_applications`)).length, 0, 'ningún intento fallido deja rastro');
  assert.equal((await rows(`select sum(amount)::numeric as s from public.smyl_finance_payment_allocations`))[0].s, '700.00');
});

test('aplicar saldo a favor reparte de los pagos más antiguos y es idempotente', { skip }, async () => {
  await as(U.reception);
  const first = (await rows(apply(1, P1, id(1), 250, id(901))))[0];
  assert.equal(Number(first.amount), 250);
  assert.deepEqual(first.sources.map(s => [s.payment_id, Number(s.amount)]), [[id(11), 100], [id(12), 150]], 'primero lo que le quedaba al pago más antiguo');
  const again = (await rows(apply(2, P1, id(1), 250, id(901))))[0];
  assert.equal(again.id, id(1), 'la misma llave devuelve la misma aplicación');
  await asServer();
  assert.equal((await rows(`select 1 from public.smyl_finance_credit_applications`)).length, 1);
  assert.equal((await rows(`select sum(amount)::numeric as s from public.smyl_finance_payment_allocations`))[0].s, '950.00', 'se aplicó una sola vez');
  await as(U.reader);
  const b = await balance(P1);
  assert.equal(b.credit_amount, 150); assert.equal(b.due_amount, 350); assert.equal(b.overdue_amount, 150);
  await as(U.reception);
  // El resto del saldo a favor cabe en otro cargo; el cargo 2 ya tenía una aplicación (se suma a la misma fila).
  await exec(apply(3, P1, id(2), 150, id(902)));
  await fails(apply(4, P1, id(2), 1, id(903)), /supera el saldo a favor/);
  await asServer();
  assert.equal((await rows(`select amount::numeric as a from public.smyl_finance_payment_allocations where payment_id='${id(12)}' and charge_id='${id(2)}'`))[0].a, '250.00');
  await as(U.reader);
  const after = await balance(P1);
  assert.equal(after.credit_amount, 0); assert.equal(after.due_amount, 200);
  await asServer();
});

test('el saldo a favor no se toca por escritura directa y la tabla solo se lee con finance.read', { skip }, async () => {
  await as(U.reception); await fails(`insert into public.smyl_finance_credit_applications(id,tenant_id,idempotency_key,patient_id,charge_id,amount,created_by) values ('${id(70)}','${U.ownerA}','${id(71)}','${P1}','${id(1)}',1,'${U.reception}')`, /permission denied/);
  assert.equal((await rows(`select 1 from public.smyl_finance_credit_applications`)).length, 2, 'solo quedan las dos aplicaciones hechas por la función');
  await as(U.dentist); assert.equal((await rows(`select 1 from public.smyl_finance_credit_applications`)).length, 0);
  await as(U.ownerB); assert.equal((await rows(`select 1 from public.smyl_finance_credit_applications`)).length, 0);
  await asServer();
});
