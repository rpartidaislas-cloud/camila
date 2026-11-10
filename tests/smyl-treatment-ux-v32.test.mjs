import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const workspace = read('../smyl-case-workspace.js');
const clinic = read('../smyl-clinic.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('Tratamiento separa la decisión clínica en cuatro etapas', () => {
  for (const label of ['Evaluación', 'Propuesta', 'Aceptación', 'Seguimiento e historial']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.doesNotMatch(workspace, /cw-command|SIGUIENTE ACCIÓN/);
  assert.match(workspace, /mountContext\(ctx,patient\)/);
  assert.match(workspace, /window\.SmylPatient360\?\.context\?\.\(ctx\.tenant,ctx\.patient\)/);
  assert.doesNotMatch(workspace, /ctx\.contextPart\.body\.append\(ctx\.safety\)|querySelector\('\.clinic-patient-card'\)/);
  assert.match(workspace, /m\.details\.hidden=!selected;m\.details\.dataset\.active=String\(selected\)/);
  assert.match(workspace, /Siguiente acción · Completa la evaluación/);
  assert.match(workspace, /Siguiente acción · Prepara la propuesta/);
  assert.match(workspace, /Siguiente acción · Registra la aceptación/);
  assert.match(workspace, /Siguiente acción · Continúa el seguimiento/);
  assert.doesNotMatch(workspace, /Etapa [1-4] de 3/);
  assert.match(clinic, /Propuesta de tratamiento/);
  assert.match(clinic, /Revisar propuesta/);
  assert.match(clinic, /Volver a la propuesta/);
  assert.doesNotMatch(clinic, /Revisar plan|Volver al plan/);
});

test('la evaluación simplifica contexto, evidencia, hallazgos y revisión en una sola superficie', () => {
  const tasks = [
    /evaluationTask\(ctx,'context','01','Contexto','Historia y alertas'\)/,
    /evaluationTask\(ctx,'evidence','02','Evidencia','Archivos y estudios'\)/,
    /evaluationTask\(ctx,'findings','03','Hallazgos','Odontograma y revisión'\)/,
    /evaluationTask\(ctx,'closure','04','Revisión','Antes de la propuesta'\)/,
  ];
  for (const task of tasks) assert.match(workspace, task);
  assert.match(workspace, /aria-label','Tareas de la evaluación/);
  assert.match(workspace, /function showEvaluationTask\(ctx,id,focus=true\)/);
  assert.equal((workspace.match(/ctx\.evaluationCta=btn/g) || []).length, 1);
  assert.match(workspace, /function updateEvaluationAction\(ctx\)/);
  for (const label of ['Continuar a evidencia', 'Continuar a hallazgos', 'Revisar', 'Continuar a propuesta', 'Volver a hallazgos']) {
    assert.match(workspace, new RegExp(label));
  }
});

test('el tenant retoma etapa y tarea sin persistir datos clínicos en el navegador', () => {
  assert.match(workspace, /const views=new Map\(\)/);
  assert.match(workspace, /views\.set\(viewKey\(ctx\),\{stage:moduleId\(ctx\.activeStage\|\|'evaluation'\),task:ctx\.evaluationTask\|\|'context'\}\)/);
  assert.match(workspace, /const resume=restoreView\(ctx\)/);
  assert.match(workspace, /showEvaluationTask\(ctx,resume\.task,false\)/);
  assert.match(workspace, /open\(resume\.stage,false\)/);
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/);
});

test('la evaluación permite continuar sin fotografías y conserva el odontograma longitudinal', () => {
  assert.match(workspace, /Sin fotografías clínicas\. Puedes continuar con el odontograma/);
  assert.match(workspace, /Seleccionar una pieza/);
  assert.match(workspace, /Analizar fotografías/);
  assert.match(workspace, /Las radiografías son opcionales/);
  assert.match(workspace, /las simulaciones nunca se utilizan como evidencia clínica/);
});

