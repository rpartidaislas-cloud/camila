import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const connection = read('../supabase/functions/lana-connection/index.ts');
const channels = read('../supabase/functions/lana-channels/index.ts');
const migration = read('../supabase/migrations/20261011200000_lana_automatic_provisioning.sql');
const ui = read('../smyl-connections.js');
const mobileUi = read('../mobile/www/smyl-connections.js');

test('automatic provisioning is server-to-server, idempotent and keeps credentials out of its state table', () => {
  assert.match(connection, /SMYL_LANA_PLATFORM_SECRET/);
  assert.match(connection, /Idempotency-Key/);
  assert.match(connection, /LANA_PROVISION_URL/);
  assert.match(connection, /encryptApiKey\(provisioned\.apiKey\)/);
  assert.match(connection, /provisioned_automatically: true/);
  assert.match(migration, /request_id uuid not null unique default gen_random_uuid\(\)/i);
  assert.match(migration, /revoke all[\s\S]*anon, authenticated/i);
  assert.doesNotMatch(migration, /api_key|ciphertext|access_token/i);
});

test('channel operations stay behind the linked LANA API key and owner check', () => {
  assert.match(channels, /requireUser/);
  assert.match(channels, /auth\.user\.id === auth\.tenantId/);
  assert.match(channels, /lanaRequest\(auth\.tenantId, "\/channels"/);
  assert.match(channels, /\/channels\/\$\{selected\}\/setup-session/);
  assert.match(channels, /return_origin: returnOrigin/);
  assert.doesNotMatch(channels, /access_token|api_key/);
});

test('SMYL presents automatic activation and per-channel connection without storing secrets in the browser', () => {
  assert.match(ui, /Activar canales para mi clínica/);
  for (const channel of ['whatsapp', 'messenger', 'instagram']) {
    assert.match(ui, new RegExp(`data-connect-channel="${channel}"`));
  }
  assert.match(ui, /window\.open\('', 'smyl-lana-'/);
  assert.match(ui, /messageEvent\.origin !== setupOrigin/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
  assert.equal(mobileUi, ui);
});
