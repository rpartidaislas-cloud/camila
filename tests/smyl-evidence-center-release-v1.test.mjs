import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const assets = [
  'smyl-evidence-model.js',
  'smyl-evidence-workspace.js',
  'smyl-evidence-workspace.css',
  'smyl-evidence-categories.js',
  'smyl-evidence-center.js',
  'smyl-evidence-center.css',
  'smyl-evidence-center-integration.js',
  'smyl-evidence-center-integration.css'
];

test('la aplicación carga el contrato antes del centro y la integración después del expediente', () => {
  const app = read('app.html');
  const model = app.indexOf('smyl-evidence-model.js?v=2');
  const evidenceWorkspace = app.indexOf('smyl-evidence-workspace.js?v=1');
  const categories = app.indexOf('smyl-evidence-categories.js?v=1');
  const center = app.indexOf('smyl-evidence-center.js?v=10');
  const workspace = app.indexOf('smyl-case-workspace.js?v=35');
  const integration = app.indexOf('smyl-evidence-center-integration.js?v=7');
  assert.ok(model > -1 && model < evidenceWorkspace && evidenceWorkspace < center);
  assert.ok(model < categories && categories < center);
  assert.ok(center < workspace && workspace < integration);
});

test('el service worker precarga todos los recursos del centro clínico', () => {
  const serviceWorker = read('sw.js');
  for (const asset of assets) assert.match(serviceWorker, new RegExp(`/camila/${asset.replaceAll('.', '\\.')}`));
  assert.match(serviceWorker, /evidence-center-ux-v6/);
  assert.match(serviceWorker, /evidence-single-intake-v1/);
  assert.match(serviceWorker, /smyl-evidence-categories\.js\?v=1/);
  assert.match(serviceWorker, /smyl-evidence-workspace\.js\?v=1/);
  assert.match(serviceWorker, /smyl-evidence-workspace\.css\?v=1/);
  assert.match(serviceWorker, /smyl-evidence-center\.js\?v=10/);
  assert.match(serviceWorker, /smyl-evidence-center\.css\?v=6/);
  assert.match(serviceWorker, /smyl-evidence-center-integration\.js\?v=7/);
  assert.match(serviceWorker, /smyl-case-workspace\.js\?v=35/);
  assert.match(serviceWorker, /smyl-evidence-center-integration\.css\?v=4/);
});

test('la versión móvil es un espejo exacto de los recursos publicados', () => {
  for (const asset of ['app.html', 'sw.js', 'smyl-patient-360.js', ...assets]) {
    assert.equal(read(asset), read(`mobile/www/${asset}`), `${asset} debe estar sincronizado`);
  }
});

test('el centro puede leer la historia completa sin cambiar los resúmenes compactos existentes', () => {
  const patient360 = read('smyl-patient-360.js');
  const integration = read('smyl-evidence-center-integration.js');
  assert.match(patient360, /SmylPatientEvidenceFiles=Object\.freeze/);
  assert.match(patient360, /items:s\.files\.map\(/);
  assert.match(integration, /SmylPatientEvidenceFiles\?\.all/);
  assert.match(patient360, /items:s\.files\.slice\(0,8\)/);
});
