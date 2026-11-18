import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Ficha 360: «Cobrar» compacto dentro de Cuenta, junto al saldo, y sin botones grandes arriba', () => {
  const chat = read('smyl-inbox.js');
  const start = chat.indexOf("var accountTop = node('div', 'smyl-inbox-account-top')");
  const end = chat.indexOf('cobrosZone.append(accountCard)');
  assert.ok(start > 0 && end > start);
  const card = chat.slice(start, end);
  assert.match(card, /btn btn-primary btn-sm smyl-inbox-charge', 'Cobrar'/);
  assert.match(card, /openCareTask\('payment'\)/);
  assert.match(card, /hasPermission\('finance\.manage'\) && canOperate\(conversation, 'finance\.manage'\)/);
  // si falla el saldo se ofrece reintentar aquí mismo (no mandar a Finanzas)
  assert.match(chat, /Saldo no disponible/);
  assert.match(chat, /loadAccountContext\(conversation\.id\)/);
  assert.doesNotMatch(chat, /Ábrela en Finanzas para revisarla/);
  // lo poco frecuente va en «Más opciones de cobranza»
  assert.match(card, /Más opciones de cobranza/);
  // máximo 3 movimientos en la ficha; el resto en «Ver cuenta completa»
  assert.match(chat, /\(moves\.items \|\| \[\]\)\.slice\(0, 3\)/);
});

test('Ficha 360: los avisos van dentro de la tarjeta de identidad y la ficha no dibuja botones si no se le pasan', () => {
  const ficha = read('smyl-inbox-ficha.js');
  assert.match(ficha, /copy\.append\(chips\)/);
  assert.match(ficha, /if \(\(ctx\.actions \|\| \[\]\)\.length\)/);
  const css = read('smyl-inbox.css');
  assert.match(css, /\.smyl-inbox-charge\.btn\{flex:none;width:auto;min-height:32px;height:32px/);
  assert.match(css, /\.smyl-f360-id-copy \.smyl-f360-chips\{margin-top:6px\}/);
});

test('la Ficha 360 ordenada llega igual a web y móvil', () => {
  for (const file of ['smyl-inbox.js', 'smyl-inbox.css', 'smyl-inbox-ficha.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});

test('cabecera del chat: sin rótulo «Ficha 360»; el nombre y el avatar abren la ficha', () => {
  const chat = read('smyl-inbox.js');
  assert.doesNotMatch(chat, /<span>Ficha 360<\/span>/);
  assert.doesNotMatch(chat, /smyl-inbox-patient-context-hint" aria-hidden/);
  // el botón que contiene avatar y nombre es el que abre/oculta la ficha
  assert.match(chat, /<button type="button" class="smyl-inbox-patient-summary" data-inbox-context[^>]*title="Ver la ficha del paciente"[^>]*><div class="smyl-inbox-avatar" data-thread-avatar><\/div><div class="smyl-inbox-thread-person"><strong data-thread-name>/);
});

test('el borde entre la lista y el chat se arrastra (y con teclado), con límites y sin guardar contenido', () => {
  const chat = read('smyl-inbox.js');
  assert.match(chat, /data-inbox-resizer role="separator" aria-orientation="vertical"/);
  assert.match(chat, /LIST_MIN = 260, LIST_MAX = 560, THREAD_MIN = 380/);
  assert.match(chat, /function initListResizer\(page\)/);
  assert.match(chat, /handle\.addEventListener\('pointerdown'/);
  assert.match(chat, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
  assert.match(chat, /addEventListener\('dblclick'/);
  // solo un número por pestaña; nunca localStorage ni contenido de mensajes
  assert.match(chat, /sessionStorage\.setItem\(LIST_WIDTH_KEY, String\(value\)\)/);
  assert.doesNotMatch(chat, /localStorage/);
  const css = read('smyl-inbox.css');
  assert.match(css, /\.smyl-inbox-resizer\{position:absolute/);
  assert.match(css, /@media\(max-width:900px\)\{#p-inbox \.smyl-inbox-resizer\{display:none\}\}/);
});
