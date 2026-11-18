import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('el calendario del chat llega igual a web, PWA y móvil', () => {
  assert.equal(read('smyl-inbox-calendar.js'), read('mobile/www/smyl-inbox-calendar.js'));
  for (const file of ['smyl-inbox.js', 'smyl-inbox.css', 'smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  const html = read('app.html');
  assert.match(html, /smyl-inbox-calendar\.js\?v=4/);
  assert.ok(html.indexOf('smyl-inbox-calendar.js') < html.indexOf('smyl-inbox.js?v='));
  assert.match(read('sw.js'), /smyl-inbox-calendar\.js\?v=4/);
});

test('el módulo del calendario expone render e invalidate, con niveles de disponibilidad y consultas acotadas', () => {
  const src = read('smyl-inbox-calendar.js');
  assert.match(src, /window\.SmylInboxCalendar\s*=/);
  assert.match(src, /render/);
  assert.match(src, /invalidate/);
  for (const level of ['many', 'few', 'none']) assert.match(src, new RegExp(level));
  assert.match(src, /Por la mañana/);
  assert.match(src, /Por la tarde/);
  assert.match(src, /Ver citas del día/);
  assert.doesNotMatch(src, /tenant_id|window\.tenantId|window\.sb/);
});

test('agendar desde el chat: calendario por defecto, confirmación explícita y mensaje nunca enviado solo', () => {
  const src = read('smyl-inbox.js');
  assert.match(src, /availabilityMode:\s*'calendar'/);
  assert.match(src, /data-availability-mode/);
  assert.match(src, /data-availability-book/);
  assert.match(src, /'appointment_request'/);
  assert.match(src, /'appointment_confirm'/);
  assert.match(src, /window\.confirm\(/);
  assert.match(src, /setComposerText\(/);
  assert.match(src, /hasPermission\('schedule\.manage'\)/);
});

test('la agenda del día la lee el módulo de Agenda, no el chat', () => {
  assert.match(read('smyl-schedule.js'), /dayAppointments:async function/);
  assert.match(read('smyl-inbox.js'), /window\.SmylSchedule\.dayAppointments/);
});

test('horarios del chat: títulos claros, sucursal en cada horario, agrupar por dentista y sin tope oculto', () => {
  const cal = read('smyl-inbox-calendar.js');
  assert.doesNotMatch(cal, /'Mañana'|'Tarde'/);
  assert.match(cal, /Por la mañana/);
  assert.match(cal, /Por dentista/);
  assert.match(cal, /places > 1/); // la sucursal solo se muestra cuando hay varias
  assert.match(cal, /GROUP_PREVIEW/);
  assert.match(cal, /'Ver ' \+ \(rows\.length - GROUP_PREVIEW\) \+ ' más'/);
  assert.doesNotMatch(cal, /30 o más/);
  const ui = read('smyl-inbox.js');
  // el servidor corta en 30 por consulta (ordenado por hora): se pide el resto desde el último horario
  assert.match(ui, /if \(rows\.length < 30\) break;/);
  assert.match(ui, /all\.truncated = truncated/);
  assert.doesNotMatch(ui, /localStorage/);
});
