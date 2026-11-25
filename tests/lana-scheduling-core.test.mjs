import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manejar, firmaValida, hmacHex, etiquetaLocal, CONTRACT_VERSION, MAX_REQUESTS_PER_MINUTE, PAGE_SIZE } from "../supabase/functions/_shared/lana-scheduling-core.mjs";

const SECRET = "s".repeat(40);
const T = "11111111-1111-4111-8111-111111111111", CONV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SVC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", SVC2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", SVC_OFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const P1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1", P2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const TZ = "America/Mexico_City";
const NOW = new Date("2026-11-23T14:00:00.000Z"); // 08:00 en México
const HOUR = 3600000;

const branch = (id, name, extra = {}) => ({ id, name, timezone: TZ, address_line: "Av. Juárez 120", city: "Zapopan", state: "Jalisco", postal_code: "45050", phone: "33 1234 5678", ...extra });
// Horario a la hora LOCAL de México (UTC-6) del día `day` de noviembre de 2026.
const slot = (day, hour, extra = {}) => {
  const start = new Date(Date.UTC(2026, 10, day, hour + 6));
  return { service_id: SVC, branch_id: B1, branch_name: "Centro", timezone: TZ, professional_id: P1, professional_name: "Dra. Fernanda", service_name: "Valoración", starts_at: start.toISOString(), ends_at: new Date(start.getTime() + HOUR).toISOString(), ...extra };
};
function makeDeps(over = {}) {
  const calls = { slots: [], logs: [] };
  const deps = {
    allow: async () => true,
    settings: async () => ({ level: "suggest", min_lead_hours: 2, horizon_days: 14 }),
    branches: async () => [branch(B1, "Centro")],
    services: async () => [{ id: SVC, name: "Valoración", duration_minutes: 60 }, { id: SVC2, name: "Limpieza", duration_minutes: 45 }],
    conversationBranch: async () => null,
    slots: async (q) => { calls.slots.push(q); return [slot(24, 10), slot(24, 16), slot(25, 10), slot(26, 11)]; },
    log: async (e) => { calls.logs.push(e); },
    ...over,
  };
  return { deps, calls };
}
async function call(body, { deps, now = NOW, secret = SECRET, sign = true, signature } = {}) {
  const payload = { contract_version: CONTRACT_VERSION, tenant_id: T, conversation_id: CONV, occurred_at: now.toISOString(), ...body };
  const raw = JSON.stringify(payload);
  const sig = signature !== undefined ? signature : sign ? `sha256=${await hmacHex(SECRET, raw)}` : null;
  return manejar({ raw, signature: sig, now, secret, deps: (deps || makeDeps().deps) });
}

test("firma: sin firma, firma falsa, cuerpo alterado, secreto corto o ausente → no pasa nada", async () => {
  assert.equal((await call({ action: "context" }, { sign: false })).status, 403);
  assert.equal((await call({ action: "context" }, { signature: "sha256=" + "0".repeat(64) })).status, 403);
  const raw = JSON.stringify({ contract_version: 1, action: "context", tenant_id: T, conversation_id: CONV, occurred_at: NOW.toISOString() });
  const sig = `sha256=${await hmacHex(SECRET, raw)}`;
  assert.equal((await manejar({ raw: raw.replace(T, "22222222-2222-4222-8222-222222222222"), signature: sig, now: NOW, secret: SECRET, deps: makeDeps().deps })).status, 403);
  assert.equal((await manejar({ raw, signature: sig, now: NOW, secret: "corto", deps: makeDeps().deps })).status, 503);
  assert.equal((await manejar({ raw, signature: sig, now: NOW, secret: "", deps: makeDeps().deps })).status, 503);
  assert.equal(await firmaValida(SECRET, "x", undefined), false);
  assert.equal((await manejar({ raw, signature: sig, now: NOW, secret: SECRET, deps: makeDeps().deps })).status, 200);
});

test("solicitud: contrato, acción, UUID y reloj se validan antes de consultar nada", async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await call({ contract_version: 2, action: "context" }, { deps })).status, 400);
  assert.equal((await call({ action: "book" }, { deps })).status, 400);
  assert.equal((await call({ action: "context", tenant_id: "no-uuid" }, { deps })).status, 400);
  const viejo = await call({ action: "context", occurred_at: new Date(NOW.getTime() - 10 * 60000).toISOString() }, { deps });
  assert.equal(viejo.status, 400); assert.equal(viejo.body.error, "expired_request");
  assert.equal(calls.slots.length, 0);
});

