import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.resolve(here, relative), 'utf8');
const migration = read('../supabase/migrations/20261014030000_smyl_inbox_availability.sql');
const edge = read('../supabase/functions/lana-inbox/index.ts');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const preview = read('./fixtures/smyl-inbox-stage7-preview.html');

test('availability is computed server-side from the canonical dental agenda', () => {
  assert.match(migration, /smyl_inbox_available_slots/);
  for (const source of ['smyl_professional_services', 'smyl_professional_hours', 'smyl_clinic_hours', 'smyl_appointments', 'smyl_schedule_blocks']) {
    assert.match(migration, new RegExp(source));
  }
  assert.match(migration, /buffer_before_minutes/);
  assert.match(migration, /buffer_after_minutes/);
  assert.match(migration, /status in \('confirmed','arrived','in_progress'\)/);
  assert.match(migration, /permission_key='schedule\.read'/);
});

test('the availability RPC is private, bounded and read-only', () => {
  assert.match(migration, /p_to - p_from > interval '31 days'/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit,12\),1\),30\)/);
  assert.match(migration, /revoke all on function[\s\S]+from public,anon,authenticated/);
  assert.match(migration, /grant execute on function[\s\S]+to service_role/);
  assert.doesNotMatch(migration, /insert into public\.smyl_appointments|update public\.smyl_appointments/);
});

test('the Inbox bridge enforces both messaging and schedule permissions', () => {
  assert.match(edge, /action === "availability_catalog" \|\| action === "availability"/);
  assert.match(edge, /requirePermission\(actor, "schedule\.read"/);
  assert.match(edge, /admin\.rpc\("smyl_inbox_available_slots"/);
  assert.match(edge, /holds_created: false/);
});

test('the dentist can review slots and add a verified shortlist to the draft', () => {
  assert.match(inbox, /Agenda disponible/);
  assert.doesNotMatch(inbox, /AGENDA · SIN SALIR DEL CHAT/);
  assert.match(inbox, /<h2 tabindex="-1">Agendar cita<\/h2>/);
  assert.match(inbox, /Agregar opciones al mensaje/);
  assert.match(inbox, /La clínica confirmará el horario después de tu elección/);
  assert.doesNotMatch(inbox.slice(inbox.indexOf('function searchAvailability'), inbox.indexOf('async function loadList')), /smyl_create_appointment|smyl_accept_appointment_request/);
  assert.match(css, /smyl-inbox-availability-slot/);
});

test('availability stays in parity on web and mobile and has deterministic QA data', () => {
  assert.equal(mobileInbox, inbox);
  assert.equal(mobileCss, css);
  assert.match(preview, /action === 'availability_catalog'/);
  assert.match(preview, /action === 'availability'/);
  assert.match(preview, /preview\.has\('availability'\)/);
});
