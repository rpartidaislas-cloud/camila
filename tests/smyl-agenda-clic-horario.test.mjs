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

test('web, móvil y PWA publican el arreglo', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=51/);
    assert.match(read(file), /smyl-schedule-board\.js\?v=3/);
    assert.match(read(file), /smyl-schedule\.css\?v=35/);
  }
  assert.match(read('sw.js'), /-agenda-clic-horario-v1';/);
  for (const file of ['smyl-schedule.js', 'smyl-schedule-board.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
