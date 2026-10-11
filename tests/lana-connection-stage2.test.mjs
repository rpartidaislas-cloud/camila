import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const panel = read('../smyl-panel.js');
const connections = read('../smyl-connections.js');
const styles = read('../smyl-connections.css');
const edge = read('../supabase/functions/lana-connection/index.ts');
const sw = read('../sw.js');

test('panel exposes the LANA connection center and advances cached assets', () => {
  assert.match(app, /smyl-connections\.css\?v=1/);
  assert.match(app, /smyl-connections\.js\?v=1/);
  assert.match(app, /smyl-panel\.css\?v=4/);
  assert.match(app, /smyl-panel\.js\?v=4/);
  assert.match(connections, /LANA atiende el chat/);
  assert.match(connections, /WhatsApp/);
  assert.match(connections, /Messenger/);
  assert.match(connections, /Instagram/);
  assert.match(styles, /connections-status-card/);
  assert.match(sw, /smyl-v164-lana-connection-center/);
  assert.match(sw, /smyl-connections\.js\?v=1/);
  assert.match(sw, /smyl-connections\.css\?v=1/);
});

test('connection keeps Meta ownership in LANA and clinical delivery human-controlled', () => {
  assert.match(connections, /Meta permanece en LANA/);
  assert.match(connections, /no solicita ni almacena tokens de Meta/);
  assert.match(connections, /Nada clínico se entrega automáticamente sin aprobación humana/);
  assert.doesNotMatch(connections, /meta-send|camila_canales|META_TOKEN/);
  assert.match(panel, /Configurar LANA/);
  assert.match(panel, /revisión y aprobación/);
});

test('server validates the LANA link and stores only AES-GCM ciphertext', () => {
  assert.match(edge, /SMYL_LANA_ENCRYPTION_KEY/);
  assert.match(edge, /AES-GCM/);
  assert.match(edge, /api_key_ciphertext/);
  assert.match(edge, /api_key_iv/);
  assert.match(edge, /fingerprint/);
  assert.match(edge, /LANA_API_BASE.*camila-api/);
  assert.match(edge, /\$\{LANA_API_BASE\}\/conversations\?limit=1/);
  assert.match(edge, /auth\.user\.id === auth\.tenantId/);
  assert.doesNotMatch(edge, /api_key:\s*apiKey/);
  assert.doesNotMatch(connections, /localStorage|sessionStorage/);
});
