import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-clinic-admin.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-clinic-admin.css', import.meta.url), 'utf8');

test('sucursales: proceso por pasos con datos, espacios, horarios, equipo y resumen', () => {
  for (const key of ['datos', 'espacios', 'horarios', 'equipo', 'resumen']) assert.match(js, new RegExp("key: '" + key + "'"));
  assert.match(js, /function firstPendingStep\(readiness\)/);
  assert.match(js, /Guardar y continuar/);
  assert.match(js, /state\.branchStep\[branch\.id\] = 'espacios'/);
});
test('sucursales: la dirección y la ciudad cuentan para que la sede esté lista', () => {
  assert.match(js, /ready: address && rooms\.length > 0 && hours\.length > 0/);
  assert.match(js, /address_line \|\| ''\)\.trim\(\) && String\(branch\.city/);
});
test('sucursales: atajos de horario sin encimar días ya configurados', () => {
  assert.match(js, /data-ca-hours-preset="1,2,3,4,5\|09:00\|18:00"/);
  assert.match(js, /filter\(function \(day\) \{ return !taken\.has\(day\); \}\)/);
});
test('sucursales: parte superior compacta (avance plegado, cifras en una línea) y sin duplicados dentro de Ajustes', () => {
  assert.match(js, /clinic-admin-readiness-fold/);
  assert.match(css, /\.settings-hub-embed \.clinic-admin-head\{display:none\}/);
  assert.match(css, /\.settings-hub-embed \.clinic-admin-tabs\{display:none\}/);
  assert.match(js, /clinic-admin-back-ops/);
});
