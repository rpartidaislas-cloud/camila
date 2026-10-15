import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const architecture = read('../docs/SMYL_PLATFORM_BOUNDARY.md');
const panel = read('../smyl-panel.js');
const connections = read('../smyl-connections.js');
const inbox = read('../smyl-inbox.js');
const attention = read('../smyl-lana-attention.js');
const handoff = read('../smyl-lana-handoff.js');
const mobilePanel = read('../mobile/www/smyl-panel.js');
const mobileConnections = read('../mobile/www/smyl-connections.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');

test('architecture assigns clinical data to SMYL and messaging infrastructure to LANA', () => {
  assert.match(architecture, /SMYL es el producto que compra y utiliza la clínica dental/);
  assert.match(architecture, /LANA es un proveedor interno de capacidades de comunicación e IA/);
  assert.match(architecture, /bases de\s+datos de producción no se mezclan/);
  assert.match(architecture, /El navegador se autentica únicamente contra SMYL/);
  assert.match(architecture, /La agenda clínica nunca se duplica en LANA/);
  assert.match(architecture, /movimientos confirmados son inmutables/);
});

test('dentist-facing copy presents one SMYL product', () => {
  assert.match(connections, /Canales e IA/);
  assert.match(connections, /pro-primary-nav/);
  assert.match(connections, /mobileButton\.textContent = 'Canales'/);
  assert.doesNotMatch(connections, /settings\.insertBefore\(button/);
  assert.match(connections, /SMYL Asistente/);
  assert.match(inbox, /SMYL Asistente y tu equipo/);
  assert.match(panel, /Dar seguimiento en Mensajes/);
  assert.match(attention, /ATENCIÓN OMNICANAL/);
  assert.match(handoff, /Consultando la identidad del contacto/);
  for (const source of [panel, connections, inbox, attention, handoff]) {
    assert.doesNotMatch(source, /LANA y canales|Continuar en LANA|Configurar LANA|LANA activa|Reanudar LANA|Paciente de LANA|ATENCIÓN CON LANA/);
  }
});

test('web and mobile product-boundary assets stay synchronized', () => {
  assert.equal(panel, mobilePanel);
  assert.equal(connections, mobileConnections);
  assert.equal(inbox, mobileInbox);
});
