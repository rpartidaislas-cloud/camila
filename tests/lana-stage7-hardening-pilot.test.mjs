import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const bridge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const mobileApp = read('../mobile/www/app.html');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const sw = read('../sw.js');
const preview = read('./fixtures/smyl-inbox-stage7-preview.html');

test('SMYL bridge exposes tenant operations and safe scheduled retry without provider credentials', () => {
  assert.match(bridge, /action === "operations"/);
  assert.match(bridge, /action === "retry_scheduled"/);
  assert.match(bridge, /scheduled\/\$\{scheduledId\}\/retry/);
  assert.match(bridge, /Idempotency-Key/);
  assert.doesNotMatch(bridge, /WHATSAPP_TOKEN|access_token|service_role/);
});

test('operations view surfaces alerts, consumption, channels and the manual pilot gate', () => {
  assert.match(inbox, /Estado del Inbox/);
  assert.match(inbox, /Consumo de IA/);
  assert.match(inbox, /Piloto profesional/);
  assert.match(inbox, /activación del piloto/);
  assert.match(inbox, /Operación estable/);
  assert.match(inbox, /Requiere atención/);
  assert.match(css, /smyl-inbox-operations-dialog/);
  assert.match(css, /smyl-inbox-pilot-checks/);
});

test('scheduled rows distinguish automatic retry, dead letter and unsafe delivery', () => {
  assert.match(inbox, /scheduledStatusLabel/);
  assert.match(inbox, /item\.status === 'retrying'/);
  assert.match(inbox, /item\.retry_safe/);
  assert.match(inbox, /action: 'retry_scheduled'/);
  assert.match(inbox, /Revisar hilo/);
  assert.match(css, /smyl-inbox-scheduled-actions/);
});

test('desktop and native bundle share stage 7 assets and cache version', () => {
  assert.match(app, /smyl-inbox\.js\?v=23/);
  assert.match(app, /smyl-inbox\.css\?v=18/);
assert.match(sw, /smyl-v248-patient-record-simple/);
  assert.equal(mobileApp, app);
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});

test('stage 7 preview contains responsive operational states without clinical filler', () => {
  assert.match(preview, /action === 'operations'/);
  assert.match(preview, /used_percent:25\.8/);
  assert.match(preview, /readiness:'ready'/);
  assert.match(preview, /status:'active'/);
  assert.match(preview, /qa-mobile/);
  assert.match(preview, /qa-tablet/);
});
