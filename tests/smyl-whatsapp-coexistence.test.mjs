import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const proxy = read('supabase/functions/lana-channels/index.ts');
const connections = read('smyl-connections.js');
const navigation = read('smyl-navigation.js');
const styles = read('smyl-navigation.css');

test('SMYL ofrece coexistencia y número exclusivo como decisiones distintas', () => {
  assert.match(connections, /Conservar mi WhatsApp/);
  assert.match(connections, /Usar un número exclusivo/);
  assert.match(connections, /data-connection-mode="coexistence"/);
  assert.match(connections, /data-connection-mode="dedicated"/);
  assert.match(connections, /Los chats anteriores no se importan todavía/);
  assert.match(connections, /Responder desde el celular pausa al asistente/);
  assert.match(connections, /connection_mode: connectionMode/);
});

test('el modo viaja por el proxy autenticado sin exponer credenciales de Meta', () => {
  assert.match(proxy, /function connectionMode/);
  assert.match(proxy, /connection_mode: selected === "whatsapp" \? requestedMode : "dedicated"/);
  assert.match(proxy, /La coexistencia solo está disponible para WhatsApp/);
  assert.doesNotMatch(proxy, /access_token|WHATSAPP_TOKEN|META_APP_SECRET/);
});

test('el espacio separa canales y herramientas y muestra dependencias reales', () => {
  assert.match(navigation, /groupLabels = \{ general: 'General', channels: 'Canales', tools: 'Herramientas' \}/);
  assert.match(navigation, /data-channel-pane-status/);
  assert.match(navigation, /data-channel-mode/);
  assert.match(navigation, /data-channel-history/);
  assert.match(navigation, /dataset\.requiresChannel = 'true'/);
  assert.match(styles, /connections-whatsapp-mode-grid/);
  assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:680px\)[\s\S]*connections-whatsapp-mode-grid\{grid-template-columns:1fr\}/);
});

test('web y móvil conservan la misma experiencia de coexistencia', () => {
  for (const file of ['smyl-connections.js', 'smyl-navigation.js', 'smyl-navigation.css']) {
    assert.equal(read(file), read('mobile/www/' + file), file + ' difiere en mobile/www');
  }
});
