import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const js = read('smyl-schedule.js');
const css = read('smyl-schedule.css');

test('Pendientes de hoy: va recogido por defecto y se puede expandir; la elección se recuerda', () => {
  // la preferencia usa el mismo patrón protegido que «semana completa» (si el almacenamiento falla, no se rompe)
  const get = js.match(/function focusOpen\(\)\{[^\n]*\n/)[0];
  assert.match(get, /try\{return window\.localStorage\.getItem\('smyl_schedule_focus_open'\)==='1';\}catch\(_\)\{return false;\}/);
  assert.match(js, /function setFocusOpen\(value\)\{try\{window\.localStorage\.setItem\('smyl_schedule_focus_open',value\?'1':'0'\);\}catch\(_\)\{\}\}/);
  // recogido: la lista lleva `hidden` y el botón avisa el estado a lectores de pantalla
  assert.match(js, /id="schedule-focus-list"'\+\(open\?'':' hidden'\)/);
  assert.match(js, /aria-expanded="'\+\(open\?'true':'false'\)\+'" aria-controls="schedule-focus-list"/);
  assert.match(js, /toggle\.onclick=function\(\)\{setFocusOpen\(!focusOpen\(\)\);renderFocus\(\);\}/);
  assert.match(css, /\.schedule-focus-list\[hidden\]\{display:none\}/);
});

test('Pendientes de hoy recogido: una línea con el total y un resumen por tipo (no 5 filas)', () => {
  assert.match(js, /counts\.slice\(0,3\)\.map\(function\(c\)\{return '<em>'\+c\.n\+' · '\+esc\(c\.label\)\+'<\/em>'/);
  assert.match(js, /host\.classList\.toggle\('is-collapsed',!open\)/);
  assert.match(css, /\.schedule-focus\.is-collapsed \.schedule-focus-head\{padding:9px 14px/);
  // expandido: si hay más de 5 se dice cuántos faltan
  assert.match(js, /pending>5\?'<p class="schedule-focus-more">y '\+\(pending-5\)\+' más/);
});

test('los botones de las filas siguen abriendo la cita, y «ver el día» no pisa a las filas', () => {
  assert.match(js, /host\.querySelectorAll\('\[data-focus-all\]'\)\.forEach/);
  assert.match(js, /host\.querySelectorAll\('\.schedule-focus-list article button'\)/);
  assert.doesNotMatch(js, /host\.querySelectorAll\('\.schedule-focus-list button'\)/);
});

test('Agenda: el filtro de sillón ya no existe, y los filtros de sucursal y profesional siguen', () => {
  assert.doesNotMatch(js, /schedule-room/);
  assert.doesNotMatch(js, /Filtrar por sillón|Todos los sillones/);
  assert.match(js, /id="schedule-branch"/);
  assert.match(js, /id="schedule-professional"/);
  // sin filtro de sillón, el estado queda siempre vacío para que filterRow no oculte citas
  assert.match(js, /state\.room='';\[\[branch,/);
  // el sillón sigue existiendo donde sí sirve: reservar y ver la cita
  assert.match(js, /Sin sillón/);
});

test('web y móvil publican lo mismo', () => {
  assert.equal(js, read('mobile/www/smyl-schedule.js'));
  assert.equal(css, read('mobile/www/smyl-schedule.css'));
});
