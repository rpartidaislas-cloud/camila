// Al enviar la confirmación al profesional por WhatsApp, un error de la función debe mostrar el MOTIVO real (p. ej. «El profesional todavía no vinculó su conversación…»),
// no el genérico «Edge Function returned a non-2xx status code» de supabase-js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

function cargar(invoke) {
  const src = read("smyl-schedule.js");
  const a = src.indexOf("async function functionErrorMessage"), b = src.indexOf("return result.data||{};}", a) + "return result.data||{};}".length;
  assert.ok(a > 0 && b > a, "se encontraron las funciones");
  return new Function("window", `${src.slice(a, b)}; return { dispatchNegotiation, functionErrorMessage };`)({ sb: { functions: { invoke } } });
}
const respuesta = (cuerpo) => ({ json: async () => cuerpo });

test("el motivo real del cuerpo de la respuesta llega a la pantalla", async () => {
  const { dispatchNegotiation } = cargar(async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: respuesta({ error: "El profesional todavía no vinculó su conversación de WhatsApp en Mensajes." }) } }));
  await assert.rejects(() => dispatchNegotiation("n1", "professional"), /El profesional todavía no vinculó su conversación de WhatsApp en Mensajes\./);
});

test("sin cuerpo legible se conserva el mensaje original, y el éxito y los errores dentro de data no cambian", async () => {
  const mensaje = async (promesa) => { try { await promesa; } catch (e) { return String((e && e.message) || e); } return null; };
  const ilegible = cargar(async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => { throw new Error("no json"); } } } }));
  assert.match(await mensaje(ilegible.dispatchNegotiation("n1", "professional")), /non-2xx status code/);
  const sinContexto = cargar(async () => ({ data: null, error: { message: "boom" } }));
  assert.equal(await mensaje(sinContexto.dispatchNegotiation("n1", "professional")), "boom");
  const vacio = cargar(async () => ({ data: null, error: { message: "x", context: respuesta({ error: "   " }) } }));
  assert.equal(await mensaje(vacio.dispatchNegotiation("n1", "professional")), "x");
  const ok = cargar(async () => ({ data: { ok: true, status: "sent" }, error: null }));
  assert.deepEqual(await ok.dispatchNegotiation("n1", "professional"), { ok: true, status: "sent" });
  const enData = cargar(async () => ({ data: { error: "La propuesta venció." }, error: null }));
  assert.equal(await mensaje(enData.dispatchNegotiation("n1", "patient")), "La propuesta venció.");
});

test("la versión del script está sincronizada en web y móvil", () => {
  for (const base of ["", "mobile/www/"]) {
    assert.match(read(`${base}app.html`), /smyl-schedule\.js\?v=63/); assert.match(read(`${base}sw.js`), /smyl-schedule\.js\?v=63/);
    assert.match(read(`${base}sw.js`), /agenda-error-envio-visible-v1/);
  }
  assert.equal(read("mobile/www/smyl-schedule.js"), read("smyl-schedule.js"));
});
