import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const record = read('../smyl-dental-record.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('el tratamiento incorpora un odontograma FDI interactivo y longitudinal', () => {
  assert.match(workspace, /MAPA CLÍNICO LONGITUDINAL/);
  assert.match(workspace, /Odontograma verificable por fuente/);
  assert.match(workspace, /SmylToothMap\.render/);
  assert.match(workspace, /SmylDentalProgress\?\.openTooth/);
  assert.match(workspace, /cw-map-inspector/);
  assert.match(workspace, /cw-map-selected/);
  assert.match(workspace, /cw-map-edit/);
  assert.match(fixture, /preview-clinical-odontogram/);
  assert.match(fixture, /Pieza 11 · Incisivo central superior derecho/);
  assert.match(fixture, /smyl-tooth-map\.js\?v=2/);
});

test('el mapa conserva una sola fuente de verdad y separa cada origen', () => {
  assert.match(record, /map\(tenant,patient,caseId\)/);
  assert.match(record, /photoPending/);
  assert.match(record, /radiographPending/);
  assert.match(record, /pending:photos\.filter/);
  assert.match(record, /openTooth\(tenant,patient,tooth\)/);
  for (const source of ['Clínica', 'Fotografías', 'Rayos X', 'Pendientes']) assert.match(workspace, new RegExp(source));
});

test('las sugerencias de IA nunca se presentan como hallazgo confirmado', () => {
  assert.match(workspace, /IA por revisar/);
  assert.match(styles, /cw-source-pending/);
  assert.match(styles, /stroke-dasharray/);
  assert.doesNotMatch(workspace, /confirmar automáticamente|diagnóstico automático/i);
});

test('la interacción es legible, filtrable y adaptativa', () => {
  for (const filter of ["'all','Todo'", "'manual','Clínica'", "'photo','Fotografías'", "'radiograph','Rayos X'", "'pending','Pendientes'"]) {
    assert.match(workspace, new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workspace, /cw-map-filter-count/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
});

test('el mapa y el inspector preceden a la explicación secundaria', () => {
  const map = workspace.indexOf('cw-clinical-map-layout');
  const context = workspace.indexOf('cw-map-context');
  assert.ok(map >= 0, 'falta el layout principal del mapa');
  assert.ok(context > map, 'la explicación secundaria no debe desplazar al mapa');
  assert.doesNotMatch(workspace, /cw-source-workspace/);
  assert.doesNotMatch(workspace, /cw-source-mode|cw-source-suggestion/);
  assert.match(fixture, /cw-map-aside cw-map-inspector/);
  assert.ok(fixture.indexOf('cw-clinical-map-layout') < fixture.indexOf('cw-map-context'));
});

test('las capas resumen sólo actividad útil y conservan una única acción primaria', () => {
  assert.match(workspace, /cw-map-context-chip/);
  assert.match(workspace, /dataset\.value=String\(/);
  assert.match(workspace, /Sin registros en esta capa/);
  assert.match(fixture, /filter\(\(\[value\]\)=>value>0\)/);
  assert.equal((fixture.match(/class="pc-primary cw-evaluation-cta"/g) || []).length, 1);
});

test('web, móvil y PWA publican la misma versión', () => {
  assert.match(app, /smyl-dental-record\.js\?v=17/);
  assert.match(app, /smyl-case-workspace\.css\?v=20/);
  assert.match(app, /smyl-case-workspace\.js\?v=24/);
  assert.match(worker, /smart-odontogram-v33/);
  for (const file of ['app.html', 'sw.js', 'smyl-dental-record.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
