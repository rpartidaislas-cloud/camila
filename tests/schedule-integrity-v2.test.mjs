import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261015020000_smyl_schedule_integrity_v2.sql');
const schedule = read('../smyl-schedule.js');

test('canonical validation protects treatment buffers for professionals and rooms', () => {
  assert.match(migration, /smyl_validate_service_appointment_slot/);
  assert.match(migration, /buffer_before_minutes/);
  assert.match(migration, /buffer_after_minutes/);
  assert.match(migration, /a\.room_id=p_room_id/);
  assert.match(migration, /tiempo clínico reservado/);
  assert.match(migration, /smyl_create_appointment[\s\S]*smyl_validate_service_appointment_slot/);
  assert.match(migration, /smyl_reschedule_appointment[\s\S]*smyl_validate_service_appointment_slot/);
});

test('conversational availability assigns a real room and excludes active holds', () => {
  assert.match(migration, /smyl_inbox_available_slots_v2/);
  assert.match(migration, /room_id uuid/);
  assert.match(migration, /left join lateral[\s\S]*public\.smyl_rooms/);
  assert.match(migration, /slot_hold_expires_at>clock_timestamp\(\)/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /clock_timestamp\(\)\+interval '10 minutes'/);
  assert.match(migration, /preferred_room_id/);
});

test('the team still confirms every conversational request explicitly', () => {
  assert.match(migration, /smyl_inbox_create_appointment_request/);
  assert.match(migration, /pendiente de confirmación humana/);
  assert.match(migration, /smyl_inbox_confirm_appointment_request/);
  assert.match(migration, /status='accepted'/);
  assert.doesNotMatch(migration.slice(
    migration.indexOf('create or replace function public.smyl_inbox_create_appointment_request'),
    migration.indexOf('create or replace function public.smyl_inbox_confirm_appointment_request')
  ), /insert into public\.smyl_appointments/);
});

test('agenda UI guides fifteen-minute booking with compatible professionals and rooms', () => {
  assert.match(schedule, /min<total;min\+=15/);
  assert.match(schedule, /preferred_professional_id/);
  assert.match(schedule, /preferred_room_id/);
  assert.match(schedule, /professionalCanService/);
  assert.match(schedule, /professionalCanBranch/);
  assert.match(schedule, /\['Reserva'/);
  assert.match(schedule, /Selecciona un sillón o consultorio/);
});
