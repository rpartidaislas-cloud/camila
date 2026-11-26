import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261121100000_smyl_patient_attendance_responses.sql');
const fn = read('supabase/functions/appointment-negotiations/index.ts');
const schedule = read('smyl-schedule.js');

function loadNormalizer() {
  const source = fn.match(/function normalizeAttendance\(value: unknown\)[^{]*\{[\s\S]*?\n\}\n/)[0]
    .replace('(value: unknown): "confirmed" | "reschedule" | "rebook" | null', '(value)');
  return new Function('text', `${source}; return normalizeAttendance;`)((value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : ''));
}

test('el servidor reconoce solo los dos botones de asistencia, sin importar acentos ni mayúsculas', () => {
  const normalize = loadNormalizer();
  for (const label of ['Confirmo mi asistencia', 'CONFIRMO MI ASISTENCIA', ' confirmo ']) assert.equal(normalize(label), 'confirmed');
  for (const label of ['Necesito reprogramar', 'necesito  reprogramar'.replace('  ', ' '), 'Reprogramar']) assert.equal(normalize(label), 'reschedule');
  for (const label of ['Quiero reagendar', 'reagendar']) assert.equal(normalize(label), 'rebook');
  for (const label of ['Aceptar', 'Rechazar', 'Voy en camino', 'Cancelar mi cita', '', null, undefined, 42]) assert.equal(normalize(label), null, String(label));
});

test('la respuesta de asistencia solo entra cuando no es una entrega de negociación y sigue firmada', () => {
  const callback = fn.slice(fn.indexOf('async function callback'), fn.indexOf('Deno.serve'));
  assert.match(callback, /safeEqual\(signature/, 'la firma HMAC se exige antes de todo');
  assert.ok(callback.indexOf('Firma inválida') < callback.indexOf('smyl_apply_patient_attendance_response'));
  assert.match(callback, /if \(!delivery\) \{[\s\S]*normalizeAttendance[\s\S]*smyl_apply_patient_attendance_response[\s\S]*\}/);
  assert.match(callback, /return json\(404, \{ error: "No se encontró la entrega\." \}\)/, 'un botón desconocido sin entrega sigue siendo 404');
  assert.match(callback, /CALLBACK_SKEW_MS|Math\.abs\(Date\.now\(\) - occurredAt\)/, 'se rechazan eventos fuera de tiempo');
  assert.ok(read('docs/bundles/appointment-negotiations.single-file.ts').includes('normalizeAttendance'), 'el bundle está regenerado');
});

test('la migración guarda solo la decisión, es idempotente y solo la llama el servidor', () => {
  assert.match(sql, /create table if not exists public\.smyl_appointment_patient_responses/);
  assert.match(sql, /response text not null check \(response in \('confirmed', 'reschedule'\)\)/);
  assert.match(sql, /unique \(tenant_id, provider_event_id\)/);
  assert.match(sql, /on conflict \(tenant_id, provider_event_id\) do nothing/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke insert, update, delete on table public\.smyl_appointment_patient_responses from authenticated/);
  assert.match(sql, /revoke all on function public\.smyl_apply_patient_attendance_response\([^)]*\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.smyl_apply_patient_attendance_response\([^)]*\) to service_role/);
  assert.doesNotMatch(sql, /update public\.smyl_appointments|delete from public\.smyl_appointments|cancelled/i, 'una respuesta nunca cambia ni cancela la cita');
  assert.doesNotMatch(sql, /\bbody\b|message_text|content text/i, 'no guarda el texto del mensaje');
});

test('si el chat tiene varios pacientes o varias citas próximas no adivina en silencio', () => {
  assert.match(sql, /'ambiguous_patient'/);
  assert.match(sql, /'no_appointment'/);
  assert.match(sql, /ambiguous boolean not null default false/);
  assert.match(sql, /v_count > 1/);
  assert.match(sql, /a\.status = 'confirmed'/);
});

test('la Agenda marca la respuesta, solo vale con el mismo horario y «pidió reprogramar» es una tarea', () => {
  assert.match(schedule, /function responseFor\(a\)/);
  assert.match(schedule, /Date\.parse\(row\.appointment_starts_at\)===Date\.parse\(a\.starts_at\)/);
  assert.match(schedule, /label:'Pidió reprogramar'/);
  assert.match(schedule, /priority:0/);
  assert.match(schedule, /Respuesta del paciente/);
  assert.match(schedule, /Confirmó su asistencia/);
  assert.match(schedule, /state\.responsesAt=0;ensureResponses\(\)/, 'el sondeo de 45 s también trae respuestas nuevas');
  assert.doesNotMatch(schedule.slice(schedule.indexOf('function ensureResponses'), schedule.indexOf('function offerNotice') > 0 ? schedule.indexOf('async function offerNotice') : undefined), /smyl_transition_appointment|smyl_reschedule_appointment/);
});

test('web, móvil y PWA publican el PR 4', () => {
  for (const file of ['smyl-schedule.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
