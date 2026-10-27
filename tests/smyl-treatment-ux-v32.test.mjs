import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('Tratamiento concentra la decisión clínica en tres etapas', () => {
  for (const label of ['Evaluación clínica', 'Plan de tratamiento', 'Autorización y seguimiento']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /cw-command/);
  assert.match(workspace, /SIGUIENTE ACCIÓN/);
  assert.match(workspace, /cw-treatment-safety/);
  assert.match(workspace, /Etapa 1 de 3/);
});

test('la evaluación permite continuar sin fotografías y conserva el odontograma', () => {
  assert.match(workspace, /Continuar sin fotografías/);
  assert.match(workspace, /Abrir odontograma/);
  assert.match(workspace, /Analizar fotografías/);
  assert.match(workspace, /Las radiografías son opcionales/);
  assert.match(workspace, /las simulaciones nunca se utilizan como evidencia clínica/);
});

test('las rutas internas anteriores siguen abriendo la etapa equivalente', () => {
  assert.match(workspace, /const moduleId=id=>id==='photos'\|\|id==='review'\?'evaluation':id==='share'\?'followup':id/);
  assert.match(workspace, /requested==='photos'/);
  assert.match(workspace, /requested==='review'/);
});

test('la política visual conserva jerarquía, tactilidad y respuesta móvil', () => {
  assert.match(styles, /Tratamiento v3\.2/);
  assert.match(styles, /min-height:42px/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /border-radius:12px/);
});

test('web, móvil y PWA distribuyen la misma implementación', () => {
  assert.match(app, /smyl-patient-360\.css\?v=8/);
  assert.match(app, /smyl-case-workspace\.css\?v=13/);
  assert.match(app, /smyl-case-workspace\.js\?v=16/);
  assert.match(worker, /treatment-ux-v32/);
  for (const file of ['app.html', 'sw.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'smyl-patient-360.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});

test('la vista de control usa únicamente identidad sintética', () => {
  assert.match(fixture, /Paciente de demostración/);
  assert.doesNotMatch(fixture, /Bordados Express|Ricardo|Hernan|Rich/);
});
