import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const asset = new URL('../assets/chat/dental-conversation-background.jpg', import.meta.url);
const mobileAsset = new URL('../mobile/www/assets/chat/dental-conversation-background.jpg', import.meta.url);
const darkAsset = new URL('../assets/chat/dental-conversation-background-dark.jpg', import.meta.url);
const mobileDarkAsset = new URL('../mobile/www/assets/chat/dental-conversation-background-dark.jpg', import.meta.url);

test('el historial del chat de Meta usa el fondo dental sin invadir otros paneles', () => {
  const css = read('smyl-inbox.css');

  assert.match(css, /#p-inbox \.smyl-inbox-thread-body\s*\{[\s\S]*dental-conversation-background\.jpg/);
  assert.doesNotMatch(css, /#p-inbox \.smyl-inbox-(?:page|workspace|list-pane)\s*\{[^}]*dental-conversation-background/);
  assert.doesNotMatch(css, /dental-conversation-background-dark\.jpg/, 'el fondo oscuro queda reservado, no se activa todavía');
});

test('el fondo está optimizado y se publica en web y PWA', () => {
  assert.ok(statSync(asset).size < 150_000, 'el fondo web debe pesar menos de 150 KB');
  assert.equal(statSync(asset).size, statSync(mobileAsset).size);
  assert.equal(readFileSync(asset).compare(readFileSync(mobileAsset)), 0);
  assert.ok(statSync(darkAsset).size < 150_000, 'el fondo oscuro debe pesar menos de 150 KB');
  assert.equal(statSync(darkAsset).size, statSync(mobileDarkAsset).size);
  assert.equal(readFileSync(darkAsset).compare(readFileSync(mobileDarkAsset)), 0);

  for (const file of ['app.html', 'mobile/www/app.html']) {
    assert.match(read(file), /smyl-inbox\.css\?v=82/);
  }

  for (const file of ['sw.js', 'mobile/www/sw.js']) {
    const serviceWorker = read(file);
    assert.match(serviceWorker, /meta-chat-background-v2/);
    assert.match(serviceWorker, /\/camila\/assets\/chat\/dental-conversation-background\.jpg/);
    assert.match(serviceWorker, /\/camila\/assets\/chat\/dental-conversation-background-dark\.jpg/);
  }
});

test('los estilos y el recurso móvil coinciden con la versión web', () => {
  assert.equal(read('smyl-inbox.css'), read('mobile/www/smyl-inbox.css'));
});
