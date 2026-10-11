import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const handoff = read('../smyl-lana-handoff.js');
const connections = read('../smyl-connections.js');
const migration = read('../supabase/migrations/20261011120000_lana_conversation_handoffs.sql');
const edge = read('../supabase/functions/lana-handoff/index.ts');
const contextEdge = read('../supabase/functions/lana-context/index.ts');

test('LANA deep link opens an explicit review before creating a clinical record', () => {
  assert.match(app, /ir'\) === 'lana-handoff'/);
  assert.match(handoff, /Solo se copiarán nombre y datos de contacto/);
  assert.match(handoff, /el historial del chat permanece en LANA/);
  assert.match(handoff, /Crear el expediente no envía mensajes/);
  assert.match(handoff, /request\('confirm'/);
});

test('handoff is tenant-scoped and idempotent', () => {
  assert.match(migration, /unique \(tenant_id, lana_conversation_id\)/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /camila_es_miembro\(tenant_id\)/);
  assert.match(edge, /eq\("tenant_id", auth\.tenantId\)/);
  assert.match(edge, /camila_confirmar_lana_handoff/);
  assert.doesNotMatch(edge, /messages|ultimo_mensaje/);
});

test('SMYL exposes a structured LANA context editor with fixed clinical limits', () => {
  assert.match(connections, /Contexto de atención/i);
  assert.match(connections, /clinic_description/);
  assert.match(connections, /handoff_rules/);
  assert.match(connections, /No diagnostica, prescribe, promete resultados/);
  assert.match(connections, /\/functions\/v1\/lana-context/);
  assert.match(contextEdge, /Solo el dueño de la clínica/);
});
