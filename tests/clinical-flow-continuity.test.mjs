import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const worker = read('../sw.js');

test('el expediente presenta un recorrido clínico navegable de cuatro etapas', () => {
  assert.match(script, /aria-label','Etapas del caso/);
  for (const label of ['Evaluación', 'Plan', 'Aprobación', 'Atención y seguimiento']) {
    assert.match(script, new RegExp(`'${label}'`));
  }
  assert.match(script, /\[\['evaluation','Evaluación'\],\['plan','Plan'\],\['approval','Aprobación'\],\['followup','Atención y seguimiento'\]\]/);
  assert.match(script, /id==='photos'\|\|id==='review'\?'evaluation'/);
  assert.match(script, /id==='share'\?'approval'/);
  assert.match(script, /ctx\.nav\[id\]=step/);
  assert.match(script, /Etapa 1 de 4/);
  assert.match(script, /Etapa 2 de 4/);
  assert.match(script, /Etapa 3 de 4/);
  assert.match(script, /Etapa 4 de 4/);
  assert.match(styles, /\.cw-nav\{display:grid/);
  assert.match(styles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('la evaluación conserva una sola acción principal y la adapta al paso pendiente', () => {
  assert.match(script, /function updateEvaluationAction\(ctx\)/);
  for (const label of ['Continuar a evidencia', 'Continuar a hallazgos', 'Revisar cierre', 'Continuar al plan', 'Volver a hallazgos']) {
    assert.match(script, new RegExp(label));
  }
  assert.equal((script.match(/ctx\.evaluationCta=btn/g) || []).length, 1);
  assert.match(script, /copy\(ctx\.evaluationCta,label\);ctx\.evaluationCta\.disabled=disabled;ctx\.evaluationAction=action/);
  assert.match(script, /ctx\.evaluationFlowState=\{reviewComplete,reviewLabel:ctx\.reviewButton\.textContent,reviewDisabled\};updateEvaluationAction\(ctx\)/);

  // La cabecera también resume la próxima acción sin introducir un segundo CTA.
  assert.match(script, /Revisar documentación/);
  assert.match(script, /Abrir odontograma/);
  assert.match(script, /Completar plan/);
  assert.match(script, /Preparar cotización/);
  assert.doesNotMatch(script, /ctx\.nextButton|cw-next-action/);
});

test('el recorrido termina en seguimiento sin afirmar un envío automático', () => {
  assert.match(script, /Continuar a aprobación/);
  assert.match(script, /ctx\.planNext\.onclick=\(\)=>open\('approval'\)/);
  assert.match(script, /Continuar seguimiento en Mensajes/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.match(script, /SMYL no confirma si ya lo enviaste/);
  assert.match(script, /no envía nada automáticamente/i);
});

test('web, móvil y PWA cargan la misma versión del recorrido', () => {
  assert.match(app, /smyl-case-workspace\.js\?v=20/);
  assert.match(app, /smyl-case-workspace\.css\?v=16/);
  assert.match(worker, /evaluation-flow-v73/);
  assert.match(worker, /smyl-case-workspace\.js\?v=20/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-case-workspace.js'));
  assert.equal(styles, read('../mobile/www/smyl-case-workspace.css'));
});
