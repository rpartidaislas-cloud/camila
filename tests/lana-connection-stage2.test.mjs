import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const panel = read('../smyl-panel.js');
const connections = read('../smyl-connections.js');
const styles = read('../smyl-connections.css');
const mobileConnections = read('../mobile/www/smyl-connections.js');
const mobileStyles = read('../mobile/www/smyl-connections.css');
const mobileApp = read('../mobile/www/app.html');
const mobileSw = read('../mobile/www/sw.js');
const edge = read('../supabase/functions/lana-connection/index.ts');
const sw = read('../sw.js');

test('panel exposes the SMYL channel center and advances cached assets', () => {
  assert.match(app, /smyl-connections\.css\?v=9/);
  assert.match(app, /smyl-connections\.js\?v=14/);
  assert.match(app, /smyl-panel\.css\?v=5/);
  assert.match(app, /smyl-panel\.js\?v=6/);
  assert.match(connections, /Tus canales y tu asistente/);
  assert.match(connections, /WhatsApp/);
  assert.match(connections, /Messenger/);
  assert.match(connections, /Instagram/);
  assert.match(styles, /connections-status-card/);
  assert.match(sw, /smyl-v263-lana-connection-recovery/);
  assert.match(sw, /smyl-connections\.js\?v=14/);
  assert.match(sw, /smyl-connections\.css\?v=9/);
  assert.equal(mobileConnections, connections);
  assert.equal(mobileStyles, styles);
  assert.match(mobileApp, /smyl-connections\.js\?v=14/);
  assert.match(mobileApp, /smyl-connections\.css\?v=9/);
  assert.equal(mobileSw, sw);
});

test('connection recovery keeps actions unambiguous and tolerates cold starts', () => {
  assert.match(styles, /\.connections-shell \[hidden\]\{display:none!important\}/);
  assert.match(connections, /manualLink\.hidden = connected \|\| !status\.can_manage/);
  assert.match(connections, /attention \? 'Reemplazar enlace'/);
  assert.match(connections, /status: 20000, connect: 40000, verify: 40000, provision: 50000/);
  assert.match(connections, /CHANNEL_TIMEOUT_MS = 30000/);
  assert.match(connections, /reconcileConnectionStatus/);
  assert.match(connections, /channelLoadGeneration/);
  assert.match(connections, /state\.channelLoadController\.abort\(\)/);
  assert.match(connections, /data-retry-channels/);
  assert.match(connections, /finally \{\s*button\.disabled = false;/);
});

test('connection hides the infrastructure provider and keeps delivery human-controlled', () => {
  assert.match(connections, /tokens de Meta se procesan en una capa privada/);
  assert.match(connections, /nunca se muestran en el navegador/);
  assert.match(connections, /Nada clínico se entrega automáticamente sin aprobación humana/);
  assert.doesNotMatch(connections, /meta-send|camila_canales|META_TOKEN/);
  assert.match(panel, /Configurar canales e IA/);
  assert.match(panel, /revisión y aprobación/);
  assert.doesNotMatch(connections, /LANA y canales|LANA atiende|LANA conectada/);
  assert.doesNotMatch(panel, /Continuar en LANA|Configurar LANA/);
});

test('server validates the LANA link and stores only AES-GCM ciphertext', () => {
  assert.match(edge, /SMYL_LANA_ENCRYPTION_KEY/);
  assert.match(edge, /AES-GCM/);
  assert.match(edge, /api_key_ciphertext/);
  assert.match(edge, /api_key_iv/);
  assert.match(edge, /fingerprint/);
  assert.match(edge, /LANA_API_BASE.*camila-api/);
  assert.match(edge, /\$\{LANA_API_BASE\}\/contract/);
  assert.match(edge, /auth\.user\.id === auth\.tenantId/);
  assert.doesNotMatch(edge, /api_key:\s*apiKey/);
  assert.doesNotMatch(connections, /localStorage|sessionStorage/);
  assert.match(connections, /20000/);
});