test("apagado por defecto: context avisa enabled:false y suggest se rechaza con 403", async () => {
  for (const settings of [async () => null, async () => ({ level: "off", min_lead_hours: 2, horizon_days: 14 })]) {
    const { deps, calls } = makeDeps({ settings });
    const ctx = await call({ action: "context" }, { deps });
    assert.equal(ctx.status, 200); assert.equal(ctx.body.enabled, false); assert.equal("services" in ctx.body, false);
    const sug = await call({ action: "suggest", service_id: SVC }, { deps });
    assert.equal(sug.status, 403); assert.equal(sug.body.error, "disabled");
    assert.equal(calls.slots.length, 0, "apagado no consulta la agenda");
  }
});

test("context: sucursal única, asignada, sin asignar y sin sucursales; solo servicios permitidos", async () => {
  let r = await call({ action: "context" });
  assert.equal(r.body.status, "single_branch"); assert.equal(r.body.branch.name, "Centro");
  assert.equal(r.body.branch.address, "Av. Juárez 120, Zapopan, Jalisco, 45050");
  assert.deepEqual(r.body.services.map((s) => s.name), ["Valoración", "Limpieza"]);
  assert.deepEqual(r.body.policy, { min_lead_hours: 2, horizon_days: 14, max_options: 3 });
  const two = async () => [branch(B1, "Centro"), branch(B2, "Plaza Sol")];
  r = await call({ action: "context" }, { deps: makeDeps({ branches: two }).deps });
  assert.equal(r.body.status, "unassigned"); assert.equal(r.body.branch, null); assert.equal(r.body.branches.length, 2);
  r = await call({ action: "context" }, { deps: makeDeps({ branches: two, conversationBranch: async () => ({ branch_id: B2, source: "manual" }) }).deps });
  assert.equal(r.body.status, "assigned"); assert.equal(r.body.branch.name, "Plaza Sol");
  r = await call({ action: "context" }, { deps: makeDeps({ branches: two, conversationBranch: async () => ({ branch_id: "otra", source: "ai" }) }).deps });
  assert.equal(r.body.status, "unassigned");   // una asignación a una sucursal que ya no existe no cuenta
  r = await call({ action: "context" }, { deps: makeDeps({ branches: async () => [] }).deps });
  assert.equal(r.body.status, "not_applicable");
});

test("suggest: tres opciones ordenadas, con etiqueta local, profesional, sucursal y un texto listo para mostrar", async () => {
  const { deps, calls } = makeDeps();
  const r = await call({ action: "suggest", service_id: SVC }, { deps });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.status, "ok");
  assert.equal(r.body.options.length, 3);
  assert.deepEqual(r.body.options.map((o) => o.index), [1, 2, 3]);
  assert.equal(r.body.options[0].tag, "Primer espacio libre");
  assert.equal(r.body.options[0].local_label, "Martes 24 de noviembre, 10:00 a. m.");
  assert.equal(r.body.options[0].professional_name, "Dra. Fernanda");
  const starts = r.body.options.map((o) => new Date(o.starts_at).getTime());
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.match(r.body.message_hint, /^Estas son las opciones disponibles en Centro:\n1\) Martes 24 de noviembre, 10:00 a\. m\. con Dra\. Fernanda\n2\) /);
  assert.match(r.body.message_hint, /Responde con el número que prefieras\.$/);
  assert.equal(r.body.next_step, "present_options");
  assert.equal(calls.slots[0].branchId, B1);
  assert.equal(calls.slots[0].limit, PAGE_SIZE);
});

