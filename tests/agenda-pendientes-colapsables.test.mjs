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

test('avisos: solo se piden «por enviar» si los recordatorios automáticos están activados y no se arrastran los viejos', () => {
  const fn = new Function(js.match(/function remindersActive\(\)\{[^\n]*\n/)[0].replace('{var s=', '{var s=') + '\nreturn remindersActive;');
  const make = (settings) => new Function('state', js.match(/function remindersActive\(\)\{[^\n]*\n/)[0] + '\nreturn remindersActive;')({ reminderSettings: settings });
  assert.equal(make([])(), false, 'sin configuración = apagado');
  assert.equal(make(undefined)(), false);
  assert.equal(make([{ enabled: false, template_id: null, confirmation_enabled: false, confirmation_template_id: null }])(), false);
  assert.equal(make([{ enabled: true, template_id: null }])(), false, 'activado sin plantilla aprobada tampoco envía');
  assert.equal(make([{ enabled: true, template_id: 'tpl' }])(), true);
  assert.equal(make([{ enabled: false, template_id: null, confirmation_enabled: true, confirmation_template_id: 'c1' }])(), true, 'basta con las confirmaciones');
  // la lista de pendientes aplica esa regla y descarta avisos de hace más de 3 días
  assert.match(js, /if\(!remindersActive\(\)\|\|new Date\(r\.scheduled_for\)\.getTime\(\)<now-3\*86400000\)return false;/);
  // la configuración se carga con el resto de la agenda y queda en el mismo lugar del arreglo de nombres
  assert.match(js, /optionalQuery\(window\.sb\.from\('smyl_reminder_settings'\)\.select\('enabled,template_id,confirmation_enabled,confirmation_template_id'\)/);
  assert.match(js, /'negotiationDeliveries','reminderSettings','intakes'\]/);
});

test('la fila del aviso explica el motivo (p. ej. sin WhatsApp vinculado) en vez de solo la fecha', () => {
  assert.match(js, /why=r\.last_error\?\(\/vinculada\/i\.test\(r\.last_error\)\?'sin WhatsApp vinculado'/);
  assert.match(js, /\+\(why\?' · '\+why:''\)/);
  assert.match(js, /'id,appointment_id,reminder_type,scheduled_for,status,delivery_channel,attempt_count,last_error,/, 'ya se pide last_error');
});
