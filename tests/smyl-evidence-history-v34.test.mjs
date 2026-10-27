import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const record = read('../smyl-patient-360.js');
const dental = read('../smyl-dental-record.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('Tratamiento resume la evidencia por fecha sin crear otro archivo clínico', () => {
  assert.match(workspace, /HISTORIA DE EVIDENCIA/);
  assert.match(workspace, /Archivos clínicos por fecha/);
  assert.match(workspace, /SmylPatient360\?\.files/);
  assert.match(workspace, /Los originales permanecen en el archivo privado del paciente/);
  assert.doesNotMatch(workspace, /localStorage/);
});

test('la ficha expone sólo un resumen seguro y conserva el archivo canónico', () => {
  assert.match(record, /files:function\(tenant,patient\)/);
  assert.match(record, /openFile:function\(tenant,patient,id\)/);
  assert.match(record, /!s\.canRead/);
  assert.doesNotMatch(record.match(/files:function[\s\S]*?openFile:function/)?.[0] || '', /storage_path|sha256|notes/);
});

test('fotografías, radiografías y archivos se mantienen diferenciados', () => {
  assert.match(dental, /studyItems:ctx\.doc\.studies\.map/);
  for (const label of ['Fotografías del caso', 'Radiografías dentales', 'Archivos del expediente']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(fixture, /Escaneo intraoral/);
  assert.match(fixture, /Panorámica inicial/);
});

test('la historia de evidencia es progresiva y móvil', () => {
  assert.match(styles, /cw-evidence-history/);
  assert.match(styles, /cw-evidence-item/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
});

test('web, móvil y PWA publican la misma etapa', () => {
  assert.match(app, /smyl-patient-360\.js\?v=12/);
  assert.match(app, /smyl-dental-record\.js\?v=13/);
  assert.match(app, /smyl-case-workspace\.css\?v=13/);
  assert.match(app, /smyl-case-workspace\.js\?v=16/);
  assert.match(worker, /evidence-history-v34/);
  for (const file of ['app.html', 'sw.js', 'smyl-patient-360.js', 'smyl-dental-record.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
