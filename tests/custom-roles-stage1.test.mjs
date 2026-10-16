import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261015030000_smyl_custom_roles.sql');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');

test('custom roles are saved atomically without privilege escalation', () => {
  assert.match(migration, /create or replace function public\.smyl_save_role/);
  assert.match(migration, /not public\.smyl_has_permission\(v_tenant, v_permission\)/);
  assert.match(migration, /El rol Propietario está protegido/);
  assert.match(migration, /delete from public\.smyl_role_permissions/);
  assert.match(migration, /insert into public\.smyl_role_permissions/);
  assert.match(migration, /security definer/);
});

test('role assignment accepts delegated administrators but not stronger roles', () => {
  assert.match(migration, /not public\.smyl_has_permission\(v_tenant_id, 'team\.manage'\)/);
  assert.match(migration, /not public\.smyl_has_permission\(v_tenant_id, rp\.permission_key\)/);
  assert.match(migration, /v_legacy_role = 'dueño' or v_role_code = 'propietario'/);
});

test('the role editor uses grouped toggle pills and supports new roles', () => {
  assert.match(script, /var PERMISSION_GROUPS =/);
  assert.match(script, /clinic-admin-permission-pill/);
  assert.match(script, /id="clinic-admin-add-role"/);
  assert.match(script, /rpc\('smyl_save_role_access'/);
  assert.match(styles, /input:checked\+span/);
  assert.match(styles, /clinic-admin-permission-group/);
});
