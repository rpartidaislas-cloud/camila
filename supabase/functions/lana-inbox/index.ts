import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Actor = {
  id: string;
  name: string;
  role: "owner" | "staff";
  role_code: string;
  role_name: string;
  permissions: string[];
};

const OWNER_PERMISSIONS = [
  "messages.read", "messages.respond", "messages.manage",
  "clinical.read", "clinical.write", "clinical.approve",
  "schedule.read", "schedule.manage",
];

function can(actor: Actor, permission: string): boolean {
  return actor.role === "owner" || actor.permissions.includes(permission);
}

function requirePermission(actor: Actor, permission: string, message: string): Response | null {
  return can(actor, permission) ? null : json(403, { error: message, code: "permission_denied" });
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function messageId(value: unknown): string | null {
  const candidate = String(value || "").trim();
  return /^[1-9][0-9]{0,18}$/.test(candidate) ? candidate : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function actorFor(user: { id: string; email?: string }, tenantId: string): Promise<Actor | null> {
  const { data } = await admin.from("camila_usuarios")
    .select("id,nombre,email,rol,activo")
    .eq("id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (data && data.activo === false) return null;
  const isOwner = user.id === tenantId || data?.rol === "dueño";
  const fallback = text(user.email, 160).split("@")[0] || (isOwner ? "Dueño de la clínica" : "Miembro del equipo");
  let roleCode = isOwner ? "propietario" : "sin_rol";
  let roleName = isOwner ? "Propietario" : "Sin rol operativo";
  let permissions = isOwner ? [...OWNER_PERMISSIONS] : [];
  if (!isOwner) {
    const { data: assignments } = await admin.from("smyl_member_roles")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id);
    const roleIds = (assignments || []).map((row: Record<string, unknown>) => String(row.role_id || "")).filter(Boolean);
    if (roleIds.length) {
      const [{ data: roles }, { data: grants }] = await Promise.all([
        admin.from("smyl_roles").select("id,code,name,active").eq("tenant_id", tenantId).in("id", roleIds).eq("active", true),
        admin.from("smyl_role_permissions").select("role_id,permission_key").eq("tenant_id", tenantId).in("role_id", roleIds),
      ]);
      const activeRoles = roles || [];
      if (activeRoles.length) {
        roleCode = activeRoles.map((row: Record<string, unknown>) => text(row.code, 40)).filter(Boolean).join(",");
        roleName = activeRoles.map((row: Record<string, unknown>) => text(row.name, 80)).filter(Boolean).join(" · ");
        const activeIds = new Set(activeRoles.map((row: Record<string, unknown>) => String(row.id || "")));
        permissions = Array.from(new Set((grants || [])
          .filter((row: Record<string, unknown>) => activeIds.has(String(row.role_id || "")))
          .map((row: Record<string, unknown>) => text(row.permission_key, 80))
          .filter(Boolean)));
      }
    }
  }
  return {
    id: user.id,
    name: text(data?.nombre, 160) || text(data?.email, 160) || fallback,
    role: isOwner ? "owner" : "staff",
    role_code: roleCode,
    role_name: roleName,
    permissions,
  };
}

async function listTeam(tenantId: string): Promise<Response> {
  const { data, error } = await admin.from("camila_usuarios")
    .select("id,nombre,email,rol,activo")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("created_at", { ascending: true });
  if (error) return json(500, { error: "No se pudo consultar el equipo de la clínica." });
  return json(200, {
    ok: true,
    members: (data || []).map((member: Record<string, unknown>) => ({
      id: String(member.id || ""),
      name: text(member.nombre, 160) || text(member.email, 160) || "Miembro del equipo",
      role: member.rol === "dueño" ? "owner" : "staff",
    })),
  });
}

async function availabilityCatalog(tenantId: string): Promise<Response> {
  const [servicesResult, branchesResult, professionalsResult, linksResult] = await Promise.all([
    admin.from("smyl_services").select("id,name,duration_minutes,category").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).eq("active", true).order("display_name"),
    admin.from("smyl_professional_services").select("professional_id,service_id").eq("tenant_id", tenantId),
  ]);
  const failed = [servicesResult, branchesResult, professionalsResult, linksResult].find((result) => result.error);
  if (failed?.error) return json(500, { error: "No se pudo consultar la configuración de Agenda." });
  return json(200, {
    ok: true,
    services: servicesResult.data || [],
    branches: branchesResult.data || [],
    professionals: professionalsResult.data || [],
    professional_services: linksResult.data || [],
  });
}

async function availableSlots(actor: Actor, tenantId: string, url: URL): Promise<Response> {
  const serviceId = uuid(url.searchParams.get("service_id"));
  const branchId = url.searchParams.get("branch_id") ? uuid(url.searchParams.get("branch_id")) : null;
  const professionalId = url.searchParams.get("professional_id") ? uuid(url.searchParams.get("professional_id")) : null;
  const from = new Date(String(url.searchParams.get("from") || ""));
  const to = new Date(String(url.searchParams.get("to") || ""));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 30);
  if (!serviceId || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return json(400, { error: "Selecciona un servicio y un periodo válidos." });
  }
  if (url.searchParams.get("branch_id") && !branchId) return json(400, { error: "Sucursal no válida." });
  if (url.searchParams.get("professional_id") && !professionalId) return json(400, { error: "Profesional no válido." });
  const { data, error } = await admin.rpc("smyl_inbox_available_slots", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_service_id: serviceId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_branch_id: branchId,
    p_professional_id: professionalId,
    p_limit: limit,
  });
  if (error) {
    console.error("[lana-inbox] availability", error.message);
    const forbidden = error.code === "42501";
    return json(forbidden ? 403 : 400, { error: forbidden ? "Tu rol no permite consultar disponibilidad." : "No se pudo calcular la disponibilidad solicitada." });
  }
  return json(200, { ok: true, slots: data || [], generated_at: new Date().toISOString(), holds_created: false });
}

