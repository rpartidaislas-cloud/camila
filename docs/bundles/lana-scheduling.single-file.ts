// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/lana-scheduling/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/lana-contract.mjs ──
const { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders, SMYL_PRODUCT, readLanaContract, decideLanaLink } = (() => {
const SMYL_LANA_CONTRACT_VERSION = "1.6";

const ALLOWED_ROOTS = new Set([
  "attention",
  "channels",
  "context",
  "contract",
  "conversations",
  "ia",
  "inbox",
  "payments",
  "training",
]);

function normalizeLanaPath(input: any) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const rawPath = raw.split(/[?#]/, 1)[0];
  let rawSegments;
  try {
    rawSegments = rawPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Ruta LANA no permitida.");
  }
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const parsed = new URL(raw, "https://lana.invalid");
  if (parsed.origin !== "https://lana.invalid" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Ruta LANA no permitida.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!segments.length) throw new Error("Ruta LANA no permitida.");
  if (!ALLOWED_ROOTS.has(segments[0])) throw new Error("Endpoint LANA no permitido.");

  return `${parsed.pathname}${parsed.search}`;
}

function lanaContractHeaders() {
  return { "X-SMYL-LANA-Contract-Version": SMYL_LANA_CONTRACT_VERSION };
}

// ── Aislamiento de contexto SMYL ↔ LANA ─────────────────────────────────────────────────────────────
// SMYL usa el motor de chat de LANA, pero cada clínica debe vivir en SU PROPIO tenant de LANA, marcado como producto
// "smyl": así el asistente usa el contexto y las herramientas dentales, nunca el catálogo/pedidos/precios comerciales.
// LANA declara esa marca en `GET /contract` → `contract.product` (y `contract.tenant_id`).
const SMYL_PRODUCT = "smyl";

// Interpreta la respuesta de /contract. Devuelve el producto y el id del tenant LANA, o null si LANA aún no los informa.
function readLanaContract(body: any) {
  const contract = body && typeof body === "object" && body.contract && typeof body.contract === "object" ? body.contract : null;
  const product = contract && typeof contract.product === "string" ? contract.product.trim().toLowerCase().slice(0, 40) : null;
  const rawTenant = contract && typeof contract.tenant_id === "string" ? contract.tenant_id.trim().toLowerCase() : "";
  const lanaTenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rawTenant) ? rawTenant : null;
  return { product: product || null, lanaTenantId };
}

// Decide si un tenant de LANA puede vincularse a una clínica de SMYL.
//  - strict (código de enlace manual): exige que LANA confirme product === "smyl"; sin confirmación se rechaza.
//  - no strict (alta automática o verificación de un enlace ya existente): sólo se rechaza un producto distinto de "smyl";
//    si LANA aún no informa el producto, se acepta pero queda marcado como "sin verificar".
// Resultado: { ok, verified, code, message }
function decideLanaLink(info: any, { strict }) {
  const product = info && info.product ? info.product : null;
  if (product === SMYL_PRODUCT) return { ok: true, verified: true, code: "", message: "" };
  if (product) {
    return { ok: false, verified: false, code: "wrong_product", message: "Este código pertenece a una cuenta comercial de LANA y no se puede usar en SMYL. Usa la activación automática." };
  }
  if (strict) {
    return { ok: false, verified: false, code: "product_unconfirmed", message: "LANA no confirmó que este código sea de una cuenta SMYL. Usa la activación automática o pide soporte." };
  }
  return { ok: true, verified: false, code: "", message: "" };
}

return { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders, SMYL_PRODUCT, readLanaContract, decideLanaLink };
})();

// ── _shared/lana-linked.ts ──
const { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin } = (() => {

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_LANA_ENCRYPTION_KEY") || "").trim();
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  estado: string;
};

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cryptoKey(): Promise<CryptoKey> {
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada correctamente.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function linkedLanaApiKey(tenantId: string): Promise<string> {
  const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la configuración de la clínica.");
  const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  const integrations = config.integraciones && typeof config.integraciones === "object"
    ? config.integraciones as Record<string, unknown> : {};
  const lana = integrations.lana && typeof integrations.lana === "object"
    ? integrations.lana as Partial<LanaConfig> : null;
  if (!lana?.api_key_ciphertext || !lana.api_key_iv || lana.estado !== "conectada") {
    throw new Error("LANA todavía no está conectada o requiere atención.");
  }
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(lana.api_key_iv) },
    await cryptoKey(),
    base64ToBytes(lana.api_key_ciphertext),
  );
  return new TextDecoder().decode(clear);
}

