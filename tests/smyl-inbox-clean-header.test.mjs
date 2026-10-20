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
  assert.match(read('../app.html'), /smyl-inbox\.js\?v=31/);
  assert.match(read('../app.html'), /smyl-inbox\.css\?v=32/);
});
