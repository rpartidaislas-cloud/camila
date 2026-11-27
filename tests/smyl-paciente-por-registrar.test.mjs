import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const schedule = read('../smyl-schedule.js');
const app = read('../app.html');
const migration = read('../supabase/migrations/20261115090000_smyl_patient_pending_registration.sql');
const workflow = read('../.github/workflows/smyl-paciente-por-registrar-migracion.yml');

test('la migración es aditiva: columna con valor por omisión y restricción de dos estados', () => {
  assert.match(migration, /add column if not exists registro_estado text not null default 'completo'/);
  assert.match(migration, /check \(registro_estado in \('completo','pendiente'\)\)/);
  assert.doesNotMatch(migration, /drop |delete from|policy|grant /i);
});

test('el workflow se dispara a mano y verifica la columna', () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.match(workflow, /column: 'registro_estado'/);
});

test('agendar a alguien nuevo exige teléfono, no nombre', () => {
  assert.match(schedule, /if\(!nombre&&!tel\)\{fail\('Escribe el teléfono/);
  assert.match(schedule, /var pending=!nombre;if\(pending\)\{nombre=pendingName\(tel\);apellido='';\}/);
  assert.match(schedule, /if\(pending\)fields\.registro_estado='pendiente'/);
});

test('si la migración aún no está aplicada, el alta reintenta sin la columna', () => {
  // Reintenta quitando solo las columnas opcionales (registro_estado, ciclo_vida) que el servidor diga que no existen.
  assert.match(schedule, /optional=\['ciclo_vida','registro_estado'\]/);
  assert.match(schedule, /schema cache\|42703\|PGRST204/);
  assert.match(schedule, /delete fields\[c\]/);
});

test('la agenda marca a la persona como por registrar en lista y semana', () => {
  assert.equal(schedule.split('schedule-pending-chip').length - 1, 2);
});

test('completar el registro exige un nombre real y marca el estado como completo', () => {
  assert.match(app, /nombre\.indexOf\('Por registrar · '\) === 0\) \{ alert\(/);
  assert.match(app, /previo\.registro_estado === 'pendiente' \|\| previo\.registro_estado === 'por_verificar'\)\) datos\.registro_estado = 'completo'/);
});

test('copias móviles idénticas', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js'])
    assert.equal(read('../' + file), read('../mobile/www/' + file), file);
});

// ── Fase 2: enlace para que la persona complete sus datos ──
const links = read('../supabase/migrations/20261115120000_smyl_patient_registration_links.sql');
const page = read('../registro-paciente.html');

test('fase 2 · el token nunca se guarda en claro y es de 256 bits', () => {
  assert.match(links, /token_hash text not null unique/);
  assert.match(links, /encode\(sha256\(convert_to\(v_token, 'utf8'\)\), 'hex'\)/);
  assert.match(links, /gen_random_uuid\(\)::text, '-', ''\) \|\| replace\(gen_random_uuid/);
  const insert = links.match(/insert into public\.smyl_patient_registration_links[^;]*;/)[0];
  assert.equal((insert.match(/v_token/g) || []).length, (insert.match(/convert_to\(v_token/g) || []).length, 'el token solo entra por convert_to dentro del hash');
});

test('fase 2 · la tabla del enlace no es accesible directamente', () => {
  assert.match(links, /enable row level security/);
  assert.match(links, /revoke all on public\.smyl_patient_registration_links from public, anon, authenticated/);
  assert.doesNotMatch(links, /create policy/i);
});

test('fase 2 · solo el personal autorizado crea enlaces y solo de fichas pendientes', () => {
  assert.match(links, /smyl_has_permission\(v_tenant, 'patients\.manage'\)/);
  assert.match(links, /smyl_current_tenant\(\)/);
  assert.match(links, /registro_estado = 'pendiente'\) then\s+raise exception 'Este paciente ya tiene su registro completo/);
  assert.match(links, /revoke all on function public\.smyl_create_registration_link\(uuid\) from public, anon/);
  assert.match(links, /grant execute on function public\.smyl_create_registration_link\(uuid\) to authenticated/);
});

test('fase 2 · enviar es de un solo uso, vence a los 7 días y solo toca la ficha ligada', () => {
  assert.match(links, /interval '7 days'/);
  assert.match(links, /used_at is null and expires_at > now\(\)\s+for update/);
  assert.match(links, /where id = v_link\.patient_id and tenant_id = v_link\.tenant_id and registro_estado = 'pendiente'/);
  assert.match(links, /set used_at = now\(\) where id = v_link\.id/);
});

test('fase 2 · exige consentimiento y valida lo que escribe la persona', () => {
  assert.match(links, /coalesce\(p_consent, false\) is not true/);
  assert.match(links, /'femenino', 'masculino', 'otro'/);
  assert.match(links, /p_fecha_nacimiento > current_date/);
});

test('fase 2 · la página pública solo usa las dos funciones y escapa textos', () => {
  assert.match(page, /smyl_registration_link_info/);
  assert.match(page, /smyl_submit_registration/);
  assert.doesNotMatch(page, /\/rest\/v1\/(?!rpc\/)/);
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /esc\(info\.clinic_name\)/);
  assert.match(page, /\^\[0-9a-f\]\{64\}\$/);
});

test('fase 2 · Pacientes ofrece «Enviar enlace de registro» solo si está pendiente', () => {
  assert.match(app, /porRegistrar && p\.registro_estado === 'pendiente'/);
  assert.match(app, /sb\.rpc\('smyl_create_registration_link'/);
  assert.match(app, /wa\.me\//);
});

// ── Fase 2b: «por verificar» ──
const verify = read('../supabase/migrations/20261115150000_smyl_patient_registration_verify.sql');

test('fase 2b · el envío deja la ficha por verificar y el estado existe en la restricción', () => {
  assert.match(verify, /check \(registro_estado in \('completo','pendiente','por_verificar'\)\)/);
  assert.match(verify, /registro_estado = 'por_verificar',\s+updated_at = now\(\)/);
  assert.doesNotMatch(verify, /registro_estado = 'completo',\s+updated_at/);
  assert.match(verify, /grant execute on function public\.smyl_submit_registration\(text, text, text, text, date, text, boolean\) to anon, authenticated/);
});

test('fase 2b · Pacientes muestra Por verificar y permite confirmar solo ese estado', () => {
  assert.match(app, /porVerificar \? 'Por verificar'/);
  assert.match(app, /confirmarDatosPaciente\(p, ok\)/);
  assert.match(app, /\.eq\('registro_estado', 'por_verificar'\)/);
  });
