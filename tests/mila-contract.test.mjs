import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('MILA never exposes the OpenAI key in browser HTML', () => {
  const html = read('mila.html');
  assert.doesNotMatch(html, /OPENAI_API_KEY|sk-proj-|api\.openai\.com/);
  assert.match(html, /mila-realtime-session/);
  assert.match(html, /mila-transcribe/);
});
test('MILA requires consent and explicit confirmation', () => {
  const html = read('mila.html');
  const actions = read('supabase/functions/mila-actions/index.ts');
  const transcribe = read('supabase/functions/mila-transcribe/index.ts');
  assert.match(html, /id="consent"/);
  assert.match(html, /form\.append\('consent_confirmed','true'\)/);
  assert.match(transcribe, /form\.get\("consent_confirmed"\) !== "true"/);
  assert.match(html, /Confirmar y guardar/);
  assert.match(actions, /requires_confirmation: true/);
  assert.match(actions, /admin\.rpc\("mila_confirm_action"/);
  const migration = read('supabase/migrations/20261015160000_mila_core_and_consumables.sql');
  assert.match(migration, /create function public\.mila_confirm_action/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /public\.smyl_validate_appointment_slot/i);
  assert.match(migration, /insert into public\.smyl_proposals/i);
  assert.doesNotMatch(migration, /create table public\.camila_(citas|cotizaciones)/i);
});
test('Realtime and action endpoints require a real authenticated user', () => {
  for (const path of [
    'supabase/functions/mila-realtime-session/index.ts',
    'supabase/functions/mila-transcribe/index.ts',
    'supabase/functions/mila-actions/index.ts',
  ]) {
    const source = read(path);
    assert.match(source, /if \(!user \|\| !tenantId\)/, path);
    assert.match(source, /requireUser\(req, CORS\)/, path);
  }
  const realtime = read('supabase/functions/mila-realtime-session/index.ts');
  assert.match(realtime, /max_output_tokens: 900/);
  assert.doesNotMatch(realtime, /max_response_output_tokens/);
});
test('MILA migration provides RLS, private audio and an idempotent ledger', () => {
  const sql = read('supabase/migrations/20261015160000_mila_core_and_consumables.sql');
  assert.match(sql, /alter table public\.mila_sessions enable row level security/i);
  assert.match(sql, /'mila-audio', 'mila-audio', false/i);
  assert.match(sql, /unique \(tenant_id, idempotency_key\)/i);
  assert.match(sql, /create function public\.smyl_consume/i);
  assert.match(sql, /meter_only/);
});
test('Consumables cover MILA, WhatsApp and SMYL AI credits', () => {
  const sql = read('supabase/migrations/20261015160000_mila_core_and_consumables.sql');
  const metaSend = read('supabase/functions/meta-send/index.ts');
  const analyze = read('supabase/functions/analizar-foto/index.ts');
  for (const resource of ['mila_seconds', 'whatsapp_messages', 'ai_credits']) {
    assert.match(sql, new RegExp(resource));
  }
  assert.match(metaSend, /p_resource: "whatsapp_messages"/);
  assert.match(analyze, /p_resource: "ai_credits"/);
});

test('MILA uses the current clinic catalog instead of hard-coded prices', () => {
  const actions = read('supabase/functions/mila-actions/index.ts');
  const realtime = read('supabase/functions/mila-realtime-session/index.ts');
  assert.match(actions, /from\("smyl_services"\)/);
  assert.match(actions, /from\("smyl_professionals"\)/);
  assert.match(actions, /mila_actor_has_permission/);
  assert.doesNotMatch(actions, /DEFAULT_PRICES/);
  assert.match(realtime, /buscar_opciones_clinica/);
});

test('The admin shell exposes MILA and consumables', () => {
  const app = read('app.html');
  const mobile = read('mobile/www/index.html');
  assert.match(app, /location\.href='mila\.html'/);
  assert.match(app, /location\.href='consumos\.html'/);
  assert.match(mobile, /href="mila\.html"/);
});

test('MILA browser scripts parse successfully', () => {
  for (const path of ['mila.html', 'consumos.html']) {
    const html = read(path);
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((source) => source.trim());
    assert.ok(scripts.length > 0, `${path} should include an inline application script`);
    for (const source of scripts) assert.doesNotThrow(() => new Function(source), path);
  }
});
// End of MILA contract tests.
