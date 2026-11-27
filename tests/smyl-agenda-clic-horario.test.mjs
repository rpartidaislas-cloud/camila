import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('el clic en la Agenda se ve en «Nueva cita» aunque falte el tratamiento', () => {
  const schedule = read('smyl-schedule.js');
  const board = read('smyl-schedule-board.js');
  assert.match(schedule, /preselected:function\(\)/, 'el tablero puede leer la hora que se tocó en la Agenda');
  assert.match(schedule, /x\.start\?fmtDate\(x\.start,\{weekday:'short',day:'numeric',month:'short'\}\)\+' · '\+fmtTime\(x\.start\):'Elige día y hora'/, 'el resumen muestra la hora sin esperar la duración');
  assert.match(board, /Elegiste /, 'avisa qué día y hora se eligieron');
  assert.match(board, /api\.pick\(pending\)/, 'al elegir tratamiento toma sola la hora tocada si está libre');
  assert.match(board, /no está libre para este tratamiento/, 'avisa cuando esa hora no está libre');
});

test('al guardar, la Agenda salta al día y la sucursal de la cita', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /state\.date=startDay\(savedStart\)/);
  assert.match(schedule, /'Cita guardada: '\+fmtDate\(savedStart/);
});

test('las citas hechas desde el chat avisan dónde quedaron y la Agenda se actualiza', () => {
  const inbox = read('smyl-inbox.js');
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /addEventListener\('smyl:appointments-changed'/, 'la Agenda escucha las citas creadas desde el chat');
  assert.match(schedule, /focusAppointment:async function\(startsAt,branchId,professionalId\)/);
  assert.match(inbox, /function announceBookedAppointment\(/);
  assert.equal((inbox.match(/announceBookedAppointment\(/g) || []).length, 3, 'definición + las dos formas de confirmar desde el chat');
  assert.doesNotMatch(inbox, /window\.alert\('Cita confirmada en la Agenda/);
  assert.match(inbox, /¿Abrir la Agenda en ese día para verla\?/);
});

test('la Agenda avisa cuando el filtro esconde citas y deja verlas todas', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /function renderHiddenNote\(\)/);
  assert.match(schedule, /no se ven porque estás filtrando por/);
  assert.match(schedule, /renderCalendar\(\);renderHiddenNote\(\);/);
  assert.match(read('smyl-schedule.css'), /\.schedule-hidden-note\{/);
});

test('web, móvil y PWA publican el arreglo', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=70/);
    assert.match(read(file), /smyl-schedule-board\.js\?v=3/);
    assert.match(read(file), /smyl-schedule\.css\?v=40/);
    assert.match(read(file), /smyl-inbox\.js\?v=101/);
  }
  assert.match(read('sw.js'), /-agenda-clic-horario-v1-chat-cita-agenda-v1-agenda-filtro-aviso-v1(-|')/);
  for (const file of ['smyl-schedule.js', 'smyl-inbox.js', 'smyl-schedule-board.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
