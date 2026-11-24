// smyl-ia-interruptor: el interruptor de la IA de la clínica desde SMYL.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rolParaInterruptor, decidirAsistentePublico } from "../supabase/functions/_shared/ia-interruptor-clinica.mjs";
import { normalizeLanaPath } from "../supabase/functions/_shared/lana-contract.mjs";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("roles: el dueño y el perfil administrador pueden cambiarlo; el resto solo consulta", () => {
  assert.equal(rolParaInterruptor({ esDueno: true, codigosDeRol: [] }), "owner");
  assert.equal(rolParaInterruptor({ esDueno: false, codigosDeRol: ["administrador"] }), "admin");
  assert.equal(rolParaInterruptor({ esDueno: false, codigosDeRol: ["recepcion", "Administrador"] }), "admin");
  assert.equal(rolParaInterruptor({ esDueno: false, codigosDeRol: ["propietario"] }), "admin");
  for (const codigos of [[], ["recepcion"], ["finanzas"], ["profesional"], [""], [null], undefined, "administrador"]) {
    assert.equal(rolParaInterruptor({ esDueno: false, codigosDeRol: codigos }), null, JSON.stringify(codigos));
  }
  assert.equal(rolParaInterruptor({ esDueno: "true", codigosDeRol: [] }), null, "un valor no booleano no cuenta como dueño");
  assert.equal(rolParaInterruptor({}), null);
});

test("asistente público: calla si el negocio o la plataforma están apagados y falla CERRADO ante cualquier duda", () => {
  const ok = (negocio, global = { apagada: false }) => ({ vinculada: true, status: 200, body: { negocio, global } });
  assert.equal(decidirAsistentePublico(ok({ apagada: false })).apagada, false);
  assert.equal(decidirAsistentePublico(ok({ apagada: true })).apagada, true);
  assert.equal(decidirAsistentePublico(ok({ apagada: false }, { apagada: true })).apagada, true, "interruptor global");
  // Fallos: cerrado.
  for (const l of [{ vinculada: true, status: 500 }, { vinculada: true, status: 0 }, { vinculada: true, status: 401 }, { vinculada: true, status: 403 },
    { vinculada: true, status: 200, body: null }, { vinculada: true, status: 200, body: {} }, { vinculada: true, status: 200, body: { negocio: null } },
    ok({ apagada: "false" }), ok({ apagada: undefined }), ok({ apagada: 0 }), undefined, null, "x"]) {
    assert.equal(decidirAsistentePublico(l).apagada, true, JSON.stringify(l));
  }
  // Excepciones deliberadas: sin LANA vinculada o ruta todavía inexistente.
  assert.equal(decidirAsistentePublico({ vinculada: false }).apagada, false);
  assert.equal(decidirAsistentePublico({ vinculada: true, status: 404 }).apagada, false);
});

test("contrato: la raíz /ia está permitida y las demás siguen bloqueadas", () => {
  assert.equal(normalizeLanaPath("/ia/interruptor"), "/ia/interruptor");
  for (const mala of ["/admin/x", "/ia/../payments", "//ia/interruptor", "/iaa/interruptor", "ia/interruptor"]) {
    assert.throws(() => normalizeLanaPath(mala), undefined, mala);
  }
});

