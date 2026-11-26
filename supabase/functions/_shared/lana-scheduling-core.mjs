// SMYL · Contrato con el asistente de IA de LANA para consultar horarios libres y dejar una SOLICITUD de cita.
// Lógica pura y sin red: la función `lana-scheduling` solo conecta `deps` con Supabase. Así todo se prueba en Node con datos de prueba.
//
// Seguridad: solicitud firmada (HMAC-SHA256 del cuerpo crudo, ±5 min); apagado por defecto; solo servicios que la clínica marcó; nunca
// devuelve datos de pacientes ni de conversaciones; límite de uso por conversación; cada respuesta con Cache-Control: no-store.
// `context` y `suggest` son de SOLO LECTURA (con nivel «request», `suggest` guarda la oferta en el servidor). `request` (task-id
// smyl-agenda-ia-solicitud) solo existe con el nivel «request» que la clínica enciende: crea una solicitud PENDIENTE a partir de una opción
// ofrecida, con consentimiento explícito del paciente. Nunca confirma una cita.
import { suggest as suggestEngine, describe as describeEngine } from "./schedule-suggest-core.mjs";

export const CONTRACT_VERSION = 1;
export const SKEW_MS = 5 * 60 * 1000;
export const MAX_REQUESTS_PER_MINUTE = 20;
export const MAX_BODY_BYTES = 8192;
export const MAX_PAGES = 6;
export const PAGE_SIZE = 30;
export const OFFER_TTL_MS = 30 * 60 * 1000;
const NOTICE_RE = /^chat-appointment-v[0-9]+$/;
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
  if (body.action !== "context" && body.action !== "suggest" && body.action !== "request") return { error: fail(400, "invalid_request", "Acción no válida.") };
  const tenantId = uuid(body.tenant_id), conversationId = uuid(body.conversation_id);
  if (!tenantId || !conversationId) return { error: fail(400, "invalid_request", "tenant_id y conversation_id deben ser UUID.") };
  const occurred = isoDate(body.occurred_at);
  if (!occurred || Math.abs(now.getTime() - occurred.getTime()) > SKEW_MS) return { error: fail(400, "expired_request", "La solicitud está fuera de tiempo. Revisa el reloj del servidor.") };
  return { tenantId, conversationId, action: body.action };
}

async function registrar(deps, event) { try { await deps.log(event); } catch { /* la bitácora nunca debe romper una respuesta */ } }

const ERRORES_SOLICITUD = [
  ["SMYL_CONSENT_REQUIRED", 400, "consent_required", "Falta la autorización del paciente para usar su nombre y su medio de contacto."],
  ["SMYL_INVALID_CONTACT", 400, "invalid_contact", "El nombre o el medio de contacto no son válidos (teléfono de 10 dígitos o correo)."],
  ["SMYL_INVALID_REQUEST", 400, "invalid_request", "Solicitud inválida."],
  ["SMYL_OFFER_NOT_FOUND", 404, "offer_not_found", "No existe esa opción ofrecida. Consulta los horarios de nuevo."],
  ["SMYL_OFFER_ALREADY_USED", 409, "offer_already_used", "Ya se eligió otra opción de esa oferta. Consulta los horarios de nuevo."],
  ["SMYL_OFFER_EXPIRED", 410, "offer_expired", "La oferta venció. Consulta los horarios de nuevo."],
  ["SMYL_CAPPED", 429, "capped", "Esta conversación o la clínica ya tienen demasiadas solicitudes pendientes. Un asesor dará seguimiento."],
];

