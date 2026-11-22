import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const W = require("../smyl-waitlist-core.js");

const TZ = "America/Mexico_City"; // UTC-6 en estas fechas
const NOW = new Date("2026-11-23T14:00:00Z"); // 08:00 hora local
const slotAt = (day, hour, extra = {}) => ({
  starts_at: new Date(Date.UTC(2026, 10, day, hour + 6)).toISOString(), ends_at: new Date(Date.UTC(2026, 10, day, hour + 7)).toISOString(),
  branch_id: "centro", professional_id: "p1", service_id: "s1", timezone: TZ, ...extra,
});
const entry = (id, extra = {}) => ({ id, service_id: "s1", branch_id: null, professional_id: null, daypart: "any", not_before: null, not_after: null, priority: "normal", status: "waiting", created_at: "2026-11-20T10:00:00Z", expires_at: "2027-01-20T10:00:00Z", ...extra });
const ids = (r) => r.map((x) => x.entry.id);

test("encaja por servicio exacto y respeta sucursal y profesional pedidos", () => {
  const slot = slotAt(25, 10);
  const r = W.matches([entry("a"), entry("b", { branch_id: "plaza" }), entry("c", { professional_id: "p2" }), entry("d", { service_id: "otro" }), entry("e", { branch_id: "centro", professional_id: "p1" })], slot, { now: NOW });
  assert.deepEqual(ids(r).sort(), ["a", "e"]);
});

test("un servicio más corto del mismo profesional cabe en el hueco; uno más largo no", () => {
  const slot = slotAt(25, 10); // hueco de 60 min
  const ctx = { now: NOW, durations: { corto: 30, largo: 90 }, professionalServices: [{ professional_id: "p1", service_id: "corto" }, { professional_id: "p1", service_id: "largo" }] };
  const r = W.matches([entry("a", { service_id: "corto" }), entry("b", { service_id: "largo" })], slot, ctx);
  assert.deepEqual(ids(r), ["a"]);
  assert.equal(r[0].fit, "shorter");
  // el profesional del hueco no hace ese servicio → no encaja
  assert.deepEqual(ids(W.matches([entry("a", { service_id: "corto" })], slot, { ...ctx, professionalServices: [] })), []);
});

test("franja del día y ventana de fechas se evalúan en la zona de la sucursal", () => {
  const manana = slotAt(25, 10), tarde = slotAt(25, 16);
  const e = [entry("m", { daypart: "morning" }), entry("t", { daypart: "afternoon" }), entry("x")];
  assert.deepEqual(ids(W.matches(e, manana, { now: NOW })).sort(), ["m", "x"]);
  assert.deepEqual(ids(W.matches(e, tarde, { now: NOW })).sort(), ["t", "x"]);
  const ventana = [entry("a", { not_before: "2026-11-26" }), entry("b", { not_after: "2026-11-24" }), entry("c", { not_before: "2026-11-25", not_after: "2026-11-25" })];
  assert.deepEqual(ids(W.matches(ventana, slotAt(25, 10), { now: NOW })), ["c"]);
  // 23:30 hora local del 25 ya es del 26 en UTC: el día que cuenta es el local
  const tardeNoche = { ...slotAt(25, 17), starts_at: "2026-11-26T05:30:00.000Z", ends_at: "2026-11-26T06:30:00.000Z" };
  assert.deepEqual(ids(W.matches([entry("a", { not_after: "2026-11-25" })], tardeNoche, { now: NOW })), ["a"]);
});

test("no ofrece huecos pasados ni con menos de una hora de anticipación", () => {
  const e = [entry("a")];
  assert.deepEqual(W.matches(e, slotAt(23, 8), { now: NOW }), []);                        // ya empezó
  assert.deepEqual(W.matches(e, slotAt(23, 8, { starts_at: new Date(NOW.getTime() + 30 * 60000).toISOString() }), { now: NOW }), []);
  assert.equal(W.matches(e, slotAt(23, 10), { now: NOW }).length, 1);
  assert.deepEqual(W.matches(e, undefined, { now: NOW }), []);
});

test("estados: no ofrece a quien ya agendó, canceló o venció; a quien ya tiene una oferta vigente tampoco", () => {
  const slot = slotAt(25, 10);
  const r = W.matches([
    entry("a", { status: "booked" }), entry("b", { status: "cancelled" }), entry("c", { status: "expired" }),
    entry("d", { expires_at: "2026-11-22T00:00:00Z" }),
    entry("e", { status: "offered", offered_at: new Date(NOW.getTime() - 30 * 60000).toISOString() }),       // ofrecida hace 30 min: aún puede contestar
    entry("f", { status: "offered", offered_at: new Date(NOW.getTime() - 3 * 3600000).toISOString() }),      // hace 3 h sin contestar: se vuelve a ofrecer
    entry("g"),
  ], slot, { now: NOW });
  assert.deepEqual(ids(r).sort(), ["f", "g"]);
  assert.equal(r.find((x) => x.entry.id === "f").reoffer, true);
  assert.ok(r.find((x) => x.entry.id === "f").reasons.includes("No contestó la oferta anterior"));
});

