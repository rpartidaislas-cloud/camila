import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');
const migration = read('../supabase/migrations/20261014040000_smyl_inbox_appointment_confirmation.sql');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileCss = read('../mobile/www/smyl-inbox.css');

test('an Inbox choice remains a pending request until a second human confirmation', () => {
  assert.match(migration, /smyl_inbox_create_appointment_request/);
  assert.match(migration, /v_req\.status<>'pending'/);
  assert.match(migration, /smyl_inbox_confirm_appointment_request/);
  assert.match(migration, /smyl_validate_appointment_slot/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /insert into public\.smyl_appointments/);
});

test('conversation, patient and professional selection stay tenant-bound', () => {
  assert.match(migration, /camila_lana_handoffs/);
  assert.match(migration, /h\.tenant_id=p_tenant_id and h\.lana_conversation_id=p_conversation_id/);
  assert.match(migration, /preferred_professional_id/);
  assert.match(migration, /foreign key \(tenant_id, preferred_professional_id\)/);
  assert.match(migration, /permission_key='schedule\.manage'/);
});

test('the two private RPCs are service-role only and idempotent', () => {
  assert.match(migration, /external_request_key/);
  assert.match(migration, /on conflict \(tenant_id,source,external_request_key\)/);
  assert.match(migration, /if exists\(select 1 from public\.smyl_appointments/);
  assert.equal((migration.match(/to service_role/g) || []).length, 2);
  assert.doesNotMatch(migration, /to authenticated/);
});

test('the bridge enforces schedule management and never sends a chat message', () => {
  assert.match(edge, /action === "appointment_request" \|\| action === "appointment_confirm"/);
  assert.match(edge, /requirePermission\(actor, "schedule\.manage"/);
  assert.match(edge, /smyl_inbox_create_appointment_request/);
  assert.match(edge, /smyl_inbox_confirm_appointment_request/);
  assert.match(edge, /message_sent: false/);
});

test('the interface separates patient choice, confirmation and messaging', () => {
  assert.match(inbox, /Registrar elección/);
  assert.match(inbox, /todavía no será una cita/);
  assert.match(inbox, /Confirmar cita/);
  assert.match(inbox, /volverá a comprobar la disponibilidad/);
  assert.match(inbox, /no envió ningún mensaje automáticamente/);
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
});
