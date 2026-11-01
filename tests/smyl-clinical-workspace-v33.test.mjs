import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('los tokens DTCG fijan siete roles legibles y cuatro pesos autorizados', () => {
  const tokens = JSON.parse(read('design/tokens/smyl.tokens.json')).smyl;
  const typeSizes = Object.entries(tokens.type.size).filter(([key]) => key !== '$type');
  const typeWeights = Object.entries(tokens.type.weight).filter(([key]) => key !== '$type');
  assert.deepEqual(typeSizes.map(([key]) => key), ['page', 'section', 'title', 'body', 'bodySmall', 'label', 'meta']);
  assert.ok(typeSizes.every(([, token]) => token.$value.value >= 12));
  assert.deepEqual(typeWeights.map(([, token]) => token.$value), [400, 500, 600, 700]);
  assert.equal(tokens.control.touchTarget.$value.value, 44);
});

test('la hoja canónica ofrece los cinco patrones del Clinical Workspace', () => {
  const css = read('smyl-ui-template-v3.css');
  for (const selector of [
    '.smyl-ui-view',
    '.smyl-ui-filter-bar',
    '.smyl-ui-data-region',
    '.smyl-ui-split-layout',
    '.smyl-ui-workspace-layout',
    '.smyl-ui-form-layout',
    '.smyl-ui-settings-layout',
  ]) assert.match(css, new RegExp(selector.replace('.', '\\.')));

  const numericWeights = [...css.matchAll(/font-weight\s*:\s*(\d{3})/g)].map(match => Number(match[1]));
  assert.ok(numericWeights.every(weight => [400, 500, 600, 700].includes(weight)), `pesos fuera de contrato: ${numericWeights.filter(weight => ![400, 500, 600, 700].includes(weight))}`);
});

test('Inicio usa una sola fuente de prioridades y nunca anuncia Todo al día si hay pendientes', () => {
  const home = read('smyl-daily-home.js');
  assert.match(home, /function resolvePriorityTasks\(\)/);
  assert.match(home, /renderMetrics\(tasks\); renderPriorities\(tasks\)/);
  assert.match(home, /if\(!tiles\.length&&priorityTasks&&priorityTasks\.length\)tiles\.push/);
  assert.doesNotMatch(home, /data-go="agenda">Abrir agenda/);
});

test('Agenda identifica filtros, reserva el periodo y mantiene texto clínico de 12px o más', () => {
  const agenda = read('smyl-schedule.js');
  const css = read('smyl-schedule.css');
  for (const label of ['Sucursal', 'Profesional', 'Sillón']) assert.match(agenda, new RegExp(`<span>${label}<\\/span>`));
  assert.match(agenda, /id="schedule-period" aria-live="polite">Cargando fechas…/);
  assert.match(css, /Agenda Clinical Workspace v4/);
  assert.match(css, /--schedule-type-meta:var\(--smyl-ui-text-meta,12px\)/);
  assert.match(css, /\.schedule-calendar\{max-width:100%;overflow-x:auto/);
});

test('Pacientes prioriza identidad, abre la fila por teclado y deja una sola acción visible', () => {
  const clinic = read('smyl-clinic.js');
  const css = read('smyl-clinic.css');
  assert.match(clinic, /row\.tabIndex = 0/);
  assert.match(clinic, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(clinic, /button\('Agendar cita'/);
  assert.doesNotMatch(clinic, /button\('Abrir expediente'/);
  assert.match(css, /td:first-child\{padding-left:24px;width:34%\}/);
  assert.match(css, /tbody tr:focus-visible/);
});

test('la navegación móvil contiene las cinco tareas correctas y el sheet es modal', () => {
  const nav = read('smyl-navigation.js');
  const css = read('smyl-navigation.css');
  assert.match(nav, /var MOBILE_PRIMARY = \[PRIMARY\[0\], PRIMARY\[1\], PRIMARY\[2\], MESSAGING\[0\]\]/);
  assert.match(nav, /\['Más', '__more', 'more'\]/);
  assert.match(nav, /panel\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(nav, /event\.key === 'Escape'/);
  assert.match(css, /repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /min-height:52px/);
});

test('el laboratorio visual reutiliza producción y sólo contiene datos sintéticos', () => {
  const fixture = read('tests/fixtures/smyl-ui-v33-clinical-workspace.html');
  assert.match(fixture, /smyl-ui-template-v3\.css/);
  assert.match(fixture, /Clinical Workspace · v3\.3/);
  assert.match(fixture, /example\.test/);
  assert.doesNotMatch(fixture, /Bordados Express|Doña|Pepe/);
});

test('web y contenedor móvil distribuyen exactamente los archivos de esta ola', () => {
  for (const file of [
    'app.html', 'sw.js', 'smyl-ui-template-v3.css', 'smyl-navigation.js', 'smyl-navigation.css',
    'smyl-daily-home.js', 'smyl-daily-home.css', 'smyl-schedule.js', 'smyl-schedule.css',
    'smyl-clinic.js', 'smyl-clinic.css',
  ]) assert.equal(read(file), read(path.join('mobile', 'www', file)), `${file} difiere en mobile/www`);
});
