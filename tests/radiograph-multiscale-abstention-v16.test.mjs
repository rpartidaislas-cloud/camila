import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
globalThis.window = {};
require('../smyl-radiograph-analysis-client.js');
const { regionsFor, dedupeReport } = window.SmylRadiographAnalysisClient;

test('multiescala usa cuatro regiones solapadas en panorámica y dos en estudios localizados', () => {
  const panoramic = regionsFor('panoramic');
  assert.equal(panoramic.length, 4);
  assert.equal(regionsFor('periapical').length, 2);
  assert.equal(regionsFor('bitewing').length, 2);
  assert.equal(regionsFor('other').length, 2);
  for (const region of panoramic) {
    assert.ok(region.x >= 0 && region.y >= 0 && region.w > 0 && region.h > 0);
    assert.ok(region.x + region.w <= 1 && region.y + region.h <= 1);
  }
  assert.ok(panoramic[0].x + panoramic[0].w > panoramic[1].x, 'los detalles se solapan para no perder bordes');
  const copy = regionsFor('panoramic');
  copy[0].x = 99;
  assert.notEqual(regionsFor('panoramic')[0].x, 99, 'cada análisis recibe una copia del plan');
});

test('el resultado unificado elimina sólo duplicados textuales exactos y conserva sus ubicaciones válidas', () => {
  const observation = { id: 'r1', category: 'density', tooth: '46', observation: 'Zona radiolúcida por comprobar.', evidence: 'Región posterior.' };
  const duplicate = { ...observation, id: 'r2', observation: 'Zona radiolúcida por comprobar', evidence: 'Región posterior' };
  const distinct = { ...observation, id: 'r3', tooth: '47', observation: 'Contorno por comprobar.' };
  const value = { schema: 1, quality: 'limited', qualityNote: 'Limitada.', observations: [observation, duplicate, distinct], limitations: [] };
  const result = dedupeReport(value, { r1: { x: .2, y: .7 }, r2: { x: .21, y: .7 }, r3: { x: .3, y: .7 } });
  assert.deepEqual(result.report.observations.map(item => item.id), ['r1', 'r3']);
  assert.deepEqual(Object.keys(result.locations), ['r1', 'r3']);
});

test('la solicitud conserva una vista completa, añade detalles y reduce vistas si el cuerpo rebasa el límite', () => {
  const client = read('smyl-radiograph-analysis-client.js');
  assert.match(client, /\[\{data:encoded,label:'Vista completa original/);
  assert.match(client, /\.\.\.details/);
  assert.match(client, /while\(body\.length>14000000&&images\.length>1\)/);
  assert.match(client, /Contraste auxiliar suavemente normalizado/);
  assert.match(client, /VISTA COMPLETA ORIGINAL/);
  assert.match(client, /Devuelve una sola lista sin duplicados/);
});

test('una imagen no evaluable permite continuar sin convertirla en una revisión terminada', () => {
  const review = read('smyl-radiograph-review.js');
  const dental = read('smyl-dental-record.js');
  assert.match(review, /No evaluable por IA/);
  assert.match(review, /Continuar sin evaluación de IA/);
  assert.match(review, /Cerrar para cambiar imagen/);
  assert.match(review, /Pendiente de revisión profesional/);
  assert.match(review, /no se marcó como revisado/);
  assert.match(dental, /report\?\.quality!=='unusable'/);
  assert.match(dental, /Pendiente manual/);
  assert.match(dental, /Sin evaluación de IA · revisión manual pendiente/);
});

test('web y PWA usan la misma versión del flujo multiescala', () => {
  const app = read('app.html');
  const worker = read('sw.js');
  assert.match(app, /smyl-radiograph-analysis-client\.js\?v=12/);
  assert.match(app, /smyl-radiograph-review\.js\?v=24/);
  assert.match(app, /smyl-radiograph-workbench\.css\?v=19/);
  assert.match(app, /smyl-dental-record\.js\?v=25/);
  assert.match(worker, /radiograph-multiscale-abstention-v16/);
  for (const file of ['app.html', 'sw.js', 'smyl-radiograph-analysis-client.js', 'smyl-radiograph-review.js', 'smyl-radiograph-workbench.css', 'smyl-dental-record.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file + ' desincronizado');
  }
});
