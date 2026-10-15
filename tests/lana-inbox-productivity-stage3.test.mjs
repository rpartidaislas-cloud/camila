import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const bridge = read('../supabase/functions/lana-inbox/index.ts');
const app = read('../app.html');
const worker = read('../sw.js');

test('search and shared files stay on the authenticated LANA bridge', () => {
  assert.match(bridge, /action === "search" \|\| action === "shared"/);
  assert.match(bridge, /\/inbox\/conversations\/\$\{conversationId\}\/\$\{action\}/);
  assert.match(inbox, /action: 'search'/);
  assert.match(inbox, /action: 'shared'/);
  assert.match(inbox, /La búsqueda se realiza en LANA/);
  assert.match(inbox, /Contenido del historial real/);
  assert.doesNotMatch(inbox, /tenant_id|SMYL_LANA_ENCRYPTION_KEY/);
});

test('quick replies prepare a draft and never send automatically', () => {
  assert.match(bridge, /action === "quick_replies"/);
  assert.match(inbox, /action: 'quick_replies'/);
  assert.match(inbox, /setComposerText\(item\.text\)/);
  assert.match(inbox, /nunca se envía automáticamente/);
  assert.doesNotMatch(inbox, /item\.text.*submitMessage/s);
});

test('the context shortcut opens the same shared-files dialog as the thread header', () => {
  assert.doesNotMatch(inbox, /openSharedDialog/);
  assert.match(inbox, /sharedButton\.onclick = openSharedItems/);
});

test('bulk work is limited to assignment and stage changes', () => {
  assert.match(inbox, /applyBulkAction\('assign'/);
  assert.match(inbox, /applyBulkAction\('stage'/);
  assert.doesNotMatch(inbox, /applyBulkAction\('send'/);
  assert.match(inbox, /conversaciones actualizadas/);
  assert.match(css, /smyl-inbox-bulkbar/);
});

test('sound notices are opt-in and contain no patient persistence', () => {
  assert.match(inbox, /notificationsEnabled: false/);
  assert.match(inbox, /AudioContext/);
  assert.match(inbox, /currentUnread > previousUnread/);
  assert.doesNotMatch(inbox, /localStorage/);
  assert.match(inbox, /notificationsEnabled: false/);
});

test('stage 3 ships synchronized web, native and PWA assets', () => {
  assert.match(app, /smyl-inbox\.js\?v=15/);
  assert.match(app, /smyl-inbox\.css\?v=12/);
  assert.match(worker, /smyl-v242-patient-operations/);
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
