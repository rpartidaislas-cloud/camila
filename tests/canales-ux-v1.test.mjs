import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nav = fs.readFileSync(new URL('../smyl-navigation.js', import.meta.url), 'utf8');
const con = fs.readFileSync(new URL('../smyl-connections.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-navigation.css', import.meta.url), 'utf8');

test('canales: pasos 1-2-3, punto de estado por canal y títulos claros', () => {
  assert.match(nav, /data-channel-steps/);
  assert.match(nav, /Activar mensajería<\/span>.*Conectar canal<\/span>.*Configurar<\/span>/);
  assert.match(nav, /Conecta tu WhatsApp/); assert.match(nav, /Conecta tu página de Facebook/); assert.match(nav, /Conecta tu cuenta de Instagram/);
  assert.match(nav, /data-tab-dot/);
  assert.match(con, /pane\.dataset\.lana = connectedToLana/);
  assert.match(con, /\[data-channel-steps\] \[data-step\]/);
});
test('canales: alcance y herramientas solo con el canal conectado; aviso corto antes', () => {
  assert.match(css, /\.connections-channel-pane:not\(\[data-channel-state=connected\]\) \.connections-channel-scope,\s*\n\.connections-channel-pane:not\(\[data-channel-state=connected\]\) \.connections-channel-tools\{display:none\}/);
  assert.match(nav, /connections-channel-next/);
});
test('canales: requisitos de WhatsApp siempre visibles, sin desplegable', () => {
  assert.doesNotMatch(con, /Requisitos y límites<\/summary>/);
  assert.match(con, /connections-mode-reqs/);
});

test('canales: logotipos de Instagram y Messenger en menú, encabezado, fila, diálogo y caché sin conexión', () => {
  for (const f of ['icons/brands/instagram.svg', 'icons/brands/messenger.svg', 'mobile/www/icons/brands/instagram.svg', 'mobile/www/icons/brands/messenger.svg']) {
    const svg = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(svg, /^<svg[\s\S]*<path fill="url\(#(ig|mg)-grad\)" d="M/);
  }
  assert.match(con, /icons\/brands\/messenger\.svg/); assert.match(con, /icons\/brands\/instagram\.svg/);
  assert.match(nav, /icons\/brands\/messenger\.svg/); assert.match(nav, /icons\/brands\/' \+ name \+ '\.svg/);
  for (const sw of ['sw.js', 'mobile/www/sw.js']) {
    const t = fs.readFileSync(new URL('../' + sw, import.meta.url), 'utf8');
    assert.match(t, /icons\/brands\/instagram\.svg/); assert.match(t, /icons\/brands\/messenger\.svg/);
  }
});
test('canales: Messenger e Instagram explican qué se necesita antes de conectar', () => {
  assert.match(nav, /La cuenta debe ser profesional/);
  assert.match(nav, /administrador de la página de Facebook/);
  assert.match(css, /\.connections-channel-pane\[data-channel-state=connected\] \.connections-channel-reqs\{display:none\}/);
});
