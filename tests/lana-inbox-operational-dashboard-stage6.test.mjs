import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const mobileApp = read('../mobile/www/app.html');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const mobileCss = read('../mobile/www/smyl-inbox.css');
const worker = read('../sw.js');

test('el tablero decide con tres puertas verificables y no inventa SLA', () => {
  assert.match(inbox, /DECISIÓN DE PILOTO/);
  assert.match(inbox, /Puerta técnica/);
  assert.match(inbox, /Pruebas en clínica/);
  assert.match(inbox, /Incidentes críticos/);
  assert.match(inbox, /Listo para aprobación/);
  assert.match(inbox, /Aprobado con atención pendiente/);
  assert.match(inbox, /operations\.generated_at/);
  assert.doesNotMatch(inbox, /tiempo promedio de respuesta/i);
});

test('las métricas y alertas indican cobertura, evidencia y siguiente control', () => {
  assert.match(inbox, /Evidencias/);
  assert.match(inbox, /Canales activos/);
  assert.match(inbox, /Siguiente control:/);
  assert.match(inbox, /Confirma el resultado con el proveedor; no reenvíes a ciegas/);
  assert.match(css, /smyl-inbox-decision-ring/);
  assert.match(css, /smyl-inbox-decision-gates/);
  assert.match(css, /@media\(max-width:760px\)/);
});

test('la etapa 6 se distribuye igual en web y PWA', () => {
  assert.match(app, /smyl-inbox\.js\?v=17/);
  assert.match(app, /smyl-inbox\.css\?v=14/);
  assert.match(worker, /smyl-v248-patient-record-simple/);
  assert.equal(inbox, mobileInbox);
  assert.equal(css, mobileCss);
  assert.equal(app, mobileApp);
});
