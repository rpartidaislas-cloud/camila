import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.resolve(here, relative), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('la tarea activa muestra una sola herramienta clínica', () => {
  assert.match(workspace, /function advancedPart\(ctx,index\)/);
  assert.match(workspace, /section\.hidden=current!==1/);
  assert.match(workspace, /dataset\.cwPart=index===1\?'radiograph':'odontogram'/);
  assert.match(workspace, /advanced\.hidden=true/);
  assert.doesNotMatch(workspace, /reviewPart\(ctx,0\)/);
  assert.match(styles, /\.cw-advanced-editor\[hidden\]\{display:none!important\}/);
  assert.match(styles, /\.cw-advanced-editor \.dr-section\[hidden\]\{display:none!important\}/);
});

test('radiografías usa un flujo breve y no repite el mapa dental', () => {
  for (const copy of ['Agregar estudio radiográfico', 'Describe el estudio', 'Selecciona el archivo', 'Revisa y confirma']) assert.match(workspace, new RegExp(copy));
  assert.match(styles, /\.cw-advanced-editor \.dr-section>summary\{display:none\}/);
  assert.match(workspace, /El odontograma superior es el único mapa clínico/);
});

test('la política visual conserva jerarquía, una acción navy y estado turquesa', () => {
  assert.match(styles, /\.cw-advanced-guide\{display:grid/);
  assert.match(styles, /background:var\(--cw-primary\);color:#fff/);
  assert.match(styles, /\.dr-file-field\{display:grid/);
  assert.match(styles, /\.dr-ai::before\{content:'IA'/);
  assert.match(styles, /input\[type=file\]::file-selector-button/);
});

test('los controles móviles mantienen 44 px y el flujo se apila', () => {
  assert.match(styles, /\.cw-advanced-guide\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.cw-advanced-editor \.dr-primary\{width:100%;min-height:44px\}/);
});

test('web, PWA y fuente móvil distribuyen la tarea clínica v3.8', () => {
  assert.match(app, /smyl-case-workspace\.css\?v=15/);
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(worker, /clinical-task-panel-v38/);
  assert.match(worker, /single-odontogram-v39/);
assert.match(worker, /radiograph-navigation-v43/);
  for (const file of ['app.html', 'sw.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) assert.equal(read('../' + file), read('../mobile/www/' + file));
});