async function lanaRequest(
  tenantId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safePath = normalizeLanaPath(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await linkedLanaApiKey(tenantId)}`);
    headers.set("Accept", "application/json");
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(lanaContractHeaders())) headers.set(name, value);
    const response = await fetch(`${LANA_API_BASE}${safePath}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}


return { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin: admin };
})();

// ── _shared/schedule-suggest-core.mjs ──
const { suggest, describe, keyOf, localParts, AFTERNOON_FROM } = (() => {
// ARCHIVO GENERADO por scripts/sync-schedule-suggest.mjs a partir de smyl-schedule-suggest.js: no lo edites.
const module = { exports: {} };
/* SMYL · Agenda: «Sugerir horarios».
   Elige, entre los horarios libres que ya calculó el servidor, un máximo de tres opciones ordenadas y variadas para ofrecerlas
   a un paciente. No consulta ni escribe datos: solo ordena lo que recibe. Es determinista (sin IA) para que el resultado sea
   explicable y repetible, y es el mismo motor que usará el asistente de IA cuando agende solo.

   Reglas:
   1. Una sola sucursal: la que se pidió o, si no hay, la del primer espacio libre.
   2. Opción 1: el primer espacio libre (o el de su profesional de continuidad si cae dentro de 72 h del primero).
   3. Opción 2: otro día y otra franja del día (mañana / tarde); si no existe, otro día; si no, el mismo día con 3 h de distancia.
   4. Opción 3: un tercer día; si no existe, un horario que se separe al menos 2 h de los demás.
   5. Nunca se ofrece un horario ya pasado ni con menos de `minLeadMinutes` de anticipación. */
(function (root: any, factory: any) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmylScheduleSuggest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600000;
  var AFTERNOON_FROM = 13;           // 13:00 en adelante cuenta como «tarde»
  var CONTINUITY_WINDOW_MS = 72 * HOUR;
  var SAME_DAY_GAP_MS = 3 * HOUR, FALLBACK_GAP_MS = 2 * HOUR;

  function keyOf(slot: any) {
    return [slot.service_id || '', slot.branch_id || '', slot.professional_id || '', new Date(slot.starts_at).toISOString()].join('|');
  }

  // Día (YYYY-MM-DD) y hora en la zona de la sucursal; sin zona o con una inválida usa la del navegador.
  function localParts(iso: any, timeZone: any) {
    var date = new Date(iso);
    function from(zone: any) {
      var options = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' };
      if (zone) options.timeZone = zone;
      var out = {}; new Intl.DateTimeFormat('en-CA', options).formatToParts(date).forEach(function (part: any) { out[part.type] = part.value; });
      return { day: out.year + '-' + out.month + '-' + out.day, hour: Number(out.hour) % 24 };
    }
    try { return from(timeZone); } catch (error) { return from(undefined); }
  }

  function daypart(parts: any) { return parts.hour >= AFTERNOON_FROM ? 'afternoon' : 'morning'; }

  function prepare(slots: any, config: any) {
    var now = config.now instanceof Date ? config.now.getTime() : Number(config.now || Date.now());
    var earliest = now + Math.max(0, Number(config.minLeadMinutes == null ? 60 : config.minLeadMinutes)) * 60000;
    var excluded = {}; (config.exclude || []).forEach(function (key: any) { excluded[key] = true; });
    var rows = [];
    (Array.isArray(slots) ? slots : []).forEach(function (slot: any) {
      if (!slot || !slot.starts_at) return;
      var start = new Date(slot.starts_at).getTime();
      if (!Number.isFinite(start) || start < earliest || excluded[keyOf(slot)]) return;
      if (config.professionalId && slot.professional_id !== config.professionalId) return;
      var parts = localParts(slot.starts_at, slot.timezone);
      rows.push({ slot: slot, start: start, day: parts.day, part: daypart(parts) });
    });
    rows.sort(function (a: any, b: any) { return a.start - b.start || String(a.slot.professional_name || '').localeCompare(String(b.slot.professional_name || '')); });
    return rows;
  }

  function pick(rows: any, picked: any, test: any) {
    for (var i = 0; i < rows.length; i += 1) {
      if (picked.indexOf(rows[i]) >= 0) continue;
      if (test(rows[i])) return rows[i];
    }
    return null;
  }

  // slots: lista del servidor. config: { now, limit (≤3), branchId, professionalId, preferredProfessionalId, exclude: [clave], minLeadMinutes }
  function suggest(slots: any, config: any) {
    config = config || {};
    var limit = Math.min(Math.max(Number(config.limit) || 3, 1), 3);
    var rows = prepare(slots, config);
    if (config.branchId) rows = rows.filter(function (row: any) { return row.slot.branch_id === config.branchId; });
    var branchIds = {}; rows.forEach(function (row: any) { branchIds[row.slot.branch_id || ''] = true; });
    var otherBranches = Object.keys(branchIds).length > 1;
    if (!config.branchId && rows.length) { var chosen = rows[0].slot.branch_id; rows = rows.filter(function (row: any) { return row.slot.branch_id === chosen; }); }
    var result = { options: [], reason: rows.length ? 'ok' : 'none', total: rows.length, branch_id: rows.length ? rows[0].slot.branch_id : null, other_branches: otherBranches && !config.branchId };
    if (!rows.length) return result;

    var picked = [], tags = [];
    // 1) primer espacio libre, o el de su profesional si está cerca
    var first = rows[0];
    if (config.preferredProfessionalId) {
      var continuity = pick(rows, [], function (row: any) { return row.slot.professional_id === config.preferredProfessionalId && row.start - rows[0].start <= CONTINUITY_WINDOW_MS; });
      if (continuity) first = continuity;
    }
    picked.push(first); tags.push(first === rows[0] ? 'Primer espacio libre' : 'Con su profesional');
    // 2) otro día y otra franja
    if (limit >= 2) {
      var second = pick(rows, picked, function (row: any) { return row.day !== first.day && row.part !== first.part; })
        || pick(rows, picked, function (row: any) { return row.day !== first.day; })
        || pick(rows, picked, function (row: any) { return row.day === first.day && Math.abs(row.start - first.start) >= SAME_DAY_GAP_MS; });
      if (second) { picked.push(second); tags.push(second.day === first.day ? 'Más tarde ese día' : second.part !== first.part ? (second.part === 'afternoon' ? 'Por la tarde' : 'Por la mañana') : 'Otro día'); }
    }
    // 3) un tercer día
    if (limit >= 3 && picked.length >= 2) {
      var days = picked.map(function (row: any) { return row.day; });
      var third = pick(rows, picked, function (row: any) { return days.indexOf(row.day) < 0; })
        || pick(rows, picked, function (row: any) { return picked.every(function (p: any) { return Math.abs(row.start - p.start) >= FALLBACK_GAP_MS; }); });
      if (third) { picked.push(third); tags.push(days.indexOf(third.day) < 0 ? 'Otro día' : 'Otro horario'); }
    }
    var order = picked.map(function (row: any, index: any) { return { row: row, tag: tags[index], rank: index + 1 }; });
    order.sort(function (a: any, b: any) { return a.row.start - b.row.start; });
    result.options = order.map(function (item: any) { return { slot: item.row.slot, tag: item.tag, rank: item.rank, key: keyOf(item.row.slot) }; });
    if (result.options.length < limit) result.reason = 'few';
    return result;
  }

  // Frase corta para el equipo cuando no hay tres opciones.
  function describe(result: any, periodLabel: any) {
    if (!result || result.reason === 'none') return 'No hay espacios libres' + (periodLabel ? ' ' + periodLabel : '') + '. Amplía el periodo o prueba con otra sucursal o profesional.';
    if (result.reason === 'few') return 'Solo encontré ' + result.options.length + (result.options.length === 1 ? ' espacio' : ' espacios') + (periodLabel ? ' ' + periodLabel : '') + '. Puedes ampliar el periodo para tener más opciones.';
    return '';
  }

  return { suggest: suggest, describe: describe, keyOf: keyOf, localParts: localParts, AFTERNOON_FROM: AFTERNOON_FROM };
});

const suggest = module.exports.suggest;
const describe = module.exports.describe;
const keyOf = module.exports.keyOf;
const localParts = module.exports.localParts;
const AFTERNOON_FROM = module.exports.AFTERNOON_FROM;
export default module.exports;

return { suggest, describe, keyOf, localParts, AFTERNOON_FROM };
})();

