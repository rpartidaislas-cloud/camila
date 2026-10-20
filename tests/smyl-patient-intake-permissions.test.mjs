import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// El alta de pacientes depende de la política pacientes_create
// (tenant_id = smyl_current_tenant() y smyl_has_permission(..., 'patients.manage')).
// La interfaz debe anticipar ese rechazo y explicarlo con precisión en vez de
// mezclar "sin permiso" con "sesión caducada".

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('el modal de paciente verifica clínica y permiso antes de guardar', () => {
  const clinic = read('smyl-clinic.js');
  assert.match(clinic, /sb\.rpc\('smyl_current_tenant'\)/);
  assert.match(clinic, /sb\.rpc\('smyl_has_permission', \{ p_tenant_id: tenant, p_permission: 'patients\.manage' \}\)/);
  assert.match(clinic, /function patientPermissionCheck\(/);
  assert.match(clinic, /PGRST202/, 'sin las funciones en la base no debe bloquear');
  assert.match(clinic, /patient-save-button/);
  assert.match(clinic, /patient-clinic-line/);
  assert.match(clinic, /Se guardará en /);
});

test('los errores 42501 y PGRST301 se explican por separado', () => {
  const model = read('smyl-clinical-model.js');
  assert.doesNotMatch(model, /code === '42501' \|\| code === 'PGRST301'/);
  assert.match(model, /code === '42501'\) return 'Tu rol en esta clínica no permite esta acción/);
  assert.match(model, /code === 'PGRST301'\) return 'Tu sesión expiró/);
  const clinic = read('smyl-clinic.js');
  assert.match(clinic, /error\.code === '42501' \? patientBlockMessage\('permission'\)/);
  assert.match(clinic, /error\.code === 'PGRST301' \? patientBlockMessage\('session'\)/);
  assert.match(clinic, /permiso «Pacientes · gestionar»/);
  assert.match(clinic, /Mi clínica → Equipo, roles y profesionales/);
});

test('web, móvil y PWA publican la misma corrección del alta de pacientes', () => {
  for (const file of ['smyl-clinic.js', 'smyl-clinical-model.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  for (const file of ['app.html', 'sw.js']) {
    const source = read(file);
    assert.match(source, /smyl-clinic\.js\?v=9/, `${file} debe cargar smyl-clinic.js v9`);
    assert.match(source, /smyl-clinical-model\.js\?v=3/, `${file} debe cargar smyl-clinical-model.js v3`);
    assert.equal(read(path.join('mobile', 'www', file)), source, `${file} difiere en mobile/www`);
  }
});
