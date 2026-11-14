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
  assert.match(workspace, /evaluationTask\(ctx,'findings','02','Revisión profesional','Comprobar y decidir'\)/);
  assert.match(workspace, /aria-label','Archivos clínicos consultados en esta revisión'/);
  assert.match(workspace, /Cada original se conserva una sola vez\. Aquí sólo eliges qué fuente revisar\./);
  assert.doesNotMatch(workspace, /cw-simulation-link|ESPACIO INDEPENDIENTE|data-open-simulations/);
  assert.doesNotMatch(workspace, /evidencePart\.body\.insertBefore\(gallery/);
  assert.doesNotMatch(workspace, /Selecciona las fotografías y simulaciones de este caso/);
});

test('simulaciones permanece fuera del archivo de evidencia', () => {
  assert.doesNotMatch(workspace, /Simulaciones de sonrisa/);
  assert.match(app, /Simulaciones de sonrisa/);
  assert.match(workspace, /cw-valuation-evidence/);
});

test('la simplificación se distribuye en web, móvil y PWA', () => {
  assert.match(app, /smyl-patient-360\.css\?v=18/);
  assert.match(app, /smyl-patient-360\.js\?v=26/);
  assert.match(app, /smyl-case-workspace\.js\?v=40/);
  assert.match(read('../sw.js'), /smyl-v263-lana-connection-recovery/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(read('../smyl-patient-360.js'), read('../mobile/www/smyl-patient-360.js'));
  assert.equal(read('../smyl-history-read.js'), read('../mobile/www/smyl-history-read.js'));
  assert.equal(workspace, read('../mobile/www/smyl-case-workspace.js'));
});
