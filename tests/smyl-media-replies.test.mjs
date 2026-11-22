import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve(process.env.SMYL_PGLITE_DIR || '.', 'loader.cjs'));
let PGlite;
try {
    ({ PGlite } = require('@electric-sql/pglite'));
}
catch (e) {
    if (process.env.SMYL_REQUIRE_PGLITE === '1')
        throw e;
}
const migration = readFileSync(new URL('../supabase/migrations/20261122210000_smyl_assistant_media_replies.sql', import.meta.url), 'utf8');
test('reglas privadas, prueba previa y versiones activas por clínica', { skip: !PGlite }, async (t) => {
    const db = new PGlite();
    t.after(() => db.close());
    const clinic = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', agent = '33333333-3333-4333-8333-333333333333', id = '44444444-4444-4444-8444-444444444444';
    const asset = clinic + '/' + id + '~ejemplo.mp4';
    await db.exec(`create schema auth;create schema storage;create role anon;create role authenticated;
    create table public.camila_tenants(id uuid primary key);
    create table storage.objects(bucket_id text,name text,metadata jsonb);
    create table storage.buckets(id text primary key,name text, public boolean,file_size_limit bigint,allowed_mime_types text[]);
    alter table storage.objects enable row level security;
    grant usage on schema storage,auth to authenticated;grant select,insert on storage.objects to authenticated;
    create function auth.uid() returns uuid language sql as $$select current_setting('smyl.actor')::uuid$$;
    create function public.smyl_current_tenant() returns uuid language sql as $$select current_setting('smyl.clinic')::uuid$$;
    create function public.smyl_has_permission(uuid,text) returns boolean language sql as $$select current_setting('smyl.can_chat')='yes'$$;`);
    await db.exec(migration);
    await db.query('insert into camila_tenants values ($1),($2)', [clinic, other]);
    const session = async (tenant, user, canChat) => { await db.query("select set_config('smyl.clinic',$1,false),set_config('smyl.actor',$2,false),set_config('smyl.can_chat',$3,false)", [tenant, user, canChat ? 'yes' : 'no']); };
    await session(clinic, clinic, true);
    await db.exec('set role authenticated');
    await db.query("insert into storage.objects values ('smyl-assistant-media',$1,'{\"mimetype\":\"video/mp4\"}')", [asset]);
    const draft = { title: 'Carillas', text: 'Te comparto un ejemplo.', topics: ['carillas'], requests: ['fotos', 'cómo se ven'], exclude: ['en mí'], channels: ['instagram'], asset };
    async function action(a, v, d = null, msg = '', c = 'instagram') {
        return (await db.query('select smyl_edit_media_rule($1,$2,$3,$4,$5,$6) as r', [a, id, v, d && JSON.stringify(d), msg, c])).rows[0].r;
    }
    const suggest = async (q, c = 'instagram') => (await db.query('select * from smyl_suggest_media_reply($1,$2)', [q, c])).rows;
    const files = async () => (await db.query('select name from storage.objects')).rows;
    const q = '¿Cómo se ven las CARILLAS?';
    await action('save', 0, draft);
    assert.deepEqual(await suggest(q), []);
    await assert.rejects(action('activate', 1), /Prueba/);
    for (const [msg, channel] of [['¿Cuánto cuestan las carillas?', 'instagram'], ['fotos de carillas en mí', 'instagram'], [q, 'whatsapp'], ['fotos de mascarillas', 'instagram']])
        assert.equal((await action('test', 1, null, msg, channel)).matched, false);
    assert.equal((await action('test', 1, null, q)).matched, true);
    await session(clinic, agent, true);
    assert.equal((await files()).length, 0);
    await assert.rejects(action('activate', 1));
    await session(clinic, clinic, true);
    await action('activate', 1);
    await action('save', 1, { ...draft, text: 'Texto nuevo.' });
    await assert.rejects(action('activate', 2), /Prueba/);
    await assert.rejects(action('save', 1, draft), /cambió/);
    assert.equal((await suggest(q))[0].reply_text, draft.text);
    await session(clinic, agent, true);
    assert.equal((await files()).length, 1);
    assert.equal((await suggest(q))[0].asset, asset);
    assert.equal((await db.query('select * from smyl_media_rules')).rows.length, 0);
    await session(clinic, agent, false);
    assert.equal((await files()).length, 0);
    assert.deepEqual(await suggest(q), []);
    await session(other, other, true);
    assert.equal((await files()).length, 0);
    assert.deepEqual(await suggest(q), []);
    await assert.rejects(action('save', 0, draft), /archivo/);
    await session(clinic, clinic, true);
    await action('test', 2, null, q);
    await action('activate', 2);
    assert.equal((await suggest(q))[0].reply_text, 'Texto nuevo.');
    await action('pause', 2);
    assert.deepEqual(await suggest(q), []);
});
