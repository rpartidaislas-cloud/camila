// SMYL · Contrato con el asistente de IA de LANA para consultar horarios libres (SOLO LECTURA).
// Lógica pura y sin red: la función `lana-scheduling` solo conecta `deps` con Supabase. Así todo se prueba en Node con datos de prueba.
//
// Seguridad: solicitud firmada (HMAC-SHA256 del cuerpo crudo, ±5 min); apagado por defecto; solo servicios que la clínica marcó; nunca
// devuelve datos de pacientes ni de conversaciones; límite de uso por conversación; cada respuesta con Cache-Control: no-store.
// No agenda ni aparta nada.
import { suggest as suggestEngine, describe as describeEngine } from "./schedule-suggest-core.mjs";

export const CONTRACT_VERSION = 1;
export const SKEW_MS = 5 * 60 * 1000;
export const MAX_REQUESTS_PER_MINUTE = 20;
export const MAX_BODY_BYTES = 8192;
export const MAX_PAGES = 6;
export const PAGE_SIZE = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const enc = new TextEncoder();
const hex = (buffer) => [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret, raw) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(raw))));
}
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function firmaValida(secret, raw, header) {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string") return false;
  return safeEqual(header, `sha256=${await hmacHex(secret, raw)}`);
}

const reply = (status, body, headers = {}) => ({ status, body: { ...body, contract_version: CONTRACT_VERSION }, headers });
const fail = (status, error, message, extra = {}, headers = {}) => reply(status, { ok: false, error, message, ...extra }, headers);

const uuid = (v) => (typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
const isoDate = (v) => { const d = new Date(String(v || "")); return Number.isFinite(d.getTime()) ? d : null; };

// «Martes 25 de noviembre, 10:00 a. m.» en la zona de la sucursal (una zona inválida cae a la del servidor).
export function etiquetaLocal(iso, timeZone) {
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

function direccion(branch) {
  return [branch.address_line, branch.city, branch.state, branch.postal_code].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}
function vistaSucursal(branch) {
  return { id: branch.id, name: branch.name, timezone: branch.timezone || "America/Mexico_City", address: direccion(branch), phone: String(branch.phone || "").trim() };
}

function validar(body, now) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: fail(400, "invalid_request", "Solicitud inválida.") };
  if (body.contract_version !== CONTRACT_VERSION) return { error: fail(400, "invalid_request", `contract_version debe ser ${CONTRACT_VERSION}.`) };
  if (body.action !== "context" && body.action !== "suggest") return { error: fail(400, "invalid_request", "Acción no válida.") };
  const tenantId = uuid(body.tenant_id), conversationId = uuid(body.conversation_id);
  if (!tenantId || !conversationId) return { error: fail(400, "invalid_request", "tenant_id y conversation_id deben ser UUID.") };
  const occurred = isoDate(body.occurred_at);
  if (!occurred || Math.abs(now.getTime() - occurred.getTime()) > SKEW_MS) return { error: fail(400, "expired_request", "La solicitud está fuera de tiempo. Revisa el reloj del servidor.") };
  return { tenantId, conversationId, action: body.action };
}

async function registrar(deps, event) { try { await deps.log(event); } catch { /* la bitácora nunca debe romper una respuesta */ } }

export async function manejar({ raw, signature, now = new Date(), secret, deps }) {
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
