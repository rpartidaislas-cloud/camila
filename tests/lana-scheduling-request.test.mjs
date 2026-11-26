// smyl-agenda-ia-solicitud: la acción `request` de lana-scheduling deja una solicitud PENDIENTE desde una opción ofrecida por el servidor.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manejar, hmacHex, CONTRACT_VERSION, OFFER_TTL_MS } from "../supabase/functions/_shared/lana-scheduling-core.mjs";

const SECRET = "s".repeat(40);
const T = "11111111-1111-4111-8111-111111111111", CONV = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", LANA = "22222222-2222-4222-8222-222222222222";
const SVC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", P1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const OFFER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TZ = "America/Mexico_City", NOW = new Date("2026-11-23T14:00:00.000Z");
const slot = (day, hour) => ({ service_id: SVC, branch_id: B1, branch_name: "Centro", timezone: TZ, professional_id: P1, professional_name: "Dra. Fernanda", service_name: "Valoración", starts_at: new Date(Date.UTC(2026, 10, day, hour + 6)).toISOString(), ends_at: new Date(Date.UTC(2026, 10, day, hour + 7)).toISOString() });

function makeDeps(over = {}) {
  const calls = { logs: [], offers: [], requests: [], slots: [] };
  const deps = {
    allow: async () => true,
    settings: async () => ({ level: "request", min_lead_hours: 2, horizon_days: 14 }),
    branches: async () => [{ id: B1, name: "Centro", timezone: TZ, address_line: "Av. Juárez 120", city: "Zapopan", state: "Jalisco", postal_code: "45050", phone: "" }],
    services: async () => [{ id: SVC, name: "Valoración", duration_minutes: 60 }],
    conversationBranch: async () => null,
    slots: async (q) => { calls.slots.push(q); return [slot(24, 10), slot(24, 16), slot(25, 10), slot(26, 11)]; },
    lanaTenantMatches: async (tenantId, lanaTenantId) => tenantId === T && lanaTenantId === LANA,
    saveOffer: async (o) => { calls.offers.push(o); },
    createRequest: async (q) => { calls.requests.push(q); return { request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", duplicate: false, starts_at: slot(24, 10).starts_at, ends_at: slot(24, 10).ends_at, hold_expires_at: "2026-11-23T14:10:00.000Z", status: "pending", slot: { local_label: "Martes 24 de noviembre, 10:00 a. m.", timezone: TZ, service_id: SVC, branch_id: B1, service_name: "Valoración", branch_name: "Centro" } }; },
    log: async (e) => { calls.logs.push(e); },
    ...over,
  };
  return { deps, calls };
}
async function call(body, { deps = makeDeps().deps, now = NOW, sign = true } = {}) {
  const raw = JSON.stringify({ contract_version: CONTRACT_VERSION, tenant_id: T, conversation_id: CONV, occurred_at: now.toISOString(), ...body });
  return manejar({ raw, signature: sign ? `sha256=${await hmacHex(SECRET, raw)}` : null, now, secret: SECRET, deps });
}
const PEDIDO = { action: "request", lana_tenant_id: LANA, offer_key: OFFER, option_index: 1, name: "Ana López", contact: "55 1234 5678", privacy_consent: true, privacy_notice_version: "chat-appointment-v1" };

test("suggest con nivel «request» guarda la oferta en el servidor y devuelve su clave; con nivel «suggest» sigue siendo de solo lectura", async () => {
  const { deps, calls } = makeDeps();
  const r = await call({ action: "suggest", service_id: SVC, lana_tenant_id: LANA }, { deps });
  assert.equal(r.status, 200);
  assert.match(r.body.offer_key, /^[0-9a-f-]{36}$/);
  assert.equal(calls.offers.length, 1);
  const o = calls.offers[0];
  assert.deepEqual([o.tenantId, o.lanaTenantId, o.conversationId, o.serviceId, o.offerKey], [T, LANA, CONV, SVC, r.body.offer_key]);
  assert.ok(o.slots.length >= 1 && o.slots.length <= 3);
  assert.equal(new Date(o.expiresAt).getTime() - NOW.getTime(), OFFER_TTL_MS);
  assert.ok(o.slots.every((s) => s.starts_at && s.branch_id && s.professional_id && s.service_id === SVC && s.local_label));
  assert.ok(!JSON.stringify(o).match(/nombre|contact|telefono|phone/i), "la oferta no lleva datos personales");
  // Solo lectura: nada se guarda y no hay clave.
  const ro = makeDeps({ settings: async () => ({ level: "suggest", min_lead_hours: 2, horizon_days: 14 }) });
  const r2 = await call({ action: "suggest", service_id: SVC }, { deps: ro.deps });
  assert.equal(r2.status, 200); assert.equal(r2.body.offer_key, undefined); assert.equal(ro.calls.offers.length, 0);
});

test("suggest con nivel «request» exige la cuenta de LANA correcta y no guarda nada si no coincide", async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await call({ action: "suggest", service_id: SVC }, { deps })).status, 400, "sin lana_tenant_id");
  assert.equal((await call({ action: "suggest", service_id: SVC, lana_tenant_id: "no-uuid" }, { deps })).status, 400);
  const otra = await call({ action: "suggest", service_id: SVC, lana_tenant_id: "99999999-9999-4999-8999-999999999999" }, { deps });
  assert.deepEqual([otra.status, otra.body.error], [403, "lana_mismatch"]);
  assert.equal(calls.offers.length, 0);
});

