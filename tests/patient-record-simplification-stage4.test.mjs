import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const workspaceCss = read('../smyl-case-workspace.css');
const record = read('../smyl-patient-360.js');
const app = read('../app.html');

test('la ficha reduce la navegación principal a cuatro áreas clínicas', () => {
  for (const label of ['Resumen','Expediente','Tratamiento','Actividad']) assert.match(record, new RegExp(`>${label}<`));
  assert.doesNotMatch(record, /data-p360-scroll="p360-cases"/);
  assert.match(record, /data-record-tab="notes"/);
  assert.match(record, /data-record-tab="files"/);
});

test('la documentación clínica no presenta simulaciones como evidencia', () => {
  assert.match(workspace, /Documentación clínica/);
  assert.match(workspace, /Las imágenes generadas no forman parte de la documentación clínica/);
  assert.match(workspace, /cw-simulation-source/);
  assert.match(workspaceCss, /\.cw-simulation-source\{display:none!important\}/);
  assert.doesNotMatch(workspace, /Selecciona las fotografías y simulaciones de este caso/);
});

test('simulaciones tiene un espacio independiente y una advertencia visual clara', () => {
  assert.match(workspace, /ESPACIO INDEPENDIENTE/);
  assert.match(workspace, /Comparaciones visuales orientativas, separadas del expediente clínico/);
  assert.match(workspace, /window\.ir\('historial'\)/);
  assert.match(app, /Simulaciones de sonrisa/);
  assert.match(app, /separadas del expediente clínico/);
});

test('la simplificación se distribuye en web, móvil y PWA', () => {
  assert.match(app, /smyl-patient-360\.js\?v=6/);
  assert.match(app, /smyl-case-workspace\.js\?v=9/);
  assert.match(read('../sw.js'), /smyl-v253-visible-shell-v3/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(record, read('../mobile/www/smyl-patient-360.js'));
  assert.equal(workspace, read('../mobile/www/smyl-case-workspace.js'));
});
