import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const taskCenter = read('../smyl-task-center.js');
const app = read('../app.html');
const worker = read('../sw.js');

test('el Inbox publica un resumen operativo limitado y sin contenido sensible', () => {
  assert.match(inbox, /smyl:inbox-operations-updated/);
  assert.match(inbox, /getOperationsSummary: operationsSummary/);
  const summary = inbox.slice(inbox.indexOf('function operationsSummary'), inbox.indexOf('function publishOperationsSummary'));
  assert.match(summary, /generated_at/);
  assert.match(summary, /alerts/);
  assert.match(summary, /all_scenarios_passed/);
  assert.doesNotMatch(summary, /state\.messages|evidence|patient|conversation|authorization|api[_-]?key|access_token/i);
});

test('el Centro de alertas agrupa bloqueos y avisos y abre el diagnostico correcto', () => {
  assert.match(taskCenter, /smyl:inbox-operations-updated/);
  assert.match(taskCenter, /bloqueo operativo/);
  assert.match(taskCenter, /señal operativa requiere/);
  assert.match(taskCenter, /open:'operations'/);
  assert.match(taskCenter, /SmylInbox\.openOperations/);
  assert.doesNotMatch(taskCenter, /\.insert\(|\.update\(|\.delete\(/);
});

test('web, movil y PWA distribuyen la misma integracion', () => {
  assert.match(app, /smyl-task-center\.js\?v=2/);
  assert.match(app, /smyl-inbox\.js\?v=15/);
  assert.match(worker, /smyl-v231-professional-verification/);
  assert.equal(inbox, read('../mobile/www/smyl-inbox.js'));
  assert.equal(taskCenter, read('../mobile/www/smyl-task-center.js'));
  assert.equal(app, read('../mobile/www/app.html'));
});
