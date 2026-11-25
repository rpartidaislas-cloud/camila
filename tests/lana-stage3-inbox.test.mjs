import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const styles = read('../smyl-inbox.css');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const app = read('../app.html');
const worker = read('../sw.js');

test('SMYL provides a responsive operational inbox and canonical LANA thread', () => {
  assert.match(inbox, /<h1 class="smyl-inbox-sr">Mensajes<\/h1>/);
  assert.match(inbox, /WhatsApp.*Messenger.*Instagram/);
  assert.match(inbox, /Cargar mensajes anteriores/);
  assert.match(inbox, /data-inbox-live role="status" hidden/);
  assert.match(inbox, /Reconectando…/);
  assert.doesNotMatch(inbox, /Sincronización segura|Actualizado ahora/);
  assert.match(styles, /grid-template-columns:332px minmax\(420px,1fr\) 268px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(app, /smyl-inbox\.js\?v=97/);
  assert.match(app, /smyl-inbox\.css\?v=80/);
  assert.match(worker, /smyl-v263-lana-connection-recovery/);
});

test('manual responses use an isolated optimistic queue with visible retry states', () => {
  assert.match(inbox, /status: 'sending'/);
  assert.match(inbox, /status === 'failed'/);
  assert.match(inbox, /Reintentar/);
  assert.match(inbox, /send_unknown/);
  assert.match(inbox, /client_request_id/);
  assert.match(inbox, /removed_conversation_ids/);
  assert.match(inbox, /data\.truncated/);
  assert.doesNotMatch(inbox, /localStorage/);
  assert.match(inbox, /AES-GCM/);
});

test('assignment, read, pause, resume and resolution travel through the authenticated bridge', () => {
  const ownerChange = inbox.slice(inbox.indexOf('function changeChatOwner('), inbox.indexOf('async function loadTeam('));
  assert.match(ownerChange, /action: targetId \? 'assign' : 'release', conversation_id: conversationId/);
  assert.match(ownerChange, /await request\('POST', \{\}, payload, uuid\(\)\)/);
  assert.match(inbox, /conversation\.paused \? prepareResume\(\) : mutateConversation\('pause'\)/);
  assert.match(inbox, /resume_with_context/);
  assert.match(inbox, /mutateConversation\('resolve'\)/);
  assert.match(inbox, /action: 'read'/);
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /X-SMYL-Actor-Id/);
  assert.match(edge, /requirePermission\(actor, permission/);
  assert.match(edge, /"messages\.manage"/);
});

test('the inbox preserves upstream conversation actions and the commercial stage catalog', () => {
  assert.match(inbox, /data-inbox-filter="pinned"/);
  assert.match(inbox, /data-inbox-filter="paused"/);
  assert.match(inbox, /mutateConversation\(conversation\.pinned \? 'unpin' : 'pin'\)/);
  assert.match(inbox, /action: 'stages'/);
  assert.match(inbox, /target_stage_id/);
  assert.match(inbox, /Etapa de atención/);
  assert.match(edge, /if \(action === "stages"\) return "\/inbox\/stages"/);
  assert.match(edge, /"pin", "unpin", "stage"/);
  assert.match(edge, /smyl_chat_set_pipeline_stage/);
});

test('the browser never receives the linked LANA credential or chooses a tenant', () => {
  assert.doesNotMatch(inbox, /linkedLanaApiKey|SMYL_LANA_ENCRYPTION_KEY|tenant_id/);
  assert.match(edge, /auth\.tenantId/);
  assert.match(edge, /lanaRequest\(auth\.tenantId/);
});