async function appointmentRequests(tenantId: string, conversationId: string): Promise<Response> {
  const { data, error } = await admin.from("smyl_appointment_requests")
    .select("id,service_id,preferred_branch_id,preferred_professional_id,requested_start,requested_end,status,appointment_id,created_at,decided_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(20);
  if (error) return json(500, { error: "No se pudieron consultar las elecciones de horario." });
  return json(200, { ok: true, requests: data || [] });
}

async function appointmentContext(tenantId: string, conversationId: string): Promise<Response> {
  const { data: handoff, error: handoffError } = await admin.from("camila_lana_handoffs")
    .select("patient_id").eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (handoffError) return json(500, { error: "No se pudo consultar la continuidad de Agenda." });
  if (!handoff) return json(200, { ok: true, linked: false, items: [] });
  const { data: requests, error } = await admin.from("smyl_appointment_requests")
    .select("id,service_id,preferred_branch_id,preferred_professional_id,requested_start,requested_end,status,appointment_id,created_at,decided_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(10);
  if (error) return json(500, { error: "No se pudo consultar la continuidad de Agenda." });
  const rows = requests || [];
  const serviceIds = [...new Set(rows.map((row) => row.service_id).filter(Boolean))];
  const branchIds = [...new Set(rows.map((row) => row.preferred_branch_id).filter(Boolean))];
  const professionalIds = [...new Set(rows.map((row) => row.preferred_professional_id).filter(Boolean))];
  const appointmentIds = [...new Set(rows.map((row) => row.appointment_id).filter(Boolean))];
  const [servicesResult, branchesResult, professionalsResult, appointmentsResult] = await Promise.all([
    serviceIds.length ? admin.from("smyl_services").select("id,name,duration_minutes").eq("tenant_id", tenantId).in("id", serviceIds) : Promise.resolve({ data: [], error: null }),
    branchIds.length ? admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).in("id", branchIds) : Promise.resolve({ data: [], error: null }),
    professionalIds.length ? admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).in("id", professionalIds) : Promise.resolve({ data: [], error: null }),
    appointmentIds.length ? admin.from("smyl_appointments").select("id,status,starts_at,ends_at").eq("tenant_id", tenantId).in("id", appointmentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([servicesResult, branchesResult, professionalsResult, appointmentsResult].some((result) => result.error)) return json(500, { error: "No se pudieron completar los datos de Agenda." });
  const byId = (data: Record<string, unknown>[]) => new Map(data.map((row) => [String(row.id), row]));
  const services = byId((servicesResult.data || []) as Record<string, unknown>[]);
  const branches = byId((branchesResult.data || []) as Record<string, unknown>[]);
  const professionals = byId((professionalsResult.data || []) as Record<string, unknown>[]);
  const appointments = byId((appointmentsResult.data || []) as Record<string, unknown>[]);
  return json(200, { ok: true, linked: true, patient_id: handoff.patient_id, items: rows.map((row) => ({
    ...row, service: services.get(String(row.service_id)) || null,
    branch: branches.get(String(row.preferred_branch_id)) || null,
    professional: professionals.get(String(row.preferred_professional_id)) || null,
    appointment: row.appointment_id ? appointments.get(String(row.appointment_id)) || null : null,
  })) });
}

async function createAppointmentRequest(actor: Actor, tenantId: string, conversationId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  const serviceId = uuid(body.service_id); const branchId = uuid(body.branch_id); const professionalId = uuid(body.professional_id);
  const startsAt = new Date(String(body.starts_at || ""));
  if (!serviceId || !branchId || !professionalId || !Number.isFinite(startsAt.getTime())) return json(400, { error: "La elección de horario está incompleta." });
  const { data, error } = await admin.rpc("smyl_inbox_create_appointment_request", {
    p_tenant_id: tenantId, p_actor_id: actor.id, p_conversation_id: conversationId,
    p_service_id: serviceId, p_branch_id: branchId, p_professional_id: professionalId,
    p_starts_at: startsAt.toISOString(), p_external_key: idempotencyKey,
  });
  if (error) {
    console.error("[lana-inbox] appointment request", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo registrar la elección." });
  }
  return json(200, { ok: true, request_id: data, status: "pending", appointment_created: false, message_sent: false });
}

async function confirmAppointmentRequest(actor: Actor, tenantId: string, requestId: string, appointmentId: string): Promise<Response> {
  const { data, error } = await admin.rpc("smyl_inbox_confirm_appointment_request", {
    p_tenant_id: tenantId, p_actor_id: actor.id, p_request_id: requestId, p_appointment_id: appointmentId,
  });
  if (error) {
    console.error("[lana-inbox] appointment confirm", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo confirmar la cita." });
  }
  return json(200, { ok: true, appointment_id: data, status: "confirmed", message_sent: false });
}

function actorHeaders(actor: Actor, idempotencyKey?: string | null): Headers {
  const headers = new Headers({
    "X-SMYL-Actor-Id": actor.id,
    "X-SMYL-Actor-Role": actor.role,
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(actor.name),
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

async function clinicalContext(tenantId: string, conversationId: string): Promise<Response> {
  const { data: handoff, error } = await admin.from("camila_lana_handoffs")
    .select("id,patient_id,case_id,lana_channel,created_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (error) return json(500, { error: "No se pudo consultar la Ficha 360." });
  if (!handoff) return json(200, { ok: true, linked: false, patient: null, case: null, clinical_images: [] });
  const [{ data: patient }, { data: caseRow }, { data: links }] = await Promise.all([
    admin.from("camila_pacientes").select("id,nombre,apellido,email,telefono,fecha_nacimiento,genero,notas,updated_at")
      .eq("tenant_id", tenantId).eq("id", handoff.patient_id).maybeSingle(),
    admin.from("camila_casos").select("id,nombre_paciente,telefono,email,score,score_lbl,resumen,diagnostico,total_cotizacion,simulacion_url,fotos_count,lana_cita_id,created_at")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle(),
    admin.from("camila_lana_clinical_links").select("id,lana_message_id,media_type,status,label,created_at")
      .eq("tenant_id", tenantId).eq("case_id", handoff.case_id).order("created_at", { ascending: false }).limit(50),
  ]);
  return json(200, {
    ok: true,
    linked: true,
    handoff: { id: handoff.id, channel: handoff.lana_channel, created_at: handoff.created_at },
    patient: patient ? {
      id: patient.id, name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim(),
      email: patient.email || "", phone: patient.telefono || "", birth_date: patient.fecha_nacimiento || null,
      gender: patient.genero || null, notes: patient.notas || "", updated_at: patient.updated_at || null,
    } : null,
    case: caseRow ? {
      id: caseRow.id, name: caseRow.nombre_paciente || "", score: caseRow.score ?? null,
      score_label: caseRow.score_lbl || null, summary: caseRow.resumen || "", diagnosis: caseRow.diagnostico || "",
      quote_total: caseRow.total_cotizacion ?? null, simulation_url: caseRow.simulacion_url || null,
      photo_count: Number(caseRow.fotos_count) || 0, lana_appointment_id: caseRow.lana_cita_id || null,
      created_at: caseRow.created_at || null,
    } : null,
    clinical_images: links || [],
  });
}

async function copilotClinicalSnapshot(tenantId: string, conversationId: string): Promise<Record<string, unknown>> {
  const { data: handoff } = await admin.from("camila_lana_handoffs")
    .select("patient_id,case_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff) return {
    patient_confirmed: false, case_confirmed: false, photo_count: 0,
    simulation_exists: false, simulation_authorized: false,
    proposal_status: null, appointment_linked: false,
  };
  const [{ data: caseRow }, proposalResult] = await Promise.all([
    admin.from("camila_casos")
      .select("id,score_lbl,simulacion_url,fotos_count,lana_cita_id,lana_webhook_estado")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle(),
    admin.from("smyl_proposals")
      .select("status")
      .eq("tenant_id", tenantId).eq("patient_id", handoff.patient_id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const proposal = proposalResult.error ? null : proposalResult.data;
  return {
    patient_confirmed: true,
    case_confirmed: Boolean(caseRow),
    photo_count: Math.max(0, Number(caseRow?.fotos_count) || 0),
    case_status: text(caseRow?.score_lbl, 120) || null,
    simulation_exists: Boolean(caseRow?.simulacion_url),
    // `lana_webhook_estado=enviado` sólo aparece después de la acción explícita
    // del profesional en lana-webhook; existir una imagen no autoriza compartirla.
    simulation_authorized: Boolean(caseRow?.simulacion_url) && caseRow?.lana_webhook_estado === "enviado",
    proposal_status: proposal?.status || null,
    appointment_linked: Boolean(caseRow?.lana_cita_id),
  };
}

async function linkClinicalImage(
  tenantId: string,
  actor: Actor,
  conversationId: string,
  channel: string,
  rawMessageId: unknown,
  label: unknown,
): Promise<Response> {
  const id = messageId(rawMessageId);
  if (!id) return json(400, { error: "Mensaje no válido." });
  const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudo validar la fotografía en LANA.") });
  const message = remote.body.message as Record<string, unknown> | undefined;
  if (!message || message.media_type !== "image" || message.deleted === true) {
    return json(409, { error: "Solo una fotografía disponible puede enviarse a revisión clínica." });
  }
  const { data, error } = await admin.rpc("camila_vincular_lana_imagen", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_message_id: id,
    p_lana_channel: channel,
    p_label: text(label, 180) || "Fotografía recibida por chat",
  });
  if (error) {
    if (String(error.message || "").includes("LANA_HANDOFF_REQUIRED")) {
      return json(409, { error: "Primero confirma el paciente y el caso en Preparar expediente.", code: "handoff_required" });
    }
    console.error("[lana-inbox clinical-link]", error.message);
    return json(500, { error: "No se pudo vincular la fotografía al expediente." });
  }
  return json(200, { ok: true, link: data });
}

function queryPath(url: URL, action: string, conversationId: string | null): string | null {
  if (action === "operations") return "/inbox/operations";
  if (action === "stages") return "/inbox/stages";
  if (action === "quick_replies") return "/inbox/quick-replies";
  if (action === "templates") return "/inbox/whatsapp/templates";
  if (action === "scheduled" && conversationId) return `/inbox/conversations/${conversationId}/scheduled`;
  if (action === "sync") {
    const since = text(url.searchParams.get("since"), 60);
    return since ? `/inbox/sync?since=${encodeURIComponent(since)}` : null;
  }
  if (action === "messages" && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["limit", "before", "since"]) {
      const value = text(url.searchParams.get(name), 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/messages${params.size ? `?${params}` : ""}`;
  }
  if ((action === "search" || action === "shared") && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["q", "limit", "before"]) {
      const value = text(url.searchParams.get(name), name === "q" ? 160 : 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/${action}${params.size ? `?${params}` : ""}`;
  }
  if (action !== "list") return null;
  const params = new URLSearchParams();
  for (const name of ["filter", "channel", "limit", "offset", "q"]) {
    const value = text(url.searchParams.get(name), 40);
    if (value) params.set(name, value);
  }
  return `/inbox${params.size ? `?${params}` : ""}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const actor = await actorFor(auth.user, auth.tenantId);
  if (!actor) return json(403, { error: "Tu acceso al equipo de esta clínica no está activo." });

  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = text(url.searchParams.get("action"), 30) || "list";
      const denied = requirePermission(actor, "messages.read", "Tu rol no permite consultar las conversaciones de la clínica.");
      if (denied) return denied;
      if (action === "team") return await listTeam(auth.tenantId);
      if (action === "availability_catalog" || action === "availability") {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar disponibilidad de Agenda.");
        if (scheduleDenied) return scheduleDenied;
        return action === "availability_catalog"
          ? await availabilityCatalog(auth.tenantId)
          : await availableSlots(actor, auth.tenantId, url);
      }
      const conversationId = url.searchParams.get("conversation_id") ? uuid(url.searchParams.get("conversation_id")) : null;
      if (url.searchParams.get("conversation_id") && !conversationId) return json(400, { error: "Conversación no válida." });
      if (action === "appointment_requests" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar solicitudes de Agenda.");
        return scheduleDenied || await appointmentRequests(auth.tenantId, conversationId);
      }
      if (action === "appointment_context" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar la continuidad de Agenda.");
        return scheduleDenied || await appointmentContext(auth.tenantId, conversationId);
      }
      if (action === "clinical_context" && conversationId) {
        const clinicalDenied = requirePermission(actor, "clinical.read", "Tu rol no permite consultar el expediente clínico.");
        return clinicalDenied || await clinicalContext(auth.tenantId, conversationId);
      }
      if (action === "message" && conversationId) {
        const id = messageId(url.searchParams.get("message_id"));
        if (!id) return json(400, { error: "Mensaje no válido." });
        const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
          method: "GET", headers: actorHeaders(actor),
        }, 15000);
        return json(remote.response.status, { ...remote.body, actor });
      }
      const path = queryPath(url, action, conversationId);
      if (!path) return json(400, { error: "Consulta de Inbox no reconocida." });
      const headers = actorHeaders(actor);
      const remote = await lanaRequest(auth.tenantId, path, { method: "GET", headers }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }

    if ((req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite enviar archivos o mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const incoming = await req.formData().catch(() => null);
      if (!incoming) return json(400, { error: "Adjunto no válido." });
      const conversationId = uuid(incoming.get("conversation_id"));
      const file = incoming.get("file");
      if (!conversationId || !(file instanceof File)) return json(400, { error: "Falta la conversación o el archivo." });
      const forwarded = new FormData();
      forwarded.append("file", file, file.name);
      forwarded.append("kind", text(incoming.get("kind"), 20));
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/attachments`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: forwarded,
      }, 60000);
      return json(remote.response.status, { ...remote.body, actor });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(body.action, 30);
    if (action === "pilot") {
      if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede aprobar el piloto." });
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const pilotAction = text(body.pilot_action, 20);
      const forwarded: Record<string, unknown> = { action: pilotAction };
      if (pilotAction === "verify") {
        forwarded.scenario_id = text(body.scenario_id, 40);
        forwarded.evidence = text(body.evidence, 500);
      }
      const remote = await lanaRequest(auth.tenantId, "/inbox/pilot", {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 20000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    const conversationId = uuid(body.conversation_id);
    if (!conversationId) return json(400, { error: "Conversación no válida." });
    if (action === "appointment_request" || action === "appointment_confirm") {
      const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar citas.");
      if (scheduleDenied) return scheduleDenied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      if (action === "appointment_request") return await createAppointmentRequest(actor, auth.tenantId, conversationId, body, idempotencyKey);
      const requestId = uuid(body.request_id);
      if (!requestId) return json(400, { error: "Solicitud no válida." });
      return await confirmAppointmentRequest(actor, auth.tenantId, requestId, idempotencyKey);
    }
    if (action === "clinical_link") {
      const denied = requirePermission(actor, "clinical.write", "Tu rol no permite incorporar archivos al expediente clínico.");
      if (denied) return denied;
      const channel = text(body.channel, 20);
      if (!["whatsapp", "messenger", "instagram"].includes(channel)) return json(400, { error: "Canal no válido." });
      return await linkClinicalImage(auth.tenantId, actor, conversationId, channel, body.message_id, body.label);
    }
    if (action === "copilot") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite preparar respuestas para pacientes.");
      if (denied) return denied;
      const mode = body.mode === "summary" ? "summary" : "draft";
      const clinical = can(actor, "clinical.read")
        ? await copilotClinicalSnapshot(auth.tenantId, conversationId)
        : { patient_confirmed: false, case_confirmed: false, clinical_access: false };
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot`, {
        method: "POST", headers: actorHeaders(actor),
        body: JSON.stringify({ mode, clinical_context: clinical }),
      }, 30000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "feedback") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite evaluar respuestas del asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const id = messageId(body.message_id);
      const rating = text(body.rating, 30);
      if (!idempotencyKey || !id || !["helpful", "needs_improvement", "unsafe"].includes(rating)) {
        return json(400, { error: "Evaluación o Idempotency-Key no válidos." });
      }
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot/feedback`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({
          message_id: id, rating,
          comment: text(body.comment, 1000), ideal_response: text(body.ideal_response, 4000),
        }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "resume_with_context") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite reactivar el asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const summary = text(body.summary, 2000);
      if (!idempotencyKey || !summary) return json(400, { error: "Revisa el resumen y vuelve a intentarlo." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/resume-context`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify({ summary }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "configure_automation") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite cambiar las reglas automáticas del chat.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const hours = body.auto_reactivate_hours === null ? null : Number(body.auto_reactivate_hours);
      if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 168)) return json(400, { error: "Plazo de reactivación no válido." });
      const windowReactivation = body.window_reactivation === null
        ? null : body.window_reactivation === true ? true : body.window_reactivation === false ? false : undefined;
      if (windowReactivation === undefined) return json(400, { error: "Regla de ventana no válida." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/automation`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({ auto_reactivate_hours: hours, window_reactivation: windowReactivation }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "schedule") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite programar mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const type = body.type === "template" ? "template" : "text";
      const forwarded: Record<string, unknown> = { type, send_at: text(body.send_at, 60) };
      if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else forwarded.content = text(body.content, 4000);
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "cancel_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite cancelar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      if (!scheduledId) return json(400, { error: "Mensaje programado no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/cancel`, {
        method: "POST", headers: actorHeaders(actor, uuid(req.headers.get("Idempotency-Key"))), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "retry_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite reintentar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!scheduledId || !idempotencyKey) return json(400, { error: "Mensaje programado o Idempotency-Key no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/retry`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (!["send", "read", "assign", "release", "pause", "resume", "resolve", "pin", "unpin", "stage", "star", "unstar", "delete"].includes(action)) {
      return json(400, { error: "Acción de Inbox no reconocida." });
    }
    const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });

    const permission = ["send", "read", "star", "unstar"].includes(action) ? "messages.respond" : "messages.manage";
    const denied = requirePermission(actor, permission, permission === "messages.respond"
      ? "Tu rol no permite responder conversaciones."
      : "Tu rol no permite organizar ni controlar conversaciones.");
    if (denied) return denied;

    const forwarded: Record<string, unknown> = {};
    if (action === "send") {
      const type = text(body.type, 30) || "text";
      forwarded.type = type;
      if (type === "text") {
        forwarded.content = text(body.content, 4000);
        const replyId = body.reply_to_message_id ? messageId(body.reply_to_message_id) : null;
        if (body.reply_to_message_id && !replyId) return json(400, { error: "Mensaje citado no válido." });
        if (replyId) forwarded.reply_to_message_id = replyId;
      } else if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else if (type === "location") {
        forwarded.latitude = Number(body.latitude); forwarded.longitude = Number(body.longitude);
        forwarded.name = text(body.name, 160); forwarded.address = text(body.address, 300);
      } else if (type === "forward") {
        const sourceConversationId = uuid(body.source_conversation_id);
        const sourceMessageId = messageId(body.source_message_id);
        if (!sourceConversationId || !sourceMessageId) return json(400, { error: "Mensaje de origen no válido." });
        forwarded.source_conversation_id = sourceConversationId;
        forwarded.source_message_id = sourceMessageId;
      } else return json(400, { error: "Tipo de mensaje no reconocido." });
    }
    if (action === "assign") {
      const targetId = uuid(body.target_actor_id) || actor.id;
      const { data: member } = await admin.from("camila_usuarios")
        .select("id,nombre,email,rol,activo")
        .eq("tenant_id", auth.tenantId)
        .eq("id", targetId)
        .eq("activo", true)
        .maybeSingle();
      if (!member) return json(404, { error: "El miembro seleccionado ya no está activo en esta clínica." });
      forwarded.target_actor_id = targetId;
      forwarded.target_actor_name = text(member.nombre, 160) || text(member.email, 160) || "Miembro del equipo";
    }
    if (action === "stage") {
      if (body.target_stage_id === null || body.target_stage_id === "") forwarded.target_stage_id = null;
      else {
        const targetStageId = uuid(body.target_stage_id);
        if (!targetStageId) return json(400, { error: "La etapa seleccionada no es válida." });
        forwarded.target_stage_id = targetStageId;
      }
    }

    const targetMessageId = ["star", "unstar", "delete"].includes(action) ? messageId(body.message_id) : null;
    if (["star", "unstar", "delete"].includes(action) && !targetMessageId) return json(400, { error: "Mensaje no válido." });
    const path = action === "send"
      ? `/inbox/conversations/${conversationId}/messages`
      : targetMessageId
      ? `/inbox/conversations/${conversationId}/messages/${targetMessageId}/${action}`
      : `/inbox/conversations/${conversationId}/${action}`;
    const headers = actorHeaders(actor, idempotencyKey);
    const remote = await lanaRequest(auth.tenantId, path, {
      method: "POST",
      headers,
      body: JSON.stringify(forwarded),
    }, action === "send" ? 30000 : 15000);
    return json(remote.response.status, { ...remote.body, actor });
  } catch (error) {
    console.error("[lana-inbox]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar el Inbox con LANA." });
  }
});
