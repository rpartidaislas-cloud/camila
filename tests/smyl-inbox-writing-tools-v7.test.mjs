import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');
const edge = read('../supabase/functions/lana-inbox/index.ts');

test('el lanzador permanente muestra sólo el icono más y conserva nombre accesible', () => {
  const launcher = inbox.match(/<button[^>]+data-compose-more[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(launcher, /aria-label="Abrir herramientas de mensaje"/);
  assert.match(launcher, /title="Herramientas"/);
  assert.match(launcher, /composeIcon\('plus'\)/);
  assert.doesNotMatch(launcher, /<span>Herramientas<\/span>/);
  assert.match(css, /\.smyl-inbox-compose-bar \.smyl-inbox-compose-more\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*justify-content:\s*center/s);
});

test('la caja incorpora ubicación multicanal y mejora de redacción con MILA', () => {
  assert.match(inbox, /data-compose-rewrite[^>]+role="menuitem"[^>]+aria-label="Mejorar redacción con MILA"/);
  assert.match(inbox, /<strong>Mejorar redacción<\/strong><small>Ortografía y claridad con MILA<\/small>/);
  assert.match(inbox, /data-compose-location[^>]+aria-label="Enviar ubicación actual"/);
  const channelRules = inbox.slice(inbox.indexOf('function renderWhatsappWindow()'), inbox.indexOf('async function loadTemplates()'));
  assert.match(channelRules, /location\.disabled = !canRespond \|\| !freeformAllowed;/);
  assert.doesNotMatch(channelRules, /location\.disabled[^;]*!isWhatsapp/);
});

test('ubicación usa el formato nativo en WhatsApp y un enlace de Maps en Instagram o Messenger', () => {
  const location = inbox.slice(inbox.indexOf('async function sendLocation()'), inbox.indexOf('function retryPending('));
  assert.match(location, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(location, /conversation\.channel === 'whatsapp'/);
  assert.match(location, /type: 'location'/);
  assert.match(location, /https:\/\/www\.google\.com\/maps\?q=/);
  assert.match(location, /submitMessage\(content, key, pending\)/);
  assert.match(location, /state\.selectedId !== conversation\.id/);
  assert.doesNotMatch(location, /Ubicación de la clínica/);
});

test('MILA propone la corrección sin sobrescribir ni enviar automáticamente', () => {
  const rewrite = inbox.slice(inbox.indexOf('async function rewriteComposerText()'), inbox.indexOf('async function prepareResume()'));
  assert.match(rewrite, /action: 'rewrite_message'/);
  assert.match(rewrite, /source_text: source/);
  assert.match(rewrite, /state\.copilot\[conversation\.id\]/);
  assert.doesNotMatch(rewrite, /submitMessage|setComposerText/);
  assert.match(inbox, /Reemplazar borrador/);
});

test('el servidor limita la corrección, conserva hechos verificables y registra el consumo', () => {
  const action = edge.slice(edge.indexOf('if (action === "rewrite_message")'), edge.indexOf('if (action === "copilot")'));
  assert.match(action, /requirePermission\(actor, "messages\.respond"/);
  assert.match(action, /sourceText\.length < 2 \|\| sourceText\.length > 4000/);
  assert.match(action, /smyl_wallets/);
  assert.match(action, /p_resource: "ai_credits"/);
  assert.match(action, /admin\.rpc\("smyl_consume"/);
  assert.match(action, /token_usage: improved\.usage/);
  assert.match(action, /usage_recorded: true/);
  assert.match(edge, /store: false/);
  assert.match(edge, /stableMessageFacts/);
  assert.match(edge, /No inventes ni agregues hechos/);
  assert.doesNotMatch(action, /p_metadata:[\s\S]{0,300}sourceText/);
});

test('web y PWA comparten exactamente las herramientas', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), inbox);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.match(read('../app.html'), /smyl-inbox\.js\?v=73/);
  assert.match(read('../app.html'), /smyl-inbox\.css\?v=62/);
  assert.match(read('../sw.js'), /inbox-writing-tools-v7/);
});