test("la función puente exige sesión, deja consultar a todos y solo el dueño o administrador cambia", () => {
  const edge = read("supabase/functions/lana-ia-interruptor/index.ts");
  assert.match(edge, /requireUser\(req, CORS\)/);
  assert.match(edge, /rolInterruptorDe\(auth\.user\.id, auth\.tenantId\)/);
  assert.match(edge, /if \(!rol\) return json\(403/);
  assert.match(edge, /"X-SMYL-Actor-Role": rol \|\| "staff"/);
  assert.match(edge, /"X-SMYL-Actor-Id": auth\.user\.id/);
  assert.match(edge, /lanaRequest\(auth\.tenantId, "\/ia\/interruptor"/);
  assert.match(edge, /can_manage: rol !== null/);
  assert.doesNotMatch(edge, /body\.tenant_id|tenantId:\s*body/, "el negocio sale de la sesión, nunca del cuerpo");
  // El 403 va ANTES de leer el cuerpo y de llamar a LANA en el PUT.
  assert.ok(edge.indexOf("if (!rol) return json(403") < edge.indexOf('method: "PUT"'));
  const resolver = read("supabase/functions/_shared/ia-interruptor-clinica.ts");
  assert.match(resolver, /smyl_member_roles/);
  assert.match(resolver, /system_role === true/);
  assert.match(resolver, /activo === false\) return null/);
});

test("el asistente del perfil público se consulta al interruptor ANTES de llamar al modelo", () => {
  const src = read("supabase/functions/public-profile-assistant/index.ts");
  assert.match(src, /import \{ asistentePublicoApagado \} from "\.\.\/_shared\/ia-interruptor-clinica\.ts";/);
  const guard = src.indexOf("await asistentePublicoApagado(p.tenant_id)");
  assert.ok(guard > 0 && guard < src.indexOf("client.messages.create"), "antes de la llamada a Anthropic");
  assert.ok(guard > src.indexOf("profileRow.professional_id"), "después de resolver la clínica del perfil");
  assert.match(src, /return json\(503, \{ error: "El asistente no está disponible por ahora\. Puedes escribir a la clínica directamente\."/);
});

test("el aviso y la tarjeta se cargan en la app y en la versión móvil, sin tocar la IA interna del personal", () => {
  for (const base of ["", "mobile/www/"]) {
    const app = read(`${base}app.html`);
    assert.match(app, /smyl-ia-interruptor\.css\?v=1/);
    assert.match(app, /smyl-ia-interruptor\.js\?v=1/);
    assert.equal(read(`${base}smyl-ia-interruptor.js`), read("smyl-ia-interruptor.js"), `${base} sincronizado`);
    assert.equal(read(`${base}smyl-connections.js`), read("smyl-connections.js"));
  }
  assert.match(read("smyl-connections.js"), /<div data-ia-interruptor-slot><\/div>/);
  assert.match(read("smyl-connections.js"), /SmylIaInterruptor\.mount\(/);
  assert.match(read("sw.js"), /smyl-ia-interruptor\.js\?v=1/);
  assert.match(read("sw.js"), /smyl-ia-interruptor\.css\?v=1/);
  assert.match(read("mobile/scripts/sync-web.js"), /smyl-ia-interruptor\.js/);
  const ui = read("smyl-ia-interruptor.js");
  assert.match(ui, /lana-ia-interruptor/);
  assert.match(ui, /window\.confirm\(message\)/);
  assert.match(ui, /type = 'datetime-local'/);
  assert.match(ui, /Solo el dueño o un administrador de la clínica puede cambiarlo/);
  assert.doesNotMatch(ui, /\btenant_id\b/, "la interfaz no manda ni lee el negocio");
});

// La conversión de fechas de la tarjeta (zona de la clínica → UTC) se ejecuta de verdad.
const ui = read("smyl-ia-interruptor.js");
const fechas = new Function(ui.slice(ui.indexOf("function offsetMs"), ui.indexOf("function pretty")) + "\nreturn { localToIso, isoToLocal };")();

test("fechas: hora de pared de la clínica → UTC, con ida y vuelta y entradas inválidas", () => {
  assert.equal(fechas.localToIso("2026-12-24T18:00", "America/Mexico_City"), "2026-12-25T00:00:00.000Z");
  assert.equal(fechas.localToIso("2026-07-01T09:00", "America/New_York"), "2026-07-01T13:00:00.000Z");
  assert.equal(fechas.isoToLocal(Date.parse("2026-12-25T00:00:00Z"), "America/Mexico_City"), "2026-12-24T18:00");
  for (const mala of ["", "mañana", "2026-12-24", null, undefined]) assert.equal(fechas.localToIso(mala, "America/Mexico_City"), null, String(mala));
});
