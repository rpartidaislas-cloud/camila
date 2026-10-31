// La IA propone dónde mirar (x, y normalizados) sin alterar el informe validado por la base: las coordenadas se separan
// antes de parseReport y pasan a las señales pendientes; el dentista las comprueba, mueve y confirma.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.window = {};
const M = globalThis.SmylRadiographReviewModel = require('../smyl-radiograph-review-model.js');
require('../smyl-radiograph-analysis-client.js');
const { splitLocations, parseModelJson } = window.SmylRadiographAnalysisClient;

const study = { id: '11111111-1111-4111-8111-111111111111', type: 'panoramic', asset: { sha256: 'a'.repeat(64) } };
const base = (extra) => ({ schema: 1, quality: 'limited', qualityNote: 'Revisión con limitaciones.', limitations: ['Superposición anterior.'],
  observations: [
    Object.assign({ id: 'r1', category: 'density', tooth: '46', observation: 'Cambio de densidad por comprobar.', evidence: 'Zona radiolúcida.' }, extra[0]),
    Object.assign({ id: 'r2', category: 'support', tooth: null, observation: 'Soporte por valorar.', evidence: 'Región posterior.' }, extra[1])
  ] });

test('separa x e y del informe y deja un informe que cumple el contrato exacto', () => {
  const raw = base([{ x: 0.31234, y: 0.5 }, { x: null, y: null }]);
  const { report, locations } = splitLocations(raw);
  assert.deepEqual(locations, { r1: { x: 0.312, y: 0.5 } });
  assert.ok(report.observations.every(o => !('x' in o) && !('y' in o)));
  assert.doesNotThrow(() => M.parseReport(report));
});

test('descarta coordenadas inválidas (fuera de 0..1, texto, incompletas) sin romper el informe', () => {
  const { report, locations } = splitLocations(base([{ x: 2, y: 0.1 }, { x: '0.3', y: 0.2 }]));
  assert.deepEqual(locations, {});
  assert.doesNotThrow(() => M.parseReport(report));
  assert.deepEqual(splitLocations(base([{ x: 0.4 }, {}])).locations, {});
});

test('el informe sigue siendo estricto: x o y dentro de una observación sin separar se rechazan', () => {
  assert.throws(() => M.parseReport(base([{ x: 0.3, y: 0.3 }, {}])), /campos distintos/);
  const viaJson = parseModelJson('```json\n' + JSON.stringify(base([{ x: 0.3, y: 0.3 }, {}])) + '\n```');
  assert.doesNotThrow(() => M.parseReport(splitLocations(viaJson).report));
});

test('completed() copia la ubicación propuesta a la señal pendiente y la base la aceptaría (0..1, ambos o ninguno)', () => {
  const { report, locations } = splitLocations(base([{ x: 0.25, y: 0.75 }, {}]));
  const requested = M.requested(M.create(study));
  const doc = M.completed(requested, { model: 'claude-sonnet-4-6', at: new Date().toISOString(), requestId: 'msg_t', report, locations });
  assert.ok(M.validate(doc, study));
  const [a, b] = doc.items;
  assert.deepEqual([a.x, a.y, a.state], [0.25, 0.75, 'pending']);
  assert.deepEqual([b.x, b.y, b.state], [null, null, 'pending']);
});

test('completed() ignora ubicaciones corruptas y sigue funcionando sin locations (compatibilidad)', () => {
  const { report } = splitLocations(base([{}, {}]));
  const requested = M.requested(M.create(study));
  const args = { model: 'claude-sonnet-4-6', at: new Date().toISOString(), requestId: '', report };
  const sin = M.completed(requested, args);
  assert.ok(sin.items.every(i => i.x === null && i.y === null));
  const mala = M.completed(requested, Object.assign({}, args, { locations: { r1: { x: 5, y: 'a' }, r2: { x: 0.2, y: 0.2 } } }));
  assert.ok(M.validate(mala, study));
  assert.deepEqual([mala.items[0].x, mala.items[1].x], [null, 0.2]);
});

test('el prompt ya no prohíbe coordenadas y las pide normalizadas con null permitido', () => {
  const src = fs.readFileSync(new URL('../smyl-radiograph-analysis-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /No inventes coordenadas/);
  assert.match(src, /normalizado de 0 a 1 desde la esquina superior izquierda/);
  assert.match(src, /usa null en ambos/);
  assert.match(src, /"x":"0 a 1 o null","y":"0 a 1 o null"/);
  assert.match(src, /return \{report,locations,model,at:/);
});

test('el texto "null" en tooth se trata como null, y un diente inválido sigue rechazándose', () => {
  const { report } = splitLocations(base([{ tooth: 'null' }, { tooth: 'NULL' }]));
  assert.deepEqual(report.observations.map(o => o.tooth), [null, null]);
  assert.doesNotThrow(() => M.parseReport(report));
  assert.throws(() => M.parseReport(splitLocations(base([{ tooth: '99' }, {}])).report), /diente "99"/);
  assert.throws(() => M.parseReport(splitLocations(base([{ tooth: 'molar' }, {}])).report), /diente "molar"/);
});
