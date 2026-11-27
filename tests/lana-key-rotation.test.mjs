import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { decryptLanaKey, encryptLanaKey, readKeyring, reencryptIfNeeded, storedKeyVersion } from '../supabase/functions/_shared/lana-crypto-core.mjs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const b64 = (n) => Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64');
const OLD = b64(), NEW = b64();
const SECRET = 'lana_test_api_key_0123456789abcdef';

test('sin versión configurada todo sigue funcionando como antes (versión "1")', async () => {
  const ring = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: OLD });
  assert.equal(ring.currentVersion, '1');
  const enc = await encryptLanaKey(SECRET, ring);
  assert.equal(enc.key_version, '1');
  const out = await decryptLanaKey({ api_key_ciphertext: enc.ciphertext, api_key_iv: enc.iv }, ring);
  assert.equal(out.apiKey, SECRET);
  assert.equal(await reencryptIfNeeded({ api_key_ciphertext: enc.ciphertext, api_key_iv: enc.iv, key_version: '1' }, ring), null);
});

test('rotación: la llave anterior sigue descifrando y la credencial se reescribe con la nueva', async () => {
  const oldRing = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: OLD });
  const legacy = await encryptLanaKey(SECRET, oldRing);
  const lana = { api_key_ciphertext: legacy.ciphertext, api_key_iv: legacy.iv, fingerprint: 'ABC', estado: 'conectada' }; // sin key_version
  const ring = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2', SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: OLD });
  assert.deepEqual(ring.keys.map((k) => [k.version, k.current]), [['2', true], ['1', false]]);
  assert.equal((await decryptLanaKey(lana, ring)).apiKey, SECRET);
  const rotated = await reencryptIfNeeded(lana, ring);
  assert.equal(rotated.key_version, '2');
  assert.equal(rotated.fingerprint, 'ABC', 'conserva el resto de la configuración');
  assert.notEqual(rotated.api_key_ciphertext, lana.api_key_ciphertext);
  const soloNueva = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2' });
  assert.equal((await decryptLanaKey(rotated, soloNueva)).apiKey, SECRET, 'ya no depende de la llave anterior');
  assert.equal(await reencryptIfNeeded(rotated, soloNueva), null, 'idempotente');
});

test('una versión mal anotada no deja la credencial inaccesible', async () => {
  const oldRing = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: OLD });
  const enc = await encryptLanaKey(SECRET, oldRing);
  const ring = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2', SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: OLD });
  const mislabeled = { api_key_ciphertext: enc.ciphertext, api_key_iv: enc.iv, key_version: '2' };
  const out = await decryptLanaKey(mislabeled, ring);
  assert.equal(out.apiKey, SECRET);
  assert.equal(out.needsReencrypt, true);
  assert.equal((await reencryptIfNeeded(mislabeled, ring)).key_version, '2');
});

test('sin ninguna llave válida falla con un mensaje claro y sin filtrar el secreto', async () => {
  const enc = await encryptLanaKey(SECRET, readKeyring({ SMYL_LANA_ENCRYPTION_KEY: OLD }));
  const ring = readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2' });
  await assert.rejects(() => decryptLanaKey({ api_key_ciphertext: enc.ciphertext, api_key_iv: enc.iv }, ring), (e) => {
    assert.match(e.message, /No se pudo descifrar/);
    assert.ok(!e.message.includes(SECRET) && !e.message.includes(OLD) && !e.message.includes(NEW));
    return true;
  });
});

test('configuración inválida se rechaza', () => {
  assert.throws(() => readKeyring({}), /no configurada/);
  assert.throws(() => readKeyring({ SMYL_LANA_ENCRYPTION_KEY: 'corta' }), /32 bytes|atob|invalid/i);
  assert.throws(() => readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2', SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: OLD, SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION: '2' }), /misma versión/);
  assert.throws(() => readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: OLD }), /PREVIOUS_VERSION/);
  assert.throws(() => readKeyring({ SMYL_LANA_ENCRYPTION_KEY: NEW, SMYL_LANA_ENCRYPTION_KEY_VERSION: '2', SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: NEW }), /igual/);
  assert.equal(storedKeyVersion({ key_version: 'bad value!' }), '1');
});

test('lana-connection y lana-linked usan el llavero y exponen la rotación', () => {
  const conn = read('supabase/functions/lana-connection/index.ts');
  const linked = read('supabase/functions/_shared/lana-linked.ts');
  for (const src of [conn, linked]) {
    assert.match(src, /lana-crypto-core\.mjs/);
    assert.match(src, /SMYL_LANA_ENCRYPTION_KEY_PREVIOUS/);
    assert.doesNotMatch(src, /crypto\.subtle\.decrypt/);
  }
  assert.equal((conn.match(/key_version: encrypted\.key_version/g) || []).length, 2, 'connect y provision guardan la versión');
  assert.match(conn, /action === "rotate_key"/);
  assert.match(conn, /reencryptIfNeeded\(next, keyring\(\)\)/, 'verify reescribe con la llave nueva');
  assert.match(conn, /encryption: encryptionPending\(lana\)/);
  assert.doesNotMatch(conn.match(/function publicStatus[\s\S]*?\n}\n/)[0], /ciphertext|api_key_iv/);
});

test('hay guía de rotación en docs', () => {
  const doc = read('docs/LANA_ENCRYPTION_KEY_ROTATION.md');
  for (const t of ['SMYL_LANA_ENCRYPTION_KEY_PREVIOUS', 'key_version', 'rotate_key', 'Verificar']) assert.match(doc, new RegExp(t));
});
