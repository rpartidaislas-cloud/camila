import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(process.env.SMYL_PGLITE_DIR
  ? path.resolve(process.env.SMYL_PGLITE_DIR, 'loader.cjs') : import.meta.url);
let engine;
try { engine = require('@electric-sql/pglite'); } catch (error) {
  if (process.env.SMYL_REQUIRE_PGLITE === '1' || error.code !== 'MODULE_NOT_FOUND') throw error;
}
const read = file => readFile(new URL(file, import.meta.url), 'utf8');

test('respuestas rápidas: dos clínicas, lector, anónimo y edición concurrente', { skip: !engine && 'Requiere PGlite' }, async t => {
  const db = new engine.PGlite();
  t.after(() => db.close());
  await db.exec(await read('./fixtures/radiograph-contracts/pglite-base.sql'));
  const migration = await read('../supabase/migrations/20261117230000_smyl_chat_quick_replies.sql');
  await db.exec(migration);
  await db.exec(migration);
  const [clinicA, clinicB, reader, role] = Array.from({ length: 4 }, () => randomUUID());
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [clinicA, clinicB, reader]);
  await db.query('insert into camila_tenants(id) values ($1),($2)', [clinicA, clinicB]);
  await db.query('insert into camila_usuarios(id,tenant_id) values ($1,$2)', [reader, clinicA]);
  await db.query("insert into smyl_roles(id,tenant_id,code,name) values ($1,$2,'lector','Lector')", [role, clinicA]);
  await db.query("insert into smyl_role_permissions(tenant_id,role_id,permission_key) values ($1,$2,'messages.read')", [clinicA, role]);
  await db.query('insert into smyl_member_roles(tenant_id,user_id,role_id) values ($1,$2,$3)', [clinicA, reader, role]);
  const as = async user => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec('set role authenticated');
  };
  const list = async () => (await db.query('select * from smyl_list_quick_replies()')).rows;
  const save = async (id, text, version) => (await db.query("select smyl_save_quick_reply($1,'horario',$2,$3) as r", [id,text,version])).rows[0].r;
  const remove = (id, version) => db.query('select smyl_delete_quick_reply($1,$2)', [id,version]);
  await as(clinicA);
  const a = await save(null,'Horario A',null);
  assert.deepEqual(await list(), [a]);
  await as(clinicB);
  assert.deepEqual(await list(), []);
  const b = await save(null,'Horario B',null);
  assert.deepEqual(await list(), [b]);
  await assert.rejects(save(a.id,'Cambio',1), { code: '40001' });
  await assert.rejects(remove(a.id,1), { code: '40001' });
  await as(reader);
  assert.deepEqual(await list(), [a]);
  await assert.rejects(save(null,'Nuevo',null), { code: '42501' });
  await assert.rejects(remove(a.id,1), { code: '42501' });
  await assert.rejects(db.query('select * from smyl_chat_quick_replies'), { code: '42501' });
  await as(clinicA);
  const updated = await save(a.id,'Horario A actualizado',1);
  assert.equal(updated.version, 2);
  await assert.rejects(save(a.id,'Versión antigua',1), { code: '40001' });
  await remove(a.id,2);
  assert.deepEqual(await list(), []);
  await as(clinicB);
  assert.deepEqual(await list(), [b]);
  await db.exec('reset role; set role anon');
  await assert.rejects(list(), { code: '42501' });
});
