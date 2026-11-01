import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261026200000_smyl_appointment_negotiations.sql');
const script = read('../smyl-schedule.js');
const styles = read('../smyl-schedule.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('negotiation state is tenant-scoped, auditable and capped at three rounds', () => {
  for (const table of ['smyl_appointment_negotiations', 'smyl_appointment_negotiation_proposals', 'smyl_appointment_negotiation_events']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /round_count between 1 and 3/);
  assert.match(migration, /v_negotiation\.round_count >= 3/);
  assert.match(migration, /reason', 'round_limit'/);
  assert.match(migration, /v_negotiation\.response_due_at <= clock_timestamp\(\)/);
  assert.match(migration, /set status = 'expired'/);
  assert.match(migration, /where status = 'offered'/);
});

test('direct negotiation writes stay behind validated RPCs', () => {
  assert.match(migration, /revoke all on public\.smyl_appointment_negotiations,[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.smyl_appointment_negotiations,[\s\S]*to authenticated/);
  assert.match(migration, /smyl_negotiation_actor_can_manage/);
  assert.match(migration, /p\.user_id = auth\.uid\(\)/);
  assert.match(migration, /smyl_validate_service_appointment_slot/);
});

test('final confirmation reuses the canonical appointment acceptance path', () => {
  assert.match(migration, /create or replace function public\.smyl_confirm_appointment_negotiation/);
  assert.match(migration, /public\.smyl_accept_appointment_request\(/);
  assert.match(migration, /state = 'confirmed', confirmed_appointment_id = v_appointment/);
});

test('agenda exposes each human decision without pretending WhatsApp was sent', () => {
  for (const label of ['Espera al profesional', 'Espera al paciente', 'Listo para confirmar', 'Requiere atención', 'Ronda ', 'Preparar confirmación', 'Paciente aceptó']) assert.match(script, new RegExp(label));
  for (const rpc of ['smyl_start_appointment_negotiation', 'smyl_professional_negotiation_decision', 'smyl_patient_negotiation_decision', 'smyl_confirm_appointment_negotiation']) assert.match(script, new RegExp(rpc));
  assert.match(script, /WhatsApp enviado · esperando respuesta/);
  assert.match(script, /Registrar confirmación/);
  assert.match(styles, /schedule-request-stage/);
  assert.match(styles, /schedule-manual-note/);
});

test('negotiation release is versioned and synchronized to mobile', () => {
  assert.match(app, /smyl-schedule\.js\?v=(?:2[6-9]|[3-9][0-9])/);
  assert.match(app, /smyl-schedule\.css\?v=19/);
  assert.match(worker, /appointment-negotiations/);
  assert.equal(script, read('../mobile/www/smyl-schedule.js'));
  assert.equal(styles, read('../mobile/www/smyl-schedule.css'));
  assert.equal(app, read('../mobile/www/app.html'));
});
