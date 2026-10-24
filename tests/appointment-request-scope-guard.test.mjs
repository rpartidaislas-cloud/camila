import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'supabase', 'migrations');
// Se normalizan los saltos de línea: un checkout con autocrlf entrega el archivo
// con \r\n y las búsquedas literales con \n daban un falso negativo sin que la
// validación SQL hubiera cambiado.
const migration = fs.readFileSync(
  path.join(migrationsDir, '20261022122000_smyl_appointment_request_scope_guard.sql'),
  'utf8',
).replace(/\r\n?/g, '\n');

function sqlFunction(name, nextName) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start + 1)
    : migration.length;
  assert.notEqual(start, -1, `no se encontró ${name}`);
  return migration.slice(start, end === -1 ? migration.length : end);
}

test('cada versión timestamped de migración es única', () => {
  const timestamped = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/.test(name));
  const versions = new Map();
  for (const file of timestamped) {
    const version = file.split('_', 1)[0];
    const prior = versions.get(version);
    assert.equal(prior, undefined, `timestamp duplicado ${version}: ${prior} y ${file}`);
    versions.set(version, file);
  }
});

test('dentista B no puede decidir una solicitud asignada al dentista A', () => {
  const body = sqlFunction(
    'smyl_accept_appointment_request',
    'smyl_reject_appointment_request',
  );
  const originalScope = body.indexOf(
    'coalesce(v_request.preferred_professional_id, v_request.professional_id)',
  );
  const targetScope = body.indexOf(
    "p_branch_id,\n    p_professional_id,\n    v_request.patient_id",
  );
  const create = body.indexOf('public.smyl_create_appointment(');
  const mutation = body.indexOf('update public.smyl_appointment_requests');

  assert.match(body, /public\.smyl_has_permission\(v_tenant, 'schedule\.manage'\)/);
  assert.match(body, /select \* into v_request[\s\S]*?for update;/);
  assert.ok(originalScope >= 0, 'falta validar el alcance original de la solicitud');
  assert.ok(targetScope > originalScope, 'falta validar el alcance del destino');
  assert.ok(create > targetScope, 'la cita no debe crearse antes de validar ambos alcances');
  assert.ok(mutation > create, 'la solicitud no debe mutarse antes de crear la cita autorizada');
});

test('aceptar no puede reutilizar el id de una cita ajena como atajo idempotente', () => {
  const body = sqlFunction(
    'smyl_accept_appointment_request',
    'smyl_reject_appointment_request',
  );
  const collision = body.indexOf('from public.smyl_appointments appointment');
  const create = body.indexOf('public.smyl_create_appointment(');

  assert.match(body, /if p_appointment_id is null then/);
  assert.match(body, /appointment\.tenant_id = v_tenant[\s\S]*?appointment\.id = p_appointment_id/);
  assert.ok(collision >= 0 && create > collision,
    'la colisión debe rechazarse antes de invocar el helper idempotente');
});

test('rechazar bloquea solicitudes fuera del alcance original', () => {
  const body = sqlFunction('smyl_reject_appointment_request');
  const scope = body.indexOf('public.smyl_can_access_schedule_row(');
  const mutation = body.indexOf('update public.smyl_appointment_requests');

  assert.match(body, /select \* into v_request[\s\S]*?for update;/);
  assert.match(body, /coalesce\(v_request\.preferred_professional_id, v_request\.professional_id\)/);
  assert.ok(scope >= 0 && mutation > scope,
    'el rechazo debe comprobar alcance antes de cambiar el estado');
});

test('las RPC conservan acceso autenticado pero no anónimo', () => {
  assert.match(migration, /revoke all on function public\.smyl_accept_appointment_request\([\s\S]*?from public, anon;/);
  assert.match(migration, /revoke all on function public\.smyl_reject_appointment_request\(uuid\)[\s\S]*?from public, anon;/);
  assert.match(migration, /grant execute on function public\.smyl_accept_appointment_request\([\s\S]*?to authenticated;/);
  assert.match(migration, /grant execute on function public\.smyl_reject_appointment_request\(uuid\)[\s\S]*?to authenticated;/);
});