// ── _shared/lana-scheduling-core.mjs ──
const { CONTRACT_VERSION, SKEW_MS, MAX_REQUESTS_PER_MINUTE, MAX_BODY_BYTES, MAX_PAGES, PAGE_SIZE, hmacHex, safeEqual, firmaValida, etiquetaLocal, manejar } = (() => {
// SMYL · Contrato con el asistente de IA de LANA para consultar horarios libres (SOLO LECTURA).
// Lógica pura y sin red: la función `lana-scheduling` solo conecta `deps` con Supabase. Así todo se prueba en Node con datos de prueba.
//
// Seguridad: solicitud firmada (HMAC-SHA256 del cuerpo crudo, ±5 min); apagado por defecto; solo servicios que la clínica marcó; nunca
// devuelve datos de pacientes ni de conversaciones; límite de uso por conversación; cada respuesta con Cache-Control: no-store.
// No agenda ni aparta nada.

const CONTRACT_VERSION = 1;
const SKEW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_BODY_BYTES = 8192;
const MAX_PAGES = 6;
const PAGE_SIZE = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const enc = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: any, raw: any) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(raw))));
}
function safeEqual(a: any, b: any) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function firmaValida(secret: any, raw: any, header: any) {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string") return false;
  return safeEqual(header, `sha256=${await hmacHex(secret, raw)}`);
}

