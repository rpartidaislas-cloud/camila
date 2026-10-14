import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../supabase/migrations/20261012230000_smyl_daily_schedule.sql');
const actions = read('../supabase/migrations/20261012240000_smyl_schedule_actions.sql');
const grants = read('../supabase/migrations/20261012250000_smyl_schedule_grants_hardening.sql');
const hoursValidation = read('../supabase/migrations/20261012260000_smyl_professional_hours_validation.sql');
const app = read('../app.html');
const script = read('../smyl-schedule.js');
const styles = read('../smyl-schedule.css');
const worker = read('../sw.js');

test('agenda owns the complete dental scheduling domain in SMYL', () => {
  for (const table of ['smyl_services','smyl_professional_services','smyl_professional_hours','smyl_appointments','smyl_schedule_blocks','smyl_appointment_requests','smyl_appointment_events','smyl_appointment_reminders']) {
    assert.match(schema, new RegExp(`create table public\\.${table}\\b`));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(schema, /foreign key \(tenant_id, patient_id\)[\s\S]*camila_pacientes\(tenant_id, id\)/);
  assert.match(schema, /foreign key \(tenant_id, professional_id, branch_id\)[\s\S]*smyl_professional_branches/);
});

test('appointment writes are atomic, conflict-safe and stateful', () => {
  assert.match(actions, /smyl_create_appointment/);
  assert.match(actions, /smyl_reschedule_appointment/);
  assert.match(actions, /smyl_transition_appointment/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /p_starts_at<a\.ends_at and p_ends_at>a\.starts_at/);
  assert.match(actions, /v_row\.status='confirmed'.*'arrived'.*'no_show'.*'cancelled'/);
  assert.match(actions, /v_row\.updated_at<>p_expected_updated_at/);
  assert.match(actions, /smyl_appointment_events/);
});

test('professional availability remains inside clinic hours and rejects overlaps', () => {
  assert.match(hoursValidation, /smyl_clinic_hours/);
  assert.match(hoursValidation, /new\.starts_at >= h\.starts_at and new\.ends_at <= h\.ends_at/);
  assert.match(hoursValidation, /new\.starts_at < h\.ends_at and new\.ends_at > h\.starts_at/);
  assert.match(hoursValidation, /pg_advisory_xact_lock/);
});

test('direct writes are denied for operational and immutable schedule records', () => {
  assert.match(grants, /revoke all on table[\s\S]*smyl_appointments[\s\S]*from anon, authenticated/);
  assert.match(grants, /grant select on table[\s\S]*smyl_appointment_reminders[\s\S]*to authenticated/);
  assert.match(grants, /grant insert, update, delete on table[\s\S]*smyl_services[\s\S]*smyl_professional_hours[\s\S]*to authenticated/);
  assert.doesNotMatch(grants, /grant insert[\s\S]*smyl_appointments/);
});

test('assistant requests cannot silently become confirmed appointments', () => {
  assert.match(schema, /status text not null default 'pending'/);
  assert.match(script, /Solicitud, no confirmación/);
  assert.match(script, /la clínica siempre confirma/i);
  assert.match(actions, /smyl_accept_appointment_request/);
  assert.match(actions, /v_req\.status<>'pending'/);
  assert.doesNotMatch(script, /from\('smyl_appointment_requests'\)\.insert/);
});

test('reminders are queued independently and cancelled on terminal states', () => {
  assert.match(schema, /smyl_appointment_reminders/);
  assert.match(actions, /p_starts_at-interval '24 hours'/);
  assert.match(actions, /p_status in \('cancelled','no_show','completed'\)/);
  assert.match(actions, /set status='cancelled'/);
});

test('agenda UI supports calendar, requests, services, availability and mobile', () => {
  assert.match(app, /smyl-schedule\.css\?v=3/);
  assert.match(app, /smyl-schedule\.js\?v=7/);
  assert.match(script, /window\.TITULOS\.agenda='Agenda'/);
  assert.match(script, /data-schedule-view="day"/);
  assert.match(script, /data-schedule-view="week"/);
  assert.match(script, /smyl_create_schedule_block/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:440px\)/);
});

test('web, mobile and offline assets stay in lockstep', () => {
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-schedule.js'));
  assert.equal(styles, read('../mobile/www/smyl-schedule.css'));
assert.match(worker, /smyl-v221-inbox-productivity/);
  assert.match(worker, /smyl-schedule\.js\?v=7/);
  assert.match(worker, /smyl-schedule\.css\?v=3/);
});
