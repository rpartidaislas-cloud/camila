import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261012190000_smyl_clinic_core.sql', import.meta.url),
  'utf8'
);
const actions = fs.readFileSync(
  new URL('../supabase/migrations/20261012200000_smyl_clinic_core_actions.sql', import.meta.url),
  'utf8'
);
const professionalActions = fs.readFileSync(
  new URL('../supabase/migrations/20261012210000_smyl_professional_actions.sql', import.meta.url),
  'utf8'
);
const staffDefaults = fs.readFileSync(
  new URL('../supabase/migrations/20261012220000_smyl_staff_default_role.sql', import.meta.url),
  'utf8'
);

const expectedTables = [
  'smyl_roles',
  'smyl_role_permissions',
  'smyl_member_roles',
  'smyl_branches',
  'smyl_rooms',
  'smyl_clinic_hours',
  'smyl_member_branches',
  'smyl_professionals',
  'smyl_professional_branches',
  'smyl_audit_events'
];

test('stage 1 owns a complete tenant-scoped clinic core', () => {
  for (const table of expectedTables) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /foreign key \(tenant_id, user_id\)[\s\S]*camila_usuarios\(tenant_id, id\)/);
  assert.match(migration, /foreign key \(tenant_id, branch_id\)[\s\S]*smyl_branches\(tenant_id, id\)/);
});

test('permissions prevent staff from escalating their own role', () => {
  assert.match(migration, /smyl_member_roles_insert_owner[\s\S]*camila_es_dueno\(tenant_id\)/);
  assert.match(migration, /smyl_member_roles_delete_owner[\s\S]*camila_es_dueno\(tenant_id\)/);
  assert.doesNotMatch(migration, /smyl_member_roles_update/);
  assert.match(migration, /revoke insert, update, delete on public\.smyl_audit_events from anon, authenticated/);
});

test('new clinics and members receive defaults without manual provisioning', () => {
  assert.match(migration, /smyl_bootstrap_clinic_after_tenant/);
  assert.match(migration, /smyl_bootstrap_clinic_after_member/);
  assert.match(migration, /'propietario'.*'Propietario'/);
  assert.match(migration, /'odontologo'.*'Odontólogo'/);
  assert.match(migration, /values \(p_tenant_id, 'Clínica principal', true\)/);
  assert.match(migration, /else 'recepcion' end/);
  assert.match(staffDefaults, /new\.rol <> 'dueño'/);
  assert.match(staffDefaults, /r\.code = 'recepcion'/);
  assert.doesNotMatch(staffDefaults, /r\.code = 'odontologo'/);
});

test('clinic hours reject overlaps and operational changes are audited', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /new\.starts_at < h\.ends_at/);
  assert.match(migration, /new\.ends_at > h\.starts_at/);
  assert.match(migration, /smyl_clinic_hours_no_overlap/);
  for (const table of expectedTables.filter((name) => name !== 'smyl_audit_events')) {
    assert.match(migration, new RegExp(`${table.replace('smyl_', 'smyl_.*?')}_audit|${table}_audit`));
  }
});

test('LANA remains outside the clinical database boundary', () => {
  assert.doesNotMatch(migration, /references\s+(?:public\.)?(?:conversaciones|mensajes|clientes|camila_integraciones)\b/i);
  assert.match(migration, /comparte tablas ni bases de datos con LANA/i);
});

test('critical clinic changes use transaction-safe RPC functions', () => {
  assert.match(actions, /create constraint trigger smyl_branches_require_default/);
  assert.match(actions, /deferrable initially deferred/);
  assert.match(actions, /create or replace function public\.smyl_set_default_branch/);
  assert.match(actions, /create or replace function public\.smyl_set_member_role/);
  assert.match(actions, /Solo el propietario puede asignar roles/);
  assert.match(actions, /create or replace function public\.smyl_set_member_primary_branch/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /grant execute on function public\.smyl_set_member_role\(uuid, uuid\) to authenticated/);
  assert.match(professionalActions, /create or replace function public\.smyl_create_professional/);
  assert.match(professionalActions, /insert into public\.smyl_professionals/);
  assert.match(professionalActions, /insert into public\.smyl_professional_branches/);
  assert.match(professionalActions, /grant execute on function public\.smyl_create_professional/);
});
