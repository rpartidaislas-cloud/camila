import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

async function hasPermission(tenantId: string, userId: string, permission: string): Promise<boolean> {
  const { data, error } = await admin.rpc("mila_actor_has_permission", {
    p_tenant_id: tenantId,
    p_actor_id: userId,
    p_permission: permission,
  });
  return !error && data === true;
}

async function getPatient(tenantId: string, patientId: string) {
  if (!isUuid(patientId)) return null;
  const { data } = await admin.from("camila_pacientes")
    .select("id,nombre,apellido,telefono,email")
    .eq("tenant_id", tenantId)
    .eq("id", patientId)
    .maybeSingle();
  return data;
}

async function audit(tenantId: string, userId: string, sessionId: string | null, eventType: string, entityType?: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await admin.from("mila_audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    event_type: eventType,
    entity_type: entityType || null,
    entity_id: entityId || null,
    metadata,
  });
}

async function startToolCall(tenantId: string, userId: string, sessionId: string | null, tool: string, args: Record<string, unknown>) {
  const { data } = await admin.from("mila_tool_calls").insert({
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    tool_name: tool,
    arguments: args,
    status: "started",
  }).select("id").single();
  return data?.id as string | undefined;
}

async function endToolCall(id: string | undefined, result: unknown, error?: string) {
  if (!id) return;
  await admin.from("mila_tool_calls").update({
    status: error ? "failed" : "completed",
    result: error ? null : result,
    error_message: error || null,
    completed_at: new Date().toISOString(),
  }).eq("id", id);
}

