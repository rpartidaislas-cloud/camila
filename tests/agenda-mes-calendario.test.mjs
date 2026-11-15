import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-schedule.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-schedule.css', import.meta.url), 'utf8');

test('mes: todo el recuadro del día abre el día, sin quitar el clic de las citas', () => {
  assert.match(js, /querySelectorAll\('\.schedule-month-day'\)\.forEach\(function\(c\)\{c\.onclick=function\(e\)\{if\(e\.target\.closest\('\[data-appointment\],\[data-open-day\]'\)\)return;/);
  assert.match(css, /\.schedule-month-day\{position:relative;cursor:pointer/);
});
test('mes: la cita muestra hora y paciente, con estado y detalle accesibles', () => {
  assert.match(js, /data-status="'\+esc\(a\.status\)\+'"/);
  assert.match(js, /aria-label="'\+esc\(fmtTime\(a\.starts_at\)\+', '\+who/);
  for (const st of ['arrived', 'in_progress', 'completed', 'no_show']) assert.match(css, new RegExp('schedule-month-event\\[data-status=' + st + '\\]'));
});
test('mes: marca los días cerrados y recuerda la última vista', () => {
  assert.match(js, /data-closed="'\+closed\+'"/);
  assert.match(css, /\.schedule-month-day\[data-closed=true\]/);
  assert.match(js, /localStorage\.setItem\('smyl-schedule-view'/);
  assert.match(js, /localStorage\.getItem\('smyl-schedule-view'\)/);
});
