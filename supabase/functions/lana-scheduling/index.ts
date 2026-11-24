// Horarios libres y solicitud de cita para el asistente de IA de LANA. `context` y `suggest` son de solo lectura; `request` (nivel «request» que la clínica
// enciende) deja una solicitud PENDIENTE en «Agenda → Por aprobar», nunca confirma. Contrato: docs/LANA_AGENDA_CONTRATO.md.
// Autenticación: firma HMAC-SHA256 del cuerpo crudo (X-SMYL-Signature: sha256=<hex>) con SMYL_LANA_SCHEDULING_SECRET; no usa sesión de personal
// (verify_jwt=false en config.toml). Apagado por defecto: la clínica lo enciende en Configuración → Agenda con IA y elige los servicios.
// Nunca agenda por sí sola. La lógica vive en _shared/lana-scheduling-core.mjs (pura y probada); aquí solo se conecta con la base de datos.
import { smylAdmin } from "../_shared/lana-linked.ts";
import { manejar, MAX_BODY_BYTES } from "../_shared/lana-scheduling-core.mjs";

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
  // ¿La conversación pertenece a la cuenta de LANA vinculada a esta clínica? (camila_tenants.config.integraciones.lana.lana_tenant_id)
  lanaTenantMatches: async (tenantId: string, lanaTenantId: string): Promise<boolean> => {
    const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
    if (error) throw error;
    const lana = data?.config?.integraciones?.lana;
    return !!lana && lana.estado === "conectada" && typeof lana.lana_tenant_id === "string" && lana.lana_tenant_id.toLowerCase() === lanaTenantId.toLowerCase();
  },
  // Guarda la oferta (hasta 3 opciones) para que `request` solo pueda elegir entre lo que el servidor ofreció. Sin datos personales.
  saveOffer: async (o: Row): Promise<void> => {
    const { error } = await admin.from("smyl_assistant_slot_offers").insert({
      tenant_id: o.tenantId, lana_tenant_id: o.lanaTenantId, lana_conversation_id: o.conversationId, offer_key: o.offerKey,
      service_id: o.serviceId, slots: o.slots, expires_at: o.expiresAt,
    });
    if (error) throw error;
  },
  createRequest: async (q: Row): Promise<Row> => {
    const { data, error } = await admin.rpc("smyl_ai_scheduling_create_request", {
      p_tenant_id: q.tenantId, p_lana_tenant_id: q.lanaTenantId, p_conversation_id: q.conversationId, p_offer_key: q.offerKey,
      p_option_index: q.optionIndex, p_name: q.name, p_contact: q.contact, p_consent: true, p_notice_version: q.privacyNoticeVersion,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as Row;
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
