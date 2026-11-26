import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.html');
const clinic = read('smyl-clinic.js');

test('el reload conserva el paciente junto con la ruta del expediente', () => {
  assert.match(clinic, /sessionStorage\.setItem\('smyl_patient_id', p\.id\)/);
  assert.match(app, /sessionStorage\.getItem\('smyl_patient_id'\)/);
  assert.match(app, /rutaGuardada[\s\S]*await smylRestaurarRutaGuardada\(rutaGuardada\)/);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\('smyl_patient_id'/);
});

test('la ficha espera al módulo profesional y no restaura el visor vacío anterior', () => {
  assert.match(app, /window\.SmylClinicReady === true/);
  assert.match(app, /addEventListener\('smyl:clinic-ready'/);
  assert.match(clinic, /window\.SmylClinicReady = true/);
  assert.match(clinic, /dispatchEvent\(new CustomEvent\('smyl:clinic-ready'\)\)/);
  assert.ok(clinic.indexOf('window.ir = function (route)') < clinic.indexOf('window.SmylClinicReady = true'));
});

test('un paciente fuera de la lista reciente se recupera de forma acotada', () => {
  assert.match(clinic, /from\('camila_pacientes'\)\.select\('\*'\)\.eq\('tenant_id', tenantId\)\.eq\('id', id\)\.maybeSingle\(\)/);
  assert.match(clinic, /sessionStorage\.removeItem\('smyl_patient_id'\)/);
  assert.match(app, /if \(restored !== true\) ir\('pacientes'\)/);
});

test('web, móvil y PWA publican la corrección versionada', () => {
  assert.match(app, /smyl-clinic\.js\?v=28/);
  assert.match(read('sw.js'), /smyl-clinic\.js\?v=28/);
  assert.match(read('sw.js'), /patient-reload-continuity-v1/);
  for (const file of ['app.html', 'smyl-clinic.js', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
});
