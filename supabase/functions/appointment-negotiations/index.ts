// Negociación de citas por WhatsApp.
//
// POST autenticado:
//   { action: "dispatch", negotiation_id, recipient }
//   { action: "link_my_professional", conversation_id }
// POST público firmado por LANA:
//   { event_id, tenant_id, conversation_id, provider_message_id, button, occurred_at }
//   X-SMYL-Signature: sha256=<HMAC del cuerpo crudo>
//
// LANA conserva mensajes, teléfonos y credenciales de Meta. SMYL sólo guarda
// ids de correlación y la decisión normalizada; nunca el texto completo.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { lanaRequest, smylAdmin } from "../_shared/lana-linked.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const WEBHOOK_SECRET = (Deno.env.get("SMYL_NEGOTIATION_WEBHOOK_SECRET") || "").trim();
const CALLBACK_SKEW_MS = 5 * 60 * 1000;
const admin = smylAdmin;

type Recipient = "professional" | "patient";
type Row = Record<string, unknown>;

function uuid(value: unknown): string | null {
  const candidate = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null;
}
function text(value: unknown, max: number): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function json(status: number, body: Row, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function actorHeaders(user: { id: string; email?: string }, tenantId: string, key?: string): Headers {
  const headers = new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(text(user.email, 160).split("@")[0] || "Agenda SMYL"),
  });
  if (key) headers.set("Idempotency-Key", key);
  return headers;
}
function systemHeaders(tenantId: string, key: string): Headers {
  return new Headers({
    "X-SMYL-Actor-Id": tenantId,
    "X-SMYL-Actor-Role": "owner",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent("Confirmaciones SMYL"),
    "Idempotency-Key": key,
  });
}
async function can(jwt: string, tenantId: string, permission: string): Promise<boolean> {
  if (!SB_URL || !SB_ANON_KEY) return false;
  const client = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await client.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: permission });
  return !error && data === true;
}
function zone(value: unknown): string {
  const result = text(value, 60) || "America/Mexico_City";
  try { new Intl.DateTimeFormat("es-MX", { timeZone: result }); return result; } catch { return "America/Mexico_City"; }
}
function dateParts(value: unknown, timeZone: string): { date: string; time: string } {
  const date = new Date(String(value || ""));
  return {
    date: new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone }).format(date).replace(",", ""),
    time: new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(date),
  };
}
async function templateId(tenantId: string, name: string, headers: Headers): Promise<string> {
  const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates?status=all", { method: "GET", headers }, 15000);
  if (!remote.response.ok) throw new Error(text(remote.body.error, 300) || "No se pudieron consultar las plantillas de WhatsApp.");
  const rows = Array.isArray(remote.body.templates) ? remote.body.templates as Row[] : [];
  const match = rows.find((item) => text(item.name, 80) === name && text(item.status, 30).toUpperCase() === "APPROVED");
  const id = uuid(match?.id);
  if (!id) throw new Error(`La plantilla ${name} todavía no está aprobada en Meta.`);
  return id;
}
async function patientConversation(tenantId: string, patientId: string): Promise<string | null> {
  const { data } = await admin.from("camila_lana_handoffs").select("lana_conversation_id")
    .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("lana_channel", "whatsapp")
    .order("updated_at", { ascending: false }).limit(1);
  return data?.[0]?.lana_conversation_id ? String(data[0].lana_conversation_id) : null;
}
async function professionalConversation(tenantId: string, professionalId: string): Promise<string | null> {
  const { data } = await admin.from("smyl_professional_whatsapp_links").select("lana_conversation_id")
    .eq("tenant_id", tenantId).eq("professional_id", professionalId).eq("active", true).maybeSingle();
  return data?.lana_conversation_id ? String(data.lana_conversation_id) : null;
}

