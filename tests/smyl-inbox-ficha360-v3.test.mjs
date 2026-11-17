import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-inbox.js');
const ficha = read('smyl-inbox-ficha.js');
const css = read('smyl-inbox.css');

test('el resumen de la conversación usa el Copilot existente y no consulta tablas', () => {
  const start = js.indexOf('async function requestConversationSummary');
  const fn = js.slice(start, js.indexOf('function freshConversationSummary', start));
  assert.match(fn, /action: 'copilot', conversation_id: conversationId, mode: 'summary'/);
  assert.doesNotMatch(fn, /\.from\(|sb\.rpc/);
  assert.match(fn, /\(!force && entry\)\) return null/, 'solo se pide una vez por sesión salvo «Actualizar»');
});

test('el resumen se muestra solo con permiso, se marca como IA y avisa cuando quedó viejo', () => {
  assert.match(js, /hasPermission\('messages\.read'\) && F\.conversationSummary/);
  assert.match(js, /onRefresh: canGenerate \? function/);
  assert.match(js, /stale: Boolean\(entry\.data && entry\.basis !== summaryBasis\(conversation\)\)/);
  assert.match(ficha, /'smyl-f360-ai-badge', 'IA'/);
  assert.match(ficha, /revísalo antes de usarlo/);
  assert.match(ficha, /Llegaron mensajes nuevos después de este resumen\./);
});

test('el resumen vive en memoria, no en el navegador, y reanudar reutiliza el vigente', () => {
  const start = js.indexOf('function summaryBasis');
  const block = js.slice(start, js.indexOf('async function loadFicha360Files', start));
  assert.doesNotMatch(block, /localStorage|sessionStorage|indexedDB/);
  assert.match(js, /freshConversationSummary\(conversation\) \|\| await requestCopilot\('summary'\)/);
});

test('en pantallas anchas la ficha se ancla sin oscurecer el chat ni atrapar el foco', () => {
  assert.match(js, /CONTEXT_DOCK_QUERY = '\(min-width: 1440px\)'/);
  assert.match(js, /contextDockedPreferred: initialDockedContextPreference\(\)/);
  assert.match(js, /state\.contextDockedPreferred !== false/);
  assert.match(js, /sessionStorage\.setItem\(CONTEXT_DOCK_STORAGE_KEY, open \? 'open' : 'closed'\)/);
  assert.match(js, /panel\.setAttribute\('role', docked \? 'complementary' : 'dialog'\)/);
  assert.match(js, /if \(event\.key !== 'Tab' \|\| contextDocked\(\)\) return;/);
  assert.match(css, /grid-template-columns:\s*320px minmax\(0, 1fr\) clamp\(340px, 24vw, 400px\)/);
  assert.match(css, /#p-inbox\.context-docked \.smyl-inbox-context-scrim\{display:none!important\}/);
});

test('web, móvil y PWA publican la ficha 360 v3', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-inbox-ficha\.js\?v=5/);
    assert.match(read(file), /smyl-inbox\.js\?v=59/);
    assert.match(read(file), /smyl-inbox\.css\?v=51/);
  }
  for (const file of ['smyl-inbox.js', 'smyl-inbox-ficha.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