test("suggest respeta la anticipación mínima y el horizonte que fijó la clínica", async () => {
  const { deps, calls } = makeDeps({ settings: async () => ({ level: "suggest", min_lead_hours: 24, horizon_days: 5 }) });
  await call({ action: "suggest", service_id: SVC }, { deps });
  const q = calls.slots[0];
  assert.equal(q.from, new Date(NOW.getTime() + 24 * HOUR).toISOString());
  assert.equal(q.to, new Date(NOW.getTime() + 5 * 24 * HOUR).toISOString());
  // pedir un periodo más amplio no rebasa el horizonte; uno ya pasado se rechaza
  await call({ action: "suggest", service_id: SVC, from: NOW.toISOString(), to: new Date(NOW.getTime() + 90 * 24 * HOUR).toISOString() }, { deps });
  assert.equal(calls.slots[1].to, new Date(NOW.getTime() + 5 * 24 * HOUR).toISOString());
  const bad = await call({ action: "suggest", service_id: SVC, from: new Date(NOW.getTime() + 20 * 24 * HOUR).toISOString() }, { deps });
  assert.equal(bad.status, 400); assert.equal(bad.body.error, "invalid_period");
  assert.equal((await call({ action: "suggest", service_id: SVC, from: "nada" }, { deps })).status, 400);
});

test("suggest: un servicio no habilitado o inventado se rechaza sin consultar la agenda", async () => {
  const { deps, calls } = makeDeps();
  let r = await call({ action: "suggest", service_id: SVC_OFF }, { deps });
  assert.equal(r.status, 403); assert.equal(r.body.error, "service_not_allowed");
  r = await call({ action: "suggest", service_id: "no-uuid" }, { deps });
  assert.equal(r.status, 400);
  r = await call({ action: "suggest" }, { deps });
  assert.equal(r.status, 400);
  assert.equal(calls.slots.length, 0);
});