async function dispatchProposal(tenantId: string, negotiationId: string, recipient: Recipient, headers: Headers): Promise<Row> {
  const { data: negotiation } = await admin.from("smyl_appointment_negotiations").select("id,request_id,state,round_count")
    .eq("tenant_id", tenantId).eq("id", negotiationId).maybeSingle();
  if (!negotiation) throw new Error("La confirmación ya no existe.");
  const expected = recipient === "professional" ? "waiting_professional" : "waiting_patient";
  if (negotiation.state !== expected) throw new Error("La confirmación avanzó a otro estado. Actualiza Agenda.");
  const { data: proposal } = await admin.from("smyl_appointment_negotiation_proposals").select("*")
    .eq("tenant_id", tenantId).eq("negotiation_id", negotiationId).eq("recipient", recipient).eq("status", "offered")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!proposal) throw new Error("No existe una propuesta activa para enviar.");
  if (new Date(proposal.hold_expires_at).getTime() <= Date.now()) throw new Error("La propuesta venció. Vuelve a validar el horario.");

  const [{ data: request }, { data: branch }, { data: service }] = await Promise.all([
    admin.from("smyl_appointment_requests").select("patient_id").eq("tenant_id", tenantId).eq("id", negotiation.request_id).maybeSingle(),
    admin.from("smyl_branches").select("name,timezone").eq("tenant_id", tenantId).eq("id", proposal.branch_id).maybeSingle(),
    admin.from("smyl_services").select("duration_minutes").eq("tenant_id", tenantId).eq("id", proposal.service_id).maybeSingle(),
  ]);
  if (!request?.patient_id || !branch || !service) throw new Error("Faltan datos operativos para enviar la propuesta.");
  const conversationId = recipient === "professional"
    ? await professionalConversation(tenantId, proposal.professional_id)
    : await patientConversation(tenantId, request.patient_id);
  if (!conversationId) throw new Error(recipient === "professional"
    ? "El profesional todavía no vinculó su conversación de WhatsApp en Mensajes."
    : "El paciente no tiene una conversación de WhatsApp vinculada en Mensajes.");

  const templateName = recipient === "professional" ? "cita_confirmacion_profesional_v1" : "cita_propuesta_paciente_v1";
  const existing = await admin.from("smyl_appointment_negotiation_deliveries").select("*")
    .eq("tenant_id", tenantId).eq("proposal_id", proposal.id).maybeSingle();
  let delivery = existing.data as Row | null;
  if (delivery?.status === "sent" || delivery?.status === "delivered" || delivery?.status === "responded") return { ok: true, delivery_id: delivery.id, status: delivery.status, existing: true };
  if (!delivery) {
    const inserted = await admin.from("smyl_appointment_negotiation_deliveries").insert({
      tenant_id: tenantId, negotiation_id: negotiationId, proposal_id: proposal.id,
      recipient, lana_conversation_id: conversationId, template_name: templateName,
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error("No se pudo preparar la entrega de WhatsApp.");
    delivery = inserted.data as Row;
  }
  const template = await templateId(tenantId, templateName, headers);
  const tz = zone(branch.timezone); const when = dateParts(proposal.starts_at, tz);
  let variables: string[];
  if (recipient === "professional") variables = [when.date, when.time, text(branch.name, 120) || "la clínica", `${Number(service.duration_minutes) || 0} minutos`];
  else {
    const { data: patient } = await admin.from("camila_pacientes").select("nombre").eq("tenant_id", tenantId).eq("id", request.patient_id).maybeSingle();
    variables = [text(patient?.nombre, 120) || "paciente", text(branch.name, 120) || "la clínica", when.date, when.time, "10 minutos"];
  }
  const key = String(delivery.idempotency_key);
  await admin.from("smyl_appointment_negotiation_deliveries").update({
    status: "pending", attempt_count: Number(delivery.attempt_count || 0) + 1,
    last_error: "", updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", delivery.id);
  const sendHeaders = new Headers(headers); sendHeaders.set("Idempotency-Key", key);
  const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages`, {
    method: "POST", headers: sendHeaders,
    body: JSON.stringify({ type: "template", template_id: template, template_variables: variables }),
  }, 20000);
  const message = remote.body.message && typeof remote.body.message === "object" ? remote.body.message as Row : {};
  if (!remote.response.ok) {
    const error = text(remote.body.error, 400) || "LANA no pudo enviar la plantilla.";
    await admin.from("smyl_appointment_negotiation_deliveries").update({ status: "failed", last_error: error, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", delivery.id);
    throw new Error(error);
  }
  const rawProviderId = message.id ?? remote.body.message_id;
  const providerId = rawProviderId == null ? null : String(rawProviderId).trim().slice(0, 120) || null;
  await admin.from("smyl_appointment_negotiation_deliveries").update({
    status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", delivery.id);
  return { ok: true, delivery_id: delivery.id, status: "sent", existing: false };
}

async function hmac(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(signed)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false; let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function normalizeAction(recipient: Recipient, value: unknown): string | null {
  const label = text(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const professional: Record<string, string> = { confirmar: "confirm", confirm: "confirm", "cambiar horario": "change", change: "change", rechazar: "reject", reject: "reject" };
  const patient: Record<string, string> = { aceptar: "accept", accept: "accept", "ver otras opciones": "other", other: "other", "hablar con clinica": "clinic", clinic: "clinic" };
  return (recipient === "professional" ? professional : patient)[label] || null;
}

async function callback(raw: string, signature: string | null): Promise<Response> {
  if (WEBHOOK_SECRET.length < 32 || !signature || !safeEqual(signature, `sha256=${await hmac(raw)}`)) return json(403, { error: "Firma inválida." });
  const body = JSON.parse(raw || "{}") as Row;
  const eventId = text(body.event_id, 200); const tenantId = uuid(body.tenant_id); const conversationId = uuid(body.conversation_id);
  const providerMessageId = text(body.provider_message_id, 120); const deliveryId = uuid(body.delivery_id);
  const occurredAt = new Date(text(body.occurred_at, 60)).getTime();
  if (!eventId || !tenantId || !conversationId || !Number.isFinite(occurredAt) || Math.abs(Date.now() - occurredAt) > CALLBACK_SKEW_MS) return json(400, { error: "Evento incompleto o fuera de tiempo." });
  let query = admin.from("smyl_appointment_negotiation_deliveries").select("*").eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId);
  query = deliveryId ? query.eq("id", deliveryId) : query.eq("provider_message_id", providerMessageId);
  const { data: delivery } = await query.maybeSingle();
  if (!delivery) return json(404, { error: "No se encontró la entrega." });
  const action = normalizeAction(delivery.recipient as Recipient, body.button ?? body.action);
  if (!action) return json(400, { error: "Botón no reconocido." });
  const { data: state, error } = await admin.rpc("smyl_apply_whatsapp_negotiation_response", {
    p_tenant_id: tenantId, p_delivery_id: delivery.id, p_provider_event_id: eventId, p_action: action,
  });
  if (error) return json(409, { error: error.message || "No se pudo aplicar la respuesta." });
  let patientDispatch: Row | null = null;
  if (state === "waiting_patient") {
    try { patientDispatch = await dispatchProposal(tenantId, delivery.negotiation_id, "patient", systemHeaders(tenantId, crypto.randomUUID())); }
    catch (dispatchError) { patientDispatch = { ok: false, error: dispatchError instanceof Error ? dispatchError.message : "No se pudo avisar al paciente." }; }
  }
  return json(200, { ok: true, state, patient_dispatch: patientDispatch });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: makeCors(req) });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });
  const raw = await req.text();
  if (req.headers.has("x-smyl-signature")) {
    try { return await callback(raw, req.headers.get("x-smyl-signature")); }
    catch { return json(400, { error: "Evento inválido." }); }
  }

  const cors = makeCors(req); const auth = await requireUser(req, cors);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." }, cors);
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const body = JSON.parse(raw || "{}") as Row; const action = text(body.action, 30);
  try {
    if (action === "dispatch") {
      if (!await can(jwt, auth.tenantId, "schedule.manage")) return json(403, { error: "Tu rol no permite gestionar confirmaciones." }, cors);
      const negotiationId = uuid(body.negotiation_id); const recipient = body.recipient === "patient" ? "patient" : body.recipient === "professional" ? "professional" : null;
      if (!negotiationId || !recipient) return json(400, { error: "Confirmación o destinatario no válido." }, cors);
      return json(200, await dispatchProposal(auth.tenantId, negotiationId, recipient, actorHeaders(auth.user, auth.tenantId)), cors);
    }
    if (action === "link_my_professional") {
      if (!await can(jwt, auth.tenantId, "schedule.read")) return json(403, { error: "Tu rol no permite consultar la agenda." }, cors);
      const conversationId = uuid(body.conversation_id);
      if (!conversationId) return json(400, { error: "Conversación no válida." }, cors);
      const remote = await lanaRequest(auth.tenantId, "/inbox?channel=whatsapp&filter=all&limit=100&offset=0", { method: "GET", headers: actorHeaders(auth.user, auth.tenantId) }, 15000);
      const rows = Array.isArray(remote.body.conversations) ? remote.body.conversations as Row[] : [];
      if (!remote.response.ok || !rows.some((row) => String(row.id) === conversationId && text(row.channel, 20) === "whatsapp")) return json(400, { error: "Esa conversación de WhatsApp no está disponible para la clínica." }, cors);
      const { data: professional } = await admin.from("smyl_professionals").select("id,user_id").eq("tenant_id", auth.tenantId).eq("user_id", auth.user.id).eq("active", true).maybeSingle();
      if (!professional) return json(404, { error: "Tu cuenta no tiene un perfil profesional activo." }, cors);
      const saved = await admin.from("smyl_professional_whatsapp_links").upsert({ tenant_id: auth.tenantId, professional_id: professional.id, lana_conversation_id: conversationId, active: true, linked_by: auth.user.id, verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "tenant_id,professional_id" });
      if (saved.error) return json(409, { error: "Esta conversación ya está vinculada a otro profesional." }, cors);
      return json(200, { ok: true, professional_id: professional.id }, cors);
    }
    return json(400, { error: "Acción no reconocida." }, cors);
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : "No se pudo completar la operación." }, cors);
  }
});
