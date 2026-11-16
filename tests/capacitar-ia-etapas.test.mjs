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
  const fn = new Function(js.match(/function trainingStepDone\(key, form\) \{[\s\S]*?\n  \}\n/)[0] + ';return trainingStepDone;')();
  const make = (values, services = 0, faqs = 0) => ({
    elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])),
    querySelectorAll: (selector) => ({ length: selector.includes('service') ? services : selector.includes('faq') ? faqs : 0 }),
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
