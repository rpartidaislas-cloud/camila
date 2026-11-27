// El botón del mensaje dice la verdad: solo lo oculta en el panel (Meta no permite a un negocio borrar mensajes ya enviados en WhatsApp, Messenger o Instagram).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("el menú del mensaje dice «Ocultar en el panel» y el aviso nombra los tres canales", () => {
  const js = read("smyl-inbox.js");
  assert.match(js, /action\('Ocultar en el panel', function \(\) \{ mutateMessage\(item, 'delete'\); \}, 'is-danger'\)/);
  assert.doesNotMatch(js, /action\('Eliminar', function \(\) \{ mutateMessage/);
  assert.match(js, /NO se borra del teléfono del paciente ni de WhatsApp, Messenger o Instagram/);
  assert.match(js, /action === 'delete' && !window\.confirm\(/, "sigue pidiendo confirmación antes de ocultar");
});

test("la acción interna sigue siendo 'delete' (no cambia el contrato con camila-api) y la versión del script está sincronizada en web y móvil", () => {
  assert.match(read("smyl-inbox.js"), /action: action, conversation_id: conversation\.id, message_id: item\.id/);
  for (const base of ["", "mobile/www/"]) {
    assert.match(read(`${base}app.html`), /smyl-inbox\.js\?v=100&media=1/);
    assert.match(read(`${base}sw.js`), /smyl-inbox\.js\?v=100&media=1/);
    assert.match(read(`${base}sw.js`), /inbox-ocultar-mensaje-v1/);
  }
  assert.equal(read("mobile/www/smyl-inbox.js"), read("smyl-inbox.js"));
});
