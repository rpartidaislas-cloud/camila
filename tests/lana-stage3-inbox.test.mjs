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
  assert.match(inbox, /CENTRO DE ATENCIÓN DENTAL/);
  assert.match(inbox, /WhatsApp.*Messenger.*Instagram/);
  assert.match(inbox, /Cargar mensajes anteriores/);
  assert.match(inbox, /Sincronización segura/);
  assert.match(styles, /grid-template-columns:332px minmax\(420px,1fr\) 268px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(app, /smyl-inbox\.js\?v=8/);
assert.match(worker, /smyl-v219-channel-disconnect/);
});

test('manual responses use an isolated optimistic queue with visible retry states', () => {
  assert.match(inbox, /status: 'sending'/);
  assert.match(inbox, /status === 'failed'/);
  assert.match(inbox, /Reintentar/);
  assert.match(inbox, /send_unknown/);
  assert.match(inbox, /client_request_id/);
  assert.match(inbox, /removed_conversation_ids/);
  assert.match(inbox, /data\.truncated/);
  assert.doesNotMatch(inbox, /localStorage|sessionStorage/);
});

test('assignment, read, pause, resume and resolution travel through the authenticated bridge', () => {
  assert.match(inbox, /mutateConversation\('release'\)/);
  assert.match(inbox, /conversation\.paused \? prepareResume\(\) : mutateConversation\('pause'\)/);
  assert.match(inbox, /resume_with_context/);
  assert.match(inbox, /mutateConversation\('resolve'\)/);
  assert.match(inbox, /action: 'read'/);
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /X-SMYL-Actor-Id/);
  assert.match(edge, /Solo el dueño puede asignar conversaciones a otras personas/);
});

test('the browser never receives the linked LANA credential or chooses a tenant', () => {
  assert.doesNotMatch(inbox, /linkedLanaApiKey|SMYL_LANA_ENCRYPTION_KEY|tenant_id/);
  assert.match(edge, /auth\.tenantId/);
  assert.match(edge, /lanaRequest\(auth\.tenantId/);
});
