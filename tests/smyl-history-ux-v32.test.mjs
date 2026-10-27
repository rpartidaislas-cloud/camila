import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const patient = read('smyl-patient-360.js');
const css = read('smyl-patient-360.css');
const app = read('app.html');
const mobileApp = read('mobile/www/app.html');
const sw = read('sw.js');

test('Historia clínica prioriza alertas, estado y lectura progresiva', () => {
  assert.match(patient, /p360-history-workspace p360-history-read/);
  assert.match(patient, /ALERTAS PARA LA ATENCIÓN/);
  assert.match(patient, /Última actualización/);
  assert.match(patient, /Información registrada/);
  assert.match(patient, /historyGroup\('Salud médica'/);
  assert.match(patient, /historyGroup\('Antecedentes dentales'/);
  assert.match(patient, /historyGroup\('Hábitos y factores de riesgo'/);
  assert.match(patient, /historyGroup\('Información complementaria'/);
});

test('La edición divide la historia en pasos sin cambiar su documento clínico', () => {
  assert.match(patient, /Revisa una sección a la vez/);
  assert.match(patient, /p360-history-safety-editor/);
  assert.match(patient, /historyEditSection\('02','Salud médica'/);
  assert.match(patient, /historyEditSection\('05','Información complementaria'/);
  assert.match(patient, /Guardar historia/);
  for (const field of ['alerts','allergies','conditions','medications','surgeries','dental_history','habits','emergency_contact','notes']) {
    assert.match(patient, new RegExp(`(?:historyField|historyTextarea)\\([^\\n]*'${field}'`));
  }
});

test('La política v3.2 gobierna controles, móvil y movimiento reducido', () => {
  assert.match(css, /Historia clínica v3\.2/);
  assert.match(css, /\.p360-history-header>\.btn\{[^}]*min-height:42px/);
  assert.match(css, /\.p360-history-field input,[\s\S]*?min-height:48px/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.p360-history-actions button\{width:100%;min-height:44px\}/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('Web, móvil y PWA publican la misma versión de Historia clínica', () => {
  assert.equal(app, mobileApp);
  assert.equal(read('smyl-patient-360.js'), read('mobile/www/smyl-patient-360.js'));
  assert.equal(css, read('mobile/www/smyl-patient-360.css'));
  assert.match(app, /smyl-patient-360\.css\?v=8/);
  assert.match(app, /smyl-patient-360\.js\?v=11/);
  assert.match(sw, /smyl-patient-360\.css\?v=8/);
  assert.match(sw, /smyl-patient-360\.js\?v=11/);
  assert.match(sw, /history-ux-v32/);
});

test('La fixture visual usa sólo información sintética', () => {
  const fixture = read('tests/fixtures/smyl-history-v32-preview.html');
  assert.match(fixture, /Historia clínica v3\.2/);
  assert.match(fixture, /Alergia: penicilina/);
  assert.doesNotMatch(fixture, /Bordados Express|Doña|Pepe/);
});
