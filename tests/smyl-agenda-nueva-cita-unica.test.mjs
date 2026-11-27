// El botón «Nueva cita» del encabezado de Agenda se oculta en escritorio (ya está en la barra lateral y en el estado vacío),
// pero sigue en el DOM porque otros accesos lo accionan con .click().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("«Nueva cita» del encabezado se oculta solo en escritorio y no se elimina del DOM", () => {
  const css = read("smyl-schedule.css");
  assert.match(css, /@media\(min-width:769px\)\{\s*body #p-agenda \.schedule-head-actions #schedule-new\{display:none !important\}/);
  assert.match(read("smyl-schedule.js"), /id="schedule-new">Nueva cita<\/button>/);
  assert.match(read("smyl-navigation.js"), /getElementById\('schedule-new'\)/);
  assert.match(read("app.html"), /getElementById\('schedule-new'\)/);
});

test("versiones del CSS sincronizadas en web y móvil", () => {
  for (const base of ["", "mobile/www/"]) {
    assert.match(read(`${base}app.html`), /smyl-schedule\.css\?v=40/);
    assert.match(read(`${base}sw.js`), /smyl-schedule\.css\?v=40/);
    assert.match(read(`${base}sw.js`), /agenda-sin-nueva-cita-duplicada-v1/);
  }
  assert.equal(read("mobile/www/smyl-schedule.css"), read("smyl-schedule.css"));
});
