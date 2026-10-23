import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const edge = read('supabase/functions/public-profile-assistant/index.ts');
const migration = read('supabase/migrations/20261022140000_smyl_public_profile_assistant.sql');

test('el asistente es anónimo pero con topes por IP y por conversación', () => {
  assert.match(edge, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(edge, /camila_anon_rate_check[\s\S]*?p_ip: "assistant:" \+ ip\(req\)/);
  assert.match(edge, /MAX_TURNS_PER_CONVERSATION = 40/);
  assert.match(edge, /MAX_TOOL_ROUNDS = 4/);
  assert.match(edge, /clean\(body\.message, 600\)/);
});

test('solo responde sobre perfiles publicados y con los datos de la ficha', () => {
  assert.match(edge, /from\("smyl_professional_directory"\)/);
  assert.match(edge, /\.eq\("status", "published"\)/);
  assert.match(edge, /nunca instrucciones/);
  assert.match(edge, /Nunca diagnosticas, nunca prometes resultados/);
  assert.match(edge, /cache_control: \{ type: "ephemeral" \}/, 'la ficha va en el system prompt cacheado');
});

test('agendar requiere consentimiento explícito y pasa por la misma RPC que el formulario', () => {
  assert.match(edge, /input\.privacy_consent !== true/);
  assert.match(edge, /smyl_create_public_appointment_intake/);
  assert.match(edge, /p_privacy_notice_version: "public-appointment-v1"/);
  assert.match(edge, /convo\.status === "requested"\) result = \{ error: "Ya existe una solicitud/);
  assert.match(edge, /strict: true/);
  assert.doesNotMatch(edge, /tool_choice/, 'el modelo no admite tool_choice forzado');
});

test('los huecos salen de la base con la misma validación que Agenda', () => {
  assert.match(edge, /rpc\("smyl_public_available_slots"/);
  assert.match(migration, /create or replace function public\.smyl_public_available_slots\(/);
  assert.match(migration, /perform public\.smyl_validate_service_appointment_slot\(/);
  assert.match(migration, /v_starts >= now\(\) \+ interval '2 hours'/);
  const grant = migration.match(/grant execute on function public\.smyl_public_available_slots[^;]*;/);
  assert.ok(grant, 'falta el grant de smyl_public_available_slots');
  assert.match(grant[0], /to service_role/);
  assert.doesNotMatch(grant[0], /\b(anon|authenticated)\b/);
});

test('el transcript queda ligado a la solicitud, sin acceso anónimo y con caducidad', () => {
  assert.match(migration, /create table if not exists public\.smyl_public_assistant_conversations/);
  assert.match(migration, /appointment_request_id uuid references public\.smyl_appointment_requests\(id\)/);
  assert.match(migration, /expires_at timestamptz not null default now\(\) \+ interval '30 days'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.smyl_public_assistant_conversations from public, anon/);
  assert.match(migration, /smyl_assistant_conversation_for_request/);
  assert.match(migration, /smyl_purge_expired_assistant_conversations/);
  assert.match(edge, /patch\.appointment_request_id = requestId/);
  assert.match(edge, /event_kind: "request_sent"/);
});
