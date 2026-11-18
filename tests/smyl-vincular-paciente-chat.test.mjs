import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('«Expediente» desde el chat: ya vinculada abre directo; sin vincular abre «Vincular paciente»', () => {
  const chat = read('smyl-inbox.js');
  const fn = chat.slice(chat.indexOf('function openPatientContext'), chat.indexOf('function focusableWithin'));
  assert.match(fn, /window\.SmylLanaHandoff\.openPatient\(linkedId, conversationId\)/);
  assert.ok(fn.indexOf('openPatient(linkedId') < fn.indexOf('SmylLanaHandoff.open(conversationId)'), 'primero el camino directo');
  assert.match(chat, /careLinked \? 'Expediente' : 'Vincular paciente'/);
  assert.match(read('smyl-inbox-ficha.js'), /'Vincular paciente'/);
  assert.doesNotMatch(read('smyl-inbox-ficha.js'), /Resolver identidad/);
});

test('la ventana de vinculación: título nuevo, búsqueda de pacientes existentes y «Volver al chat»', () => {
  const js = read('smyl-lana-handoff.js');
  assert.match(js, /<h2 id="lana-handoff-title">Vincular paciente<\/h2>/);
  assert.doesNotMatch(js, /Preparar expediente clínico/);
  // ya vinculada: no se muestra la ventana
  assert.match(js, /if\(data\.existing_link&&data\.existing_link\.patient_id\)\{await openPatient\(/);
  // búsqueda en camila_pacientes limitada a la clínica, con texto limpiado y tope de resultados
  assert.match(js, /from\('camila_pacientes'\)[^;]*\.eq\('tenant_id',window\.tenantId\)/);
  assert.match(js, /replace\(\/\[\^\\p\{L\}\\p\{N\}@\.\+_-\]\/gu,''\)/);
  assert.match(js, /\.limit\(8\)/);
  // vincular usa la misma acción de confirmación (con el id elegido) y no cambia el backend
  assert.match(js, /request\('confirm',data\.conversation\.id,selected\.value\)/);
  assert.match(js, /Volver al chat/);
  assert.match(js, /window\.SmylLanaHandoff=\{open:open,close:close,openPatient:openPatient\}/);
  assert.doesNotMatch(js, /localStorage/);
});

test('la vinculación llega igual a web y móvil', () => {
  for (const file of ['smyl-lana-handoff.js', 'smyl-lana-handoff.css', 'smyl-inbox.js', 'smyl-inbox-ficha.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
