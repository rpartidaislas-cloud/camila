import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261026170000_smyl_google_calendar_sync.sql');
const sync = read('../supabase/functions/google-calendar-sync/index.ts');
const webhook = read('../supabase/functions/google-calendar-webhook/index.ts');
const oauth = read('../supabase/functions/google-calendar-oauth/index.ts');
const client = read('../smyl-google-calendar.js');
const schedule = read('../smyl-schedule.js');
const config = read('../supabase/config.toml');

test('cada conexión queda ligada a un profesional y una clínica', () => {
  assert.match(migration, /professional_id uuid/);
  assert.match(migration, /unique index[\s\S]*\(tenant_id, professional_id\)/);
  assert.match(oauth, /activeProfessional/);
  assert.match(oauth, /professional_id: row\.professional_id/);
});

test('los cambios de SMYL producen trabajos idempotentes hacia Google', () => {
  assert.match(migration, /smyl_appointments_google_calendar_queue/);
  assert.match(migration, /on conflict \(connection_id, appointment_id\) do update/);
  assert.match(sync, /operation === "delete"/);
  assert.match(sync, /method = link \? "PATCH" : "POST"/);
  assert.match(sync, /extendedProperties/);
  assert.match(sync, /Sin datos clínicos/);
  assert.doesNotMatch(sync, /camila_pacientes/);
});

test('los cambios de Google quedan pendientes antes de tocar la cita clínica', () => {
  assert.match(migration, /change_type text not null check \(change_type in \('reschedule','cancel','create'\)\)/);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(sync, /smyl_reschedule_appointment/);
  assert.match(sync, /smyl_transition_appointment/);
  assert.match(sync, /La cita debe pertenecer al dentista que conectó este calendario/);
  assert.match(client, /completeCreate/);
  assert.match(client, /Por revisar/);
  assert.match(client, /Aceptar/);
  assert.match(client, /Rechazar/);
  assert.match(schedule, /bookAt:function/);
});

test('la recepción usa sync tokens y un webhook autenticado y renovable', () => {
  assert.match(sync, /syncToken/);
  assert.match(sync, /response\.status === 410/);
  assert.match(sync, /allowUnlinkedCreates = Boolean\(connection\.sync_token\)/);
  assert.match(sync, /events\/watch/);
  assert.match(sync, /channel_expires_at/);
  assert.match(webhook, /x-goog-channel-id/);
  assert.match(webhook, /x-goog-resource-id/);
  assert.match(webhook, /channel_token_hash !== await hash\(token\)/);
  assert.match(config, /\[functions\.google-calendar-sync\][\s\S]*verify_jwt = false/);
  assert.match(config, /\[functions\.google-calendar-webhook\][\s\S]*verify_jwt = false/);
});
