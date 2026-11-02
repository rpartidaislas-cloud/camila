import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const record = read('smyl-patient-360.js');
const cases = read('smyl-patient-cases.js');
const styles = read('smyl-patient-cases.css');
const app = read('app.html');
const worker = read('sw.js');

test('el expediente ofrece un área única para todas las simulaciones SMYL', () => {
  assert.match(record, /data-p360-tab="simulations"[^>]*>Simulaciones SMYL/);
  assert.match(record, /data-p360-panel="simulations"/);
  assert.match(record, /key:'simulations'/);
  assert.match(record, /smyl:patient-simulations-updated/);
});

test('la galería se monta dentro del expediente y no como un bloque paralelo', () => {
  assert.match(cases, /querySelector\('\[data-p360-panel="simulations"\]'\)/);
  assert.match(cases, /host\.replaceChildren\(gallery\)/);
  assert.doesNotMatch(cases, /layout\.before\(gallery\)/);
  assert.match(cases, /ARCHIVO VISUAL DEL PACIENTE/);
  assert.match(cases, /Fotografías originales, resultados orientativos y revisiones/);
});

test('cada sesión conserva originales, resultados y acciones sin convertirlos en diagnóstico', () => {
  for (const label of ['Sesiones','Fotografías','Simulaciones','Ver fotos de esta sesión','Revisar fotos y dientes','Ver antes y después','Preparar propuesta para el paciente']) assert.match(cases, new RegExp(label));
  assert.match(cases, /Simulación visual, no diagnóstico/);
  assert.match(cases, /Simulación · no es un resultado clínico/);
  assert.match(cases, /SmylCaseClient/);
  assert.doesNotMatch(cases, /from\('camila_casos'\)/);
});

test('la sección responde en escritorio y móvil con los mismos recursos', () => {
  assert.match(styles, /\.pc-gallery-header\{/);
  assert.match(styles, /\.pc-case-summary\{/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /@media\(max-width:420px\)/);
  assert.match(app, /smyl-patient-cases\.css\?v=3/);
  assert.match(app, /smyl-patient-cases\.js\?v=10/);
  assert.match(worker, /smyl-patient-cases\.css\?v=3/);
  assert.match(worker, /smyl-patient-cases\.js\?v=10/);
  assert.match(worker, /patient-simulations-v70/);
  assert.equal(cases, read('mobile/www/smyl-patient-cases.js'));
  assert.equal(styles, read('mobile/www/smyl-patient-cases.css'));
});
