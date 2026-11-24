// smyl-asistente-niveles: tarjetas de nivel de autonomía (1 Informativo · 2 Citas y precios · 3 Acompañamiento) en SMYL Asistente.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const conn = read("smyl-connections.js");
const css = read("smyl-navigation.css");

test("el paso «Reglas de atención» ofrece 3 niveles como tarjetas; el <select> sigue siendo la fuente que se guarda", () => {
  const fieldset = conn.slice(conn.indexOf("<fieldset><legend>Flujo de atención</legend>"), conn.indexOf("<fieldset><legend>Memoria administrativa</legend>"));
  assert.ok(fieldset.indexOf("data-assistant-levels") > 0 && fieldset.indexOf("data-assistant-levels") < fieldset.indexOf('name="attention_objective"'), "las tarjetas van al INICIO del paso");
  for (const n of [1, 2, 3]) assert.ok(fieldset.includes(`data-level-card="${n}"`), `tarjeta ${n}`);
  assert.ok(!fieldset.includes('data-level-card="4"'), "ya no hay nivel 4");
  for (const nombre of ["Informativo", "Citas y precios", "Acompañamiento"]) assert.ok(fieldset.includes(`<strong>${nombre}</strong>`), nombre);
  assert.match(fieldset, /<option value="1">1 · Informativo<\/option><option value="2">2 · Citas y precios<\/option><option value="3">3 · Acompañamiento<\/option>/);
  assert.ok(!/Solo bienvenida|Gestión administrativa confirmada/.test(fieldset), "etiquetas antiguas fuera");
  assert.match(fieldset, /role="radiogroup"/);
  assert.match(fieldset, /role="radio" aria-checked="false" data-level-card="1"/);
  assert.match(fieldset, /desde \$X, sujeto a valoración/);
});

test("la capacitación guarda y carga el nivel: vacío = 1, el 4 del esquema anterior = 3, y se repinta al cargar", () => {
  assert.match(conn, /form\.elements\.autonomy_level\.value = String\(Math\.min\(3, Math\.max\(1, Math\.floor\(Number\(training\.autonomy_level\)\) \|\| 1\)\)\);\n    renderAssistantLevels\(\);/);
  assert.match(conn, /autonomy_level: Number\(form\.elements\.autonomy_level\.value\)/);
  // El nivel elegido marca el borrador como modificado (autoguardado) disparando `input` sobre el select.
  assert.match(conn, /select\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test("el chip del nivel vive en la barra de estado, lleva al paso 5 y las tarjetas se manejan con flechas y se deshabilitan sin permiso", () => {
  const bar = conn.slice(conn.indexOf('<div class="connections-training-bar"'), conn.indexOf("<form data-lana-training-form"));
  assert.ok(bar.includes("data-assistant-level"));
  assert.match(conn, /event\.target\.closest\('\[data-assistant-level\]'\)\) goTrainingStep\(5\)/);
  assert.match(conn, /\['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'\]/);
  assert.match(conn, /if \(!select \|\| select\.disabled\) return;/, "sin permiso/conexión no se puede cambiar (renderStatus deshabilita los controles del formulario)");
  assert.match(conn, /LEVEL_NAMES = \{ 1: 'Informativo', 2: 'Citas y precios', 3: 'Acompañamiento' \}/);
  assert.match(conn, /Los precios de referencia salen de «Servicios confirmados»/);
});

test("estilos de las tarjetas: a todo el ancho, estado marcado, foco visible y una columna en celular; versiones y copia móvil", () => {
  assert.match(css, /\.assistant-levels\{grid-column:1\/-1;display:grid/);
  assert.match(css, /\.assistant-level\[aria-checked=true\]\{border-color:#313c83/);
  assert.match(css, /\.assistant-level:focus-visible/);
  assert.match(css, /@media\(max-width:760px\)\{\.connections-training \.assistant-levels-grid\{grid-template-columns:minmax\(0,1fr\)\}\}/);
  for (const f of ["smyl-connections.js", "smyl-navigation.css"]) assert.equal(read(`mobile/www/${f}`), read(f), f);
  for (const base of ["", "mobile/www/"]) {
    assert.match(read(`${base}app.html`), /smyl-connections\.js\?v=30&media=1/);
    assert.match(read(`${base}app.html`), /smyl-navigation\.css\?v=14/);
    assert.match(read(`${base}sw.js`), /smyl-connections\.js\?v=30&media=1/);
  }
});
