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
const preview = read('./fixtures/smyl-inbox-stage6-preview.html');

test('SMYL bridge exposes templates, scheduled sends and controlled reactivation without storing Meta credentials', () => {
  assert.match(bridge, /action === "templates"/);
  assert.match(bridge, /action === "scheduled"/);
  assert.match(bridge, /action === "schedule"/);
  assert.match(bridge, /action === "cancel_scheduled"/);
  assert.match(bridge, /action === "configure_automation"/);
  assert.match(bridge, /Idempotency-Key/);
  assert.doesNotMatch(bridge, /WHATSAPP_TOKEN|access_token/);
});

test('expired WhatsApp conversations disable free-form controls and keep approved templates available', () => {
  assert.match(inbox, /function liveWhatsappWindow/);
  assert.match(inbox, /windowState\.status === 'expired'/);
  assert.match(inbox, /input\.disabled = !canRespond \|\| !freeformAllowed/);
  assert.match(inbox, /data-compose-template/);
  assert.match(inbox, /openTemplateDialog/);
  assert.match(inbox, /type: 'template'/);
  assert.match(css, /data-state="expired"/);
});

test('the UI supports idempotent scheduling, cancellation and per-chat automation', () => {
  assert.match(inbox, /action: 'schedule'/);
  assert.match(inbox, /action: 'cancel_scheduled'/);
  assert.match(inbox, /action: 'configure_automation'/);
  assert.match(inbox, /request\('POST', \{\}, payload, uuid\(\), 20000\)/);
  assert.match(inbox, /Programar seguimiento/);
  assert.match(inbox, /Reactivación controlada/);
  assert.match(inbox, /Último recordatorio automático/);
});

test('desktop and native web bundle use the same stage 6 assets', () => {
  assert.match(app, /smyl-inbox\.js\?v=23/);
  assert.match(app, /smyl-inbox\.css\?v=18/);
  assert.equal(mobileApp, app);
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});

test('the stage 6 workspace remains bounded and visually reproducible on desktop, tablet and mobile', () => {
  assert.match(css, /height:calc\(100vh - 65px\)/);
  assert.match(css, /smyl-inbox-compose-main textarea\{min-width:0\}/);
  assert.match(preview, /qa-mobile/);
  assert.match(preview, /qa-tablet/);
  assert.match(preview, /whatsapp_window:\{ status:'expired'/);
});
