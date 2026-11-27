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
  assert.match(app, /smyl-clinic-admin\.css\?v=24/);
  assert.match(app, /smyl-clinic-admin\.js\?v=31/);
  assert.match(script, /window\.TITULOS\.clinica = 'Mi clínica'/);
  assert.match(script, /navButton\('Mi clínica', 'clinica'\)/);
  assert.match(script, /Sucursales y horarios/);
  assert.match(script, /Roles y permisos/);
  assert.match(script, /data-ca-team-view="professionals"/);
});

test('clinic admin reads only SMYL-owned operational tables', () => {
  for (const table of [
    'smyl_branches', 'smyl_rooms', 'smyl_clinic_hours', 'smyl_roles',
    'smyl_role_permissions', 'smyl_member_roles', 'smyl_member_branches',
    'smyl_professionals', 'smyl_professional_branches', 'smyl_staff_invitations'
  ]) assert.match(script, new RegExp(`from\\('${table}'\\)`));
  assert.doesNotMatch(script, /from\(['"](?:conversaciones|mensajes|clientes|camila_integraciones)['"]\)/);
  assert.doesNotMatch(script, /LANA/);
});

test('sensitive multi-row changes use atomic RPC functions', () => {
  assert.match(script, /rpc\('smyl_set_default_branch'/);
  assert.match(script, /rpc\('smyl_set_member_role'/);
  assert.match(script, /rpc\('smyl_set_member_primary_branch'/);
  assert.match(script, /member_kind: 'professional'/);
  assert.match(script, /functions\/v1\/invite-staff/);
  assert.match(script, /rpc\('smyl_create_professional'/);
  assert.match(script, /memberByEmail/);
  assert.match(script, /Profesional ya vinculado/);
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
assert.match(worker, /professional-invitations/);
  assert.match(worker, /smyl-clinic-admin\.js\?v=31/);
  assert.match(worker, /smyl-clinic-admin\.css\?v=24/);
});

test('el perfil del profesional permite asignar los servicios activos de la clínica que realiza (escritura directa bajo RLS, solo con schedule.manage)', () => {
  for (const src of [script, mobileScript]) {
    assert.match(src, /sheetSection\('Servicios que realiza'/);
    assert.match(src, /from\('smyl_services'\)\.select\('id,name,active'\)\.eq\('tenant_id', tenant\)\.eq\('active', true\)/, 'solo servicios activos del catálogo');
    assert.match(src, /from\('smyl_professional_services'\)\.upsert\(/); assert.match(src, /from\('smyl_professional_services'\)\.delete\(\)\.eq\('tenant_id', state\.tenant\)\.eq\('professional_id', professionalId\)\.in\('service_id', ids\)/);
    assert.match(src, /box\.disabled = !canEdit/); assert.doesNotMatch(src, /box\.disabled = [^;]*state\.mutating/, 'las casillas no se bloquean por el estado global de guardado (bug: quedaban todas deshabilitadas)');
    assert.match(src, /Primero activa los servicios de la clínica en Servicios y tarifas/);
    assert.match(src, /Marcar todos/); assert.match(src, /Quitar todos/); assert.match(src, /Buscar servicio/); assert.match(src, /servicesQueue/, 'las escrituras se serializan');
    assert.match(src, /No se pudo guardar el cambio/, 'si falla se revierte y se avisa');
  }
  assert.match(styles, /\.clinic-admin-sheet-service\.is-on\b/); assert.match(styles, /\.clinic-admin-sheet-service\[hidden\]/);
});

test('al redibujar la ficha del profesional se conserva el desplazamiento y el foco (antes cada casilla saltaba arriba)', () => {
  for (const src of [script, mobileScript]) {
    assert.match(src, /previous\.scrollTop/); assert.match(src, /body\.scrollTop = keepTop/);
    assert.match(src, /dialog\.dataset\.personKey === String\(person\.key \|\| person\.name\)/, 'al cambiar de persona sí empieza arriba');
    assert.match(src, /again\.focus\(\{ preventScroll: true \}\)/);
  }
});
