import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-connections.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-connections.css', import.meta.url), 'utf8');

test('capacitar IA: 6 etapas que reparten los bloques del formulario existente', () => {
  for (const title of ['Identidad', 'Tu clínica', 'Sedes y servicios', 'Preguntas frecuentes', 'Reglas de atención', 'Revisar y publicar']) assert.match(js, new RegExp("title: '" + title + "'"));
  assert.match(js, /'Identidad y voz': 1, 'La clínica': 2, 'Sucursales y operación': 3, 'Servicios confirmados': 3, 'Preguntas frecuentes': 4, 'Flujo de atención': 5, 'Memoria administrativa': 5/);
  assert.match(js, /initTrainingSteps\(page\);/);
});
test('capacitar IA: avance por etapa según lo capturado y resumen antes de publicar', () => {
  const fn = new Function(js.match(/function hasPlaceholders\(value\) \{[^\n]*\n/)[0] + js.match(/function trainingStepDone\(key, form\) \{[\s\S]*?\n  \}\n/)[0] + ';return trainingStepDone;')();
  const make = (values, services = 0, faqs = 0) => ({
    elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])),
    querySelectorAll: (selector) => (selector.includes('textarea') ? [] : { length: selector.includes('service') ? services : selector.includes('faq') ? faqs : 0 }),
  });
  assert.equal(fn(1, make({ assistant_name: 'LANA', welcome_message: 'Hola' })), true);
  assert.equal(fn(1, make({ assistant_name: 'LANA', welcome_message: '' })), false);
  assert.equal(fn(3, make({ branches: '' }, 2)), true);
  assert.equal(fn(3, make({ branches: '' }, 0)), false);
  assert.equal(fn(4, make({}, 0, 1)), true);
  assert.equal(fn(5, make({ appointment_policy: 'x', pricing_policy: 'y', emergency_policy: '' })), false);
  assert.match(js, /Antes de publicar/);
});
test('capacitar IA: validar y publicar solo en el último paso; guardar borrador siempre visible', () => {
  assert.match(css, /\[data-lana-training-form\]:not\(\[data-step="6"\]\) \[data-validate-training\],\s*\n\[data-lana-training-form\]:not\(\[data-step="6"\]\) \[data-publish-training\]\{display:none\}/);
  assert.match(css, /\.connections-training-actions\{position:sticky;bottom:0/);
  assert.match(js, /control\.disabled = false; \}\);\s*\n\s*updateTrainingSteps\(\);/);
});

test('ejemplos: cada campo difícil tiene su ejemplo y lo entre [corchetes] cuenta como pendiente', () => {
  for (const name of ['welcome_message', 'clinic_description', 'appointment_policy', 'pricing_policy', 'emergency_policy', 'handoff_rules', 'intake_questions']) assert.match(js, new RegExp('\\b' + name + ": '"));
  const hasPlaceholders = new Function(js.match(/function hasPlaceholders\(value\) \{[^\n]*\n/)[0] + ';return hasPlaceholders;')();
  assert.equal(hasPlaceholders('Atendemos de [días] a [hora]'), true);
  assert.equal(hasPlaceholders('Atendemos de lunes a viernes'), false);
  assert.equal(hasPlaceholders(''), false);
  assert.match(js, /Todavía hay textos de ejemplo con \[corchetes\] sin completar/);
  assert.match(js, /&& !hasPlaceholders\(form\.elements\[name\]\.value\)\)/);
});
test('ejemplos: no reemplazan lo escrito sin confirmar y no se ofrecen a quien no puede editar', () => {
  assert.match(js, /Esto reemplaza lo que ya escribiste en este campo\. ¿Usar el ejemplo\?/);
  assert.doesNotMatch(js, /open\.dataset\.trainNav|use\.dataset\.trainNav|faqExamples\.dataset\.trainNav/);
});
test('guardado automático: solo borrador, con espera, sin solaparse y sin perder lo escrito durante el guardado', () => {
  assert.match(js, /var AUTOSAVE_MS = 4000;/);
  assert.match(js, /if \(!state\.dirty \|\| state\.savingDraft \|\| state\.autosaveFailed \|\| !canAutosaveTraining\(\)\) return;/);
  assert.match(js, /state\.dirty = \(state\.editSeq \|\| 0\) !== seq;/);
  assert.match(js, /if \(state\.dirty\) scheduleTrainingAutosave\(true\);/);
  assert.match(js, /Guardado automáticamente a las /);
  assert.match(js, /No se pudo guardar automáticamente\. Usa «Guardar borrador» para reintentar\./);
  assert.match(js, /window\.addEventListener\('beforeunload'/);
  assert.doesNotMatch(js.slice(js.indexOf('async function runTrainingAutosave'), js.indexOf('function initTrainingAutosave')), /publish|validate/i);
});
