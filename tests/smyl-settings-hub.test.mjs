import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hub = createRequire(import.meta.url)('../smyl-settings-hub.js');

test('las secciones siguen el orden del panel de LANA y agregan seguridad al final', () => {
  assert.deepEqual(hub.SECTIONS.map(s => s.id), ['negocio', 'cobros', 'catalogo', 'canales', 'experiencia', 'seguridad']);
  assert.deepEqual(hub.SECTIONS.slice(0, 5).map(s => s.title), ['Negocio', 'Ventas y cobros', 'Catálogo', 'Canales', 'Experiencia']);
});

test('cada pantalla de configuración que existe hoy tiene su tarjeta y nada se queda sin camino', () => {
  const routes = new Set(hub.SECTIONS.flatMap(s => s.items.filter(i => !i.soon).map(i => i.route)));
  for (const route of ['clinica', 'mi-cuenta', 'caja', 'precios', 'inventario', 'agenda', 'conexiones', 'plantillas', 'sim-config', 'directorio', 'lanzamiento', 'seguridad']) {
    assert.ok(routes.has(route), `falta la ruta ${route}`);
  }
  for (const item of hub.SECTIONS.flatMap(s => s.items)) {
    assert.ok(item.soon || item.route, `${item.title} no lleva a ningún lado`);
    assert.ok(item.desc && item.desc.length > 10, `${item.title} necesita descripción`);
  }
  // Lo que todavía no existe se muestra como «Próximamente», sin botón.
  assert.deepEqual(hub.SECTIONS.flatMap(s => s.items).filter(i => i.soon).map(i => i.title).sort(),
    ['Colaboraciones', 'Formas de pago y anticipo', 'Perfil público de WhatsApp']);
});

test('los avisos de estado salen de verificaciones reales y no inventan nada si no se pudo verificar', () => {
  const results = { hours: { done: true }, whatsapp: { done: false }, template: { done: false, waiting: true }, reminders: { unknown: true } };
  assert.deepEqual({ ...hub.status('hours', results) }, { text: 'Horario listo', tone: 'ok' });
  assert.deepEqual({ ...hub.status('whatsapp', results) }, { text: 'Sin conectar', tone: 'todo' });
  assert.deepEqual({ ...hub.status('template', results) }, { text: 'Meta la revisa', tone: 'wait' });
  assert.equal(hub.status('reminders', results), null, 'sin verificación no hay aviso');
  assert.equal(hub.status('hours', null), null);
  assert.equal(hub.status('services', null, null), null);
  assert.equal(hub.status('services', null, 0).tone, 'todo');
  assert.equal(hub.status('services', null, 3).text, '3 activos');
  const negocio = hub.SECTIONS[0], canales = hub.SECTIONS[3];
  assert.equal(hub.pendingCount(negocio, { hours: { done: false } }, 1), 1);
  assert.equal(hub.pendingCount(canales, { whatsapp: { done: false }, template: { done: true }, reminders: { done: false } }, 1), 2);
  assert.equal(hub.pendingCount(canales, null, null), 0);
});

test('el menú tiene un solo acceso a Configuración y mantiene registradas las rutas para los demás módulos', () => {
  const nav = read('smyl-navigation.js');
  assert.match(nav, /var SETTINGS = \[\['Configuración', 'configuracion', 'settings'\]\];/);
  assert.match(nav, /var REGISTRY = \[/);
  for (const route of ['clinica', 'conexiones', 'lanzamiento', 'seguridad', 'mi-cuenta', 'sim-config', 'directorio']) {
    assert.match(nav, new RegExp(`\\['[^']+', '${route}', '[a-z]+'\\]`), `${route} debe seguir registrada`);
  }
  assert.match(nav, /registry\.hidden = true/);
  assert.match(nav, /\['Simulaciones', 'historial', 'history'\]/);
  assert.match(nav, /button\.dataset\.also = SETTINGS_ROUTES\.join\(' '\)/);
  assert.match(read('smyl-professional-v3.js'), /configuracion:\['Configuración'/);
});

test('la pantalla solo navega: no escribe datos y no guarda secretos', () => {
  const source = read('smyl-settings-hub.js');
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|rpc\(|functions\.invoke/);
  assert.doesNotMatch(source, /token|secret|api[_-]?key/i);
  assert.match(source, /localStorage/);
  assert.match(source, /catch \(_\) \{ return null; \}/);
  assert.match(read('smyl-clinic-setup.js'), /results: function \(\) \{ return state\.results; \}/);
});

test('la configuración se distribuye igual en web, móvil y PWA', () => {
  for (const file of ['smyl-settings-hub.js', 'smyl-settings-hub.css', 'smyl-navigation.js', 'smyl-clinic-setup.js', 'smyl-professional-v3.js', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-settings-hub\.js\?v=1/);
  assert.match(read('app.html'), /smyl-settings-hub\.css\?v=1/);
  assert.match(read('sw.js'), /\/camila\/smyl-settings-hub\.js\?v=1/);
  assert.match(read('sw.js'), /\/camila\/smyl-settings-hub\.css\?v=1/);
});