const reply = (status, body, headers = {}) => ({ status, body: { ...body, contract_version: CONTRACT_VERSION }, headers });
const fail = (status, error, message, extra = {}, headers = {}) => reply(status, { ok: false, error, message, ...extra }, headers);

const uuid = (v) => (typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
const isoDate = (v) => { const d = new Date(String(v || "")); return Number.isFinite(d.getTime()) ? d : null; };

// «Martes 25 de noviembre, 10:00 a. m.» en la zona de la sucursal (una zona inválida cae a la del servidor).
function etiquetaLocal(iso: any, timeZone: any) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const make = (zone) => {
    const day = { weekday: "long", day: "numeric", month: "long" }, time = { hour: "numeric", minute: "2-digit", hour12: true };
    if (zone) { day.timeZone = zone; time.timeZone = zone; }
    const d = date.toLocaleDateString("es-MX", day).replace(/^(\S+?),\s*/, "$1 ");
    return d.charAt(0).toUpperCase() + d.slice(1) + ", " + date.toLocaleTimeString("es-MX", time).replace(/\s+/g, " ").replace(/a\.m\./i, "a. m.").replace(/p\.m\./i, "p. m.");
  };
  try { return make(timeZone); } catch { return make(undefined); }
}

function direccion(branch: any) {
  return [branch.address_line, branch.city, branch.state, branch.postal_code].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}
function vistaSucursal(branch: any) {
  return { id: branch.id, name: branch.name, timezone: branch.timezone || "America/Mexico_City", address: direccion(branch), phone: String(branch.phone || "").trim() };
}

function validar(body: any, now: any) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: fail(400, "invalid_request", "Solicitud inválida.") };
  if (body.contract_version !== CONTRACT_VERSION) return { error: fail(400, "invalid_request", `contract_version debe ser ${CONTRACT_VERSION}.`) };
  if (body.action !== "context" && body.action !== "suggest") return { error: fail(400, "invalid_request", "Acción no válida.") };
  const tenantId = uuid(body.tenant_id), conversationId = uuid(body.conversation_id);
  if (!tenantId || !conversationId) return { error: fail(400, "invalid_request", "tenant_id y conversation_id deben ser UUID.") };
  const occurred = isoDate(body.occurred_at);
  if (!occurred || Math.abs(now.getTime() - occurred.getTime()) > SKEW_MS) return { error: fail(400, "expired_request", "La solicitud está fuera de tiempo. Revisa el reloj del servidor.") };
  return { tenantId, conversationId, action: body.action };
}

