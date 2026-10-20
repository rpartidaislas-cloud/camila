import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const app = read('../app.html');
const worker = read('../sw.js');

test('el informe resume la decisión, criterios, evidencias e incidencias', () => {
  assert.match(inbox, /INFORME OPERATIVO/);
  assert.match(inbox, /Criterios de salida/);
  assert.match(inbox, /Evidencia de campo/);
  assert.match(inbox, /Incidencias del corte/);
  assert.match(inbox, /Imprimir o guardar PDF/);
  assert.match(css, /smyl-inbox-report-dialog/);
  assert.match(css, /smyl-inbox-report-evidence/);
});

test('el documento declara límites y excluye contenido clínico y conversaciones', () => {
  assert.match(inbox, /No contiene conversaciones ni datos de pacientes/);
  assert.match(inbox, /No certifica resultados clínicos/);
  const report = inbox.slice(inbox.indexOf('function renderPilotReport'), inbox.indexOf('function openPilotReport'));
  assert.doesNotMatch(report, /state\.messages|selectedConversation|message_body|patient_id/);
});

test('web, móvil y PWA publican el mismo informe', () => {
  assert.match(app, /smyl-inbox\.js\?v=34/);
  assert.match(app, /smyl-inbox\.css\?v=33/);
  assert.match(worker, /smyl-v254-visible-shell-v4/);
  assert.equal(inbox, read('../mobile/www/smyl-inbox.js'));
  assert.equal(css, read('../mobile/www/smyl-inbox.css'));
  assert.equal(app, read('../mobile/www/app.html'));
});