async function prepareAppointment(tenantId: string, userId: string, sessionId: string | null, args: Record<string, unknown>) {
  if (!await hasPermission(tenantId, userId, "schedule.manage")) {
    throw new Error("No tienes permiso para administrar la agenda.");
  }
  const patientId = cleanText(args.paciente_id, 50);
  const patient = await getPatient(tenantId, patientId);
  if (!patient) throw new Error("No encontré ese paciente en tu clínica.");
  const branchId = cleanText(args.sucursal_id, 50);
  const professionalId = cleanText(args.profesional_id, 50);
  const serviceId = cleanText(args.servicio_id, 50);
  const roomId = cleanText(args.consultorio_id, 50) || null;
  if (![branchId, professionalId, serviceId].every(isUuid) || (roomId && !isUuid(roomId))) {
    throw new Error("Falta elegir sucursal, profesional o servicio desde las opciones reales de la clínica.");
  }
  const [{ data: branch }, { data: professional }, { data: service }, { data: room }] = await Promise.all([
    admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).eq("id", branchId).eq("active", true).maybeSingle(),
    admin.from("smyl_professionals").select("id,display_name").eq("tenant_id", tenantId).eq("id", professionalId).eq("active", true).maybeSingle(),
    admin.from("smyl_services").select("id,name,patient_name,duration_minutes").eq("tenant_id", tenantId).eq("id", serviceId).eq("active", true).maybeSingle(),
    roomId
      ? admin.from("smyl_rooms").select("id,name,branch_id").eq("tenant_id", tenantId).eq("id", roomId).eq("active", true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!branch || !professional || !service) throw new Error("Una opción de agenda ya no está disponible.");
  if (roomId && (!room || room.branch_id !== branch.id)) throw new Error("El consultorio no pertenece a esa sucursal.");
  const { data: professionalBranch } = await admin.from("smyl_professional_branches")
    .select("professional_id").eq("tenant_id", tenantId).eq("professional_id", professional.id).eq("branch_id", branch.id).maybeSingle();
  if (!professionalBranch) throw new Error("Ese profesional no trabaja en la sucursal seleccionada.");

  const start = new Date(cleanText(args.inicia_en, 80));
  if (!Number.isFinite(start.getTime())) throw new Error("La fecha de la cita no es válida.");
  if (start.getTime() < Date.now() - 60_000) throw new Error("La cita no puede comenzar en el pasado.");
  const duration = Number(service.duration_minutes);
  const reason = cleanText(args.motivo, 500) || "Consulta dental";
  const patientName = `${patient.nombre || ""} ${patient.apellido || ""}`.trim();
  const payload = {
    patient_id: patient.id,
    branch_id: branch.id,
    professional_id: professional.id,
    service_id: service.id,
    room_id: room?.id || null,
    starts_at: start.toISOString(),
    notes: reason,
  };
  const timezone = cleanText(branch.timezone, 80) || "America/Mexico_City";
  const serviceName = cleanText(service.patient_name, 120) || cleanText(service.name, 120);
  const roomLabel = room ? `, ${room.name}` : "";
  const summary = `Crear cita para ${patientName}: ${serviceName}, con ${professional.display_name}, en ${branch.name}${roomLabel}, el ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(start)}. Duración ${duration} minutos. Motivo: ${reason}.`;
  const { data, error } = await admin.from("mila_confirmations").insert({
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    action_type: "crear_cita",
    summary,
    payload,
  }).select("id,summary,expires_at").single();
  if (error || !data) throw new Error("No se pudo preparar la cita.");
  return { ok: true, requires_confirmation: true, confirmation_id: data.id, action_type: "crear_cita", summary: data.summary, expires_at: data.expires_at };
}

async function prepareQuote(tenantId: string, userId: string, sessionId: string | null, args: Record<string, unknown>) {
  if (!await hasPermission(tenantId, userId, "proposal.write")) {
    throw new Error("No tienes permiso para crear propuestas.");
  }
  const patientId = cleanText(args.paciente_id, 50);
  const patient = await getPatient(tenantId, patientId);
  if (!patient) throw new Error("No encontré ese paciente en tu clínica.");
  const requested = Array.isArray(args.partidas) ? args.partidas : [];
  if (!requested.length || requested.length > 20) throw new Error("Incluye entre 1 y 20 partidas.");
  const normalized = requested.map((raw) => {
    const item = (raw || {}) as Record<string, unknown>;
    const serviceId = cleanText(item.servicio_id, 50);
    const quantity = Math.round(Number(item.cantidad));
    if (!isUuid(serviceId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error("Una partida contiene un servicio o cantidad inválidos.");
    }
    return { serviceId, quantity };
  });
  if (new Set(normalized.map((item) => item.serviceId)).size !== normalized.length) {
    throw new Error("Cada servicio debe aparecer una sola vez en la cotización.");
  }
  const { data: plan } = await admin.from("smyl_clinical_plans")
    .select("revision,status,document").eq("tenant_id", tenantId).eq("patient_id", patient.id).maybeSingle();
  if (!plan || plan.status !== "reviewed" || (plan.document as Record<string, unknown> | null)?.schema !== 2) {
    throw new Error("Primero revisa y aprueba el plan clínico vigente del paciente.");
  }
  const { data: services, error: servicesError } = await admin.from("smyl_services")
    .select("id,name,patient_name,reference_price,currency,active")
    .eq("tenant_id", tenantId).eq("active", true).in("id", normalized.map((item) => item.serviceId));
  if (servicesError || !services || services.length !== normalized.length) {
    throw new Error("Uno de los servicios ya no está disponible.");
  }
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const items = normalized.map((requestedItem, index) => {
    const service = serviceMap.get(requestedItem.serviceId);
    const price = Number(service?.reference_price);
    if (!service || !Number.isFinite(price) || price < 0 || service.currency !== "MXN") {
      throw new Error(`El servicio ${service?.name || "seleccionado"} no tiene un precio MXN válido.`);
    }
    return {
      id: `mila-${index + 1}-${service.id.slice(0, 8)}`,
      treatment_id: null,
      service_id: null,
      service_revision: null,
      service_snapshot: null,
      teeth: [],
      surfaces: [],
      label: cleanText(service.patient_name, 200) || cleanText(service.name, 200),
      area: "",
      quantity: requestedItem.quantity,
      unit_cents: Math.round(price * 100),
      currency: "MXN",
    };
  });
  const totalCents = items.reduce((sum, item) => sum + item.unit_cents * item.quantity, 0);
  const patientName = `${patient.nombre || ""} ${patient.apellido || ""}`.trim();
  const summary = `Crear cotización borrador para ${patientName}: ${items.map((item) => `${item.quantity} × ${item.label}`).join(", ")}. Total $${(totalCents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN.`;
  const payload = {
    patient_id: patient.id,
    plan_revision: plan.revision,
    items,
    notes: cleanText(args.notas, 1000) || null,
  };
  const { data, error } = await admin.from("mila_confirmations").insert({
    tenant_id: tenantId,
    user_id: userId,
    session_id: sessionId,
    action_type: "crear_cotizacion",
    summary,
    payload,
  }).select("id,summary,expires_at").single();
  if (error || !data) throw new Error("No se pudo preparar la cotización.");
  return { ok: true, requires_confirmation: true, confirmation_id: data.id, action_type: "crear_cotizacion", summary: data.summary, expires_at: data.expires_at, total: totalCents / 100, currency: "MXN" };
}

async function getClinicOptions(tenantId: string, userId: string, args: Record<string, unknown>) {
  const type = cleanText(args.tipo, 30);
  const query = cleanText(args.consulta, 80).replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  if (type === "cotizacion") {
    if (!await hasPermission(tenantId, userId, "proposal.write")) {
      throw new Error("No tienes permiso para crear propuestas.");
    }
    let request = admin.from("smyl_services")
      .select("id,name,patient_name,reference_price,currency,pricing_mode,scope_type")
      .eq("tenant_id", tenantId).eq("active", true).not("reference_price", "is", null)
      .order("featured", { ascending: false }).order("name").limit(12);
    if (query) request = request.or(`name.ilike.%${query}%,patient_name.ilike.%${query}%`);
    const { data, error } = await request;
    if (error) throw new Error("No se pudo consultar el catálogo dental.");
    return { ok: true, type, services: data || [] };
  }

  if (!await hasPermission(tenantId, userId, "schedule.manage")) {
    throw new Error("No tienes permiso para administrar la agenda.");
  }
  let serviceRequest = admin.from("smyl_services")
    .select("id,name,patient_name,duration_minutes")
    .eq("tenant_id", tenantId).eq("active", true).order("featured", { ascending: false }).order("name").limit(12);
  if (query) serviceRequest = serviceRequest.or(`name.ilike.%${query}%,patient_name.ilike.%${query}%`);
  const [servicesResult, professionalsResult, branchesResult, roomsResult, linksResult] = await Promise.all([
    serviceRequest,
    admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).eq("active", true).order("display_name").limit(20),
    admin.from("smyl_branches").select("id,name,timezone,is_default").eq("tenant_id", tenantId).eq("active", true).order("is_default", { ascending: false }).limit(20),
    admin.from("smyl_rooms").select("id,name,branch_id,room_type").eq("tenant_id", tenantId).eq("active", true).order("name").limit(30),
    admin.from("smyl_professional_branches").select("professional_id,branch_id").eq("tenant_id", tenantId).limit(100),
  ]);
  if (servicesResult.error || professionalsResult.error || branchesResult.error || roomsResult.error || linksResult.error) {
    throw new Error("No se pudieron consultar las opciones de agenda.");
  }
  return {
    ok: true,
    type: "cita",
    services: servicesResult.data || [],
    professionals: professionalsResult.data || [],
    branches: branchesResult.data || [],
    rooms: roomsResult.data || [],
    professional_branches: linksResult.data || [],
  };
}

async function confirmAction(tenantId: string, userId: string, confirmationId: string) {
  if (!isUuid(confirmationId)) throw new Error("Confirmación inválida.");
  const { data, error } = await admin.rpc("mila_confirm_action", {
    p_confirmation_id: confirmationId,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });
  if (error) throw new Error("No se pudo ejecutar la confirmación de forma segura.");
  const result = (data || {}) as Record<string, unknown>;
  if (result.ok !== true) throw new Error(cleanText(result.error, 300) || "La confirmación no está disponible.");
  const entity = result.result && typeof result.result === "object" ? result.result as Record<string, unknown> : {};
  const entityType = cleanText(result.entity_type, 80);
  const sessionId = isUuid(result.session_id) ? result.session_id : null;
  await audit(tenantId, userId, sessionId, "mila_action_confirmed", entityType, cleanText(entity.id, 80), { confirmation_id: confirmationId, already_completed: result.already_completed === true });
  return result;
}

async function finishSession(tenantId: string, userId: string, sessionId: string) {
  if (!isUuid(sessionId)) throw new Error("Sesión inválida.");
  const { data: session } = await admin.from("mila_sessions")
    .select("id,modo,estado,started_at,duracion_segundos,modelo")
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!session) throw new Error("No encontré la sesión de MILA.");
  if (session.estado === "completada" && session.duracion_segundos) {
    return { ok: true, duration_seconds: session.duracion_segundos, already_completed: true };
  }
  const seconds = Math.max(1, Math.min(3600, Math.ceil((Date.now() - new Date(session.started_at).getTime()) / 1000)));
  const { data: usage, error: usageError } = await admin.rpc("smyl_consume", {
    p_tenant_id: tenantId,
    p_resource: "mila_seconds",
    p_quantity_units: seconds,
    p_idempotency_key: `mila-conversation:${session.id}`,
    p_source_type: "mila_conversa",
    p_source_id: session.id,
    p_provider: "openai",
    p_provider_model: session.modelo,
    p_metadata: {},
    p_enforce: CONSUMABLES_ENFORCED,
  });
  if (usageError) throw new Error("No se pudo registrar el consumo de la sesión.");
  await admin.from("mila_sessions").update({
    estado: "completada",
    duracion_segundos: seconds,
    ended_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", session.id);
  await audit(tenantId, userId, session.id, "mila_conversation_completed", "mila_session", session.id, { duration_seconds: seconds });
  return { ok: true, duration_seconds: seconds, usage: usage?.[0] || null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Body inválido." });
  }
  const action = cleanText(body.action, 80);
  const args = body.arguments && typeof body.arguments === "object" ? body.arguments as Record<string, unknown> : {};
  const sessionId = body.session_id == null || body.session_id === "" ? null : cleanText(body.session_id, 50);
  if (sessionId !== null && !isUuid(sessionId)) return json(400, { error: "session_id inválido." });

  const toolCallId = await startToolCall(tenantId, user.id, sessionId, action, args);
  try {
    let result: unknown;
    if (action === "buscar_paciente") {
      if (!await hasPermission(tenantId, user.id, "patients.read")) throw new Error("No tienes permiso para consultar pacientes.");
      const query = cleanText(args.consulta, 100)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}+\s-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (query.length < 2) throw new Error("Dime al menos dos caracteres del nombre o teléfono.");
      const { data, error } = await admin.from("camila_pacientes")
        .select("id,nombre,apellido,telefono")
        .eq("tenant_id", tenantId)
        .or(`nombre.ilike.%${query}%,apellido.ilike.%${query}%,telefono.ilike.%${query}%`)
        .limit(5);
      if (error) throw new Error("No se pudo buscar pacientes.");
      result = { ok: true, patients: data || [] };
    } else if (action === "buscar_opciones_clinica") {
      result = await getClinicOptions(tenantId, user.id, args);
    } else if (action === "preparar_cita") {
      result = await prepareAppointment(tenantId, user.id, sessionId, args);
    } else if (action === "preparar_cotizacion") {
      result = await prepareQuote(tenantId, user.id, sessionId, args);
    } else if (action === "confirm_action") {
      result = await confirmAction(tenantId, user.id, cleanText(args.confirmation_id, 50));
    } else if (action === "cancel_action") {
      const confirmationId = cleanText(args.confirmation_id, 50);
      if (!isUuid(confirmationId)) throw new Error("Confirmación inválida.");
      const { data } = await admin.from("mila_confirmations")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", confirmationId).eq("tenant_id", tenantId).eq("user_id", user.id).eq("status", "pending")
        .select("id").maybeSingle();
      result = { ok: Boolean(data), cancelled: Boolean(data) };
    } else if (action === "approve_note") {
      const noteId = cleanText(args.note_id, 50);
      if (!isUuid(noteId)) throw new Error("Nota inválida.");
      const { data } = await admin.from("mila_clinical_notes")
        .update({ status: "aprobada", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", noteId).eq("tenant_id", tenantId).eq("status", "borrador")
        .select("id,status").maybeSingle();
      if (!data) throw new Error("La nota no está disponible o ya fue revisada.");
      await audit(tenantId, user.id, sessionId, "mila_note_approved", "mila_clinical_note", noteId);
      result = { ok: true, note: data };
    } else if (action === "discard_note") {
      const noteId = cleanText(args.note_id, 50);
      if (!isUuid(noteId)) throw new Error("Nota inválida.");
      const { data } = await admin.from("mila_clinical_notes")
        .update({ status: "descartada", updated_at: new Date().toISOString() })
        .eq("id", noteId).eq("tenant_id", tenantId).eq("status", "borrador")
        .select("id,status").maybeSingle();
      if (!data) throw new Error("La nota no está disponible o ya fue revisada.");
      await audit(tenantId, user.id, sessionId, "mila_note_discarded", "mila_clinical_note", noteId);
      result = { ok: true, note: data };
    } else if (action === "finish_session") {
      result = await finishSession(tenantId, user.id, sessionId || cleanText(args.session_id, 50));
    } else {
      throw new Error("Acción de MILA no permitida.");
    }
    await endToolCall(toolCallId, result);
    return json(200, result);
  } catch (error) {
    const message = (error as Error).message || "No se pudo completar la acción.";
    console.error("[mila-actions]", action, message);
    await endToolCall(toolCallId, null, message);
    return json(400, { error: message });
  }
});
