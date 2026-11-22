import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const inbox = read("smyl-inbox.js"), css = read("smyl-inbox.css"), app = read("app.html"), sw = read("sw.js");

test("«Sugerir horarios» se publica en web, PWA y móvil y carga el motor antes del Inbox", () => {
  assert.ok(app.indexOf("smyl-schedule-suggest.js") > 0 && app.indexOf("smyl-schedule-suggest.js") < app.indexOf("smyl-inbox.js"));
  assert.match(sw, /\/camila\/smyl-schedule-suggest\.js\?v=1/);
  for (const f of ["smyl-schedule-suggest.js", "smyl-inbox.js", "smyl-inbox.css", "app.html", "sw.js"]) {
    assert.ok(existsSync(new URL("../mobile/www/" + f, import.meta.url)), "falta mobile/www/" + f);
    assert.equal(read("mobile/www/" + f), read(f), "mobile/www/" + f + " no coincide");
  }
});

test("la sugerencia solo ordena lo que calculó el servidor y respeta el permiso de mensajes", () => {
  const block = inbox.slice(inbox.indexOf("function suggestHost()"), inbox.indexOf("function prepareAvailabilityOptions()"));
  assert.match(block, /fetchDay\(from, to\)/);                       // los horarios salen de la consulta real de disponibilidad
  assert.match(block, /SmylScheduleSuggest\.suggest\(/);
  assert.match(block, /canOperate\(selectedConversation\(\), 'messages\.respond'\)/);
  assert.doesNotMatch(block, /request\('POST'/);                       // sugerir nunca escribe datos
  assert.match(block, /prepareAvailabilityOptions\(\)/);                // el mensaje queda en el compositor, nunca se envía solo
  assert.doesNotMatch(block, /action: 'send'/);
});

test("la sección tiene estilos responsivos y no depende de un ancho fijo", () => {
  assert.match(css, /\.smyl-inbox-availability-suggest\b/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*smyl-suggest-list li \{ grid-template-columns: 28px 1fr/);
});