async function solicitar({ body, settings, tenantId, conversationId, now, deps, log }) {
  if (settings.level !== "request") {
    await log("denied", { reason: "requests_disabled" });
    return fail(403, "disabled", "La clínica no permite que el asistente deje solicitudes de cita.");
  }
  // `offer_key` es opcional: sin ella se usa la oferta más reciente de la conversación (el modelo solo elige el número de la opción).
  const lanaTenantId = uuid(body.lana_tenant_id), offerKey = body.offer_key == null ? null : uuid(body.offer_key);
  const index = Number.isInteger(body.option_index) ? body.option_index : null;
  const name = typeof body.name === "string" ? body.name.trim() : "", contact = typeof body.contact === "string" ? body.contact.trim() : "";
  if (!lanaTenantId || (body.offer_key != null && !offerKey) || index === null || index < 1 || index > 3) { await log("invalid", { reason: "fields" }); return fail(400, "invalid_request", "Faltan lana_tenant_id u option_index (1 a 3), o offer_key no es un UUID."); }
  if (body.privacy_consent !== true) { await log("denied", { reason: "consent_required" }); return fail(400, "consent_required", ERRORES_SOLICITUD[0][3]); }
  if (typeof body.privacy_notice_version !== "string" || !NOTICE_RE.test(body.privacy_notice_version)) { await log("invalid", { reason: "notice_version" }); return fail(400, "invalid_request", "privacy_notice_version no es válida."); }
  if (name.length < 2 || name.length > 80 || contact.length < 7 || contact.length > 120) { await log("invalid", { reason: "contact" }); return fail(400, "invalid_contact", ERRORES_SOLICITUD[1][3]); }
  if (!(await deps.lanaTenantMatches(tenantId, lanaTenantId))) { await log("denied", { reason: "lana_mismatch" }); return fail(403, "lana_mismatch", "La conversación no pertenece a la cuenta de LANA vinculada a esta clínica."); }
  let result;
  try {
    result = await deps.createRequest({ tenantId, lanaTenantId, conversationId, offerKey, optionIndex: index, name, contact, privacyNoticeVersion: body.privacy_notice_version });
  } catch (error) {
    const text = String((error && error.message) || error), code = String((error && error.code) || "");
    const hit = ERRORES_SOLICITUD.find(([token]) => text.includes(token));
    if (hit) { await log(hit[2] === "capped" ? "capped" : hit[2] === "offer_expired" ? "expired" : "invalid", { reason: hit[2] }); return fail(hit[1], hit[2], hit[3], {}, hit[2] === "capped" ? { "Retry-After": "3600" } : {}); }
    if (code === "23P01" || /ya no est[aá] disponible/i.test(text)) { await log("taken", { option: index }); return fail(409, "slot_taken", "Ese horario ya no está disponible. Consulta los horarios de nuevo para ofrecer otras opciones."); }
    throw error;
  }
  const slot = result && typeof result.slot === "object" && result.slot ? result.slot : {};
  const label = String(slot.local_label || etiquetaLocal(result.starts_at, slot.timezone));
  await log(result.duplicate ? "duplicate" : "created", { option: index, service_id: slot.service_id || null, branch_id: slot.branch_id || null });
  return reply(200, {
    ok: true, status: result.duplicate ? "duplicate" : "created",
    request: { id: result.request_id, starts_at: result.starts_at, ends_at: result.ends_at, local_label: label, hold_expires_at: result.hold_expires_at || null, service_name: slot.service_name || "", branch_name: slot.branch_name || "" },
    message_hint: `Listo: dejé tu solicitud para ${label}. Todavía NO está confirmada: la clínica la revisará y te confirmará por este mismo chat.`,
    next_step: "wait_for_clinic", generated_at: now.toISOString(),
  });
}

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
    // ── request: deja una solicitud PENDIENTE a partir de una opción que el propio servidor ofreció (nunca confirma una cita) ──
    if (action === "request") return await solicitar({ body, settings, tenantId, conversationId, now, deps, log });
    const [branches, services, assignment] = await Promise.all([deps.branches(tenantId), deps.services(tenantId), deps.conversationBranch(tenantId, conversationId)]);
    // Profesionales activos y sus sedes: el asistente puede pedir horarios con uno en concreto (`professional_id`). Solo nombre público; sin datos de contacto ni clínicos.
    const professionals = typeof deps.professionals === "function" ? ((await deps.professionals(tenantId)) || []).slice(0, 40).map((p) => ({ id: p.id, name: String(p.name || "").slice(0, 120), branch_ids: Array.isArray(p.branch_ids) ? p.branch_ids.slice(0, 20) : [], ...(Array.isArray(p.service_ids) ? { service_ids: p.service_ids.slice(0, 60) } : {}) })) : [];
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
        professionals,
        policy, generated_at: now.toISOString(),
      });
    }

    // ── suggest ──
    // Con el nivel «request» la oferta se guarda en el servidor, y se exige que la conversación sea de la cuenta de LANA vinculada a la clínica.
    const guardaOferta = settings.level === "request";
    let lanaTenantId = null;
    if (guardaOferta) {
      lanaTenantId = uuid(body.lana_tenant_id);
      if (!lanaTenantId) { await log("invalid", { reason: "lana_tenant_id" }); return fail(400, "invalid_request", "lana_tenant_id debe ser un UUID."); }
      if (!(await deps.lanaTenantMatches(tenantId, lanaTenantId))) { await log("denied", { reason: "lana_mismatch" }); return fail(403, "lana_mismatch", "La conversación no pertenece a la cuenta de LANA vinculada a esta clínica."); }
    }
    const serviceId = uuid(body.service_id);
    if (!serviceId) { await log("invalid", { reason: "service_id" }); return fail(400, "invalid_request", "service_id debe ser un UUID."); }
    const service = services.find((s) => s.id === serviceId);
    if (!service) { await log("denied", { reason: "service_not_allowed" }); return fail(403, "service_not_allowed", "Ese servicio no está habilitado para que el asistente sugiera horarios."); }
    const professionalId = body.professional_id == null ? null : uuid(body.professional_id);
    const preferredId = body.preferred_professional_id == null ? null : uuid(body.preferred_professional_id);
    if ((body.professional_id != null && !professionalId) || (body.preferred_professional_id != null && !preferredId)) { await log("invalid", { reason: "professional_id" }); return fail(400, "invalid_request", "professional_id no es válido."); }
    let exclude = Array.isArray(body.exclude) ? body.exclude.filter((x) => typeof x === "string" && x.length <= 300).slice(0, 30) : [];
    // «Más opciones»: el servidor excluye los horarios que ya ofreció en esta conversación (ofertas recientes), sin que el cliente tenga que recordarlos.
    if (body.more === true && typeof deps.recentOfferKeys === "function") {
      const vistos = (await deps.recentOfferKeys({ tenantId, conversationId, since: new Date(now.getTime() - 2 * 3600000).toISOString() })) || [];
      exclude = Array.from(new Set(exclude.concat(vistos.filter((x) => typeof x === "string" && x.length <= 300)))).slice(0, 60);
    }

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
    let offerKey = null;
    if (guardaOferta && options.length) {
      offerKey = crypto.randomUUID();
      await deps.saveOffer({ tenantId, lanaTenantId, conversationId, offerKey, serviceId, slots: options.map((o) => ({
        index: o.index, key: o.key, service_id: o.service_id, branch_id: o.branch_id, professional_id: o.professional_id, starts_at: o.starts_at, ends_at: o.ends_at,
        local_label: o.local_label, timezone: o.timezone, service_name: o.service_name, professional_name: o.professional_name, branch_name: o.branch_name,
      })), expiresAt: new Date(now.getTime() + OFFER_TTL_MS).toISOString() });
    }
    await log(code, { options: options.length, service_id: serviceId, branch_id: chosen.id, candidates: rows.length });
    return reply(200, {
      ok: true, status: code, branch: { id: chosen.id, name: chosen.name, timezone: chosen.timezone }, options, ...(offerKey ? { offer_key: offerKey } : {}), message_hint: hint,
      explanation: code === "ok" ? "" : describeEngine(result, period),
      next_step: code === "none" ? "widen_period_or_other_branch_or_waitlist" : code === "few" ? "offer_these_or_widen_period" : "present_options",
      other_branches_available: Boolean(result.other_branches), generated_at: now.toISOString(),
    });
  } catch (error) {
    await log("error", { message: String((error && error.message) || error).slice(0, 200) });
    return fail(502, "upstream_error", "No se pudo consultar la agenda en este momento.");
  }
}
