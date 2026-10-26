import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const normalize = (source) => source.replace(/\r\n/g, '\n');

const schedule = read('../smyl-schedule.js');
const mobileSchedule = read('../mobile/www/smyl-schedule.js');
const directory = read('../smyl-professional-directory.js');
const mobileDirectory = read('../mobile/www/smyl-professional-directory.js');
const edge = read('../supabase/functions/public-appointment-request/index.ts');
const edgeBundle = read('../docs/bundles/public-appointment-request.single-file.ts');
const app = read('../app.html');
const mobileApp = read('../mobile/www/app.html');
const profile = read('../dentista.html');
const mobileProfile = read('../mobile/www/dentista.html');
const profileCss = read('../smyl-public-profile.css');
const mobileProfileCss = read('../mobile/www/smyl-public-profile.css');
const worker = read('../sw.js');
const mobileWorker = read('../mobile/www/sw.js');
const retentionMigration = read('../supabase/migrations/20261022121000_smyl_public_intake_retention.sql');

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(start, -1, `no se encontró ${name}`);
  return source.slice(start, end === -1 ? source.length : end);
}

function assetVersion(source, file) {
  const match = source.match(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=(\\d+)'));
  assert.ok(match, `no se encontró la versión de ${file}`);
  return match[1];
}

test('Agenda consulta la captación pública sin convertirla automáticamente en paciente', () => {
  assert.match(schedule, /from\('smyl_public_appointment_intakes'\)\.select\('appointment_request_id,contact_name,email,phone,preferred_contact,requested_date,requested_period,patient_message,status'\)/);
  assert.match(schedule, /\.in\('appointment_request_id',state\.requests\.map\(function\(r\)\{return r\.id;\}\)\)/);
  assert.match(schedule, /state\.intakes\s*=\s*await optionalQuery/);
  assert.match(schedule, /ensurePatients\(state\.appointments[\s\S]*?state\.requests\.map\(function\(r\)\{return r\.patient_id;\}\)/);
  assert.doesNotMatch(edge, /from\("camila_pacientes"\)/,
    'la función pública no debe consultar ni crear expedientes clínicos');
  assert.match(edge, /admin\.rpc\("smyl_create_public_appointment_intake"/);
});

test('una persona del equipo debe vincular la captación antes de poder agendar', () => {
  const review = functionBody(schedule, 'reviewPublicIntake', 'negotiationById');
  const negotiation = functionBody(schedule, 'openNegotiation', 'professionalDecision');
  const open = functionBody(schedule, 'openNew', 'openAppointment');

  assert.match(review, /state\.canManagePatients/);
  assert.match(review, /rpc\('smyl_link_public_appointment_intake',\{p_request_id:request\.id,p_patient_id:patientId\}\)/);
  assert.ok(review.indexOf("smyl_link_public_appointment_intake") < review.indexOf('openNegotiation(linked'),
    'la vinculación debe completarse antes de preparar la confirmación');
  assert.match(negotiation, /if\(!request\|\|!request\.patient_id\)/);
  assert.match(negotiation, /smyl_start_appointment_negotiation/);
  assert.match(open, /if\(request&&!request\.patient_id\)/);
  assert.match(open, /return reviewPublicIntake\(request,intake\)/);
  assert.match(open, /Primero vincula esta solicitud con un paciente verificado/);
  assert.ok(open.indexOf('if(request&&!request.patient_id)') < open.indexOf('appointmentForm('),
    'el guard debe ejecutarse antes de construir la cita');
  assert.match(schedule, /smyl_confirm_appointment_negotiation/);
});

test('el archivo único de la Edge Function contiene exactamente el handler vigente', () => {
  const sourceMain = normalize(edge)
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .join('\n')
    .replace(/^\s+/, '')
    .trimEnd();
  const marker = '// ── public-appointment-request/index.ts ──\n';
  const bundled = normalize(edgeBundle);
  const markerIndex = bundled.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'el bundle no contiene el handler público');
  assert.equal(bundled.slice(markerIndex + marker.length).trimEnd(), sourceMain);
});

test('el endpoint público verifica Turnstile cuando está configurado y nunca guarda sin validarlo', () => {
  assert.match(edge, /if \(TURNSTILE_SECRET\) \{/);
  assert.match(edge, /turnstile\/v0\/siteverify/);
  assert.match(edge, /if \(!verify\.success\) return response\(403,/);
  assert.doesNotMatch(edge, /return response\(503,/, 'sin clave configurada el formulario sigue protegido por honeypot y tope por IP, no se apaga');
  assert.ok(edge.indexOf('if (TURNSTILE_SECRET) {') < edge.indexOf('admin.rpc("smyl_create_public_appointment_intake"'),
    'la verificación de seguridad debe ocurrir antes de guardar la captación');
});

test('la retención puede borrar PII vencida sin dejar solicitudes pendientes huérfanas', () => {
  assert.match(retentionMigration, /smyl_purge_expired_public_appointment_intakes/);
  assert.match(retentionMigration, /retention_expires_at <= clock_timestamp\(\)/);
  assert.match(retentionMigration, /set status = 'expired'/);
  assert.match(retentionMigration, /delete from public\.smyl_public_appointment_intakes/);
  assert.match(retentionMigration, /grant execute[\s\S]*?to service_role/);
  assert.doesNotMatch(retentionMigration, /linked_patient_id|contact_name|patient_message|email|phone/,
    'la nueva bitácora de retención no debe duplicar PII');
});

test('el directorio sólo considera servicios realmente activos', () => {
  assert.match(directory, /function hasActiveService\(professionalId\)/);
  assert.match(directory, /service\.id===link\.service_id&&service\.active/);
  assert.match(directory, /from\('smyl_services'\)\.select\('id,name,active'\)/,
    'el helper necesita cargar el campo active para no bloquear perfiles válidos');
  assert.match(directory, /hasActiveService\(pro\.id\)/);
  assert.equal(directory, mobileDirectory);
});

test('web, PWA y cache distribuyen las mismas versiones de los assets públicos', () => {
  assert.equal(schedule, mobileSchedule);
  assert.equal(app, mobileApp);
  assert.equal(profile, mobileProfile);
  assert.equal(profileCss, mobileProfileCss);
  assert.equal(worker, mobileWorker);

  for (const file of ['smyl-schedule.js', 'smyl-professional-directory.js']) {
    const version = assetVersion(app, file);
    assert.equal(assetVersion(mobileApp, file), version);
    assert.equal(assetVersion(worker, file), version);
    assert.equal(assetVersion(mobileWorker, file), version);
  }
  assert.equal(assetVersion(profile, 'smyl-public-profile.css'), assetVersion(worker, 'smyl-public-profile.css'));
  assert.equal(assetVersion(mobileProfile, 'smyl-public-profile.css'), assetVersion(mobileWorker, 'smyl-public-profile.css'));
  assert.equal(assetVersion(profile, 'smyl-design-system-v2.css'), assetVersion(worker, 'smyl-design-system-v2.css'));
  assert.equal(assetVersion(mobileProfile, 'smyl-design-system-v2.css'), assetVersion(mobileWorker, 'smyl-design-system-v2.css'));
});