test("request: crea una solicitud PENDIENTE, con mensaje honesto de que aún no está confirmada, y manda a la base solo lo validado", async () => {
  const { deps, calls } = makeDeps();
  const r = await call(PEDIDO, { deps });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "created");
  assert.equal(r.body.request.local_label, "Martes 24 de noviembre, 10:00 a. m.");
  assert.match(r.body.message_hint, /NO está confirmada/);
  assert.equal(r.body.next_step, "wait_for_clinic");
  assert.deepEqual(calls.requests, [{ tenantId: T, lanaTenantId: LANA, conversationId: CONV, offerKey: OFFER, optionIndex: 1, name: "Ana López", contact: "55 1234 5678", privacyNoticeVersion: "chat-appointment-v1" }]);
  assert.equal(calls.logs.at(-1).status, "created");
  assert.ok(!JSON.stringify(calls.logs).match(/Ana|5512|55 1234/), "la bitácora no guarda datos personales");
  // Mismo cuerpo otra vez → «duplicate» (idempotencia en la base).
  const d = makeDeps({ createRequest: async () => ({ request_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", duplicate: true, starts_at: slot(24, 10).starts_at, ends_at: null, slot: { local_label: "Martes 24 de noviembre, 10:00 a. m." } }) });
  assert.equal((await call(PEDIDO, { deps: d.deps })).body.status, "duplicate");
});

test("request sin offer_key usa la oferta vigente de la conversación (el modelo solo elige el número)", async () => {
  const { deps, calls } = makeDeps();
  const { offer_key: _omitida, ...sinClave } = PEDIDO;
  const r = await call(sinClave, { deps });
  assert.equal(r.status, 200);
  assert.equal(calls.requests[0].offerKey, null);
  assert.equal(calls.requests[0].optionIndex, 1);
});

test("request: apagado por defecto, y solo el nivel «request» lo permite (suggest/off lo rechazan sin tocar la base)", async () => {
  for (const level of ["off", "suggest", "book"]) {
    const { deps, calls } = makeDeps({ settings: async () => ({ level, min_lead_hours: 2, horizon_days: 14 }) });
    const r = await call(PEDIDO, { deps });
    assert.deepEqual([r.status, r.body.error], [403, "disabled"], level);
    assert.equal(calls.requests.length, 0);
  }
  const sin = makeDeps({ settings: async () => null });
  assert.equal((await call(PEDIDO, { deps: sin.deps })).status, 403);
});

test("request: sin consentimiento explícito, sin datos válidos o sin versión de aviso → 400 y nada se guarda", async () => {
  const malos = [
    [{ privacy_consent: false }, "consent_required"], [{ privacy_consent: "true" }, "consent_required"], [{ privacy_consent: undefined }, "consent_required"],
    [{ name: "A" }, "invalid_contact"], [{ name: "x".repeat(81) }, "invalid_contact"], [{ contact: "123" }, "invalid_contact"], [{ contact: 5512345678 }, "invalid_contact"],
    [{ privacy_notice_version: "v1" }, "invalid_request"], [{ privacy_notice_version: undefined }, "invalid_request"],
    [{ option_index: 0 }, "invalid_request"], [{ option_index: 4 }, "invalid_request"], [{ option_index: "1" }, "invalid_request"],
    [{ offer_key: "no" }, "invalid_request"], [{ offer_key: 5 }, "invalid_request"], [{ lana_tenant_id: undefined }, "invalid_request"],
  ];
  for (const [cambio, error] of malos) {
    const { deps, calls } = makeDeps();
    const r = await call({ ...PEDIDO, ...cambio }, { deps });
    assert.deepEqual([r.status, r.body.error], [400, error], JSON.stringify(cambio));
    assert.equal(calls.requests.length, 0, JSON.stringify(cambio));
  }
});

test("request: una conversación de otra cuenta de LANA no puede pedir citas de esta clínica", async () => {
  const { deps, calls } = makeDeps();
  const r = await call({ ...PEDIDO, lana_tenant_id: "99999999-9999-4999-8999-999999999999" }, { deps });
  assert.deepEqual([r.status, r.body.error], [403, "lana_mismatch"]);
  assert.equal(calls.requests.length, 0);
});

test("request: los errores de la base se traducen sin filtrar detalles internos", async () => {
  const casos = [
    [{ message: "SMYL_OFFER_NOT_FOUND" }, 404, "offer_not_found"], [{ message: "SMYL_OFFER_ALREADY_USED" }, 409, "offer_already_used"],
    [{ message: "SMYL_OFFER_EXPIRED" }, 410, "offer_expired"], [{ message: "SMYL_CAPPED" }, 429, "capped"], [{ message: "SMYL_CONSENT_REQUIRED" }, 400, "consent_required"],
    [{ message: "Ese horario ya no está disponible. Consulta la agenda nuevamente.", code: "23P01" }, 409, "slot_taken"],
  ];
  for (const [err, status, error] of casos) {
    const { deps, calls } = makeDeps({ createRequest: async () => { throw Object.assign(new Error(err.message), { code: err.code }); } });
    const r = await call(PEDIDO, { deps });
    assert.deepEqual([r.status, r.body.error], [status, error], err.message);
    assert.ok(!JSON.stringify(r.body).includes("SMYL_"), "no filtra los códigos internos");
    assert.ok(calls.logs.length >= 1);
  }
  const caido = makeDeps({ createRequest: async () => { throw new Error("connection to server at 10.0.0.5 failed password=abc"); } });
  const r = await call(PEDIDO, { deps: caido.deps });
  assert.deepEqual([r.status, r.body.error], [502, "upstream_error"]);
  assert.ok(!JSON.stringify(r.body).match(/10\.0\.0\.5|password/));
});

test("request: firma, límite de uso y reloj se aplican igual que en las demás acciones", async () => {
  const { deps, calls } = makeDeps();
  assert.equal((await call(PEDIDO, { deps, sign: false })).status, 403);
  assert.equal((await call(PEDIDO, { deps, now: new Date(NOW.getTime() + 10 * 60000), sign: true }).then((r) => r.status)), 200, "reloj del servidor = ahora de la prueba");
  const lim = makeDeps({ allow: async () => false });
  assert.equal((await call(PEDIDO, { deps: lim.deps })).status, 429);
  assert.equal(lim.calls.requests.length, 0);
  assert.equal(calls.requests.length >= 0, true);
});

test("la función conecta la oferta, la verificación de la cuenta de LANA y la RPC de la base; el contrato y la migración lo documentan", () => {
  const idx = readFileSync(new URL("../supabase/functions/lana-scheduling/index.ts", import.meta.url), "utf8");
  assert.match(idx, /lanaTenantMatches: async/);
  assert.match(idx, /lana\.estado === "conectada"/);
  assert.match(idx, /from\("smyl_assistant_slot_offers"\)\.insert/);
  assert.match(idx, /rpc\("smyl_ai_scheduling_create_request"/);
  assert.match(idx, /p_consent: true/);
  const sql = readFileSync(new URL("../supabase/migrations/20261128100000_smyl_ai_scheduling_request.sql", import.meta.url), "utf8");
  assert.match(sql, /grant execute on function public\.smyl_ai_scheduling_create_request\([^)]*\) to service_role;/);
  assert.ok(!/smyl_ai_scheduling_create_request\([^)]*\) to (anon|authenticated)/.test(sql));
  assert.match(sql, /check \(level in \('off', 'suggest', 'request', 'book'\)\)/);
  assert.match(sql, /errcode = 'SM001'/);
  assert.match(sql, /order by created_at desc limit 1 for update/, "sin clave explícita: la oferta más reciente de esa conversación");
  assert.ok(!/errcode = 'P000[1-4]'/.test(sql), "sin códigos reservados de PostgreSQL");
  assert.ok(!/p_tenant_id uuid[^)]*smyl_set_ai_scheduling/.test(sql));
  const ui = readFileSync(new URL("../smyl-ai-scheduling.js", import.meta.url), "utf8");
  assert.ok(!ui.includes("p_tenant_id"), "la pantalla ya no manda un parámetro que la función no tiene");
});

test("«Por aprobar» muestra el origen, el nombre y el contacto de una solicitud del chat y ya no deja un callejón sin salida", () => {
  const ui = readFileSync(new URL("../smyl-schedule.js", import.meta.url), "utf8");
  assert.match(ui, /chatReq=r\.source==='assistant'&&!intake&&Boolean\(r\.lana_conversation_id\)/);
  assert.match(ui, /name=intake\?intake\.contact_name:\(r\.requester_name\|\|patientName\(r\.patient_id\)\)/);
  assert.match(ui, /\[r\.requester_contact,p&&p\.display_name,room&&room\.name\]/);
  assert.match(ui, /\(chatReq\?' · Chat con IA':''\)/);
  assert.match(ui, /if\(!r\.patient_id&&chatReq\)actions='<button class="btn btn-primary" data-request-chat=/, "abrir conversación en lugar de «Vincular paciente» sin salida");
  assert.match(ui, /window\.SmylInbox\.open\(request\.lana_conversation_id\)/);
  assert.match(ui, /nunca se confirma sola/);
  const cfg = readFileSync(new URL("../smyl-ai-scheduling.js", import.meta.url), "utf8");
  assert.match(cfg, /data-ai-request/);
  assert.match(cfg, /\? 'request' : 'suggest'/);
  assert.match(cfg, /nunca se confirma sola/);
  for (const f of ["smyl-schedule.js"]) assert.equal(readFileSync(new URL(`../mobile/www/${f}`, import.meta.url), "utf8"), readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  for (const base of ["", "mobile/www/"]) {
    assert.match(readFileSync(new URL(`../${base}app.html`, import.meta.url), "utf8"), /smyl-ai-scheduling\.js\?v=2/);
    assert.match(readFileSync(new URL(`../${base}app.html`, import.meta.url), "utf8"), /smyl-schedule\.js\?v=64/);
  }
});

test("guardar lee la casilla de solicitud ANTES de render() (si no, siempre manda 'suggest')", () => {
  const cfg = readFileSync(new URL("../smyl-ai-scheduling.js", import.meta.url), "utf8");
  const save = cfg.slice(cfg.indexOf("async function save"));
  assert.ok(save.indexOf("wantsRequest =") < save.indexOf("state.saving = true; render()"));
  const tras = save.slice(save.indexOf("state.saving = true; render()"), save.indexOf("state.settings ="));
  assert.doesNotMatch(tras, /data-ai-request/);
});
