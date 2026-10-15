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
    permissions: { read_availability: true, create_request: false, confirm_appointment: false },
  });
}

async function availability(smylTenantId: string, body: Record<string, unknown>): Promise<Response> {
  const serviceId = uuid(body.service_id);
  const branchId = body.branch_id ? uuid(body.branch_id) : null;
  const professionalId = body.professional_id ? uuid(body.professional_id) : null;
  const from = isoDate(body.from);
  const to = isoDate(body.to);
  if (!serviceId || !from || !to || (body.branch_id && !branchId) || (body.professional_id && !professionalId)) {
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
    slots,
    generated_at: new Date().toISOString(),
    holds_created: false,
    appointment_created: false,
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
  if (action === "availability_catalog") return await catalog(smylTenantId);
  if (action === "availability") return await availability(smylTenantId, body);
  return json(400, { error: "Acción no permitida." });
});
