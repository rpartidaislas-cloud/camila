import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  lanaContractHeaders,
  normalizeLanaPath,
  SMYL_LANA_CONTRACT_VERSION,
} from '../supabase/functions/_shared/lana-contract.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const linked = read('../supabase/functions/_shared/lana-linked.ts');
const connection = read('../supabase/functions/lana-connection/index.ts');
const contract = read('../docs/SMYL_LANA_CHAT_CONTRACT_V1.md');
const architecture = read('../docs/SMYL_CHAT_ARCHITECTURE.md');

test('SMYL only calls versioned LANA server endpoints through a fixed host', () => {
  assert.equal(SMYL_LANA_CONTRACT_VERSION, '1.6');
  assert.deepEqual(lanaContractHeaders(), { 'X-SMYL-LANA-Contract-Version': '1.6' });
  assert.equal(normalizeLanaPath('/conversations?limit=1'), '/conversations?limit=1');
  assert.equal(normalizeLanaPath('/attention/123/resolve'), '/attention/123/resolve');
  assert.equal(normalizeLanaPath('/context/preview'), '/context/preview');
  assert.throws(() => normalizeLanaPath('https://evil.example/conversations'), /no permitida/);
  assert.throws(() => normalizeLanaPath('//evil.example/conversations'), /no permitida/);
  assert.throws(() => normalizeLanaPath('/context/../billing'), /no permitida/);
  assert.throws(() => normalizeLanaPath('/context/%2e%2e/billing'), /no permitida/);
  assert.throws(() => normalizeLanaPath('/billing'), /no permitido/);
  assert.match(linked, /normalizeLanaPath\(path\)/);
  assert.match(linked, /lanaContractHeaders\(\)/);
  assert.match(connection, /lanaContractHeaders\(\)/);
});

test('the frozen boundary keeps Meta credentials and canonical chat data in LANA', () => {
  assert.match(contract, /LANA es la fuente canónica de canales, conversaciones y mensajes/);
  assert.match(contract, /SMYL nunca recibe[\s\S]*?access_token[\s\S]*?refresh_token[\s\S]*?api_key[\s\S]*?en claro/);
  assert.match(contract, /No se crea una segunda bandeja canónica/);
  assert.match(contract, /tenant SMYL.*tenant LANA/i);
  assert.match(contract, /Idempotency-Key/);
  assert.match(architecture, /\*\*Versión:\*\* 1\.2/);
  assert.match(architecture, /Meta → webhooks\/adaptadores LANA/);
  assert.match(architecture, /No autorizan crear una segunda fuente de chat en SMYL/);
  assert.match(architecture, /Etapa 1 — conexión de LANA y Meta desde SMYL/);
});

test('the browser never receives the linked API key', () => {
  assert.match(connection, /api_key_ciphertext/);
  assert.match(connection, /api_key_iv/);
  assert.doesNotMatch(connection, /return json\([^\n]+api_key\s*:/);
  assert.doesNotMatch(linked, /Access-Control-Allow-Origin/);
});