async function registrar(deps: any, event: any) { try { await deps.log(event); } catch { /* la bitácora nunca debe romper una respuesta */ } }

async function manejar({ raw, signature, now = new Date(), secret, deps }) {
  if (typeof secret !== "string" || secret.length < 32) return fail(503, "not_configured", "La integración no está configurada en el servidor.");
  if (!(await firmaValida(secret, raw, signature))) return fail(403, "bad_signature", "Firma inválida.");
  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return fail(400, "invalid_request", "El cuerpo no es JSON."); }
  const parsed = validar(body, now);
  if (parsed.error) return parsed.error;
  const { tenantId, conversationId, action } = parsed;
  const log = (status, detail = {}) => registrar(deps, { tenant_id: tenantId, conversation_id: conversationId, action, status, detail });

  try {
    if (!(await deps.allow(tenantId, conversationId, now, MAX_REQUESTS_PER_MINUTE))) {
      await log("limited");
      return fail(429, "rate_limited", "Demasiadas consultas para esta conversación. Intenta de nuevo en un minuto.", {}, { "Retry-After": "60" });
    }
    const settings = await deps.settings(tenantId);
    if (!settings || settings.level === "off") {
      if (action === "context") return reply(200, { ok: true, enabled: false, generated_at: now.toISOString() });
      await log("denied", { reason: "disabled" });
      return fail(403, "disabled", "La clínica no tiene activada la consulta de horarios para el asistente.");
    }
    const [branches, services, assignment] = await Promise.all([deps.branches(tenantId), deps.services(tenantId), deps.conversationBranch(tenantId, conversationId)]);
    const policy = { min_lead_hours: settings.min_lead_hours, horizon_days: settings.horizon_days, max_options: 3 };
    const branchViews = branches.map(vistaSucursal);

    // Sucursal de la conversación: única, ya asignada, o pendiente de preguntar al paciente.
    let status = "not_applicable", branch = null;
    if (branches.length === 1) { status = "single_branch"; branch = branchViews[0]; }
    else if (branches.length > 1) {
      const assigned = assignment && branchViews.find((b) => b.id === assignment.branch_id);
      if (assigned) { status = "assigned"; branch = assigned; } else status = "unassigned";
    }

    if (action === "context") {
      await log("ok", { branch_status: status, services: services.length });
      return reply(200, {
        ok: true, enabled: true, level: settings.level, status, branch,
        branches: branchViews.map((b) => ({ id: b.id, name: b.name })),
        services: services.map((s) => ({ id: s.id, name: s.name, duration_minutes: s.duration_minutes })),
        policy, generated_at: now.toISOString(),
      });
    }

    // ── suggest ──
    const serviceId = uuid(body.service_id);
    if (!serviceId) { await log("invalid", { reason: "service_id" }); return fail(400, "invalid_request", "service_id debe ser un UUID."); }
    const service = services.find((s) => s.id === serviceId);
    if (!service) { await log("denied", { reason: "service_not_allowed" }); return fail(403, "service_not_allowed", "Ese servicio no está habilitado para que el asistente sugiera horarios."); }
    const professionalId = body.professional_id == null ? null : uuid(body.professional_id);
    const preferredId = body.preferred_professional_id == null ? null : uuid(body.preferred_professional_id);
    if ((body.professional_id != null && !professionalId) || (body.preferred_professional_id != null && !preferredId)) { await log("invalid", { reason: "professional_id" }); return fail(400, "invalid_request", "professional_id no es válido."); }
    const exclude = Array.isArray(body.exclude) ? body.exclude.filter((x) => typeof x === "string" && x.length <= 300).slice(0, 30) : [];

    let chosen = null;
    if (body.branch_id != null) {
      const requested = uuid(body.branch_id);
      chosen = requested && branchViews.find((b) => b.id === requested);
      if (!chosen) { await log("invalid", { reason: "branch_not_found" }); return fail(404, "branch_not_found", "La sucursal no existe o no está activa."); }
    } else if (branch) chosen = branch;
    else if (branches.length === 0) { await log("invalid", { reason: "no_branches" }); return fail(409, "no_branches", "La clínica no tiene sucursales activas."); }
    else { await log("invalid", { reason: "branch_required" }); return fail(409, "branch_required", "Pregunta al paciente en qué sucursal quiere atenderse.", { branches: branchViews.map((b) => ({ id: b.id, name: b.name })) }); }

    const lead = settings.min_lead_hours, horizon = settings.horizon_days;
    const earliest = new Date(now.getTime() + lead * 3600000), latest = new Date(now.getTime() + horizon * 86400000);
    const reqFrom = body.from == null ? null : isoDate(body.from), reqTo = body.to == null ? null : isoDate(body.to);
    if ((body.from != null && !reqFrom) || (body.to != null && !reqTo)) { await log("invalid", { reason: "period" }); return fail(400, "invalid_period", "Las fechas no son válidas."); }
    const from = reqFrom && reqFrom > earliest ? reqFrom : earliest, to = reqTo && reqTo < latest ? reqTo : latest;
    if (to <= from) { await log("invalid", { reason: "period" }); return fail(400, "invalid_period", `El periodo debe estar dentro de los próximos ${horizon} días y con al menos ${lead} h de anticipación.`); }

    // El servidor devuelve como máximo 30 horarios por consulta, ordenados por hora: se pide el resto desde el último (hasta MAX_PAGES).
    const rows = []; const seen = new Set(); let cursor = from;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const got = await deps.slots({ tenantId, serviceId, branchId: chosen.id, professionalId, from: cursor.toISOString(), to: to.toISOString(), limit: PAGE_SIZE });
      let fresh = 0;
      for (const slot of got || []) { const key = [slot.service_id, slot.branch_id, slot.professional_id, new Date(slot.starts_at).toISOString()].join("|"); if (!seen.has(key)) { seen.add(key); rows.push(slot); fresh += 1; } }
      if (!got || got.length < PAGE_SIZE || !fresh) break;
      cursor = new Date(got[got.length - 1].starts_at);
    }

    const result = suggestEngine(rows, { now, limit: 3, branchId: chosen.id, professionalId, preferredProfessionalId: preferredId, exclude, minLeadMinutes: lead * 60 });
    const options = result.options.map((o, i) => {
      const zone = o.slot.timezone || chosen.timezone;
      return {
        index: i + 1, key: o.key, tag: o.tag, starts_at: new Date(o.slot.starts_at).toISOString(), ends_at: o.slot.ends_at ? new Date(o.slot.ends_at).toISOString() : null,
        local_label: etiquetaLocal(o.slot.starts_at, zone), timezone: zone, service_id: serviceId, service_name: o.slot.service_name || service.name,
        professional_id: o.slot.professional_id, professional_name: o.slot.professional_name || "", branch_id: o.slot.branch_id, branch_name: o.slot.branch_name || chosen.name,
      };
    });
    const period = `en los próximos ${horizon} días`;
    const lines = options.map((o) => `${o.index}) ${o.local_label}${o.professional_name ? " con " + o.professional_name : ""}`);
    const hint = options.length ? [`Estas son las opciones disponibles en ${chosen.name}:`, ...lines, "Responde con el número que prefieras."].join("\n") : "";
    const code = result.reason; // ok | few | none
    await log(code, { options: options.length, service_id: serviceId, branch_id: chosen.id, candidates: rows.length });
    return reply(200, {
      ok: true, status: code, branch: { id: chosen.id, name: chosen.name, timezone: chosen.timezone }, options, message_hint: hint,
      explanation: code === "ok" ? "" : describeEngine(result, period),
      next_step: code === "none" ? "widen_period_or_other_branch_or_waitlist" : code === "few" ? "offer_these_or_widen_period" : "present_options",
      other_branches_available: Boolean(result.other_branches), generated_at: now.toISOString(),
    });
  } catch (error) {
    await log("error", { message: String((error && error.message) || error).slice(0, 200) });
    return fail(502, "upstream_error", "No se pudo consultar la agenda en este momento.");
  }
}

