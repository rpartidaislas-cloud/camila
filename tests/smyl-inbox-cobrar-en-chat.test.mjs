import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Cobrar desde el chat abre el cobro guiado en el mismo lugar, con el paciente de la conversación', () => {
  const chat = read('smyl-inbox.js');
  assert.match(chat, /type === 'payment' && window\.SmylFinance && typeof window\.SmylFinance\.collect === 'function'/);
  assert.match(chat, /window\.SmylFinance\.collect\(linked && linked\.id \|\| '', linked\)/);
  // ya no pasa por la lista intermedia de pacientes para cobrar
  const payment = chat.slice(chat.indexOf('function openCareTask'), chat.indexOf('function permittedCareActions'));
  assert.ok(payment.indexOf("type === 'payment'") < payment.indexOf('SmylCareTasks'), 'el cobro se resuelve antes de caer al selector de tareas');
  // después de cobrar, la cuenta del paciente se actualiza sola
  assert.match(chat, /addEventListener\('smyl:finance-updated'/);
  // permisos: se sigue exigiendo finance.manage y alcance sobre la conversación
  assert.match(chat, /var permission = type === 'quote' \? 'proposal\.write' : 'finance\.manage'/);
  assert.doesNotMatch(chat, /localStorage/);
});

test('el módulo de Cobros expone collect() y su diálogo vive en <body>', () => {
  const fin = read('smyl-finance.js');
  assert.match(fin, /collect:function\(patientId,patient\)/);
  assert.match(fin, /document\.body\.append\(financeDialog\)/);
  assert.match(fin, /if\(!state\.canManage\)return resolve\(\{ok:false,reason:'role'\}\)/);
  assert.match(read('smyl-finance.css'), /body>\.finance-dialog \*\{box-sizing:border-box/);
});

test('Cobrar desde el chat llega igual a web y móvil', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-inbox.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
