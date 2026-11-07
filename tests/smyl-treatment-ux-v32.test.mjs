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
  assert.match(workspace, /cw-treatment-safety/);
  assert.match(workspace, /ctx\.contextPart\.body\.append\(ctx\.safety\)/);
  assert.doesNotMatch(workspace, /contextActions|Revisar historia clínica/);
  assert.match(workspace, /m\.details\.hidden=!selected;m\.details\.open=selected/);
  assert.match(workspace, /Etapa 1 de 4/);
  assert.match(workspace, /Etapa 2 de 4/);
  assert.match(workspace, /Etapa 3 de 4/);
  assert.match(workspace, /Etapa 4 de 4/);
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

test('la evaluación permite continuar sin fotografías y conserva el odontograma longitudinal', () => {
  assert.match(workspace, /Sin fotografías clínicas\. Puedes continuar con el odontograma/);
  assert.match(workspace, /Seleccionar una pieza/);
  assert.match(workspace, /Analizar fotografías/);
  assert.match(workspace, /Las radiografías son opcionales/);
  assert.match(workspace, /las simulaciones nunca se utilizan como evidencia clínica/);
});

test('las rutas internas anteriores siguen abriendo la etapa equivalente', () => {
  assert.match(workspace, /const moduleId=id=>id==='photos'\|\|id==='review'\?'evaluation':id==='share'\?'approval':id/);
  assert.match(workspace, /requested==='photos'/);
  assert.match(workspace, /requested==='review'/);
});

test('la política visual conserva jerarquía, una CTA visible, tactilidad y respuesta móvil', () => {
  assert.match(styles, /Evaluación v4 · cuatro tareas, una superficie y una sola acción principal/);
  assert.match(styles, /Tratamiento simple v4\.1 · una etapa visible y el historial siempre accesible/);
  assert.match(styles, /\.cw-module\[hidden\]\{display:none!important\}/);
  assert.match(styles, /\.cw-body #clinic-review\{display:none!important\}/);
  assert.match(styles, /\.cw-version-note\{display:grid/);
  assert.match(styles, /\.cw-evaluation-tasks\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.cw-evaluation-footer\{display:flex/);
  assert.doesNotMatch(styles, /\.cw-evaluation-footer\{position:sticky/);
  assert.match(styles, /\.cw-evaluation-footer \.cw-evaluation-cta\{min-width:190px\}/);
  assert.match(styles, /min-height:42px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /\.cw-evaluation-footer \.cw-evaluation-cta\{width:100%;min-height:46px\}/);
  assert.match(styles, /border-radius:12px/);
});

test('web, móvil y PWA distribuyen la misma implementación', () => {
  assert.match(app, /smyl-patient-360\.css\?v=16/);
  assert.match(app, /smyl-clinic\.js\?v=19/);
  assert.match(app, /smyl-patient-360\.js\?v=23/);
  assert.match(app, /smyl-case-workspace\.css\?v=17/);
  assert.match(app, /smyl-case-workspace\.js\?v=21/);
  assert.match(worker, /treatment-ux-v32/);
  assert.match(worker, /evaluation-flow-v73/);
  for (const file of ['app.html', 'sw.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'smyl-patient-360.js', 'smyl-patient-360.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});

test('la vista de control usa únicamente identidad sintética', () => {
  assert.match(fixture, /Paciente de demostración/);
  assert.doesNotMatch(fixture, /Bordados Express|Ricardo|Hernan|Rich/);
});
