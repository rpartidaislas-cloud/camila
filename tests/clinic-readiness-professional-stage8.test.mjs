import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-clinic-admin.js');
const styles = read('../smyl-clinic-admin.css');
const worker = read('../sw.js');

test('Mi clínica guía la preparación operativa sin presentar una certificación', () => {
  assert.match(script, /PREPARACIÓN OPERATIVA/);
  assert.match(script, /configuración visible en SMYL/);
  assert.match(script, /no sustituye validaciones clínicas, laborales, fiscales ni sanitarias/);
  assert.match(script, /function readinessSnapshot/);
  assert.match(styles, /\.clinic-admin-readiness/);
});

test('cada sede muestra señales verificables antes de considerarse lista para agenda', () => {
  assert.match(script, /function branchReadiness/);
  assert.match(script, /rooms\.length > 0 && hours\.length > 0/);
  assert.match(script, /Lista para agenda/);
  assert.match(script, /Configuración mínima lista/);
  assert.match(script, /días con horario/);
});

test('equipo y profesionales exponen pendientes y alcance de roles', () => {
  assert.match(script, /staffMissingRole/);
  assert.match(script, /professionalsMissingBranch/);
  assert.match(script, /Qué permite cada rol/);
  assert.match(script, /PERMISSION_LABELS/);
  assert.match(script, /Consulta el alcance antes de asignar responsabilidades/);
});

test('web, móvil y PWA publican la etapa ocho sincronizada', () => {
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-clinic-admin.js'));
  assert.equal(styles, read('../mobile/www/smyl-clinic-admin.css'));
  assert.match(app, /smyl-clinic-admin\.js\?v=2/);
  assert.match(app, /smyl-clinic-admin\.css\?v=2/);
  assert.match(worker, /smyl-v240-auth-recovery/);
  assert.match(read('./fixtures/smyl-clinic-readiness-stage8-preview.html'), /Preparación operativa/);
});
