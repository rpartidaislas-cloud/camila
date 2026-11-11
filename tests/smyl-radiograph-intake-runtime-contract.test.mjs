import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const evidence = read('../smyl-evidence-center.js');

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\n function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `debe existir ${name}`);
  return source.slice(start, end);
}

test('el cargador consulta las secciones en el mismo panel donde se montó el editor', () => {
  const organize = functionBody(workspace, 'organizeReview', 'shortDate');
  const adopt = functionBody(workspace, 'adopt', 'select');
  const review = functionBody(workspace, 'reviewPart', 'openRadiographIntake');

  assert.match(organize, /ctx\.evidencePart\.body\.insertBefore\(advanced/,
    'el editor radiográfico se monta en Evidencia');
  assert.doesNotMatch(review, /ctx\.reviewPart\?\.body\.querySelectorAll/,
    'no debe buscar el editor dentro del panel oculto de Valoración');
  assert.match(review, /ctx\.(?:advancedSections|advancedEditor)/,
    'debe usar la referencia canónica al editor ya montado');
  assert.match(adopt, /workspaceOrganized/,
    'el observador debe reconocer que el editor ya fue organizado');
  assert.match(adopt, /ctx\.advancedEditor\.append\(dental\)/,
    'si otro render lo desplaza, debe devolver el editor a Evidencia');
});

test('un reintento sustituye el aviso anterior en vez de apilar errores iguales', () => {
  const submitStart = evidence.indexOf('async submitDraft(');
  const submitEnd = evidence.indexOf('\n    setItems(', submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart, 'debe existir submitDraft');
  const submit = evidence.slice(submitStart, submitEnd);

  assert.match(evidence, /this\.submitDraft\(error\)/,
    'el envío debe reutilizar la alerta accesible del formulario');
  assert.match(submit, /target\.textContent\s*=\s*message/,
    'cada reintento debe reemplazar el texto de la única alerta');
  assert.doesNotMatch(submit, /element\(['"]p['"],\s*['"]sec-error['"]|prepend\(message\)/,
    'el envío no debe crear ni apilar alertas nuevas');
});
