import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('smyl-case-workspace.js');
const photoReview = read('smyl-clinical-photo-review.js');
const evidenceCenter = read('smyl-evidence-center.js');
const evidenceStyles = read('smyl-evidence-center.css');
const integration = read('smyl-evidence-center-integration.js');
const app = read('app.html');

test('el archivo clínico conserva una sola acción cuando todavía está vacío', () => {
  assert.match(evidenceCenter, /this\.root\.dataset\.empty = String\(this\.items\.length === 0\)/);
  assert.match(evidenceStyles, /data-empty=true[^}]*\.sec-clinical-categories/);
  assert.match(evidenceStyles, /data-empty=true[^}]*\.sec-head \.sec-add/);
  assert.match(evidenceCenter, /empty\.append\(button\('Agregar archivo'/);
});

test('fotografías y radiografías aparecen sólo cuando existe material para revisar', () => {
  assert.match(photoReview, /const root = el\('section', 'scpr-root smyl-evidence-workspace'\);\s*root\.hidden = true/);
  assert.match(photoReview, /state\.root\.hidden = state\.studies\.length === 0/);
  const photoList = photoReview.slice(photoReview.indexOf('function renderStudies'), photoReview.indexOf('\n  async function refresh'));
  assert.match(photoList, /if \(!state\.studies\.length\) return;/);
  assert.doesNotMatch(photoList, /renderEmpty/);

  const radiographs = workspace.slice(workspace.indexOf('function renderRadiographShelf'), workspace.indexOf('\n function toothAnatomy'));
  assert.match(radiographs, /ctx\.radiographShelf\.hidden=!studies\.length/);
  assert.match(radiographs, /if\(!studies\.length\)return/);
  assert.doesNotMatch(radiographs, /Agregar radiografía|No hay radiografías para revisar/);
});

test('la evaluación no dibuja un segundo resumen del mismo archivo', () => {
  const start = integration.indexOf('function renderValuationArchive');
  const end = integration.indexOf('\n  function ', start + 1);
  const valuation = integration.slice(start, end);
  assert.match(valuation, /host\.replaceChildren\(\)/);
  assert.match(valuation, /host\.hidden = true/);
  assert.doesNotMatch(valuation, /Ver archivos clínicos|seci-valuation-categories/);
});

test('web, móvil y PWA distribuyen la simplificación con versiones nuevas', () => {
  assert.match(app, /smyl-case-workspace\.js\?v=40/);
  assert.match(app, /smyl-clinical-photo-review\.js\?v=4/);
  assert.match(app, /smyl-evidence-center\.css\?v=7/);
  assert.match(app, /smyl-evidence-center-integration\.js\?v=10/);
  for (const file of [
    'app.html',
    'sw.js',
    'smyl-case-workspace.js',
    'smyl-clinical-photo-review.js',
    'smyl-evidence-center.css',
    'smyl-evidence-center-integration.js',
    'smyl-evidence-center-integration.css'
  ]) assert.equal(read(file), read(`mobile/www/${file}`), `${file} debe ser idéntico en móvil`);
});
