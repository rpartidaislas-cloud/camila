import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const edge = fs.readFileSync(new URL('../supabase/functions/lana-assistant-tools/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261015123000_smyl_assistant_slot_selection.sql', import.meta.url), 'utf8');
const inbox = fs.readFileSync(new URL('../smyl-inbox.js', import.meta.url), 'utf8');

test('LANA assistant availability is a private read-only server bridge', () => {
  assert.match(edge, /SMYL_LANA_TOOL_SECRET/);
  assert.match(edge, /constantTimeEqual/);
  assert.match(edge, /lana_tenant_id/);
  assert.match(edge, /lana\.estado === "conectada"/);
  assert.match(edge, /smyl_inbox_available_slots_v2/);
  assert.match(edge, /p_actor_id: smylTenantId/);
  assert.match(config, /\[functions\.lana-assistant-tools\][\s\S]*?verify_jwt = false/);
});

test('selection creates only an idempotent pending request and never confirms an appointment', () => {
  assert.match(edge, /action === "select_slot"/);
  assert.match(edge, /create_pending_request: true/);
  assert.match(edge, /smyl_assistant_create_appointment_request/);
  assert.match(edge, /status: "pending"/);
  assert.match(edge, /confirm_appointment: false/);
  assert.match(edge, /appointment_created: false/);
  assert.doesNotMatch(edge, /smyl_inbox_confirm_appointment_request/);
  assert.doesNotMatch(edge, /from\("smyl_appointments"\)\.insert/);
  assert.match(migration, /source='assistant'/);
  assert.match(migration, /clock_timestamp\(\)\+interval '10 minutes'/);
  assert.match(migration, /patient_linked/);
});

test('availability is bounded, minimized and audited without patient data', () => {
  assert.match(edge, /31 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(edge, /8 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(edge, /p_limit: 3/);
  assert.match(edge, /assistant_availability_query/);
  assert.match(edge, /contentLength > 16_384/);
  assert.match(edge, /No se pudo auditar la consulta/);
  assert.doesNotMatch(edge, /patient_id|patient_name|phone|email/);
});

test('temporary offers contain no PII and an unlinked request guides reception to link the patient', () => {
  assert.match(migration, /smyl_assistant_slot_offers/);
  assert.match(migration, /revoke all on table public\.smyl_assistant_slot_offers from public, anon, authenticated/);
  assert.doesNotMatch(migration.split('create table if not exists public.smyl_assistant_slot_offers')[1].split(');')[0], /patient_id|phone|email|name/);
  assert.match(migration, /smyl_link_pending_requests_after_handoff/);
  assert.match(inbox, /Solicitud recibida\. Vincula al paciente antes de confirmar la cita/);
  assert.match(inbox, /Vincular paciente para confirmar/);
});
