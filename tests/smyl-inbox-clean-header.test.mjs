import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const js = read('../smyl-inbox.js');
const css = read('../smyl-inbox.css');

test('cada canal conserva su marca y la cabecera la muestra junto al nombre', () => {
  assert.match(js, /var CHANNEL_MARKS = \{\s*whatsapp:/);
  assert.match(js, /instagram: '<svg/);
  assert.match(js, /messenger: '<svg/);
  assert.match(js, /badge\.setAttribute\('role', 'img'\); badge\.setAttribute\('aria-label', channelLabel\(channel\)\)/);
  assert.equal((js.match(/channelBadge\(/g) || []).length, 4); // definición, lista, pipeline y la API del Inicio (buildAvatar)
  assert.match(js, /meta\.replaceChildren\(channelLogo, node\('span', 'smyl-inbox-thread-channel-text'/);
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

test('la cabecera conserva Agendar cita y las demás acciones respetan los permisos del paciente', () => {
  const start = js.indexOf('function permittedCareActions');
  const end = js.indexOf('function closeComposerTools', start);
  assert.ok(start >= 0 && end > start);
  const actions = js.slice(start, end);
  for (const permission of ['schedule.manage', 'clinical.read', 'proposal.write', 'finance.manage']) {
    const escapedPermission = permission.replace('.', '\\.');
    assert.match(actions, new RegExp(`hasPermission\\('${escapedPermission}'\\)`));
  }
  assert.match(actions, /function primaryCareAction\(conversation, actions\)/);
  assert.equal((actions.match(/host\.append\(primaryButton\)/g) || []).length, 1);
  assert.match(actions, /primaryButton\.dataset\.threadPrimaryAction/);
  assert.match(actions, /action\.id === 'schedule'/, 'Agendar cita es la acción principal cuando hay permiso');
  assert.doesNotMatch(actions, /'Nueva acción'|id: 'template'/, 'sin botón «Nueva acción» ni plantilla en el encabezado');
  const head = js.match(/<header class="smyl-inbox-thread-head">.*?<\/header>/s)?.[0] || '';
  assert.match(head, /data-thread-owner aria-haspopup="dialog"/);
  assert.doesNotMatch(head, /data-thread-more|data-thread-menu/);
  assert.doesNotMatch(js, /data-thread-more|data-thread-menu-care|SMYL te pone al día/);
  assert.match(js, /settings\.onclick = openConversationSettings/);
});

test('el responsable y el relevo privado comparten un solo acceso en el encabezado', () => {
  const header = js.slice(js.indexOf('<header class="smyl-inbox-thread-head"'), js.indexOf('<div class="smyl-inbox-thread-body"'));
  assert.match(header, /data-thread-owner[^>]+aria-controls="smyl-chat-owner"/);
  assert.doesNotMatch(header, /data-handoff|data-thread-assign/);
  const ownerDialog = js.slice(js.indexOf('id="smyl-chat-owner"')).split('</dialog>')[0];
  assert.match(ownerDialog, /data-thread-assign/);
  assert.match(ownerDialog, /data-handoff[^>]+hidden/);
  assert.match(js, /id: 'citas', title: 'Citas', peek: visitsPeek/);
});

test('web y móvil entregan el mismo chat', () => {
  assert.equal(read('../mobile/www/smyl-inbox.js'), js);
  assert.equal(read('../mobile/www/smyl-inbox.css'), css);
  assert.match(read('../app.html'), /smyl-inbox\.js\?v=101/);
  assert.match(read('../app.html'), /smyl-inbox\.css\?v=81/);
});

test('la cabecera grande se reemplaza por una barra delgada y los contadores viven en las pestañas', () => {
  assert.doesNotMatch(js, /CENTRO DE ATENCIÓN DENTAL|data-inbox-overview|function renderInboxOverview/);
  assert.match(js, /<h1 class="smyl-inbox-sr">Mensajes<\/h1>/);
  const start = js.indexOf('<div class="smyl-inbox-filters"');
  const end = js.indexOf('smyl-inbox-filter-panel', start);
  const filters = js.slice(start, end);
  assert.equal((filters.match(/data-inbox-filter=/g) || []).length, 4);
  assert.equal((filters.match(/role="tab"/g) || []).length, 4);
  assert.equal((filters.match(/aria-selected="(?:true|false)"/g) || []).length, 4);
  for (const filter of ['all', 'unread', 'attention', 'mine']) assert.match(filters, new RegExp(`data-inbox-filter="${filter}"`));
  assert.match(css, /\.smyl-inbox-page\.show-thread \.smyl-inbox-top\{display:none\}/);
});

test('las burbujas no repiten el autor y las opciones viven fuera del mensaje', () => {
  assert.match(js, /bubble\.append\(node\('span', 'smyl-inbox-sr', author \+ ': '\)\)/);
  assert.match(js, /function dayLabel\(date\)/);
  assert.match(js, /return 'Hoy'/);
  assert.match(js, /state\.actionsOpenId/);
  assert.match(js, /row\.append\(actions\)/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.smyl-inbox-day\{width:max-content[^}]*border-radius:999px/);
});

test('el compositor tiene un solo lanzador de herramientas y el aviso de ventana solo aparece si vence', () => {
  assert.match(js, /smyl-inbox-compose-bar" role="group" aria-label="Acciones de respuesta"/);
  assert.match(js, /data-compose-copilot aria-label="Sugerir con MILA"/);
  assert.match(js, /data-compose-more[^>]+aria-haspopup="menu"/);
  assert.match(js, /data-compose-attach role="menuitem"/);
  assert.match(js, /data-compose-quick role="menuitem"/);
  assert.match(js, /data-compose-emoji role="menuitem"/);
  assert.equal((js.match(/data-compose-file accept/g) || []).length, 1);
  assert.match(js, /notice\.hidden = !isWhatsapp \|\| windowState\.status === 'open'/);
});

test('Chat limpio: un solo aviso de plantilla, conversación abierta que no desaparece y acciones del mensaje alcanzables con teclado', () => {
  assert.match(js, /Ventana de 24 h vencida · usa una plantilla aprobada/);
  assert.match(js, /send\.innerHTML = templateOnly/);
  assert.match(js, /Elegir plantilla aprobada/);
  assert.doesNotMatch(js, /smyl-inbox-window-action/, 'el aviso no duplica la acción de plantilla');
  assert.match(js, /var keepOpen = item\.id === state\.selectedId && \(state\.view !== 'pipeline' \|\| state\.pipelineChatId === item\.id\)/);
  assert.match(js, /Ventana 24 h: quedan /);
  assert.doesNotMatch(js, /smyl-inbox-briefing-files/, '«Archivos» ya no vive en la franja de resumen');
  const css = fs.readFileSync(new URL('../smyl-inbox.css', import.meta.url), 'utf8');
  assert.match(css, /smyl-inbox-message:focus-within \.smyl-inbox-message-more/, 'las opciones también aparecen con el foco del teclado');
  assert.match(css, /#p-inbox \.smyl-inbox-filters button\.active b\{background:#2d3a9e;color:#fff\}/, 'el contador del filtro activo se ve');
});
