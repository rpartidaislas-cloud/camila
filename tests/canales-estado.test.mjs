import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const connections = read('smyl-connections.js');
const nav = read('smyl-navigation.js');
const css = read('smyl-connections.css');

function freshness() {
  const start = connections.indexOf('function verificationFreshness(value) {');
  const end = connections.indexOf('\n  }\n', start) + 4;
  return new Function(`${connections.slice(start, end)}; return verificationFreshness;`)();
}

test('la última verificación se dice en palabras y avisa cuando ya pasó más de un día', () => {
  const fn = freshness(); const now = Date.now(); const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
  assert.equal(fn(ago(0)).text, 'Última verificación: hace un momento');
  assert.equal(fn(ago(5)).text, 'Última verificación: hace 5 min');
  assert.equal(fn(ago(60)).text, 'Última verificación: hace 1 hora');
  assert.equal(fn(ago(180)).text, 'Última verificación: hace 3 horas');
  assert.equal(fn(ago(1440)).stale, true);
  assert.match(fn(ago(2 * 1440)).text, /hace 2 días · conviene verificar de nuevo/);
  assert.equal(fn(ago(300)).stale, false);
  assert.deepEqual(fn(''), { text: '', title: '', stale: false });
  assert.deepEqual(fn('no es fecha'), { text: '', title: '', stale: false });
  assert.ok(fn(ago(90)).title.length > 5, 'la fecha completa queda en el título');
});

test('Estado muestra cada canal de un vistazo con su estado en texto y acceso directo', () => {
  assert.match(nav, /connections-glance/);
  for (const name of ['whatsapp', 'messenger', 'instagram']) assert.ok(nav.includes(`'${name}'`) || nav.includes(`${name}:`), name);
  assert.match(nav, /data-overview-channel/);
  assert.match(nav, /data-overview-open/);
  assert.match(nav, /tabs\.querySelector\('\[data-connection-tab="' \+ open\.dataset\.overviewOpen/);
  // El estado se actualiza desde el mismo punto que ya actualizaba los puntos de color.
  assert.match(connections, /data-overview-channel="' \+ name \+ '"/);
  assert.match(connections, /data-tab-state="' \+ name \+ '"/);
  assert.match(connections, /'Conectado' : \(connectedToLana \? 'Sin conectar' : 'Activa los canales'\)/);
});

test('el color no es el único indicador: cada pestaña de canal lleva su estado en texto', () => {
  assert.match(nav, /<span class="connections-tab-sr" data-tab-state="/);
  assert.match(css, /\.connections-tab-sr\{position:absolute;width:1px;height:1px/);
});

test('las pestañas usan iconos de línea coherentes y no letras sueltas', () => {
  assert.match(nav, /var TAB_ICONS = \{/);
  for (const key of ['overview', 'assistant', 'templates', 'automations', 'lab']) assert.match(nav, new RegExp(`${key}: lineIcon\\(`));
  assert.doesNotMatch(nav, /\['(?:channels|assistant|templates|automations|lab)','[^']+','[A-ZT⌁]','/);
});

test('el detalle de seguridad queda plegado y el texto deja de usar jerga interna', () => {
  assert.match(nav, /how\.className = 'connections-how'/);
  assert.match(nav, /<summary>Cómo protege SMYL tus conversaciones<\/summary>/);
  assert.match(nav, /how\.append\(flow, safety\)/);
  assert.doesNotMatch(connections, /puente entre productos|Infraestructura de canales|FLUJO SEGURO|tokens de Meta/);
  assert.match(connections, /Conexión de mensajería/);
  assert.match(connections, /SMYL no envía diagnósticos, simulaciones ni propuestas a los pacientes sin que el dentista los revise y los apruebe/);
  assert.match(connections, /Nada clínico se entrega automáticamente sin aprobación humana/);
});

test('desvincular queda apartado y con aspecto de acción delicada, no del mismo peso que verificar', () => {
  assert.match(connections, /class="connections-unlink-button connections-unlink-link" data-unlink-lana/);
  assert.match(css, /\.connections-unlink-link\{margin-left:auto/);
  assert.match(css, /color:#a1362b/);
});

test('el estilo respeta movimiento reducido y no baja de 12 px', () => {
  const block = css.slice(css.indexOf('/* ── Canales › Estado'));
  assert.match(block, /prefers-reduced-motion:reduce/);
  for (const [, size] of block.matchAll(/font-size:(\d+)px/g)) assert.ok(Number(size) >= 12, `font-size ${size}px`);
});

test('web, móvil y PWA publican la pantalla de Canales', () => {
  for (const file of ['smyl-connections.js', 'smyl-connections.css', 'smyl-navigation.js', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
