import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-schedule.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-schedule.css', import.meta.url), 'utf8');
const moveTarget = new Function(js.match(/function moveTarget\(a,dayKey\)\{[^\n]*\n/)[0] + ';return moveTarget;')();

test('mover cita en el mes: conserva la hora del día y cambia solo la fecha', () => {
  const a = { starts_at: new Date(2026, 10, 17, 9, 30).toISOString() };
  const d = moveTarget(a, '2026-11-19');
  assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 10); assert.equal(d.getDate(), 19);
  assert.equal(d.getHours(), 9); assert.equal(d.getMinutes(), 30);
});
test('mes: solo las citas confirmadas se arrastran, con confirmación y el RPC de reprogramar con control de versión', () => {
  assert.match(js, /\.schedule-month-event\[data-status=confirmed\]'\)\.forEach\(function\(b\)\{b\.draggable=true/);
  assert.match(js, /function openMoveConfirm\(a,dayKey\)/);
  assert.match(js, /smyl_reschedule_appointment',\{p_appointment_id:a\.id,p_branch_id:a\.branch_id,p_room_id:a\.room_id\|\|null,p_starts_at:to\.toISOString\(\),p_expected_updated_at:a\.updated_at\}/);
  assert.match(js, /if\(state\.canManage\)\{\s*var dragging=null/);
  assert.match(css, /\.schedule-month-day\.is-drop/);
});
test('agenda: se actualiza sola cuando otra persona cambia una cita, sin interrumpir diálogos abiertos', () => {
  assert.match(js, /setInterval\(checkRemoteChanges,45000\)/);
  assert.match(js, /document\.hidden\|\|!state\.loaded\|\|state\.loading/);
  assert.match(js, /document\.querySelector\('dialog\[open\]'\)\)return;/);
  assert.match(js, /remote&&remote>local/);
});
test('mes: las flechas mueven el foco entre los días', () => {
  assert.match(js, /ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7/);
});
