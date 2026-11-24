// smyl-asistente-layout: pantalla «SMYL Asistente» (Canales): barra de estado, pasos en una fila, interruptor dentro de la pestaña.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const conn = read("smyl-connections.js");
const nav = read("smyl-navigation.js");
const css = read("smyl-navigation.css");
const ia = read("smyl-ia-interruptor.js");

test("la barra de estado trae el chip de la IA, los canales y el acceso a la prueba, sin quitar los data-* que usa la lógica", () => {
  const bar = conn.slice(conn.indexOf('<div class="connections-training-bar"'), conn.indexOf("<form data-lana-training-form"));
  for (const sel of ["data-training-state", "data-training-version", "data-training-score", "data-assistant-ia", "data-assistant-channels", 'data-select-workspace="lab"']) {
    assert.ok(bar.includes(sel), `la barra debe conservar/traer ${sel}`);
  }
  assert.match(bar, /role="status"/);
});

test("el chip de la IA lee el resumen del interruptor, se oculta sin mensajería y abre/cierra la tarjeta", () => {
  const fn = conn.slice(conn.indexOf("function renderAssistantBar()"), conn.indexOf("function renderTrainingMeta()"));
  assert.match(fn, /SmylIaInterruptor\.summary/);
  assert.match(fn, /if \(!summary \|\| !summary\.available\) \{ chip\.hidden = true; return; \}/, "sin interruptor disponible el chip no se muestra");
  assert.match(fn, /summary\.apagada \|\| summary\.programada/, "se abre sola si la IA está apagada o programada");
  assert.match(conn, /event\.target\.closest\('\[data-assistant-ia\]'\)/);
  assert.match(conn, /smyl:ia-interruptor-changed/);
  // Se actualiza con el estado, los canales y la capacitación.
  assert.ok((conn.match(/renderAssistantBar\(\);/g) || []).length >= 4);
});

test("el módulo del interruptor expone un resumen sin datos internos y avisa cuando carga", () => {
  assert.match(ia, /function summary\(\)/);
  assert.match(ia, /summary: summary/);
  const fn = ia.slice(ia.indexOf("function summary()"), ia.indexOf("window.SmylIaInterruptor"));
  assert.doesNotMatch(fn, /motivo|cambiado|tenant/, "el resumen no expone motivo ni autor");
  assert.match(ia, /renderBanner\(\);\n    window\.dispatchEvent\(new CustomEvent\('smyl:ia-interruptor-changed'\)\);/);
});

test("la pestaña del asistente aloja el interruptor plegado y el encabezado repetido se oculta en ella", () => {
  assert.match(nav, /trainingBar\.after\(iaSlot\)/);
  assert.match(nav, /iaSlot\.hidden = true/);
  assert.match(nav, /shell\.dataset\.connectionsActive = name;/);
  assert.match(css, /\.connections-shell\[data-connections-active=assistant\] \.connections-hero\{display:none\}/);
  // El slot literal sigue en el markup (lo monta smyl-ia-interruptor.js).
  assert.match(conn, /<div data-ia-interruptor-slot><\/div>/);
});

test("pasos en una fila a todo el ancho y formulario en tarjeta; en celular los pasos se desplazan", () => {
  assert.match(css, /\.connections-train-steps\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /\.connections-workspace \.connections-training\.connections-pane\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:980px\)\{[\s\S]*overflow-x:auto/);
  assert.match(css, /\.connections-step-test\{display:none\}/, "la caja vacía de «Probar tu asistente» ya no se muestra (la prueba vive en su pestaña)");
  // Las reglas que la lógica necesita siguen intactas en el CSS base.
  const base = read("smyl-connections.css");
  assert.match(base, /\[data-lana-training-form\]:not\(\[data-step="6"\]\) \[data-validate-training\]/);
});

test("copia móvil y versiones de caché", () => {
  for (const f of ["smyl-connections.js", "smyl-navigation.js", "smyl-navigation.css", "smyl-ia-interruptor.js"]) assert.equal(read(`mobile/www/${f}`), read(f), f);
  for (const base of ["", "mobile/www/"]) {
    assert.match(read(`${base}app.html`), /smyl-navigation\.js\?v=34/);
    assert.match(read(`${base}app.html`), /smyl-navigation\.css\?v=15/);
    assert.match(read(`${base}sw.js`), /smyl-navigation\.js\?v=34/);
    assert.match(read(`${base}sw.js`), /smyl-connections\.js\?v=31&media=1/);
  }
});
