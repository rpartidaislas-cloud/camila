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

type Actor = { id: string; name: string; role: "owner" | "staff" };

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
  return {
    id: user.id,
    name: text(data?.nombre, 160) || text(data?.email, 160) || fallback,
    role: isOwner ? "owner" : "staff",
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
      if (action === "team") return await listTeam(auth.tenantId);
      const conversationId = url.searchParams.get("conversation_id") ? uuid(url.searchParams.get("conversation_id")) : null;
      if (url.searchParams.get("conversation_id") && !conversationId) return json(400, { error: "Conversación no válida." });
      if (action === "clinical_context" && conversationId) return await clinicalContext(auth.tenantId, conversationId);
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
    if (action === "clinical_link") {
      const channel = text(body.channel, 20);
      if (!["whatsapp", "messenger", "instagram"].includes(channel)) return json(400, { error: "Canal no válido." });
      return await linkClinicalImage(auth.tenantId, actor, conversationId, channel, body.message_id, body.label);
    }
    if (action === "copilot") {
      const mode = body.mode === "summary" ? "summary" : "draft";
      const clinical = await copilotClinicalSnapshot(auth.tenantId, conversationId);
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot`, {
        method: "POST", headers: actorHeaders(actor),
        body: JSON.stringify({ mode, clinical_context: clinical }),
      }, 30000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "feedback") {
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
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const summary = text(body.summary, 2000);
      if (!idempotencyKey || !summary) return json(400, { error: "Revisa el resumen y vuelve a intentarlo." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/resume-context`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify({ summary }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "configure_automation") {
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
      const scheduledId = messageId(body.scheduled_id);
      if (!scheduledId) return json(400, { error: "Mensaje programado no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/cancel`, {
        method: "POST", headers: actorHeaders(actor, uuid(req.headers.get("Idempotency-Key"))), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "retry_scheduled") {
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
      if (actor.role !== "owner" && targetId !== actor.id) return json(403, { error: "Solo el dueño puede asignar conversaciones a otras personas." });
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
