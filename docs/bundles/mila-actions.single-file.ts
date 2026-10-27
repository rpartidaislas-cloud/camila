// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/mila-actions/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth-membership.ts ──
const { decidirMembresia } = (() => {
// Decisión pura (sin red) sobre la membresía de quien llama a una Edge Function privada.
// Vive aparte de auth.ts para poder probarla sin Deno ni Supabase.
//
// `row` es la fila de camila_usuarios de la persona (o null si no tiene: el dueño de siempre
// es una cuenta cuyo id = tenant_id y puede no tener fila). Si la fila existe pero está
// desactivada, la persona ya no pertenece al equipo: no se le resuelve ninguna clínica
// (antes se ignoraba `activo` y un staff dado de baja seguía usando las funciones con el
// service role).
interface FilaMembresia {
  tenant_id?: string | null;
  activo?: boolean | null;
}

type DecisionMembresia = { tenantId: string } | { inactivo: true };

function decidirMembresia(row: FilaMembresia | null | undefined, userId: string): DecisionMembresia {
  if (row && row.activo === false) return { inactivo: true };
  if (row?.tenant_id) return { tenantId: row.tenant_id };
  return { tenantId: userId };
}

return { decidirMembresia };
})();

// ── _shared/auth.ts ──
const { requireUser, requirePermission } = (() => {
// Verificación obligatoria de sesión para Edge Functions privadas.
// Una publishable key identifica el proyecto, pero nunca autentica a una
// persona. Los flujos públicos deben usar funciones separadas con capacidades
// limitadas; nunca deben reutilizar este helper ni aceptar tenant_id del cliente.


// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectadas automáticamente
// en el entorno de toda Edge Function. `segment-teeth` usa nombres propios
// (SB_URL / SB_SERVICE_ROLE_KEY) porque el prefijo SUPABASE_ está reservado
// y no se puede definir a mano en Secrets, así que aceptamos ambos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

interface AuthResult {
  user: { id: string; email?: string } | null;
  // La clínica real de quien llama -- NO uses user.id para topes de gasto,
  // RPCs ni escrituras con tenant_id, usa siempre este campo. Para el dueño
  // coincide con user.id (de siempre); para staff invitado (etapa 4, ver
  // camila_team.sql/camila_usuarios) es la clínica de quien lo invitó.
  // Antes de esto, claude/index.ts y segment-teeth/index.ts usaban user.id
  // directo: camila_consumir_diagnostico nunca encontraba la fila de un
  // staff en camila_tenants (rechazo 402, "no se encontró tu clínica"), y
  // segment-teeth guardaba la segmentación con un tenant_id que no
  // pertenecía a ningún caso real -- se perdía en silencio. null si no hay
  // sesión.
  tenantId: string | null;
  response: Response | null; // si no es null, devuélvela tal cual y no sigas
}

// Mismo patrón que ya usa el cliente (cargarTenantConfig() en
// simulacion.html, continuarConUsuario() en app.html): resuelve si quien
// llama es staff antes de asumir que su propio auth.uid() es el tenant.
// Si la persona tiene fila en camila_usuarios pero está desactivada, ya no pertenece al equipo y no
// se le resuelve ninguna clínica (decidirMembresia, _shared/auth-membership.ts).
async function resolverMembresia(userId: string): Promise<DecisionMembresia> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return decidirMembresia(data, userId);
}

async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
  const deny = (msg: string) => ({
    user: null,
    tenantId: null,
    response: new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return deny('No autenticado: falta el header Authorization.');

  // Esta llamada corre ANTES de cualquier otro código de la función (incluido
  // el fetchConTimeout de claude/index.ts) -- si se queda colgada sin límite
  // de tiempo, la plataforma mata el proceso a medio camino sin headers de
  // CORS ("CORS error" en el navegador) y ningún timeout más adelante en el
  // código llega siquiera a ejecutarse. Se le pone su propio límite (8s,
  // suficiente para una llamada a la API de Auth de Supabase en condiciones
  // normales) para que, si falla, devuelva una respuesta real con CORS en
  // vez de dejar que la plataforma la corte a ciegas.
  let seTardo = false;
  const timeout = new Promise<{ data: null }>((resolve) => {
    setTimeout(() => { seTardo = true; resolve({ data: null }); }, 8000);
  });
  const { data } = await Promise.race([
    admin.auth.getUser(jwt).catch(() => ({ data: null })),
    timeout,
  ]);
  if (data?.user) {
    try {
      const membresia = await resolverMembresia(data.user.id);
      if ('inactivo' in membresia) {
        return {
          user: null,
          tenantId: null,
          response: new Response(JSON.stringify({ error: 'Tu acceso a esta clínica está desactivado. Pide al dueño que lo reactive.' }), {
            status: 403,
            headers: { ...cors, 'Content-Type': 'application/json' },
          }),
        };
      }
      return { user: { id: data.user.id, email: data.user.email }, tenantId: membresia.tenantId, response: null };
    } catch (error) {
      console.error('[auth] no se pudo resolver el tenant del usuario:', error instanceof Error ? error.message : 'error desconocido');
      return {
        user: null,
        tenantId: null,
        response: new Response(JSON.stringify({ error: 'No se pudo verificar el acceso a la clínica. Intenta de nuevo.' }), {
          status: 503,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }),
      };
    }
  }

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');

  return deny('No autenticado: la sesión no es válida o ya expiró.');
}

// Exige un permiso del modelo de roles de SMYL (smyl_member_roles / smyl_role_permissions) además de
// la sesión. El dueño (user.id === tenantId) siempre pasa; el staff solo si su rol activo tiene el
// permiso. Falla cerrado: si la consulta falla, se niega. Devuelve una Response para regresar tal
// cual, o null si se puede continuar.
async function requirePermission(
  auth: AuthResult,
  cors: Record<string, string>,
  permission: string,
): Promise<Response | null> {
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!auth.user || !auth.tenantId) return reply(401, 'Necesitas iniciar sesión.');
  if (auth.user.id === auth.tenantId) return null;
  const { data, error } = await admin.rpc('smyl_actor_has_permission_explicit', {
    p_actor: auth.user.id,
    p_tenant: auth.tenantId,
    p_permission: permission,
  });
  if (error) {
    console.error('[auth] no se pudo verificar el permiso:', error.message);
    return reply(503, 'No se pudo verificar tu permiso. Intenta de nuevo.');
  }
  if (data !== true) return reply(403, 'Tu rol no tiene permiso para esta acción.');
  return null;
}

return { requireUser, requirePermission };
})();

// ── _shared/cors.ts ──
const { makeCors, corsPublic, corsHeaders } = (() => {
// Orígenes autorizados para funciones privadas (autenticadas).
// Las funciones públicas (webhooks, portales de paciente) usan corsPublic o "*" directamente.
const ALLOWED_ORIGINS = new Set([
  'https://app.smyldesign.ai',
  'https://rpartidaislas-cloud.github.io',
]);

// Para funciones privadas: refleja el origen si está en la lista; si no, bloquea con el origen
// principal. Siempre incluye Vary:Origin para que las cachés no reutilicen respuestas entre orígenes.
function makeCors(req: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.smyldesign.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
    'Vary': 'Origin',
  };
}

// Para endpoints públicos que legítimamente necesitan "*" (portales de paciente, formularios públicos).
const corsPublic: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Alias de compatibilidad hacia atrás (stripe-checkout, stripe-portal).
const corsHeaders = corsPublic;

return { makeCors, corsPublic, corsHeaders };
})();

// ── mila-actions/index.ts ──
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

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
  const CORS = makeCors(req);
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
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
