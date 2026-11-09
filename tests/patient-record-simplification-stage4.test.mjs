import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const workspaceCss = read('../smyl-case-workspace.css');
const record = read('../smyl-patient-360.js') + read('../smyl-history-read.js');
const recordCss = read('../smyl-patient-360.css');
const app = read('../app.html');

test('la ficha reduce la navegación principal a cuatro áreas clínicas', () => {
  for (const label of ['Resumen','Historia clínica','Tratamiento','Archivos']) assert.match(record, new RegExp(`>${label}<`));
  assert.doesNotMatch(record, /data-p360-scroll="p360-cases"/);
  assert.match(record, /data-p360-tab="treatment"/);
  assert.match(record, /p360-treatment-hidden/);
  assert.match(record, /data-record-tab="notes"/);
  assert.match(record, /data-p360-tab="files"/);
});

test('el expediente no apila una segunda identidad ni el flujo completo bajo el resumen', () => {
  assert.match(record, /p360-patient-copy/);
  assert.match(recordCss, /\.cw-enhanced \.cw-workspace>\.cw-patient-head/);
  assert.match(recordCss, /\.cw-enhanced \.cw-workspace>\.cw-quick-links/);
  assert.match(recordCss, /display:none!important/);
});

test('la documentación clínica no presenta simulaciones como evidencia', () => {
  assert.match(workspace, /evaluationTask\(ctx,'evidence','02','Evidencia','Archivos y estudios'\)/);
  assert.match(workspace, /Las simulaciones se mantienen separadas de la evidencia clínica/);
  assert.match(workspace, /las simulaciones nunca se utilizan como evidencia clínica/);
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
  assert.match(app, /smyl-patient-360\.css\?v=17/);
  assert.match(app, /smyl-patient-360\.js\?v=25/);
  assert.match(app, /smyl-case-workspace\.js\?v=25/);
  assert.match(read('../sw.js'), /smyl-v263-lana-connection-recovery/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(read('../smyl-patient-360.js'), read('../mobile/www/smyl-patient-360.js'));
  assert.equal(read('../smyl-history-read.js'), read('../mobile/www/smyl-history-read.js'));
  assert.equal(workspace, read('../mobile/www/smyl-case-workspace.js'));
});
