import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const edge = fs.readFileSync(new URL('../supabase/functions/lana-assistant-tools/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

test('LANA assistant availability is a private read-only server bridge', () => {
  assert.match(edge, /SMYL_LANA_TOOL_SECRET/);
  assert.match(edge, /constantTimeEqual/);
  assert.match(edge, /lana_tenant_id/);
  assert.match(edge, /lana\.estado === "conectada"/);
  assert.match(edge, /smyl_inbox_available_slots_v2/);
  assert.match(edge, /p_actor_id: smylTenantId/);
  assert.match(config, /\[functions\.lana-assistant-tools\][\s\S]*?verify_jwt = false/);
});

test('the runtime cannot create, hold or confirm appointments', () => {
  assert.match(edge, /create_request: false/);
  assert.match(edge, /confirm_appointment: false/);
  assert.match(edge, /holds_created: false/);
  assert.match(edge, /appointment_created: false/);
  assert.doesNotMatch(edge, /smyl_inbox_create_appointment_request/);
  assert.doesNotMatch(edge, /smyl_inbox_confirm_appointment_request/);
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
