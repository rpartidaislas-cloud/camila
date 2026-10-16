import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261015050000_smyl_chat_finance_scopes.sql');
const inbox = read('../supabase/functions/lana-inbox/index.ts');

test('the inbox resolves the widest active messages scope', () => {
  assert.match(inbox, /smyl_role_scopes/);
  assert.match(inbox, /SCOPE_RANK/);
  assert.match(inbox, /scopes\.messages/);
});

test('limited inbox roles only receive assigned or authorized patient conversations', () => {
  assert.match(inbox, /canAccessConversation/);
  assert.match(inbox, /assignedActorId\(conversation\) === actor\.id/);
  assert.match(inbox, /camila_lana_handoffs/);
  assert.match(inbox, /filterConversationPayload/);
  assert.match(inbox, /conversation_scope_denied/);
});

test('conversation scope protects reads, uploads, writes and forwarded sources', () => {
  const checks = inbox.match(/await canAccessConversation/g) || [];
  assert.ok(checks.length >= 5, `expected at least 5 server-side scope checks, found ${checks.length}`);
  assert.match(inbox, /sourceConversationId[\s\S]*canAccessConversation\(actor, auth\.tenantId, sourceConversationId\)/);
});

test('finance rows are scoped by patient or branch instead of permission alone', () => {
  assert.match(migration, /smyl_can_access_finance_patient/);
  assert.match(migration, /smyl_can_access_finance_branch/);
  assert.match(migration, /create policy smyl_finance_charges_read[\s\S]*smyl_can_access_finance_patient/);
  assert.match(migration, /create policy smyl_cash_sessions_read[\s\S]*smyl_can_access_finance_branch/);
  assert.match(migration, /create policy smyl_cfdi_drafts_read[\s\S]*smyl_can_access_finance_patient/);
});

test('fiscal configuration stays clinic-wide and privileged writes cannot bypass scope', () => {
  assert.match(migration, /smyl_issuer_fiscal_profiles_read[\s\S]*effective_scope\(tenant_id,'finance'\)='clinic'/);
  assert.match(migration, /smyl_cfdi_pac_readiness_read[\s\S]*effective_scope\(tenant_id,'finance'\)='clinic'/);
  assert.match(migration, /smyl_guard_finance_scope_write/);
  assert.match(migration, /auth\.role\(\)='service_role'/);
  assert.match(migration, /smyl_proposal_charge_batches_scope_guard/);
});
