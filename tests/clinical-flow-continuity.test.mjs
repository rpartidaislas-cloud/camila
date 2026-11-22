import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const worker = read('../sw.js');

test('Tratamiento conserva cuatro etapas y simplifica Evaluación a tres pasos clínicos', () => {
  assert.match(script, /aria-label','Etapas del caso/);
  for (const label of ['Diagnóstico', 'Plan de tratamiento', 'Presupuesto y aceptación', 'En tratamiento']) {
    assert.match(script, new RegExp(`'${label}'`));
  }
  assert.match(script, /const ROUTE=\[\['evaluation','Diagnóstico'\],\['plan','Plan de tratamiento'\],\['approval','Presupuesto y aceptación'\],\['followup','En tratamiento'\]\]/);
  assert.match(script, /id==='photos'\|\|id==='review'\?'evaluation'/);
  assert.match(script, /id==='share'\?'approval'/);
  assert.match(script, /ctx\.nav\[id\]=step/);
  // La ruta dice qué sigue: cada etapa muestra Listo / En curso / qué falta, y hay una sola acción fija.
  assert.doesNotMatch(script, /Siguiente acción · /);
  assert.match(script, /function syncRoute\(ctx\)/);
  assert.match(script, /function syncDock\(ctx\)/);
  assert.match(script, /Se habilita al confirmar el diagnóstico/);
  assert.match(script, /Se habilita al aprobar el plan/);
  assert.match(styles, /\.cw-nav\{display:grid/);
  assert.match(styles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  for (const task of [
    /evaluationTask\(ctx,'context','01','Contexto','Historia y alertas'\)/,
    /evaluationTask\(ctx,'findings','02','Revisión profesional','Comprobar y decidir'\)/,
    /evaluationTask\(ctx,'closure','03','Conclusión','Hallazgos confirmados'\)/,
  ]) assert.match(script, task);
  assert.doesNotMatch(script, /evaluationTask\(ctx,'evidence'/);
});

test('la evaluación conserva una sola acción principal y la adapta al paso pendiente', () => {
  assert.match(script, /function updateEvaluationAction\(ctx\)/);
  for (const label of ['Continuar a revisión', 'Continuar a conclusión', 'Continuar revisión', 'Confirmar diagnóstico']) {
    assert.match(script, new RegExp(label));
  }
  assert.equal((script.match(/ctx\.evaluationCta=btn/g) || []).length, 1);
  assert.match(script, /copy\(ctx\.evaluationCta,label\);ctx\.evaluationCta\.disabled=disabled;ctx\.evaluationAction=action/);
  assert.match(script, /ctx\.evaluationFlowState=\{reviewComplete:state\.evaluationComplete,findingsComplete:state\.findingsComplete,reviewLabel:label,reviewDisabled:disabled,reviewSource,reviewStatus\};updateEvaluationAction\(ctx\)/);
  assert.match(script, /ctx\.evaluationCta\.hidden=true/);
  assert.match(script, /const evaluationComplete=findingsComplete&&contextReviewed/);

  // No existe una cabecera duplicada: la etapa activa concentra la acción.
  assert.doesNotMatch(script, /cw-command|SIGUIENTE ACCIÓN/);
  assert.doesNotMatch(script, /ctx\.nextButton|cw-next-action/);
});

test('el recorrido termina en seguimiento sin afirmar un envío automático', () => {
  assert.match(script, /Continuar al presupuesto/);
  assert.match(script, /ctx\.planNext\.onclick=\(\)=>open\('approval'\)/);
  assert.match(script, /Continuar seguimiento en Mensajes/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.match(script, /SMYL no confirma si ya lo enviaste/);
  assert.match(script, /no envía nada automáticamente/i);
});

test('web, móvil y PWA cargan la misma versión del recorrido', () => {
  assert.match(app, /smyl-case-workspace\.js\?v=\d+/);
  assert.match(app, /smyl-case-workspace\.css\?v=\d+/);
  assert.match(worker, /evaluation-separation-v79/);
  assert.match(worker, /smyl-case-workspace\.js\?v=\d+/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-case-workspace.js'));
  assert.equal(styles, read('../mobile/www/smyl-case-workspace.css'));
});