test("suggest con varias sucursales: usa la de la conversación; si no hay, pide preguntar; una inexistente se rechaza", async () => {
  const two = async () => [branch(B1, "Centro"), branch(B2, "Plaza Sol")];
  let { deps, calls } = makeDeps({ branches: two });
  let r = await call({ action: "suggest", service_id: SVC }, { deps });
  assert.equal(r.status, 409); assert.equal(r.body.error, "branch_required");
  assert.deepEqual(r.body.branches.map((b) => b.name), ["Centro", "Plaza Sol"]);
  assert.equal(calls.slots.length, 0);
  ({ deps, calls } = makeDeps({ branches: two, conversationBranch: async () => ({ branch_id: B2, source: "ai" }), slots: async (q) => { calls.slots.push(q); return [slot(24, 10, { branch_id: B2, branch_name: "Plaza Sol" }), slot(25, 16, { branch_id: B2, branch_name: "Plaza Sol" }), slot(26, 10, { branch_id: B2, branch_name: "Plaza Sol" })]; } }));
  r = await call({ action: "suggest", service_id: SVC }, { deps });
  assert.equal(calls.slots[0].branchId, B2); assert.ok(r.body.options.every((o) => o.branch_id === B2));
  r = await call({ action: "suggest", service_id: SVC, branch_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb99" }, { deps });
  assert.equal(r.status, 404); assert.equal(r.body.error, "branch_not_found");
  r = await call({ action: "suggest", service_id: SVC, branch_id: B1 }, { deps });   // pedir otra sucursal explícitamente sí se puede
  assert.equal(calls.slots.at(-1).branchId, B1);
});

test("«Otras opciones» (exclude) y el profesional de continuidad llegan al motor", async () => {
  const many = [];
  for (let d = 24; d <= 30; d += 1) many.push(slot(d, 10), slot(d, 16, { professional_id: P2, professional_name: "Dr. Andrés" }));
  const { deps } = makeDeps({ slots: async () => many });
  const a = await call({ action: "suggest", service_id: SVC }, { deps });
  const b = await call({ action: "suggest", service_id: SVC, exclude: a.body.options.map((o) => o.key) }, { deps });
  const shown = new Set(a.body.options.map((o) => o.key));
  assert.equal(b.body.options.length, 3); assert.ok(b.body.options.every((o) => !shown.has(o.key)));
  const c = await call({ action: "suggest", service_id: SVC, preferred_professional_id: P2 }, { deps });
  assert.equal(c.body.options.find((o) => o.tag === "Con su profesional").professional_id, P2);
  assert.equal((await call({ action: "suggest", service_id: SVC, professional_id: "x" }, { deps })).status, 400);
});

test("sin espacios o con pocos: lo explica y sugiere el siguiente paso", async () => {
  let r = await call({ action: "suggest", service_id: SVC }, { deps: makeDeps({ slots: async () => [] }).deps });
  assert.equal(r.body.status, "none"); assert.deepEqual(r.body.options, []); assert.equal(r.body.message_hint, "");
  assert.match(r.body.explanation, /No hay espacios libres en los próximos 14 días/);
  assert.equal(r.body.next_step, "widen_period_or_other_branch_or_waitlist");
  r = await call({ action: "suggest", service_id: SVC }, { deps: makeDeps({ slots: async () => [slot(25, 10)] }).deps });
  assert.equal(r.body.status, "few"); assert.equal(r.body.options.length, 1);
  assert.match(r.body.explanation, /Solo encontré 1 espacio/);
});

test("pagina la agenda de 30 en 30 hasta tener variedad y no repite horarios", async () => {
  const day = (d) => Array.from({ length: PAGE_SIZE }, (_, i) => slot(d, 8 + (i % 9), { professional_id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}` }));
  const pages = [day(24), day(25).concat(), day(26)];
  let n = 0; const { deps, calls } = makeDeps({ slots: async (q) => { calls.slots.push(q); return pages[n++] || []; } });
  const r = await call({ action: "suggest", service_id: SVC }, { deps });
  assert.equal(r.body.options.length, 3);
  assert.ok(calls.slots.length >= 2 && calls.slots.length <= 6);
  const days = new Set(r.body.options.map((o) => o.local_label.split(",")[0]));
  assert.equal(days.size, 3, "tres días distintos gracias a las páginas siguientes");
});

test("límite de uso por conversación y fallos de la agenda no filtran detalles", async () => {
  let r = await call({ action: "context" }, { deps: makeDeps({ allow: async () => false }).deps });
  assert.equal(r.status, 429); assert.equal(r.headers["Retry-After"], "60"); assert.equal(MAX_REQUESTS_PER_MINUTE, 20);
  const { deps, calls } = makeDeps({ slots: async () => { throw new Error("password authentication failed for user postgres at 10.0.0.5"); } });
  r = await call({ action: "suggest", service_id: SVC }, { deps });
  assert.equal(r.status, 502); assert.equal(r.body.error, "upstream_error");
  assert.equal(JSON.stringify(r.body).includes("postgres"), false);
  assert.equal(calls.logs.at(-1).status, "error");
});

test("nunca devuelve datos de pacientes ni de la conversación, y la bitácora tampoco los guarda", async () => {
  const { deps, calls } = makeDeps();
  const ctx = await call({ action: "context", patient_name: "Ana López", message: "me duele la muela" }, { deps });
  const sug = await call({ action: "suggest", service_id: SVC, patient_name: "Ana López", message: "me duele la muela" }, { deps });
  for (const text of [JSON.stringify(ctx.body), JSON.stringify(sug.body), JSON.stringify(calls.logs)]) {
    assert.equal(/\bAna\b|López|muela|"patient|"message":"me /.test(text), false, text.slice(0, 120));
  }
  assert.ok(calls.logs.length >= 2);
  assert.ok(calls.logs.every((e) => !("message" in e.detail) && ["context", "suggest"].includes(e.action)));
  assert.equal(ctx.body.contract_version, CONTRACT_VERSION);
});

test("etiquetaLocal: zona de la sucursal, a. m./p. m. con espacio y zona inválida sin romper", () => {
  assert.equal(etiquetaLocal("2026-11-24T16:00:00Z", TZ), "Martes 24 de noviembre, 10:00 a. m.");
  assert.equal(etiquetaLocal("2026-11-24T22:30:00Z", TZ), "Martes 24 de noviembre, 4:30 p. m.");
  assert.equal(etiquetaLocal("2026-11-25T05:30:00Z", TZ), "Martes 24 de noviembre, 11:30 p. m.");   // el día que cuenta es el local
  assert.doesNotThrow(() => etiquetaLocal("2026-11-24T16:00:00Z", "Zona/Inventada"));
  assert.equal(etiquetaLocal("no-es-fecha", TZ), "");
});

test("el motor del servidor es copia exacta del que usa el navegador", () => {
  const src = readFileSync(new URL("../smyl-schedule-suggest.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const gen = readFileSync(new URL("../supabase/functions/_shared/schedule-suggest-core.mjs", import.meta.url), "utf8");
  assert.ok(gen.includes(src), "schedule-suggest-core.mjs está desfasado: ejecuta node scripts/sync-schedule-suggest.mjs");
  assert.match(gen, /^\/\/ ARCHIVO GENERADO por scripts\/sync-schedule-suggest\.mjs/);
});

// ── Profesional concreto y «más opciones» (tras la prueba real por Instagram: «con la Dra. Fernanda» y «¿tienes más opciones?») ──
test("el contexto lista los profesionales activos con sus sedes (solo id y nombre público)", async () => {
  const { deps } = makeDeps({ professionals: async () => [{ id: P1, name: "Dra. Fernanda Lozano Vera", branch_ids: [B1], extra_secreto: "x" }, { id: P2, name: "Dr. Iván Carrasco", branch_ids: [] }] });
  const r = await call({ action: "context" }, { deps });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.professionals, [{ id: P1, name: "Dra. Fernanda Lozano Vera", branch_ids: [B1] }, { id: P2, name: "Dr. Iván Carrasco", branch_ids: [] }]);
  const sin = await call({ action: "context" }, { deps: makeDeps().deps });
  assert.deepEqual(sin.body.professionals, [], "sin la dependencia nueva el contexto sigue funcionando");
});

test("suggest con un profesional concreto lo pasa a la búsqueda y solo ofrece horarios suyos", async () => {
  const { deps, calls } = makeDeps({ slots: async (q) => { calls.slots.push(q); return [slot(24, 10, { professional_id: P1 }), slot(24, 16, { professional_id: P2, professional_name: "Dr. Iván" }), slot(25, 10, { professional_id: P1 })]; } });
  const r = await call({ action: "suggest", service_id: SVC, branch_id: B1, professional_id: P1 }, { deps });
  assert.equal(r.status, 200);
  assert.ok(calls.slots.length >= 1 && calls.slots.every((q) => q.professionalId === P1));
  assert.ok(r.body.options.length > 0 && r.body.options.every((o) => o.professional_id === P1), "ninguna opción de otro profesional");
});

test("«más opciones» (more:true) excluye los horarios ya ofrecidos en la conversación y consulta solo ofertas recientes", async () => {
  const todos = [slot(24, 10), slot(24, 16), slot(25, 10), slot(26, 11)];
  const llaves = (arr) => arr.map((x) => [x.service_id, x.branch_id, x.professional_id, new Date(x.starts_at).toISOString()].join("|"));
  let consultado = null;
  const { deps } = makeDeps({ slots: async () => todos, recentOfferKeys: async (q) => { consultado = q; return llaves(todos.slice(0, 3)); } });
  const r = await call({ action: "suggest", service_id: SVC, branch_id: B1, more: true }, { deps });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.options.map((o) => o.starts_at), [todos[3].starts_at], "solo lo que no se había ofrecido");
  assert.equal(consultado.tenantId, T); assert.equal(consultado.conversationId, CONV);
  assert.ok(new Date(consultado.since) > new Date(NOW.getTime() - 3 * HOUR), "ventana de 2 horas");
  const sinMas = await call({ action: "suggest", service_id: SVC, branch_id: B1 }, { deps });
  assert.equal(sinMas.body.options.length, 3, "sin more no se excluye nada");
  const nada = await call({ action: "suggest", service_id: SVC, branch_id: B1, more: true }, { deps: makeDeps({ slots: async () => todos, recentOfferKeys: async () => llaves(todos) }).deps });
  assert.equal(nada.body.options.length, 0); assert.equal(nada.body.status, "none");
});

test("la implementación real de las dependencias nuevas solo toca tablas de la clínica y no devuelve datos de contacto", () => {
  const idx = readFileSync(new URL("../supabase/functions/lana-scheduling/index.ts", import.meta.url), "utf8");
  assert.match(idx, /professionals: async \(tenantId: string\)/); assert.match(idx, /select\("id,display_name,active"\)\.eq\("tenant_id", tenantId\)\.eq\("active", true\)/);
  assert.match(idx, /smyl_professional_branches/); assert.match(idx, /recentOfferKeys: async \(q: Row\)/);
  assert.match(idx, /\.eq\("lana_conversation_id", q\.conversationId\)\.gte\("created_at", q\.since\)/);
  assert.doesNotMatch(idx.slice(idx.indexOf("professionals: async"), idx.indexOf("recentOfferKeys: async")), /license|email|phone|user_id/);
});
