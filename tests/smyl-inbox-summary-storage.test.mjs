import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20261117013000_smyl_conversation_summaries.sql');
const edge = read('supabase/functions/lana-inbox/index.ts');
const js = read('smyl-inbox.js');
const workflow = read('.github/workflows/smyl-resumen-chat-migracion.yml');

test('la tabla del resumen no se expone al navegador y separa el alcance clínico', () => {
  assert.match(sql, /create table if not exists public\.smyl_conversation_summaries/);
  assert.match(sql, /primary key \(tenant_id, lana_conversation_id, includes_clinical\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.smyl_conversation_summaries from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
  assert.match(sql, /on delete cascade/);
});

test('lana-inbox guarda el resumen solo tras Copilot y lo lee con permiso y acceso a la conversación', () => {
  assert.match(edge, /if \(mode === "summary" && remote\.response\.ok/);
  assert.match(edge, /const includesClinical = clinical\.patient_confirmed === true && clinical\.clinical_access !== false;/);
  assert.match(edge, /onConflict: "tenant_id,lana_conversation_id,includes_clinical"/);
  assert.match(edge, /if \(!allowClinical\) query = query\.eq\("includes_clinical", false\);/);
  assert.match(edge, /accessiblePatient\(actor, tenantId, String\(handoff\.patient_id\), "clinical"\)/);
  // La lectura está dentro de la rama GET, después de messages.read y canAccessConversation.
  const get = edge.slice(edge.indexOf('if (req.method === "GET")'), edge.indexOf('action === "conversation_summary"'));
  assert.match(get, /requirePermission\(actor, "messages\.read"/);
  assert.match(get, /canAccessConversation\(actor, auth\.tenantId, conversationId\)/);
  assert.match(edge, /if \(error\) return \{ ok: true, summary: null, storage: "unavailable" \};/, 'sin migración la ficha sigue funcionando');
});

test('la ficha lee primero el resumen guardado y solo genera si no existe', () => {
  assert.match(js, /action: 'conversation_summary', conversation_id: conversationId/);
  assert.match(js, /if \(hasPermission\('messages\.respond'\)\) requestConversationSummary\(conversationId, false\);/);
  assert.match(js, /basis_at: conversation\.last_message_at \|\| null/);
  assert.doesNotMatch(js, /smyl_conversation_summaries/);
});

test('el flujo de migración es manual y verifica RLS y permisos', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /20261117013000_smyl_conversation_summaries\.sql/);
  assert.match(workflow, /sin_permisos_ok/);
  assert.match(workflow, /rls_ok/);
});
