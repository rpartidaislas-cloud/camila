import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const worker = read('../sw.js');

test('el expediente presenta un recorrido clínico navegable de tres etapas', () => {
  assert.match(script, /aria-label','Etapas del caso/);
  for (const label of ['Evaluación', 'Plan', 'Seguimiento']) {
    assert.match(script, new RegExp(`'${label}'`));
  }
  assert.match(script, /id==='photos'\|\|id==='review'\?'evaluation'/);
  assert.match(script, /id==='share'\?'followup'/);
  assert.match(script, /ctx\.nav\[id\]=step/);
  assert.match(styles, /\.cw-nav\{display:grid/);
});

test('la acción principal cambia según el siguiente paso pendiente', () => {
  assert.match(script, /Revisar documentación/);
  assert.match(script, /Abrir odontograma/);
  assert.match(script, /Completar plan/);
  assert.match(script, /Preparar cotización/);
  assert.doesNotMatch(script, /ctx\.nextButton|cw-next-action/);
});

test('el recorrido termina en seguimiento sin afirmar un envío automático', () => {
  assert.match(script, /Continuar seguimiento en Mensajes/);
  assert.match(script, /window\.ir\('inbox'\)/);
  assert.match(script, /SMYL no confirma si ya lo enviaste/);
  assert.match(script, /no envía nada automáticamente/i);
});

test('web, móvil y PWA cargan la misma versión del recorrido', () => {
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(app, /smyl-case-workspace\.css\?v=15/);
  assert.match(worker, /treatment-ux-v32/);
  assert.match(worker, /smyl-case-workspace\.js\?v=18/);
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-case-workspace.js'));
  assert.equal(styles, read('../mobile/www/smyl-case-workspace.css'));
});
