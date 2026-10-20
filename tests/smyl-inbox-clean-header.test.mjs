import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');

test('cada canal muestra su logo en la esquina del avatar, en lista, encabezado y pipeline', () => {
  assert.match(js, /var CHANNEL_MARKS = \{\s*whatsapp:/);
  assert.match(js, /instagram: '<svg/);
  assert.match(js, /messenger: '<svg/);
  assert.match(js, /badge\.setAttribute\('role', 'img'\); badge\.setAttribute\('aria-label', channelLabel\(channel\)\)/);
  assert.equal((js.match(/channelBadge\(/g) || []).length, 4);
  // Ya no hay un chip de texto con el nombre del canal en cada fila.
  assert.doesNotMatch(js, /node\('span', 'smyl-inbox-channel', channelLabel/);
  assert.match(css, /\.smyl-inbox-channel-badge\{position:absolute/);
  assert.doesNotMatch(js, /https?:\/\/[^'"]*(whatsapp|instagram|messenger)[^'"]*\.(png|svg|jpg)/i);
});

test('un interruptor de IA sustituye al chip de estado y al botón Tomar control / Reanudar IA', () => {
  assert.match(js, /data-thread-mode role="switch" aria-checked="true"/);
  assert.match(js, /mode\.setAttribute\('aria-checked', conversation\.paused \? 'false' : 'true'\)/);
  assert.match(js, /'IA pausada'/);
  assert.doesNotMatch(js, /'Reanudar IA'|'Tomar control'/);
  assert.match(js, /conversation\.paused \? prepareResume\(\) : mutateConversation\('pause'\)/);
});

test('Expediente, Cotizar y Cobrar viven en el menú y solo Agendar cita queda en el encabezado', () => {
  assert.match(css, /\.smyl-inbox-carebar \.smyl-inbox-care-action:not\(\.is-primary\)\{display:none\}/);
  assert.match(css, /\.smyl-inbox-thread-menu-care\{display:block/);
  assert.match(js, /actions\.push\(\['Expediente'/);
});

test('la barra «SMYL te pone al día» resume lo pendiente sin consultas extra ni IA', () => {
  const bar = js.slice(js.indexOf('function briefingFacts'), js.indexOf('function renderThreadMenuState'));
  assert.match(bar, /Pidió hablar con una persona/);
  assert.match(bar, /Sin respuesta hace/);
  assert.match(bar, /'Cita ' \+ availabilityDate/);
  assert.match(bar, /'Etapa: ' \+ stage/);
  assert.match(bar, /Marcar resuelta/);
  assert.doesNotMatch(bar, /request\(/);
  assert.match(js, /refreshBriefing\(\);\s*\}/);
  assert.match(css, /\.smyl-inbox-briefing\[data-state=attention\]\{border-left-color:#D92D20/);
});

test('web y móvil entregan el mismo chat', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), js);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.match(read('../app.html'), /smyl-inbox\.js\?v=33/);
  assert.match(read('../app.html'), /smyl-inbox\.css\?v=33/);
});

test('la cabecera grande se reemplaza por una barra delgada y los contadores viven en las pestañas', () => {
  assert.doesNotMatch(js, /CENTRO DE ATENCIÓN DENTAL|data-inbox-overview|function renderInboxOverview/);
  assert.match(js, /<h1 class="smyl-inbox-sr">Mensajes<\/h1>/);
  assert.match(js, /data-inbox-filter="all" class="active">Todas<\/button><button type="button" data-inbox-filter="unread">Sin leer<\/button><button type="button" data-inbox-filter="attention">Por atender<\/button><button type="button" data-inbox-filter="mine">Mías/);
  assert.match(css, /\.smyl-inbox-page\.show-thread \.smyl-inbox-top\{display:none\}/);
});

test('las burbujas no repiten Paciente / Equipo de la clínica y Responder / Más aparece al tocar en celular', () => {
  assert.match(js, /bubble\.append\(node\('span', 'smyl-inbox-sr', author \+ ': '\)\)/);
  assert.match(js, /function dayLabel\(date\)/);
  assert.match(js, /return 'Hoy'/);
  assert.match(js, /state\.actionsOpenId/);
  assert.match(css, /\.smyl-inbox-message\.show-actions \.smyl-inbox-message-actions\{display:flex\}/);
  assert.match(css, /\.smyl-inbox-day\{width:max-content[^}]*border-radius:999px/);
});

test('el compositor tiene una sola fila de herramientas y el aviso de ventana solo aparece si vence', () => {
  assert.match(js, /smyl-inbox-compose-bar" title="El borrador se cifra para esta sesión/);
  assert.match(js, /<button type="button" data-compose-attach>Adjuntar<\/button><button type="button" data-compose-quick>Respuesta rápida<\/button><button type="button" class="smyl-inbox-compose-copilot" data-compose-copilot aria-label="Sugerir con Copilot">Sugerir<\/button>/);
  assert.equal((js.match(/data-compose-file accept/g) || []).length, 1);
  assert.match(js, /notice\.hidden = !isWhatsapp \|\| windowState\.status === 'open'/);
});
