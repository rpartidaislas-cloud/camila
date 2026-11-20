import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const notice = require('../smyl-appointment-notice.js');
const sql = read('supabase/migrations/20261120160000_smyl_appointment_notice_log.sql');

const ALL = ['cita_confirmada_v1', 'agenda_cita_nueva_profesional_v1', 'cita_reprogramada_v1', 'agenda_cambio_profesional_v1', 'cita_cancelada_clinica_v1', 'agenda_cancelacion_profesional_v1'];
const approved = ALL.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name }));
const appointment = { id: 'a1', patient_id: 'p1', professional_id: 'pr1', starts_at: '2026-11-24T16:00:00.000Z', updated_at: '2026-11-20T18:00:00.000Z', source: 'inbox' };
const ctx = { patient: { first: 'Ana', last: 'Pérez' }, service: 'Valoración', professional: 'Dra. Lozano', branch: { name: 'Centro', timezone: 'America/Mexico_City' }, clinic: 'Clínica Sonríe' };
const plan = (extra = {}) => notice.planRows({ event: 'confirmed', appointment, previous: null, ctx, defaults: {}, approved, patientConversation: 'c1', professionalConversation: 'c2', autoConfirmation: true, log: [], ...extra });

test('la migración del historial es aditiva, con RLS por cita y escritura solo por RPC con permiso', () => {
  assert.match(sql, /create table if not exists public\.smyl_appointment_notice_log/);
  assert.match(sql, /foreign key \(tenant_id, appointment_id\) references public\.smyl_appointments\(tenant_id, id\) on delete cascade/);
  assert.match(sql, /alter table public\.smyl_appointment_notice_log enable row level security/);
  assert.match(sql, /smyl_has_permission\(tenant_id, 'schedule\.read'\)\s+and exists \(select 1 from public\.smyl_appointments/);
  assert.match(sql, /revoke insert, update, delete on table public\.smyl_appointment_notice_log from authenticated/);
  assert.match(sql, /v_tenant uuid := public\.smyl_current_tenant\(\)/);
  assert.match(sql, /'messages\.respond'\) or public\.smyl_has_permission\(v_tenant, 'schedule\.manage'/);
  assert.match(sql, /revoke all on function public\.smyl_log_appointment_notice\(uuid, text, text, text, text, text\) from public, anon/);
  assert.doesNotMatch(sql, /drop table|truncate|body|message_text/i, 'no guarda el texto del mensaje');
});

test('una cita del chat sí recibe aviso al paciente aunque la confirmación automática esté activa', () => {
  assert.equal(plan().find((r) => r.audience === 'patient').state, 'ready');
});

test('«ya se avisó» sale del historial guardado y no se vuelve a marcar', () => {
  const log = [{ event: 'confirmed', audience: 'patient', status: 'sent', created_at: '2026-11-20T18:05:00.000Z' }];
  const rows = plan({ log });
  const patient = rows.find((r) => r.audience === 'patient'), pro = rows.find((r) => r.audience === 'professional');
  assert.equal(patient.already, true); assert.equal(patient.checked, false); assert.ok(patient.sentAt);
  assert.equal(pro.already, false); assert.equal(pro.checked, true);
  // Un intento fallido no cuenta como avisado.
  const failed = plan({ log: [{ ...log[0], status: 'failed' }] });
  assert.equal(failed.find((r) => r.audience === 'patient').already, false);
});

test('un aviso de cambio de horario viejo no cuenta si la cita se volvió a mover', () => {
  const old = [{ event: 'rescheduled', audience: 'patient', status: 'sent', created_at: '2026-11-19T10:00:00.000Z' }];
  const fresh = [{ event: 'rescheduled', audience: 'patient', status: 'sent', created_at: '2026-11-20T18:00:30.000Z' }];
  const previous = { starts_at: '2026-11-21T16:00:00.000Z' };
  assert.equal(plan({ event: 'rescheduled', previous, log: old }).find((r) => r.audience === 'patient').already, false);
  assert.equal(plan({ event: 'rescheduled', previous, log: fresh }).find((r) => r.audience === 'patient').already, true);
  assert.equal(notice.lastSent(old, appointment, 'rescheduled', 'patient'), '');
});

test('el componente registra cada envío (enviado o fallido) sin bloquear el envío', () => {
  const source = read('smyl-appointment-notice.js');
  assert.match(source, /record\(opts, row, 'sent', ''\)/);
  assert.match(source, /record\(opts, row, 'failed', row\.error\)/);
  assert.match(source, /smyl_log_appointment_notice/);
  assert.match(source, /\.catch\(function \(\) \{\}\)/);
  assert.match(source, /async function offerById/);
});

test('el chat ofrece el aviso al confirmar (reserva directa y solicitud) y no toca el tenant', () => {
  const inbox = read('smyl-inbox.js');
  assert.match(inbox, /offerAppointmentNotice\('confirmed', confirmedBooking && confirmedBooking\.appointment_id\)/);
  assert.match(inbox, /offerAppointmentNotice\('confirmed', data && data\.appointment_id\)/);
  assert.match(inbox, /SmylAppointmentNotice\.offerById\(\{ event: event, appointmentId: appointmentId \}\)/);
  assert.doesNotMatch(inbox, /offerById\([^)]*tenant/);
});

test('la Ficha 360 deja cambiar horario o cancelar las citas confirmadas próximas, solo con permiso', () => {
  const ficha = read('smyl-inbox-ficha.js'), inbox = read('smyl-inbox.js'), schedule = read('smyl-schedule.js');
  assert.match(ficha, /ctx\.onManage && visit\.status === 'confirmed' && ctx\.isUpcoming/);
  assert.match(ficha, /'Cambiar horario'/); assert.match(ficha, /'Cancelar cita'/);
  assert.match(inbox, /onManage: hasPermission\('schedule\.manage'\) && window\.SmylSchedule/);
  assert.match(schedule, /openAppointmentAction:async function\(id,action\)/);
  assert.match(schedule, /if\(!state\.canManage\)throw new Error/);
  assert.match(schedule, /if\(a\.status!=='confirmed'\)throw/);
});

test('la ficha de la Agenda lista los avisos enviados', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /data-ficha-notices/);
  assert.match(schedule, /from\('smyl_appointment_notice_log'\)/);
  assert.match(schedule, /Enviado'|No se envió/);
});

test('web, móvil y PWA publican el PR 3', () => {
  for (const file of ['smyl-appointment-notice.js', 'smyl-schedule.js', 'smyl-inbox.js', 'smyl-inbox.css', 'smyl-inbox-ficha.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
});
