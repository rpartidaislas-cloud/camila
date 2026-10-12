import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');
const worker = read('../sw.js');
const mobileApp = read('../mobile/www/app.html');
const mobileScript = read('../mobile/www/smyl-clinic-admin.js');
const mobileStyles = read('../mobile/www/smyl-clinic-admin.css');

test('Mi clínica is loaded as a first-class panel module', () => {
  assert.match(app, /smyl-clinic-admin\.css\?v=1/);
  assert.match(app, /smyl-clinic-admin\.js\?v=1/);
  assert.match(script, /window\.TITULOS\.clinica = 'Mi clínica'/);
  assert.match(script, /navButton\('Mi clínica', 'clinica'\)/);
  assert.match(script, /Sucursales y horarios/);
  assert.match(script, /Equipo y profesionales/);
});

test('clinic admin reads only SMYL-owned operational tables', () => {
  for (const table of [
    'smyl_branches', 'smyl_rooms', 'smyl_clinic_hours', 'smyl_roles',
    'smyl_role_permissions', 'smyl_member_roles', 'smyl_member_branches',
    'smyl_professionals', 'smyl_professional_branches'
  ]) assert.match(script, new RegExp(`from\\('${table}'\\)`));
  assert.doesNotMatch(script, /from\(['"](?:conversaciones|mensajes|clientes|camila_integraciones)['"]\)/);
  assert.doesNotMatch(script, /LANA/);
});

test('sensitive multi-row changes use atomic RPC functions', () => {
  assert.match(script, /rpc\('smyl_set_default_branch'/);
  assert.match(script, /rpc\('smyl_set_member_role'/);
  assert.match(script, /rpc\('smyl_set_member_primary_branch'/);
  assert.match(script, /rpc\('smyl_create_professional'/);
  assert.match(script, /eq\('tenant_id', state\.tenant\)/);
});

test('the module has responsive layouts and explicit staff read-only states', () => {
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:440px\)/);
  assert.match(script, /branchButton\.hidden = !state\.canClinic/);
  assert.match(script, /roleSelect\.disabled = !state\.canAssignRoles/);
  assert.match(script, /professionalButton\.hidden = !state\.canTeam/);
});

test('web, mobile and offline cache include the same clinic module', () => {
  assert.equal(app, mobileApp);
  assert.equal(script, mobileScript);
  assert.equal(styles, mobileStyles);
  assert.match(worker, /smyl-v179-clinic-core/);
  assert.match(worker, /smyl-clinic-admin\.js\?v=1/);
  assert.match(worker, /smyl-clinic-admin\.css\?v=1/);
});
