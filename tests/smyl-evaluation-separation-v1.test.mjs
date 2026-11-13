import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('smyl-case-workspace.js');
const mobileWorkspace = read('mobile/www/smyl-case-workspace.js');
const dental = read('smyl-dental-record.js');
const mobileDental = read('mobile/www/smyl-dental-record.js');
const photoReview = read('smyl-clinical-photo-review.js');
const evidenceCenter = read('smyl-evidence-center.js');
const fixture = read('tests/fixtures/smyl-clinical-flow-preview.html');

test('Evaluación presenta tres tareas clínicas con responsabilidades distintas', () => {
  assert.match(workspace, /evaluationTask\(ctx,'context','01','Contexto'/);
  assert.match(workspace, /evaluationTask\(ctx,'findings','02','Revisi[oó]n profesional'/);
  assert.match(workspace, /evaluationTask\(ctx,'closure','03','Conclusi[oó]n'/);
  assert.doesNotMatch(workspace, /evaluationTask\(ctx,'evidence'/, 'Archivos no debe ser un cuarto paso clínico');

  const taskCalls = workspace.match(/evaluationTask\(ctx,'(?:context|findings|closure)'/g) || [];
  assert.equal(taskCalls.length, 3);
  assert.match(workspace, /panel\.dataset\.task=id/, 'cada panel debe declarar su tarea clínica canónica');
});

test('el lenguaje distingue originales, revisión y hallazgos confirmados', () => {
  assert.match(workspace + evidenceCenter, /Archivos cl[ií]nicos/);
  assert.match(workspace, /Hallazgos radiogr[aá]ficos/);
  assert.match(workspace, /Revisi[oó]n profesional/);
  assert.match(workspace, /Conclusi[oó]n/);
});

test('la vista de control refleja las tres tareas y conserva cada herramienta en su responsabilidad', () => {
  assert.equal((fixture.match(/data-task-target=/g) || []).length, 3);
  assert.doesNotMatch(fixture, /data-task-(?:target|panel)="evidence"|preview-panel-evidence/);
  assert.match(fixture, /Paso 1 de 3 · Contexto/);

  const review = fixture.indexOf('id="preview-panel-findings"');
  const files = fixture.indexOf('class="cw-clinical-files-source"');
  const editor = fixture.indexOf('class="cw-advanced-editor"');
  const conclusion = fixture.indexOf('id="preview-panel-closure"');
  const odontogram = fixture.indexOf('class="cw-clinical-map"');
  assert.ok(review >= 0 && files > review && editor > files && conclusion > editor,
    'Archivos clínicos y el editor deben permanecer dentro de Revisión profesional');
  assert.ok(odontogram > conclusion, 'el odontograma longitudinal debe formar parte de Conclusión');
});

test('retirar una radiografía no es una acción destructiva primaria de la tarjeta', () => {
  const start = workspace.indexOf('function renderRadiographShelf');
  const end = workspace.indexOf('\n function ', start + 1);
  assert.ok(start > -1 && end > start, 'debe existir el listado radiográfico');
  const shelf = workspace.slice(start, end);

  assert.match(shelf, /archiveStudy/, 'la capacidad de archivar debe conservarse');
  assert.doesNotMatch(shelf, /actions\.append\(remove\)/, 'la acción destructiva no debe competir con Revisar');
  assert.match(shelf, /Más acciones|cw-radiograph-(?:overflow|menu)|Excluir de esta evaluaci[oó]n|Anular archivo/);
});

test('las radiografías se muestran una sola vez en su cola dedicada', () => {
  const start = workspace.indexOf('function renderEvidenceHistory');
  const end = workspace.indexOf('\n const radiographTypes', start);
  assert.ok(start > -1 && end > start, 'debe existir el resumen de archivos clínicos');
  const history = workspace.slice(start, end);

  assert.doesNotMatch(history, /studyItems\.forEach/, 'el historial general no debe volver a dibujar cada estudio');
  assert.match(history, /hasRadiographs&&file\.category==='radiograph'/, 'el espejo Patient360 tampoco debe duplicar una radiografía ya indexada');
  assert.match(history, /cola dedicada, sin duplicarlos aqu[ií]/);
});

test('una radiografía incierta o no utilizable no puede cerrar la evaluación', () => {
  assert.match(dental, /assistedReviewed=!!review&&pending===0&&workflow==='completed'&&report\?\.quality!=='unusable'/,
    'sólo un resultado completado y utilizable debe contar como revisión asistida resuelta');
  assert.match(dental, /rxResolved=studyItems\.filter\(study=>study\.reviewed\)\.length,rxUnresolved=Math\.max\(0,studyItems\.length-rxResolved\)/);
  assert.match(workspace, /findingsComplete=hasProfessionalReview&&!photoPending&&!rxPending&&!rxUnresolved/,
    'cualquier estudio radiográfico sin resolver debe bloquear Conclusión');
  assert.match(workspace, /hasRadiographReview=\(dental\?\.rxResolved\|\|0\)>0/,
    'la mera existencia de una fila de revisión no debe equivaler a una revisión concluida');
  assert.match(workspace, /resultados sin confirmar o las imágenes no utilizables no cierran la evaluación/);
});

test('la valoración manual y las fotografías canónicas no dependen de una simulación', () => {
  assert.match(dental, /manualReviewed=Array\.isArray\(study\.marks\)&&study\.marks\.length>0/);
  assert.match(workspace, /photoStudies=window\.SmylClinicalPhotoReview\?\.studies\?\./);
  assert.match(workspace, /collectEvidence\?\.\(ctx\.tenant,ctx\.patient,photoStudies\)/);
  assert.doesNotMatch(workspace, /const reviewDisabled=!entry\|\|/,
    'un paciente sin caso de simulación debe poder iniciar una valoración manual');
  assert.match(photoReview, /studies\(tenant, patient\)/);
});

test('el gate seguro permanece idéntico en web y PWA', () => {
  assert.equal(mobileWorkspace, workspace);
  assert.equal(mobileDental, dental);
});
