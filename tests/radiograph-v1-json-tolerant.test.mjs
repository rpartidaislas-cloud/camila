// El visor de revisión v1 debe aceptar el JSON del modelo aunque venga envuelto en ```json o con una frase previa,
// sin relajar el contrato: parseReport sigue rechazando campos extra, categorías o límites inválidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = {};
globalThis.SmylRadiographReviewModel = require('../smyl-radiograph-review-model.js');
require('../smyl-radiograph-analysis-client.js');
const { parseModelJson } = window.SmylRadiographAnalysisClient;
const report = { schema: 1, quality: 'usable', qualityNote: 'Imagen utilizable.', observations: [{ id: 'r1', category: 'density', tooth: null, observation: 'Zona radiopaca aparente por comprobar.', evidence: 'Región posterior derecha.' }], limitations: [] };

test('acepta JSON limpio, con cercas ```json y con texto previo; sigue rechazando lo que no es JSON', () => {
  const json = JSON.stringify(report);
  assert.deepEqual(parseModelJson(json), report);
  assert.deepEqual(parseModelJson('```json\n' + json + '\n```'), report);
  assert.deepEqual(parseModelJson('Aquí está el resultado:\n' + json + '\nSaludos.'), report);
  assert.throws(() => parseModelJson('sin objeto'), SyntaxError);
  assert.throws(() => parseModelJson('{"a":'), SyntaxError);
});

test('el contrato sigue siendo estricto después de extraer el JSON', () => {
  const M = SmylRadiographReviewModel;
  assert.doesNotThrow(() => M.parseReport(parseModelJson('```json\n' + JSON.stringify(report) + '\n```')));
  assert.throws(() => M.parseReport(parseModelJson('```json\n' + JSON.stringify(Object.assign({}, report, { extra: 1 })) + '\n```')));
  assert.throws(() => M.parseReport(parseModelJson(JSON.stringify(Object.assign({}, report, { observations: [Object.assign({}, report.observations[0], { category: 'caries' })] })))));
});
