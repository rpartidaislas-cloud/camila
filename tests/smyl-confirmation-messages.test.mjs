import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261119120000_smyl_appointment_confirmation_messages.sql');
const fn = read('supabase/functions/appointment-reminders/index.ts');

test('la migración agrega la confirmación, la ventana, el consentimiento y el WhatsApp por sucursal sin tocar lo existente', () => {
  assert.match(migration, /reminder_type in \('24h', '2h', 'custom', 'confirmation'\)/);
  assert.match(migration, /add column if not exists confirmation_enabled boolean not null default false/);
  assert.match(migration, /confirmation_since timestamptz/);
  assert.match(migration, /send_window_start time not null default '09:00'/);
  assert.match(migration, /send_window_end time not null default '20:00'/);
  assert.match(migration, /send_window_end - send_window_start >= interval '1 hour'/);
  assert.match(migration, /require_consent boolean not null default false/);
  assert.match(migration, /whatsapp_mode text not null default 'single' check \(whatsapp_mode in \('single', 'per_branch'\)\)/);
  assert.match(migration, /alter table public\.smyl_branches[\s\S]*whatsapp_phone text not null default ''/);
  assert.match(migration, /contact_phone_public boolean not null default false/);
  // aditiva: no borra tablas ni columnas
  assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test('las confirmaciones solo cubren citas del equipo o del portal, nuevas desde que se enciende, sin duplicar ni mandar en retroactivo', () => {
  assert.match(migration, /a\.source in \('manual', 'patient_portal'\)/);
  assert.match(migration, /a\.created_at >= s\.confirmation_since/);
  assert.match(migration, /e\.event_type = 'rescheduled' and e\.created_at >= s\.confirmation_since/);
  assert.match(migration, /c\.starts_snapshot = a\.starts_at and c\.status in \('pending', 'processing', 'sent'\)/);
  // una confirmación reciente evita el recordatorio pegado a ella (< 6 h)
  assert.match(migration, /r\.scheduled_for < c\.scheduled_for \+ interval '6 hours'/);
  // nunca a menos de 2 horas de la cita
  assert.match(migration, /a\.starts_at > now\(\) \+ interval '2 hours'/);
});

test('el reclamo sigue reservado al servicio (no a usuarios) y devuelve los datos de contacto sin exponer teléfonos privados', () => {
  assert.match(migration, /revoke all on function public\.smyl_claim_appointment_reminders\(uuid, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.smyl_claim_appointment_reminders\(uuid, integer\) to service_role/);
  assert.match(migration, /case when pr\.contact_phone_public then nullif\(btrim\(pr\.contact_phone\), ''\) end/);
  assert.match(migration, /cfg\.whatsapp_mode = 'per_branch' and nullif\(btrim\(b\.whatsapp_phone\), ''\) is not null/);
});

test('la Edge Function respeta consentimiento, ventana y tipo apagado, y asigna la sucursal sin pisar una manual', () => {
  assert.match(fn, /settings\.require_consent === true && row\.whatsapp_consent !== true/);
  assert.match(fn, /sendAtWithinWindow\(/);
  assert.match(fn, /mode: isConfirmation \? "later" : "nearest"/);
  assert.match(fn, /isConfirmation \? !confirmOn : !remindersOn/);
  assert.match(fn, /ignoreDuplicates: true/);
  assert.match(fn, /source: "appointment"/);
  assert.match(fn, /\|\| "—"/);
  // la confirmación solo aplica desde que se enciende y apagar un tipo no toca el otro
  assert.match(fn, /row\.confirmation_since = previous\?\.confirmation_enabled && previous\.confirmation_since/);
  assert.match(fn, /const types = kind === "confirmation" \? \["confirmation"\] : REMINDER_TYPES/);
  // permisos: configurar exige gestionar la agenda y responder mensajes
  assert.match(fn, /if \(!canConfigure\) return json\(403/);
});

test('el paquete para pegar en Supabase incluye la lógica nueva y la pantalla ofrece confirmación, ventana, consentimiento y números por sucursal', () => {
  const bundle = read('docs/bundles/appointment-reminders.single-file.ts');
  assert.match(bundle, /function sendAtWithinWindow\(/);
  assert.match(bundle, /kind === "preferences"/);
  const ui = read('smyl-reminders.js');
  assert.match(ui, /Confirmación al agendar/);
  assert.match(ui, /Un solo número para toda la clínica/);
  assert.match(ui, /Un número por sucursal/);
  assert.match(ui, /data-branch-whatsapp/);
  assert.match(ui, /kind: 'preferences'/);
  assert.doesNotMatch(ui, /localStorage/);
  for (const file of ['smyl-reminders.js', 'smyl-schedule.css']) assert.equal(read(`mobile/www/${file}`), read(file), file);
});
