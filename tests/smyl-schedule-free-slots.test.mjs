import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20261027120000_smyl_schedule_free_slots.sql');
const schedule = read('smyl-schedule.js');

test('la función de horas libres solo sirve a quien puede agendar y solo en su propia clínica', () => {
  assert.match(sql, /create or replace function public\.smyl_schedule_free_slots\(/);
  // La clínica sale de la sesión, nunca de un parámetro que el navegador pueda cambiar.
  assert.match(sql, /v_tenant uuid := public\.smyl_current_tenant\(\)/);
  assert.doesNotMatch(sql, /p_tenant_id/);
  assert.match(sql, /not public\.smyl_has_permission\(v_tenant, 'schedule\.manage'\)/);
  assert.match(sql, /errcode = '42501'/);
  assert.match(sql, /security definer\s+set search_path = pg_catalog, public/);
  assert.match(sql, /revoke all on function public\.smyl_schedule_free_slots\([^)]*\)\s+from public, anon;/);
  assert.match(sql, /grant execute on function public\.smyl_schedule_free_slots\([^)]*\)\s+to authenticated;/);
  assert.doesNotMatch(sql, /to anon|to public/);
  // Solo devuelve horarios, nunca datos de pacientes ni de citas.
  assert.match(sql, /returns table \(slot_start timestamptz, slot_end timestamptz, slot_room_id uuid, slot_room_name text\)/);
  assert.doesNotMatch(sql, /patient_id|camila_pacientes|notes/);
});

test('la función copia la regla del validador: horarios, citas con preparación, bloqueos, apartados y sillón', () => {
  assert.match(sql, /smyl_clinic_hours/);
  assert.match(sql, /smyl_professional_hours/);
  assert.match(sql, /a\.status in \('confirmed', 'arrived', 'in_progress'\)/);
  assert.match(sql, /old_s\.buffer_after_minutes/);
  assert.match(sql, /old_s\.buffer_before_minutes/);
  assert.match(sql, /smyl_schedule_blocks/);
  assert.match(sql, /req\.slot_hold_expires_at > clock_timestamp\(\)/);
  assert.match(sql, /v_total := v_duration \+ v_extra/);
  assert.match(sql, /p_exclude_appointment_id is null or a\.id <> p_exclude_appointment_id/);
  assert.match(sql, /v_extra % 15 <> 0/);
  assert.match(sql, /p_to - p_from > interval '8 days'/);
  // Hora local de la sucursal, como el validador.
  assert.match(sql, /at time zone v_timezone/);
});

test('la Agenda usa la función del servidor y conserva el cálculo del navegador como respaldo', () => {
  assert.match(schedule, /rpc\('smyl_schedule_free_slots',\{p_service_id:snap\.service\.id/);
  assert.match(schedule, /p_extra_minutes:snap\.extra\|\|0/);
  assert.match(schedule, /p_exclude_appointment_id:appointment&&appointment\.id\|\|null/);
  assert.match(schedule, /if\(missingRpc\(err\)\)slotRpcOff=true;/);
  assert.match(schedule, /var busy=await dayBusy\(snap\.branch\.id,day\)/);
  assert.match(schedule, /Revisados con la agenda de toda la clínica/);
  // El servidor sigue decidiendo al confirmar.
  assert.match(schedule, /rpc\('smyl_create_appointment'/);
  assert.equal(fs.existsSync(path.join(root, 'smyl-schedule-slots.js')), true);
});

test('las horas libres del servidor se distribuyen igual en web, móvil y PWA', () => {
  for (const file of ['smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-schedule\.js\?v=28/);
});
