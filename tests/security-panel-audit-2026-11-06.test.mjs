import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const scopes = read('supabase/migrations/20261106100000_smyl_role_scopes_seed_new_clinics.sql');
const rls = read('supabase/migrations/20261106110000_smyl_rls_read_policies_set_based.sql');
const workflow = read('.github/workflows/smyl-panel-auditoria-migracion.yml');

test('alcances de rol: los roles nuevos reciben alcance, los personalizados el mínimo y el relleno no pisa nada', () => {
  assert.match(scopes, /create trigger smyl_seed_role_scopes_after_role[\s\S]*after insert on public\.smyl_roles/);
  assert.match(scopes, /when not new\.system_role then 'own'/);
  assert.match(scopes, /on conflict do nothing/);
  assert.doesNotMatch(scopes, /on conflict[^;]*do update/i);
  assert.match(scopes, /revoke all on function public\.smyl_seed_role_scopes\(\)/);
});

test('RLS por conjuntos: ambas políticas exigen permiso Y alcance, y no usan funciones por fila para pacientes', () => {
  const pacientes = rls.slice(rls.indexOf('create policy pacientes_read'), rls.indexOf('create policy smyl_appointments_read'));
  assert.match(pacientes, /tenant_id in \(select public\.smyl_tenants_with_permission\('patients\.read'\)\)/);
  assert.match(pacientes, /\(tenant_id, id\) in \(select s\.tenant_id, s\.patient_id from public\.smyl_patient_ids_in_scope\('patients'\) s\)/);
  assert.doesNotMatch(pacientes, /smyl_has_permission|smyl_can_access_patient/);
  const citas = rls.slice(rls.indexOf('create policy smyl_appointments_read'));
  assert.match(citas, /smyl_tenants_with_permission\('schedule\.read'\)/);
  assert.match(citas, /smyl_can_access_schedule_row\(tenant_id, branch_id, professional_id, patient_id\)/);
});

test('RLS por conjuntos: ayudantes security definer con search_path fijo, sin acceso para anon', () => {
  for (const fn of ['smyl_tenants_with_permission', 'smyl_tenants_with_scope', 'smyl_my_professional_ids', 'smyl_patient_ids_in_scope']) {
    const m = rls.match(new RegExp('create or replace function public\\.' + fn + '[\\s\\S]*?\\$\\$;?\\s*(?=\\n\\n|\\ncreate|\\nrevoke|$)', 'i'));
    assert.ok(m, fn);
    assert.match(m[0], /security definer/);
    assert.match(m[0], /set search_path = pg_catalog, public/);
  }
  assert.match(rls, /revoke all on function [\s\S]*from public, anon;/);
  assert.match(rls, /grant execute on function [\s\S]*to authenticated;/);
});

test('workflow del panel aplica y verifica las dos migraciones', () => {
  assert.match(workflow, /20261106100000/);
  assert.match(workflow, /20261106110000/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /roles_sin_alcance/);
  assert.match(workflow, /smyl_tenants_with_permission/);
});
