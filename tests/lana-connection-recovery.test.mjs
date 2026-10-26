import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const edge = read('../supabase/functions/lana-connection/index.ts');

test('LANA verification uses the lightweight authenticated contract endpoint with cold-start margin', () => {
  assert.match(edge, /LANA_VERIFY_TIMEOUT_MS\s*=\s*25000/);
  assert.match(edge, /`\$\{LANA_API_BASE\}\/contract`/);
  assert.doesNotMatch(edge, /LANA_API_BASE\}\/conversations\?limit=1/);
  assert.match(edge, /body\.ok\s*!==\s*true/);
  assert.match(edge, /typeof body\.contract\s*!==\s*"object"/);
});

test('only an explicit credential rejection degrades the stored link', () => {
  assert.match(edge, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(edge, /"invalid_credentials"/);
  assert.match(edge, /invalidCredentials \? "requiere_atencion" : lana\.estado/);
  assert.match(edge, /error_code: invalidCredentials \? "invalid_credentials" : "verification_temporary"/);
  assert.match(edge, /retryable: !invalidCredentials/);
});

test('timeouts and provider incidents preserve the link and remain retryable', () => {
  assert.match(edge, /response\.status === 408 \|\| response\.status === 429 \|\| response\.status >= 500/);
  assert.match(edge, /Tu enlace se conserva/);
  assert.match(edge, /"temporary"/);
  assert.match(edge, /retryable: error\.failure === "temporary"/);
});
