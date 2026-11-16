import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DIAS_PERMITIDOS, MAX_INTENTOS_CODIGO, TOKEN_RE, CODIGO_RE, aleatorioHex, sha256Hex, codigoAleatorio, hashDeCodigo,
  diasValidos, venceEn, estadoDelEnlace, enlaceDisponible, vistaPublica,
} from '../supabase/functions/_shared/cloud-share-core.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261116180000_smyl_cloud_shares.sql');
const fn = read('supabase/functions/cloud-share/index.ts');
const page = read('compartido.html');

test('token de 64 hex, código de 6 dígitos y vigencias cerradas', async () => {
  assert.match(aleatorioHex(32), TOKEN_RE);
  for (let i = 0; i < 50; i++) assert.match(codigoAleatorio(), CODIGO_RE);
  assert.deepEqual(DIAS_PERMITIDOS, [1, 7, 30]);
  assert.equal(diasValidos('7'), 7);
  assert.equal(diasValidos(365), null);
  assert.equal(diasValidos('abc'), null);
  assert.equal(await sha256Hex('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  const salt = aleatorioHex(8);
  assert.notEqual(await hashDeCodigo(salt, '123456'), await hashDeCodigo(salt, '123457'));
  assert.notEqual(await hashDeCodigo(salt, '123456'), await hashDeCodigo(aleatorioHex(8), '123456'));
});

test('un enlace vencido, revocado o bloqueado se ve igual que uno inexistente', () => {
  const ahora = Date.parse('2026-11-16T12:00:00Z');
  const base = { expires_at: '2026-11-20T00:00:00Z', revoked_at: null, failed_attempts: 0 };
  assert.equal(estadoDelEnlace(base, ahora), 'active');
  assert.equal(estadoDelEnlace({ ...base, expires_at: '2026-11-16T11:59:59Z' }, ahora), 'expired');
  assert.equal(estadoDelEnlace({ ...base, revoked_at: '2026-11-16T10:00:00Z' }, ahora), 'revoked');
  assert.equal(estadoDelEnlace({ ...base, failed_attempts: MAX_INTENTOS_CODIGO }, ahora), 'locked');
  assert.equal(estadoDelEnlace(null, ahora), 'missing');
  assert.equal(enlaceDisponible({ ...base, failed_attempts: 4 }, ahora), true);
  assert.equal(venceEn(7, 0), '1970-01-08T00:00:00.000Z');
});

test('la vista pública no expone paciente, notas ni rutas internas', () => {
  const vista = vistaPublica({ nombre: 'Panorámica.jpg', mime: 'image/jpeg', size: 10, clinica: 'Clínica', url: 'https://x', expires_at: 'z' });
  assert.deepEqual(Object.keys(vista).sort(), ['clinic', 'expires_at', 'mime_type', 'name', 'size_bytes', 'url']);
});

test('la migración guarda solo hashes, limita lo que lee la clínica y exige poder ver el archivo', () => {
  assert.match(sql, /token_hash text not null unique check \(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.doesNotMatch(sql, /\btoken text\b/);
  assert.match(sql, /revoke all on public\.smyl_cloud_shares, public\.smyl_cloud_share_events from public, anon, authenticated;/);
  assert.match(sql, /grant select \(id, tenant_id, file_id, requires_code[^)]*\)\s+on public\.smyl_cloud_shares to authenticated/);
  assert.doesNotMatch(sql.match(/grant select \([^)]*\)/)[0], /token_hash|code_hash|code_salt/);
  assert.match(sql, /smyl_has_permission\(v_tenant, 'cloud\.share'\)/);
  assert.match(sql, /smyl_cloud_can_see\(f\.tenant_id, f\.patient_id, f\.category\)/);
  assert.match(sql, /on delete cascade/);
});

test('la función comparte solo con permiso, bloquea tras 5 códigos fallidos y deja bitácora', () => {
  assert.match(fn, /rpc\("smyl_cloud_can_share"/);
  assert.match(fn, /requireUser\(req, CORS\)/);
  assert.match(fn, /estadoDelEnlace\(share\) !== "active"\) return json\(CORS, 404/);
  assert.match(fn, /MAX_INTENTOS_CODIGO/);
  assert.match(fn, /createSignedUrl\(file\.storage_path, 120\)/);
  for (const tipo of ['created', 'viewed', 'code_failed', 'locked', 'revoked']) assert.match(fn, new RegExp(`"${tipo}"`));
  assert.doesNotMatch(fn, /token_hash:\s*token\b/);
  assert.match(read('supabase/config.toml'), /\[functions\.cloud-share\]\s+verify_jwt = false/);
});

test('compartido.html: sin innerHTML, token solo en el fragmento, CSP y sin indexar', () => {
  assert.doesNotMatch(page, /innerHTML|document\.write|eval\(/);
  assert.match(page, /\[#&\]t=\(\[a-f0-9\]\{64\}\)/);
  assert.match(page, /history\.replaceState\(null, '', location\.pathname\)/);
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /name="referrer" content="no-referrer"/);
  assert.match(page, /Content-Security-Policy[^>]*frame-src 'none'[^>]*object-src 'none'/);
});

test('la Nube ofrece compartir solo con cloud.share y llega igual a web y móvil', () => {
  const ui = read('smyl-cloud.js');
  assert.match(ui, /can\.share && state\.sharesReady/);
  assert.match(ui, /invokeFn\('cloud-share'/);
  assert.match(ui, /smyl_cloud_shares/);
  for (const file of ['smyl-cloud.js', 'smyl-cloud.css', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
  assert.match(read('app.html'), /smyl-cloud\.js\?v=3/);
});
