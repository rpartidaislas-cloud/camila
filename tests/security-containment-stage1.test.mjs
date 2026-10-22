import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('private Edge Functions reject a publishable key without a user session', () => {
  const auth = read('supabase/functions/_shared/auth.ts');
  assert.match(auth, /return deny\('No autenticado: la sesión no es válida o ya expiró\.'\)/);
  assert.doesNotMatch(auth, /return \{ user: null, tenantId: null, response: null \}/);
});

test('critical and intentionally public functions have explicit JWT policy', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /\[functions\.claude\][\s\S]*?verify_jwt = true/);
  assert.match(config, /\[functions\.segment-teeth\][\s\S]*?verify_jwt = true/);
  for (const name of ['meta-webhook', 'stripe-webhook', 'public-appointment-request', 'public-profile-event', 'public-professional-cases', 'public-patient-reviews']) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\][\\s\\S]*?verify_jwt = false`));
  }
});

test('the browser has no direct Anthropic credential path', () => {
  for (const path of ['app.html', 'mobile/www/app.html']) {
    const html = read(path);
    assert.doesNotMatch(html, /api\.anthropic\.com\/v1\/messages/);
    assert.doesNotMatch(html, /x-api-key/);
    assert.doesNotMatch(html, /camila_ak/);
    assert.doesNotMatch(html, /function getApiKey/);
  }
});

test('public simulations stop before invoking paid AI until scoped access exists', () => {
  for (const path of ['simulacion.html', 'simulacion-rapida.html', 'mobile/www/simulacion.html', 'mobile/www/simulacion-rapida.html']) {
    const html = read(path);
    assert.match(html, /if \(CFG\.modoProspecto\) \{[\s\S]{0,260}simulación pública está temporalmente pausada/);
  }
});

test('tenant configuration is scrubbed and rejects provider secrets', () => {
  const sql = read('supabase/migrations/20261014140000_smyl_provider_secret_cleanup.sql');
  assert.match(sql, /update public\.camila_tenants/);
  assert.match(sql, /camila_tenants_config_no_provider_secrets/);
  for (const key of ['api_key', 'anthropic_api_key', 'openai_api_key', 'gemini_api_key', 'replicate_api_key']) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
});
