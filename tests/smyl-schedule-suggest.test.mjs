import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("../smyl-schedule-suggest.js");

const TZ = "America/Mexico_City"; // UTC-6 en estas fechas (sin horario de verano)
const NOW = new Date("2026-11-23T14:00:00Z"); // 08:00 hora local
// Crea un horario a la hora LOCAL de la sucursal (mexico = UTC-6).
function slot(day, hour, extra = {}) {
  const utc = new Date(Date.UTC(2026, 10, day, hour + 6, 0, 0)).toISOString();
  return { service_id: "s1", branch_id: "centro", branch_name: "Centro", professional_id: "p1", professional_name: "Dra. Ana", starts_at: utc, timezone: TZ, ...extra };
}
const hours = (r) => r.options.map((o) => S.localParts(o.slot.starts_at, TZ).hour);
const days = (r) => r.options.map((o) => S.localParts(o.slot.starts_at, TZ).day);

test("elige tres opciones: primer espacio, otra franja en otro día y un tercer día, en orden cronológico", () => {
  const slots = [slot(23, 10), slot(23, 11), slot(23, 16), slot(24, 9), slot(24, 17), slot(25, 10), slot(26, 12)];
  const r = S.suggest(slots, { now: NOW });
  assert.equal(r.options.length, 3);
  assert.equal(r.reason, "ok");
  assert.deepEqual(r.options.map((o) => o.tag), ["Primer espacio libre", "Por la tarde", "Otro día"]);
  assert.deepEqual(days(r), ["2026-11-23", "2026-11-24", "2026-11-25"]);
  assert.deepEqual(hours(r), [10, 17, 10]);
  const starts = r.options.map((o) => new Date(o.slot.starts_at).getTime());
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test("no ofrece horarios pasados ni con menos de una hora de anticipación", () => {
  const slots = [slot(23, 7), slot(23, 8), slot(23, 8, { starts_at: new Date(NOW.getTime() + 30 * 60000).toISOString() }), slot(23, 10), slot(24, 10)];
  const r = S.suggest(slots, { now: NOW, minLeadMinutes: 60 });
  assert.ok(r.options.every((o) => new Date(o.slot.starts_at).getTime() >= NOW.getTime() + 3600000));
  assert.equal(r.options[0].slot.starts_at, slot(23, 10).starts_at);
  const sinMargen = S.suggest([slot(23, 8, { starts_at: new Date(NOW.getTime() + 30 * 60000).toISOString() })], { now: NOW, minLeadMinutes: 0 });
  assert.equal(sinMargen.options.length, 1);
});

test("usa una sola sucursal: la pedida o la del primer espacio libre", () => {
  const slots = [slot(23, 10, { branch_id: "plaza", branch_name: "Plaza" }), slot(23, 11), slot(24, 10), slot(25, 10), slot(24, 10, { branch_id: "plaza", branch_name: "Plaza" })];
  const auto = S.suggest(slots, { now: NOW });
  assert.ok(auto.options.every((o) => o.slot.branch_id === "plaza"));
  assert.equal(auto.other_branches, true);
  const pedida = S.suggest(slots, { now: NOW, branchId: "centro" });
  assert.ok(pedida.options.every((o) => o.slot.branch_id === "centro"));
  assert.equal(pedida.other_branches, false);
});

test("prefiere a su profesional de continuidad si cae dentro de 72 horas del primer espacio", () => {
  const slots = [slot(23, 10, { professional_id: "p2", professional_name: "Dr. Beto" }), slot(24, 11, { professional_id: "p1" }), slot(25, 10), slot(26, 10)];
  const r = S.suggest(slots, { now: NOW, preferredProfessionalId: "p1" });
  const primera = r.options.find((o) => o.rank === 1);          // la opción 1 se elige por continuidad…
  assert.equal(primera.slot.professional_id, "p1");
  assert.equal(primera.tag, "Con su profesional");
  assert.equal(r.options[0].slot.professional_id, "p2");          // …y el primer espacio libre sigue incluido, en orden cronológico
  // fuera de la ventana de 72 h se conserva el primer espacio libre
  const lejos = S.suggest([slot(23, 10, { professional_id: "p2" }), slot(28, 11, { professional_id: "p1" })], { now: NOW, preferredProfessionalId: "p1" });
  assert.equal(lejos.options[0].slot.professional_id, "p2");
});

test("si solo hay un día, usa el mismo día con 3 horas de distancia y avisa que son pocas", () => {
  const slots = [slot(23, 10), slot(23, 11), slot(23, 12), slot(23, 14)];
  const r = S.suggest(slots, { now: NOW });
  assert.equal(r.options[0].tag, "Primer espacio libre");
  assert.ok(r.options.length >= 2);
  assert.ok(hours(r).every((h, i, a) => i === 0 || h - a[i - 1] >= 2));
});

test("sin espacios: reason none y mensaje claro; con pocos: reason few", () => {
  const vacio = S.suggest([], { now: NOW });
  assert.equal(vacio.reason, "none");
  assert.match(S.describe(vacio, "en los próximos 7 días"), /No hay espacios libres en los próximos 7 días/);
  const poco = S.suggest([slot(24, 10)], { now: NOW });
  assert.equal(poco.reason, "few");
  assert.match(S.describe(poco), /Solo encontré 1 espacio/);
  assert.equal(S.describe(S.suggest([slot(23, 10), slot(24, 15), slot(25, 10)], { now: NOW })), "");
});

test("«Otras opciones»: excluir lo ya mostrado devuelve otro conjunto sin repetir", () => {
  const slots = [];
  for (let d = 23; d <= 30; d += 1) { slots.push(slot(d, 10), slot(d, 16)); }
  const a = S.suggest(slots, { now: NOW });
  const b = S.suggest(slots, { now: NOW, exclude: a.options.map((o) => o.key) });
  const claves = new Set(a.options.map((o) => o.key));
  assert.ok(b.options.length === 3);
  assert.ok(b.options.every((o) => !claves.has(o.key)));
});

test("la franja del día se calcula en la zona de la sucursal, no en la del navegador", () => {
  // 22:30 UTC = 16:30 en Ciudad de México (tarde) aunque en UTC sea de noche.
  const tarde = { ...slot(24, 16), starts_at: "2026-11-24T22:30:00.000Z" };
  assert.equal(S.localParts(tarde.starts_at, TZ).hour, 16);
  // una zona inválida no rompe: cae a la del navegador
  assert.doesNotThrow(() => S.localParts(tarde.starts_at, "Zona/Inventada"));
  const r = S.suggest([slot(23, 10), tarde, slot(25, 10)], { now: NOW });
  assert.equal(r.options[1].tag, "Por la tarde");
});

test("el filtro de profesional y los datos inválidos no rompen el motor", () => {
  const slots = [null, {}, { starts_at: "no-es-fecha" }, slot(24, 10, { professional_id: "p9" }), slot(25, 10, { professional_id: "p1" })];
  const r = S.suggest(slots, { now: NOW, professionalId: "p1" });
  assert.equal(r.options.length, 1);
  assert.equal(r.options[0].slot.professional_id, "p1");
  assert.equal(S.suggest(undefined, {}).reason, "none");
  assert.equal(S.suggest([slot(30, 10)], { now: NOW, limit: 9 }).options.length, 1);
});
