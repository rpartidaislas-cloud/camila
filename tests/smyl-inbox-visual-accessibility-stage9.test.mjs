import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');

function openingTag(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.notEqual(markerAt, -1, `No se encontró ${marker}`);
  const start = source.lastIndexOf('<', markerAt);
  const end = source.indexOf('>', markerAt);
  assert.ok(start >= 0 && end > markerAt, `No se pudo leer la etiqueta de ${marker}`);
  return source.slice(start, end + 1);
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `No se encontró la función ${name}`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.ok(end > start, `No se pudo delimitar la función ${name}`);
  return source.slice(start, end);
}

test('la Ficha 360 se comporta como drawer modal, no queda navegable al cerrarse y devuelve el foco', () => {
  const drawer = openingTag(inbox, 'data-inbox-context-panel');
  assert.match(drawer, /\brole=["']dialog["']/);
  assert.match(drawer, /\baria-modal=["']true["']/);
  assert.match(drawer, /\baria-hidden=["']true["']/);
  assert.match(drawer, /\binert(?:\s|=|>)/);

  // El contrato acepta propiedad DOM o set/remove/toggleAttribute.
  const lifecycleStart = inbox.indexOf('function syncContextAccessibility');
  const lifecycleEnd = inbox.indexOf('function contextSectionKey', lifecycleStart);
  assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart, 'Falta el ciclo accesible del drawer');
  const lifecycle = inbox.slice(lifecycleStart, lifecycleEnd);
  const context = functionBody(inbox, 'renderContext', 'renderCareBar');
  assert.match(lifecycle, /setAttribute\(['"]aria-hidden['"]/);
  assert.match(lifecycle, /\.inert\s*=|(?:set|remove|toggle)Attribute\(['"]inert['"]/);
  assert.match(lifecycle, /contextReturnFocus/);
  assert.match(context, /smyl-inbox-context-title/);
  assert.match(lifecycle, /\.focus\(\)/);
  assert.match(inbox, /document\.activeElement/);
  assert.match(inbox, /\.key\s*===\s*['"]Escape['"]/);
});

test('la cabecera expone una sola acción contextual y cada acción respeta su permiso real', () => {
  const actionsStart = inbox.indexOf('function permittedCareActions');
  const actionsEnd = inbox.indexOf('function closeThreadMenu', actionsStart);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, 'Falta el modelo de acciones contextuales');
  const actions = inbox.slice(actionsStart, actionsEnd);
  const careBar = functionBody(inbox, 'renderCareBar', 'closeThreadMenu');

  // El CTA visible tiene un contrato de QA estable; las acciones restantes viven en el menú.
  assert.match(careBar, /data-thread-primary-action|threadPrimaryAction/);
  assert.match(actions, /primary(?:Care|Thread|Contextual)?Action/);
  assert.match(actions, /setAttribute\(['"]role['"],\s*['"]menuitem['"]\)/);

  // Consultar un módulo no equivale a poder modificarlo.
  for (const permission of ['schedule.manage', 'clinical.read', 'proposal.write', 'finance.manage']) {
    assert.match(actions, new RegExp(`hasPermission\\(['"]${permission.replace('.', '\\.')}['"]\\)`));
  }
});

test('pestañas y menú de conversación publican semántica completa', () => {
  const viewTabs = openingTag(inbox, 'smyl-inbox-view-toggle');
  assert.match(viewTabs, /\brole=["']tablist["']/);

  const primaryFiltersStart = inbox.indexOf('<div class="smyl-inbox-filters"');
  const primaryFiltersEnd = inbox.indexOf('smyl-inbox-filter-panel', primaryFiltersStart);
  const primaryFilters = inbox.slice(primaryFiltersStart, primaryFiltersEnd);
  assert.match(primaryFilters, /\brole=["']tablist["']/);
  assert.equal((primaryFilters.match(/\brole=["']tab["']/g) || []).length, 4);
  assert.equal((primaryFilters.match(/\baria-selected=["'](?:true|false)["']/g) || []).length, 4);
  const filterControls = functionBody(inbox, 'renderFilterControls', 'toggleInboxFilters');
  assert.match(filterControls, /setAttribute\(['"]aria-selected['"]/);
  assert.match(filterControls, /tabIndex|setAttribute\(['"]tabindex['"]/);

  const menuTrigger = openingTag(inbox, 'data-thread-more');
  const menu = openingTag(inbox, 'data-thread-menu role');
  assert.match(menuTrigger, /\baria-haspopup=["']menu["']/);
  assert.match(menuTrigger, /\baria-controls=["'][^"']+["']/);
  assert.match(menu, /\bid=["'][^"']+["']/);
  assert.match(menu, /\brole=["']menu["']/);
  assert.match(inbox, /\brole=["']menuitem["']/);
});

test('el historial anuncia mensajes nuevos sin releer toda la conversación', () => {
  const log = openingTag(inbox, 'data-thread-messages');
  assert.match(log, /\brole=["']log["']/);
  assert.match(log, /\baria-live=["']polite["']/);
  assert.match(log, /\baria-relevant=["']additions(?:\s+text)?["']/);
  assert.match(log, /\baria-atomic=["']false["']/);

  const queueStatus = openingTag(inbox, 'data-inbox-queue-summary');
  assert.match(queueStatus, /\brole=["']status["']/);
  assert.match(queueStatus, /\baria-live=["']polite["']/);
});

test('la hoja de estilos declara una escala legible y objetivos táctiles canónicos', () => {
  assert.match(css, /--smyl-inbox-font-message\s*:\s*(?:14px|0\.875rem)/);
  assert.match(css, /--smyl-inbox-font-meta\s*:\s*(?:12px|0\.75rem)/);
  assert.match(css, /--smyl-inbox-touch-target\s*:\s*44px/);
  assert.match(css, /--smyl-inbox-drawer-width\s*:\s*(?:4(?:0|2)0px|26\.25rem)/);

  assert.match(css, /\.smyl-inbox-bubble(?:\s+p)?\s*\{[^}]*font-size\s*:\s*var\(--smyl-inbox-font-message\)/);
  assert.match(css, /\.(?:smyl-inbox-message-meta|smyl-inbox-message-status)[^{]*\{[^}]*font-size\s*:\s*(?:var\(--smyl-inbox-font-meta\)|12px|0\.75rem)/);
  assert.match(css, /min-height\s*:\s*var\(--smyl-inbox-touch-target\)/);
  assert.match(css, /@media\s*\(max-width\s*:\s*760px\)[\s\S]*?\.smyl-inbox-context\s*\{[^}]*width\s*:\s*100%[^}]*max-width\s*:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/);
});