test('hallazgos prioriza un mapa operable con cinco capas e inspector persistente', () => {
  for (const layer of ['Todo', 'Clínica', 'Fotografías', 'Rayos X', 'Pendientes']) {
    assert.match(workspace, new RegExp(layer));
  }
  assert.match(workspace, /cw-map-filter-count/);
  assert.match(workspace, /cw-map-inspector/);
  assert.match(workspace, /cw-map-inspector-fact/);
  assert.match(workspace, /cw-map-selected/);
  assert.match(workspace, /Editar pieza/);
  assert.match(workspace, /dataset\.empty=String\(!tooth\)/);
  assert.doesNotMatch(workspace, /classList\.toggle\('cw-map-inspector-empty'/);
  assert.doesNotMatch(styles, /\.cw-map-inspector-empty\{/);
  assert.match(workspace, /photo:totals\.photo\+totals\.photoPending/);
  assert.match(workspace, /radiograph:studyCount/);
  assert.match(workspace, /estudio radiogr[aá]fico/);
  assert.match(workspace, /hallazgos por revisar/);
  assert.doesNotMatch(workspace, /cw-source-workspace/);
  assert.doesNotMatch(workspace, /cw-source-mode|cw-source-suggestion/);
  assert.ok(workspace.indexOf('cw-clinical-map-layout') < workspace.indexOf('cw-map-context'));
});

test('la fixture clínica elimina tarjetas métricas vacías y acciones duplicadas', () => {
  assert.match(fixture, /data-filter="pending"/);
  assert.match(fixture, /filter\(\(\[value\]\)=>value>0\)/);
  assert.match(fixture, /cw-map-context-empty/);
  assert.equal((fixture.match(/class="pc-primary cw-evaluation-cta"/g) || []).length, 1);
  assert.equal((fixture.match(/class="cw-map-aside cw-map-inspector"/g) || []).length, 1);
});

test('las rutas internas anteriores siguen abriendo la etapa equivalente', () => {
  assert.match(workspace, /const moduleId=id=>id==='photos'\|\|id==='review'\?'evaluation':id==='share'\?'approval':id/);
  assert.match(workspace, /requested==='photos'/);
  assert.match(workspace, /requested==='review'/);
});

test('la política visual conserva jerarquía, una CTA visible, tactilidad y respuesta móvil', () => {
  assert.match(styles, /Evaluación v4 · cuatro tareas, una superficie y una sola acción principal/);
  assert.match(styles, /Tratamiento simple v4\.1 · una etapa visible y el historial siempre accesible/);
  assert.match(styles, /Tratamiento v4\.2 · contexto clínico primero, navegación jerárquica y acción persistente/);
  assert.match(styles, /Tratamiento v4\.3 · espacio de trabajo del tenant, sin ficha duplicada ni scroll atrapado/);
  assert.match(styles, /\.cw-enhanced \.clinic-layout\.cw-layout>\.clinic-patient-card\{display:none!important\}/);
  assert.match(styles, /\.cw-enhanced \.cw-stage-status\{position:static/);
  assert.match(styles, /\.cw-module\[hidden\]\{display:none!important\}/);
  assert.match(styles, /\.cw-body #clinic-review\{display:none!important\}/);
  assert.match(styles, /\.cw-version-note\{display:grid/);
  assert.match(styles, /\.cw-evaluation-flow\{display:grid;grid-template-columns:190px minmax\(0,1fr\)/);
  assert.match(styles, /\.cw-evaluation-tasks\{grid-area:tasks;display:flex;flex-direction:column/);
  assert.match(styles, /\.cw-evaluation-footer\{position:sticky/);
  assert.match(styles, /\.cw-evaluation-footer \.cw-evaluation-cta\{min-width:190px\}/);
  assert.match(styles, /\.cw-context-summary\{/);
  assert.match(styles, /\.cw-history-drawer\{/);
  assert.match(styles, /min-height:42px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /\.cw-evaluation-footer \.cw-evaluation-cta\{width:100%;min-height:46px\}/);
  assert.match(styles, /\.cw-enhanced \.cw-evaluation-flow\{display:grid;[^}]*height:auto;min-height:0;max-height:none;overflow:visible\}/);
  assert.match(styles, /\.cw-enhanced \.cw-evaluation-panels\{[^}]*overflow:visible;overscroll-behavior:auto/);
  assert.match(styles, /\.cw-enhanced \.cw-evaluation-footer\{position:static;bottom:auto/);
  assert.match(styles, /border-radius:12px/);
});

test('web, móvil y PWA distribuyen la misma implementación', () => {
  assert.match(app, /smyl-patient-360\.css\?v=17/);
  assert.match(app, /smyl-clinic\.js\?v=20/);
  assert.match(app, /smyl-patient-360\.js\?v=25/);
  assert.match(app, /smyl-case-workspace\.css\?v=24/);
  assert.match(app, /smyl-case-workspace\.js\?v=28/);
  assert.match(worker, /treatment-ux-v32/);
  assert.match(worker, /evaluation-flow-v73/);
  assert.match(worker, /treatment-tenant-workbench-v82/);
  for (const file of ['app.html', 'sw.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'smyl-patient-360.js', 'smyl-patient-360.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});

test('la vista de control usa únicamente identidad sintética', () => {
  assert.match(fixture, /Contexto|Evaluación clínica|Penicilina/);
  assert.match(fixture, /clinic-layout cw-layout/);
  assert.match(fixture, /Ficha administrativa heredada/);
  assert.doesNotMatch(fixture, /Bordados Express|Ricardo|Hernan|Rich/);
});
