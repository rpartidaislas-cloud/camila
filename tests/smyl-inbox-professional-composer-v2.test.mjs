import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');

test('el compositor profesional reúne escritura, herramientas y envío en una sola tarjeta', () => {
  assert.equal((inbox.match(/smyl-inbox-compose-card/g) || []).length, 1);
  assert.match(inbox, /smyl-inbox-compose-card[\s\S]*smyl-inbox-message-row[\s\S]*smyl-inbox-compose-bar/);
  assert.match(inbox, /data-compose-send[^>]*aria-label="Enviar mensaje"/);
  assert.match(css, /\.smyl-inbox-compose-card\s*\{[^}]*border:/);
  assert.match(css, /\.smyl-inbox-composer textarea\s*\{[^}]*border:\s*0/);
});

test('las acciones frecuentes quedan visibles y las secundarias viven en un menú anclado', () => {
  for (const marker of ['data-compose-attach', 'data-compose-quick', 'data-compose-emoji', 'data-compose-copilot', 'data-compose-send']) {
    assert.equal((inbox.match(new RegExp(marker, 'g')) || []).length >= 1, true, marker);
  }
  for (const marker of ['data-compose-template', 'data-compose-schedule', 'data-compose-record', 'data-compose-location']) {
    assert.match(inbox, new RegExp(`<button[^>]+${marker}[^>]+role="menuitem"`));
  }
  assert.match(inbox, /data-compose-more[^>]+aria-haspopup="menu"/);
  assert.match(inbox, /data-compose-tools[^>]+role="menu"[^>]+hidden/);
  assert.match(inbox, /data-compose-tools[^\n]+addEventListener\('keydown'[\s\S]*menuKeydown/);
  assert.match(css, /\.smyl-inbox-compose-tools\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.smyl-inbox-compose-tools\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
});

test('los controles usan iconos vectoriales accesibles y no glifos sueltos', () => {
  assert.match(inbox, /function composeIcon\(name\)/);
  assert.match(inbox, /<svg class="smyl-inbox-compose-icon"[^>]+aria-hidden="true"/);
  assert.doesNotMatch(inbox, /data-compose-more[^>]*>\+<\/button>/);
  for (const label of ['Adjuntar archivo', 'Respuesta rápida', 'Agregar emoji', 'Más herramientas', 'Sugerir con MILA']) {
    assert.match(inbox, new RegExp(`aria-label="${label}"`));
  }
});

test('la ventana vencida de WhatsApp ofrece una sola acción de plantilla sin duplicar CTAs', () => {
  const whatsapp = inbox.slice(inbox.indexOf('function renderWhatsappWindow()'), inbox.indexOf('async function loadTemplates()'));
  const careAction = inbox.slice(inbox.indexOf('function primaryCareAction('), inbox.indexOf('function menuItems('));
  assert.doesNotMatch(whatsapp, /smyl-inbox-window-action/);
  assert.match(whatsapp, /send\.innerHTML = templateOnly/);
  assert.match(whatsapp, /Elegir plantilla aprobada/);
  assert.doesNotMatch(careAction, /id:\s*'template'/);
  assert.match(css, /\.smyl-inbox-composer\[data-mode="template"\][\s\S]*?\[data-compose-copilot\][\s\S]*?display:\s*none/);
  assert.match(css, /\.smyl-inbox-composer\[data-mode="template"\] \.smyl-inbox-send > span\s*\{[^}]*position:\s*static/);
});

test('Más sólo aparece con herramientas disponibles y el foco evita controles ocultos', () => {
  const whatsapp = inbox.slice(inbox.indexOf('function renderWhatsappWindow()'), inbox.indexOf('async function loadTemplates()'));
  const focus = inbox.slice(inbox.indexOf('function focusComposer()'), inbox.indexOf('function openPatientContext('));
  const toggle = inbox.slice(inbox.indexOf('function toggleComposerTools()'), inbox.indexOf('function renderThreadHeader()'));
  assert.match(whatsapp, /hasSecondaryTool[\s\S]*more\.hidden = !hasSecondaryTool/);
  assert.match(focus, /!composer\.disabled && composer\.getClientRects\(\)\.length/);
  assert.match(focus, /data-compose-send/);
  assert.match(toggle, /menuItems\(tools\)\[0\]/);
});

test('el historial se concentra en un carril legible y el móvil no usa una barra horizontal', () => {
  const workspaceV5 = css.slice(css.indexOf('Professional Conversation Workspace v5'));
  assert.match(workspaceV5, /\[data-thread-messages\],[\s\S]*?\.smyl-inbox-compose-surface\s*\{[^}]*max-width:\s*1240px/);
  assert.match(workspaceV5, /\.smyl-inbox-thread-branchwrap:not\(\[hidden\]\)[^}]*margin-left:\s*auto/);
  assert.match(css, /\.smyl-inbox-bubble\s*\{[^}]*max-width:\s*min\(68%,\s*620px\)/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.smyl-inbox-compose-bar\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.smyl-inbox-compose-tools\s*\{[^}]*max-width:\s*calc\(100vw - 24px\)/);
});

test('web y PWA conservan exactamente el mismo chat', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), inbox);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
});
