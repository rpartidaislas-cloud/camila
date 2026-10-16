import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const handoff = read('../smyl-lana-handoff.js');
const connections = read('../smyl-connections.js');
const migration = read('../supabase/migrations/20261011120000_lana_conversation_handoffs.sql');
const edge = read('../supabase/functions/lana-handoff/index.ts');
const inboxEdge = read('../supabase/functions/lana-inbox/index.ts');
const contextEdge = read('../supabase/functions/lana-context/index.ts');

test('SMYL prepares the clinical record internally without navigating to LANA', () => {
  assert.doesNotMatch(app, /ir'\) === 'lana-handoff'/);
  assert.doesNotMatch(handoff, /app\.get-lana\.com\/admin|Volver al chat de LANA|LANA → SMYL/);
  assert.doesNotMatch(connections, /app\.get-lana\.com\/admin|Abrir LANA/);
  assert.match(handoff, /Solo se copiarán nombre y datos de contacto/);
  assert.match(handoff, /el historial de mensajes permanece protegido en su canal/);
  assert.match(handoff, /Crear el expediente no envía mensajes/);
  assert.match(handoff, /request\('confirm'/);
});

test('handoff is tenant-scoped and idempotent', () => {
  assert.match(migration, /unique \(tenant_id, lana_conversation_id\)/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /camila_es_miembro\(tenant_id\)/);
  assert.match(edge, /patient_link_preview/);
  assert.match(edge, /patient_link_confirm/);
  assert.match(edge, /\/functions\/v1\/lana-inbox/);
  assert.doesNotMatch(edge, /camila_confirmar_lana_handoff|smyl_lana_patient_candidates/);
  assert.match(inboxEdge, /canAccessConversation\(actor, auth\.tenantId, conversationId\)/);
  assert.match(inboxEdge, /camila_confirmar_lana_handoff/);
});

test('SMYL exposes structured dental training with fixed clinical limits', () => {
  assert.match(connections, /CAPACITAR IA/i);
  assert.match(connections, /clinic_description/);
  assert.match(connections, /handoff_rules/);
  assert.match(connections, /No diagnosticar, prescribir ni recomendar dosis/);
  assert.match(connections, /\/functions\/v1\/lana-training/);
  assert.match(connections, /Completa y guarda tu primer borrador/);
  assert.match(contextEdge, /Solo el dueño de la clínica/);
});
