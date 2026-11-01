// Reintento explícito de la revisión v1 "sin confirmar": migración, store y botón. La lógica SQL se ejecuta en PGlite
// con un esquema mínimo de la revisión v1 (si PGlite no está, esa parte se omite salvo SMYL_REQUIRE_PGLITE=1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261029090000_smyl_radiograph_review_retry.sql');

test('estático: solo dueña, solo "unconfirmed" o "requested" abandonada, conserva historial y no borra', () => {
  assert.match(migration, /smyl_case_owner\(\)/);
  assert.match(migration, /state'='unconfirmed'/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /insert into public\.smyl_radiograph_review_versions select result\.\*/);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.match(migration, /revoke all on function public\.smyl_retry_radiograph_review\(uuid,uuid,integer\) from public,anon/);
  assert.match(migration, /grant execute on function public\.smyl_retry_radiograph_review\(uuid,uuid,integer\) to authenticated/);
  const store = read('smyl-radiograph-review-store.js'), ui = read('smyl-radiograph-review.js');
  assert.match(store, /smyl_retry_radiograph_review/);
  assert.match(ui, /Volver a intentar/); assert.match(ui, /otro consumo del plan de IA/); assert.match(ui, /run\.store\.retry\(run\.revision\)/);
  for (const f of ['app.html', 'sw.js', 'mobile/www/app.html', 'mobile/www/sw.js']) { const t = read(f); assert.match(t, /smyl-radiograph-review\.js\?v=12/, f); assert.match(t, /smyl-radiograph-review-store\.js\?v=2/, f); }
  for (const f of ['smyl-radiograph-review.js', 'smyl-radiograph-review-store.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});

async function loadPglite() {
  try { return await import('@electric-sql/pglite'); } catch (e) {}
  const dir = process.env.SMYL_PGLITE_DIR;
  if (!dir) return null;
  try { return await import(pathToFileURL(createRequire(path.join(dir, 'noop.js')).resolve('@electric-sql/pglite')).href); } catch (e) { return null; }
}
const pglite = await loadPglite();
if (!pglite && process.env.SMYL_REQUIRE_PGLITE === '1') throw new Error('SMYL_REQUIRE_PGLITE=1 pero PGlite no está disponible.');

test('SQL en Postgres real: reintenta solo lo "unconfirmed", crea revisión nueva, conserva la anterior y respeta dueña/revisión', { skip: pglite ? false : 'PGlite no disponible' }, async () => {
  const db = new pglite.PGlite();
  const U = '11111111-1111-4111-8111-111111111111', O = '22222222-2222-4222-8222-222222222222', P = '33333333-3333-4333-8333-333333333333', S = '44444444-4444-4444-8444-444444444444';
  await db.exec(`
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role authenticated nologin; create role anon nologin;
    create function public.smyl_case_owner() returns boolean language sql stable as $$ select auth.uid() = '${U}'::uuid $$;
    create table public.smyl_radiograph_reviews(patient_id uuid, study_id uuid, tenant_id uuid, revision integer not null, document jsonb not null, updated_at timestamptz not null, updated_by uuid not null, primary key(patient_id,study_id));
    create table public.smyl_radiograph_review_versions(patient_id uuid, study_id uuid, tenant_id uuid, revision integer not null, document jsonb not null, updated_at timestamptz not null, updated_by uuid not null, primary key(patient_id,study_id,revision));
    insert into auth.users values ('${U}'),('${O}');
    insert into public.smyl_radiograph_reviews values ('${P}','${S}','${U}',3,'{"schema":1,"study":{"id":"${S}","type":"panoramic","sha256":"${'a'.repeat(64)}"},"workflow":{"state":"unconfirmed","attempt":1},"analysis":null,"items":[]}',now(),'${U}');`);
  await db.exec(migration);
  const as = async id => { await db.exec(`select set_config('request.jwt.claim.sub','${id}',false)`); };
  const call = rev => db.query(`select * from public.smyl_retry_radiograph_review('${P}','${S}',${rev})`);
  await as(O);
  await assert.rejects(call(3), /access denied/);
  await as(U);
  await assert.rejects(call(2), /revision conflict/);
  const ok = (await call(3)).rows[0];
  assert.equal(ok.revision, 4); assert.equal(ok.document.workflow.state, 'ready'); assert.equal(ok.document.workflow.attempt, 0); assert.equal(ok.document.analysis, null); assert.deepEqual(ok.document.items, []);
  assert.equal(ok.document.study.sha256, 'a'.repeat(64), 'la evidencia (estudio) no cambia');
  assert.equal((await db.query(`select count(*)::int as n from public.smyl_radiograph_review_versions where revision=4`)).rows[0].n, 1);
  assert.equal((await call(3)).rows[0].revision, 4, 'idempotente al repetir con la revisión anterior');
  await assert.rejects(call(4), /Only an unconfirmed review/, 'una revisión "ready" no se reinicia');
  await db.exec(`update public.smyl_radiograph_reviews set revision=5, document=jsonb_set(document,'{workflow,state}','"completed"') where patient_id='${P}'`);
  await assert.rejects(call(5), /Only an unconfirmed review/, 'una revisión completada no se reintenta');
  await db.exec(`update public.smyl_radiograph_reviews set revision=6, document=jsonb_set(document,'{workflow,state}','"requested"'), updated_at=now()`);
  await assert.rejects(call(6), /Only an unconfirmed review/, 'una solicitud reciente puede estar en curso');
  await db.exec(`update public.smyl_radiograph_reviews set updated_at=now()-interval '20 minutes'`);
  assert.equal((await call(6)).rows[0].revision, 7, 'una solicitud abandonada sí');
  await db.close();
});
