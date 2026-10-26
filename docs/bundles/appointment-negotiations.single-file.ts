// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/appointment-negotiations/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth.ts ──
const { requireUser } = (() => {
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
async function resolverTenantId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data?.tenant_id) return data.tenant_id;
  return userId;
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
      const tenantId = await resolverTenantId(data.user.id);
      return { user: { id: data.user.id, email: data.user.email }, tenantId, response: null };
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

return { requireUser };
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

// ── _shared/lana-contract.mjs ──
const { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders } = (() => {
const SMYL_LANA_CONTRACT_VERSION = "1.6";

const ALLOWED_ROOTS = new Set([
  "attention",
  "channels",
  "context",
  "contract",
  "conversations",
  "inbox",
  "training",
]);

function normalizeLanaPath(input: any) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const rawPath = raw.split(/[?#]/, 1)[0];
  let rawSegments;
  try {
    rawSegments = rawPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Ruta LANA no permitida.");
  }
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const parsed = new URL(raw, "https://lana.invalid");
  if (parsed.origin !== "https://lana.invalid" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Ruta LANA no permitida.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!segments.length) throw new Error("Ruta LANA no permitida.");
  if (!ALLOWED_ROOTS.has(segments[0])) throw new Error("Endpoint LANA no permitido.");

  return `${parsed.pathname}${parsed.search}`;
}

function lanaContractHeaders() {
  return { "X-SMYL-LANA-Contract-Version": SMYL_LANA_CONTRACT_VERSION };
}

return { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders };
})();

// ── _shared/lana-linked.ts ──
const { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin } = (() => {

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_LANA_ENCRYPTION_KEY") || "").trim();
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  estado: string;
};

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cryptoKey(): Promise<CryptoKey> {
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada correctamente.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

async function linkedLanaApiKey(tenantId: string): Promise<string> {
  const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la configuración de la clínica.");
  const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  const integrations = config.integraciones && typeof config.integraciones === "object"
    ? config.integraciones as Record<string, unknown> : {};
  const lana = integrations.lana && typeof integrations.lana === "object"
    ? integrations.lana as Partial<LanaConfig> : null;
  if (!lana?.api_key_ciphertext || !lana.api_key_iv || lana.estado !== "conectada") {
    throw new Error("LANA todavía no está conectada o requiere atención.");
  }
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(lana.api_key_iv) },
    await cryptoKey(),
    base64ToBytes(lana.api_key_ciphertext),
  );
  return new TextDecoder().decode(clear);
}

async function lanaRequest(
  tenantId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safePath = normalizeLanaPath(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await linkedLanaApiKey(tenantId)}`);
    headers.set("Accept", "application/json");
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(lanaContractHeaders())) headers.set(name, value);
    const response = await fetch(`${LANA_API_BASE}${safePath}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}


return { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin: admin };
})();

// ── appointment-negotiations/index.ts ──
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
