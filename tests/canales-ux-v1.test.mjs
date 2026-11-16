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
