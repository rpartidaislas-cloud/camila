import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const js = read('smyl-schedule.js'), css = read('smyl-schedule.css'), dlg = read('smyl-dialog-system.js');

test('nueva cita: el resumen es neutro hasta elegir tratamiento y profesional, y solo es alerta con problemas reales', () => {
  assert.match(js, /host\.dataset\.tone=complete\?\(x\.issues\.length\?'issue':'ready'\):'pending'/);
  assert.match(css, /\.schedule-booking-check\[data-tone=pending\]\{/);
});
test('nueva cita: los horarios libres son lo principal y la fecha manual queda como opción', () => {
  assert.match(js, /<details class="schedule-custom-time" data-custom-time><summary>Escribir otra fecha u hora<\/summary><label>Día y hora<input name="starts"/);
  assert.match(js, /if\(!list\.length&&custom\)custom\.open=true/);
  assert.match(js, /if\(custom\)custom\.open=true;host\.innerHTML=head\+/);
});
test('nueva cita: ventana amplia con formulario a la izquierda y resumen a la derecha en escritorio', () => {
  assert.match(dlg, /#schedule-appointment-form'\)\) return 'large'/);
  assert.match(css, /@media\(min-width:900px\)\{[\s\S]*#schedule-appointment-form \.schedule-form-grid\{position:relative;padding-right:324px/);
});