test("orden: urgentes, luego quien pidió profesional o sucursal, luego servicio exacto y por último quien lleva más esperando", () => {
  const slot = slotAt(25, 10);
  const r = W.matches([
    entry("viejo", { created_at: "2026-10-01T10:00:00Z" }),
    entry("nuevo", { created_at: "2026-11-22T10:00:00Z" }),
    entry("pidioProf", { professional_id: "p1", created_at: "2026-11-22T11:00:00Z" }),
    entry("urgente", { priority: "urgent", created_at: "2026-11-22T12:00:00Z" }),
    entry("pidioSede", { branch_id: "centro", created_at: "2026-11-22T13:00:00Z" }),
  ], slot, { now: NOW });
  assert.deepEqual(ids(r), ["urgente", "pidioProf", "pidioSede", "viejo", "nuevo"]);
  assert.ok(r[0].reasons.includes("Urgente"));
});

test("describe y waitingSince producen texto corto y claro", () => {
  const lookup = { service: () => "Valoración", branch: () => "Centro", professional: () => "Dra. Ana" };
  assert.equal(W.describe(entry("a", { branch_id: "centro", daypart: "afternoon", not_after: "2026-11-30" }), lookup), "Valoración · Centro · por la tarde · hasta 30 nov");
  assert.equal(W.describe(entry("a"), lookup), "Valoración · cualquier sucursal · cualquier horario");
  assert.match(W.describe(entry("a", { professional_id: "p1" }), lookup), /Dra\. Ana/);
  assert.equal(W.waitingSince({ created_at: "2026-11-20T14:00:00Z" }, NOW), "hace 3 días");
  assert.equal(W.waitingSince({ created_at: "2026-11-23T12:00:00Z" }, NOW), "hace 2 h");
  assert.equal(W.waitingSince({ created_at: "2026-11-23T13:59:30Z" }, NOW), "hace un momento");
});

test("el mensaje de oferta es corto, sin datos clínicos y no promete el horario", () => {
  const text = W.offerMessage({ firstName: "Ana", service: "Valoración dental", when: "Martes 25 de noviembre, 10:00 a. m.", professional: "Dra. Fernanda", branch: "Centro" });
  assert.match(text, /^Hola Ana, se liberó un horario para Valoración dental:/);
  assert.match(text, /Martes 25 de noviembre, 10:00 a\. m\./);
  assert.match(text, /Dra\. Fernanda · Centro/);
  assert.match(text, /Respóndeme «sí» y te lo aparto/);
  assert.match(text, /sigues en nuestra lista de espera/);
  assert.doesNotThrow(() => W.offerMessage());
});

test("datos inválidos o ausentes no rompen el motor", () => {
  assert.deepEqual(W.matches(null, slotAt(25, 10), { now: NOW }), []);
  assert.deepEqual(W.matches([null, {}, { service_id: "s1", status: "waiting" }], slotAt(25, 10), { now: NOW }).length, 1);
  assert.doesNotThrow(() => W.localParts("2026-11-25T16:00:00Z", "Zona/Inventada"));
});

test("variables de la plantilla «Se liberó un horario»: nombre, lugar, fecha y hora en la zona de la sucursal", () => {
  assert.equal(W.OFFER_TEMPLATE, "cita_lista_espera_v1");
  const v = W.templateVariables({ firstName: "Ana", place: "Clínica Centro", startsAt: "2026-11-25T16:00:00Z", timeZone: TZ });
  assert.equal(v.length, 4);
  assert.equal(v[0], "Ana");
  assert.equal(v[1], "Clínica Centro");
  assert.equal(v[2], "miércoles 25 de noviembre");           // minúsculas y sin coma: «para el miércoles 25 de noviembre»
  assert.match(v[3], /^10:00 a\. ?m\.$/);                      // 16:00 UTC = 10:00 en México
  // otra zona horaria cambia la hora y puede cambiar el día
  assert.equal(W.templateVariables({ startsAt: "2026-11-26T05:30:00Z", timeZone: TZ })[2], "miércoles 25 de noviembre");
  assert.equal(W.templateVariables({ startsAt: "2026-11-26T05:30:00Z", timeZone: "UTC" })[2], "jueves 26 de noviembre");
});

test("las variables de la plantilla nunca salen vacías ni rompen con datos ausentes", () => {
  const v = W.templateVariables({});
  assert.deepEqual(v.slice(0, 2), ["paciente", "la clínica"]);
  assert.doesNotThrow(() => W.templateVariables({ startsAt: "2026-11-25T16:00:00Z", timeZone: "Zona/Inventada" }));
  assert.equal(W.templateVariables({ firstName: "A\u0000na\nB" })[0], "A na B");
});

test("la plantilla existe en el catálogo con las mismas cuatro variables que se envían", () => {
  const catalog = require("../smyl-template-catalog.js");
  const t = catalog.TEMPLATES.find((x) => x.id === W.OFFER_TEMPLATE);
  assert.ok(t, "falta la plantilla en el catálogo");
  assert.equal(t.category, "UTILITY");
  assert.equal(t.variables.length, 4);
  assert.deepEqual(t.variables.map((x) => x.source), ["patient_first_name", "clinic", "date", "time"]);
  assert.match(t.body, /se liberó un horario en \{\{2\}\} para el \{\{3\}\} a las \{\{4\}\}/);
});
