import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const ui = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const edge = read('../supabase/functions/lana-inbox/index.ts');

test('SMYL Copilot proposes drafts and reviewed resume context without auto-send', () => {
  assert.match(ui, /data-compose-copilot/);
  assert.match(ui, /Usar como borrador/);
  assert.match(ui, /Borrador interno · no enviado/);
  assert.match(ui, /data-copilot-resume/);
  assert.match(ui, /resume_with_context/);
  assert.match(ui, /Corrige cualquier inferencia antes de reactivar/);
  assert.match(ui, /La capacitación no cambió/);
  assert.match(css, /smyl-inbox-copilot-draft/);
  assert.match(css, /smyl-inbox-copilot-dialog/);
  const requestBody = ui.slice(ui.indexOf('async function requestCopilot'), ui.indexOf('async function prepareResume'));
  assert.doesNotMatch(requestBody, /action:\s*'send'/);
});

test('the authenticated bridge builds dental facts server-side and never trusts browser tenant or authorization', () => {
  assert.match(edge, /copilotClinicalSnapshot/);
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /auth\.tenantId/);
  assert.match(edge, /lana_webhook_estado === "enviado"/);
  assert.match(edge, /\/copilot\/feedback/);
  assert.match(edge, /\/resume-context/);
  assert.doesNotMatch(ui, /tenant_id|api_key_ciphertext|SMYL_LANA_ENCRYPTION_KEY/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});
