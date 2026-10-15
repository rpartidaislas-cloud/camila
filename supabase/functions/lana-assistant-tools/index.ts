import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const TOOL_SECRET = (Deno.env.get("SMYL_LANA_TOOL_SECRET") || "").trim();
const admin = createClient(SB_URL, SERVICE_ROLE_KEY);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function uuid(value: unknown): string | null {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)
    ? candidate
    : null;
}

function isoDate(value: unknown): Date | null {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

async function resolveLinkedTenant(smylTenantId: string, lanaTenantId: string): Promise<boolean> {
  const { data, error } = await admin.from("camila_tenants")
    .select("config")
    .eq("id", smylTenantId)
    .maybeSingle();
  if (error || !data) return false;
  const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  const integrations = config.integraciones && typeof config.integraciones === "object"
    ? config.integraciones as Record<string, unknown>
    : {};
  const lana = integrations.lana && typeof integrations.lana === "object"
    ? integrations.lana as Record<string, unknown>
    : {};
  return lana.estado === "conectada" && uuid(lana.lana_tenant_id) === lanaTenantId;
}

async function catalog(smylTenantId: string): Promise<Response> {
  const [servicesResult, branchesResult] = await Promise.all([
    admin.from("smyl_services").select("id,name,duration_minutes,category")
      .eq("tenant_id", smylTenantId).eq("active", true).order("name").limit(40),
    admin.from("smyl_branches").select("id,name,timezone")
      .eq("tenant_id", smylTenantId).eq("active", true).order("name").limit(20),
  ]);
  if (servicesResult.error || branchesResult.error) {
    return json(500, { error: "No se pudo consultar la configuración de Agenda." });
  }
  return json(200, {
    ok: true,
    services: servicesResult.data || [],
    branches: branchesResult.data || [],
    permissions: { read_availability: true, create_pending_request: true, confirm_appointment: false },
  });
}

async function activeOffer(
  smylTenantId: string,
  lanaTenantId: string,
  conversationId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!conversationId) return null;
  const { data, error } = await admin.from("smyl_assistant_slot_offers")
    .select("offer_key,service_id,slots,expires_at")
    .eq("tenant_id", smylTenantId)
    .eq("lana_tenant_id", lanaTenantId)
    .eq("lana_conversation_id", conversationId)
    .is("selected_index", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("No se pudo consultar la oferta activa.");
  return data || null;
}

async function availability(smylTenantId: string, lanaTenantId: string, body: Record<string, unknown>): Promise<Response> {
  const serviceId = uuid(body.service_id);
  const branchId = body.branch_id ? uuid(body.branch_id) : null;
  const professionalId = body.professional_id ? uuid(body.professional_id) : null;
  const from = isoDate(body.from);
  const to = isoDate(body.to);
  const conversationId = uuid(body.conversation_id);
  const offerKey = uuid(body.offer_key);
  if (!serviceId || !from || !to || !conversationId || !offerKey || (body.branch_id && !branchId) || (body.professional_id && !professionalId)) {
    return json(400, { error: "Los criterios de disponibilidad no son válidos." });
  }
  const now = Date.now();
  const maximum = now + 31 * 24 * 60 * 60 * 1000;
  if (to <= from || to.getTime() - from.getTime() > 8 * 24 * 60 * 60 * 1000 || to.getTime() > maximum) {
    return json(400, { error: "El periodo debe estar dentro de los próximos 31 días y abarcar como máximo 8 días." });
  }
  const { data, error } = await admin.rpc("smyl_inbox_available_slots_v2", {
    p_tenant_id: smylTenantId,
    p_actor_id: smylTenantId,
    p_service_id: serviceId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_branch_id: branchId,
    p_professional_id: professionalId,
    p_limit: 3,
  });
  if (error) {
    console.error("[lana-assistant-tools] availability", error.message);
    return json(400, { error: "No se pudo calcular la disponibilidad solicitada." });
  }
  const slots = (data || []).map((slot: Record<string, unknown>) => ({
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    timezone: slot.timezone,
    service_id: slot.service_id,
    service_name: slot.service_name,
    duration_minutes: slot.duration_minutes,
    branch_id: slot.branch_id,
    branch_name: slot.branch_name,
    professional_id: slot.professional_id,
    professional_name: slot.professional_name,
    specialty: slot.specialty,
  }));
  if (!slots.length) {
    return json(200, { ok: true, slots: [], generated_at: new Date().toISOString(), holds_created: false, appointment_created: false });
  }
  const { error: offerError } = await admin.from("smyl_assistant_slot_offers").upsert({
    tenant_id: smylTenantId,
    lana_tenant_id: lanaTenantId,
    lana_conversation_id: conversationId,
    offer_key: offerKey,
    service_id: serviceId,
    slots,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    selected_index: null,
    request_id: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,offer_key" });
  if (offerError) {
    console.error("[lana-assistant-tools] offer", offerError.message);
    return json(500, { error: "No se pudo preparar la selección de horarios." });
  }
  const { error: auditError } = await admin.from("smyl_audit_events").insert({
    tenant_id: smylTenantId,
    actor_id: null,
    action: "insert",
    entity_type: "assistant_availability_query",
    entity_id: serviceId,
    after_data: {
      source: "lana_ai_runtime",
      branch_id: branchId,
      professional_id: professionalId,
      from: from.toISOString(),
      to: to.toISOString(),
      result_count: slots.length,
    },
  });
  if (auditError) {
    console.error("[lana-assistant-tools] audit", auditError.message);
    return json(500, { error: "No se pudo auditar la consulta de disponibilidad." });
  }
  return json(200, {
    ok: true,
    offer_key: offerKey,
    slots,
    generated_at: new Date().toISOString(),
    holds_created: false,
    appointment_created: false,
  });
}

async function selectSlot(
  smylTenantId: string,
  lanaTenantId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const conversationId = uuid(body.conversation_id);
  const offerKey = uuid(body.offer_key);
  const option = Number(body.option);
  if (!conversationId || !offerKey || !Number.isInteger(option) || option < 1 || option > 3) {
    return json(400, { error: "La elección de horario no es válida." });
  }
  const { data: offer, error } = await admin.from("smyl_assistant_slot_offers")
    .select("id,service_id,slots,expires_at,selected_index,request_id")
    .eq("tenant_id", smylTenantId).eq("lana_tenant_id", lanaTenantId)
    .eq("lana_conversation_id", conversationId).eq("offer_key", offerKey)
    .maybeSingle();
  if (error || !offer) return json(404, { error: "La oferta de horarios ya no está disponible.", code: "offer_not_found" });
  if (offer.request_id) {
    return json(200, { ok: true, request_id: offer.request_id, status: "pending", appointment_created: false, already_recorded: true });
  }
  if (new Date(offer.expires_at).getTime() <= Date.now()) {
    return json(409, { error: "Las opciones vencieron. Consulta disponibilidad nuevamente.", code: "offer_expired" });
  }
  const slots = Array.isArray(offer.slots) ? offer.slots as Record<string, unknown>[] : [];
  const slot = slots[option - 1];
  const serviceId = uuid(offer.service_id);
  const branchId = uuid(slot?.branch_id);
  const professionalId = uuid(slot?.professional_id);
  const startsAt = isoDate(slot?.starts_at);
  if (!serviceId || !branchId || !professionalId || !startsAt) {
    return json(409, { error: "La opción elegida ya no es válida.", code: "offer_invalid" });
  }
  const { data: requestId, error: requestError } = await admin.rpc("smyl_assistant_create_appointment_request", {
    p_tenant_id: smylTenantId,
    p_conversation_id: conversationId,
    p_service_id: serviceId,
    p_branch_id: branchId,
    p_professional_id: professionalId,
    p_starts_at: startsAt.toISOString(),
    p_external_key: offerKey,
  });
  if (requestError) {
    console.error("[lana-assistant-tools] select", requestError.message);
    return json(409, { error: requestError.message || "No se pudo registrar la elección.", code: "slot_unavailable" });
  }
  const { error: updateError } = await admin.from("smyl_assistant_slot_offers").update({
    selected_index: option,
    request_id: requestId,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", smylTenantId).eq("id", offer.id).is("request_id", null);
  if (updateError) {
    console.error("[lana-assistant-tools] selection state", updateError.message);
    return json(500, { error: "La solicitud se registró, pero falta reconciliar su estado.", code: "selection_reconcile" });
  }
  return json(200, {
    ok: true,
    request_id: requestId,
    status: "pending",
    hold_expires_in_seconds: 600,
    appointment_created: false,
    requires_human_confirmation: true,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });
  const contentLength = Number(req.headers.get("Content-Length") || "0");
  if (contentLength > 16_384) return json(413, { error: "Solicitud demasiado grande." });
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!constantTimeEqual(bearer, TOOL_SECRET)) return json(401, { error: "No autorizado." });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json(400, { error: "Body JSON inválido." });
  const smylTenantId = uuid(body.smyl_tenant_id);
  const lanaTenantId = uuid(body.lana_tenant_id);
  if (!smylTenantId || !lanaTenantId || !await resolveLinkedTenant(smylTenantId, lanaTenantId)) {
    return json(403, { error: "La cuenta de LANA no corresponde a esta clínica." });
  }

  const action = String(body.action || "");
  if (action === "availability_catalog") {
    try {
      const base = await catalog(smylTenantId);
      if (!base.ok) return base;
      const payload = await base.json() as Record<string, unknown>;
      const conversationId = body.conversation_id ? uuid(body.conversation_id) : null;
      payload.active_offer = await activeOffer(smylTenantId, lanaTenantId, conversationId);
      return json(200, payload);
    } catch (error) {
      console.error("[lana-assistant-tools] active offer", error instanceof Error ? error.message : error);
      return json(500, { error: "No se pudo consultar la configuración de Agenda." });
    }
  }
  if (action === "availability") return await availability(smylTenantId, lanaTenantId, body);
  if (action === "select_slot") return await selectSlot(smylTenantId, lanaTenantId, body);
  return json(400, { error: "Acción no permitida." });
});
