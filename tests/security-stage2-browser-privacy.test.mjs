import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('app.html');
const simulation = read('simulacion.html');
const quickSimulation = read('simulacion-rapida.html');
const editor = read('editor-v2.js');
const privacy = read('smyl-browser-privacy.js');

test('legacy clinical browser archives are purged without clearing auth storage', () => {
  ['camila_pacientes_', 'camila_casos_', 'camila_cotizaciones_', 'camila_progreso_', 'smyl_rapida_progreso_', 'camila_caso_preview', 'smyl_editor_v2_media'].forEach((key) => {
    assert.match(privacy, new RegExp(key));
  });
  assert.doesNotMatch(privacy, /\.clear\s*\(/);
  assert.doesNotMatch(privacy, /sb-/);
});

test('patient and case flows no longer fall back to persistent browser storage', () => {
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\('camila_(?:pacientes|casos|cotizaciones|caso_preview)/);
  assert.doesNotMatch(simulation, /localStorage\.setItem\(key, JSON\.stringify\(casos\)\)/);
  assert.doesNotMatch(quickSimulation, /localStorage\.setItem\(key, JSON\.stringify\(casos\)\)/);
  assert.match(simulation, /if \(!savedToCloud\)/);
  assert.match(quickSimulation, /if \(!savedToCloud\)/);
});

test('simulation progress and editor photos live only in memory', () => {
  assert.doesNotMatch(simulation, /progressStorage\(\)\.setItem/);
  assert.doesNotMatch(quickSimulation, /progressStorage\(\)\.setItem/);
  assert.doesNotMatch(editor, /localStorage\.(?:getItem|setItem)/);
  assert.doesNotMatch(editor, /indexedDB\.open/);
  assert.match(editor, /volatilePhotos = new Map\(\)/);
});

test('legacy app escapes clinical text and restricts image sources', () => {
  assert.match(app, /function smylEsc\(/);
  assert.match(app, /function smylImageSrc\(/);
  assert.match(app, /smylEsc\(diag\.resumen\|\|c\.resumen/);
  assert.match(app, /smylEsc\(item\.procedimiento\)/);
});

test('web and mobile load the same privacy boundary and cache generation', () => {
  assert.equal(read('mobile/www/app.html'), app);
  assert.equal(read('mobile/www/simulacion.html'), simulation);
  assert.equal(read('mobile/www/simulacion-rapida.html'), quickSimulation);
  assert.equal(read('mobile/www/smyl-clinic.js'), read('smyl-clinic.js'));
  assert.equal(read('mobile/www/smyl-browser-privacy.js'), privacy);
  assert.match(read('sw.js'), /smyl-v252-visual-policy-v2/);
});