return { CONTRACT_VERSION, SKEW_MS, MAX_REQUESTS_PER_MINUTE, MAX_BODY_BYTES, MAX_PAGES, PAGE_SIZE, hmacHex, safeEqual, firmaValida, etiquetaLocal, manejar };
})();

// ── lana-scheduling/index.ts ──
// Consulta de horarios libres para el asistente de IA de LANA (SOLO LECTURA). Contrato: docs/LANA_AGENDA_CONTRATO.md.
// Autenticación: firma HMAC-SHA256 del cuerpo crudo (X-SMYL-Signature: sha256=<hex>) con SMYL_LANA_SCHEDULING_SECRET; no usa sesión de personal
// (verify_jwt=false en config.toml). Apagado por defecto: la clínica lo enciende en Configuración → Agenda con IA y elige los servicios.
// No agenda ni aparta nada. La lógica vive en _shared/lana-scheduling-core.mjs (pura y probada); aquí solo se conecta con la base de datos.

const admin = smylAdmin;
const SECRET = (Deno.env.get("SMYL_LANA_SCHEDULING_SECRET") || "").trim();
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const deps = {
  // Límite de uso: máximo N consultas por minuto por conversación (cuenta las de la bitácora).
  allow: async (tenantId: string, conversationId: string, now: Date, max: number): Promise<boolean> => {
    const since = new Date(now.getTime() - 60000).toISOString();
    const { count, error } = await admin.from("smyl_ai_scheduling_events").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("conversation_id", conversationId).gte("created_at", since);
    if (error) throw error;
    return (count || 0) < max;
  },
  settings: async (tenantId: string): Promise<Row | null> => {
    const { data, error } = await admin.from("smyl_ai_scheduling_settings").select("level,min_lead_hours,horizon_days").eq("tenant_id", tenantId).maybeSingle();
    if (error) throw error;
    return data;
  },
  // Solo los servicios que la clínica habilitó y que siguen activos.
  services: async (tenantId: string): Promise<Row[]> => {
    const { data: allowed, error } = await admin.from("smyl_ai_scheduling_services").select("service_id").eq("tenant_id", tenantId);
    if (error) throw error;
    const ids = (allowed || []).map((r: Row) => r.service_id);
    if (!ids.length) return [];
    const { data, error: e2 } = await admin.from("smyl_services").select("id,name,duration_minutes").eq("tenant_id", tenantId).eq("active", true).in("id", ids).order("name");
    if (e2) throw e2;
    return data || [];
  },
  branches: async (tenantId: string): Promise<Row[]> => {
    const { data, error } = await admin.from("smyl_branches").select("id,name,timezone,address_line,city,state,postal_code,phone").eq("tenant_id", tenantId).eq("active", true).order("name");
    if (error) throw error;
    return data || [];
  },
  conversationBranch: async (tenantId: string, conversationId: string): Promise<Row | null> => {
    const { data, error } = await admin.from("smyl_conversation_branches").select("branch_id,source").eq("tenant_id", tenantId).eq("conversation_id", conversationId).maybeSingle();
    if (error) throw error;
    return data;
  },
  // Misma función que usa la Agenda y el chat: horario de sucursal y profesional, servicio, sillón, bloqueos, citas y apartados vigentes.
  // El actor es la propia clínica (cuenta propietaria): solo lectura.
  slots: async (q: Row): Promise<Row[]> => {
    const { data, error } = await admin.rpc("smyl_inbox_available_slots_v2", {
      p_tenant_id: q.tenantId, p_actor_id: q.tenantId, p_service_id: q.serviceId, p_from: q.from, p_to: q.to,
      p_branch_id: q.branchId, p_professional_id: q.professionalId, p_limit: q.limit,
    });
    if (error) throw error;
    return data || [];
  },
  log: async (event: Row): Promise<void> => {
    const { error } = await admin.from("smyl_ai_scheduling_events").insert(event);
    if (error) console.error("[lana-scheduling] bitácora:", error.message);
  },
};

Deno.serve(async (req: Request): Promise<Response> => {
  const send = (status: number, body: Row, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
  if (req.method !== "POST") return send(405, { ok: false, error: "method_not_allowed" });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return send(413, { ok: false, error: "too_large" });
  try {
    const result = await manejar({ raw, signature: req.headers.get("X-SMYL-Signature"), now: new Date(), secret: SECRET, deps });
    return send(result.status, result.body, result.headers);
  } catch (error) {
    console.error("[lana-scheduling]", (error as Error)?.message);
    return send(500, { ok: false, error: "internal_error" });
  }
});
