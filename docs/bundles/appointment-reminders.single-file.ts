// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/appointment-reminders/index.ts con sus archivos de _shared incluidos,
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

// ── appointment-reminders/index.ts ──
// Recordatorios automáticos de cita por WhatsApp (fase 4 del chat).
//
// SMYL ya genera una fila en smyl_appointment_reminders 24 h antes de cada
// cita. Esta función la entrega a LANA como mensaje programado con una
// plantilla aprobada por Meta; el trabajador de LANA lo envía a su hora,
// aunque nadie tenga SMYL abierto. Se invoca:
//   - desde el navegador al agendar/reprogramar y al abrir la Agenda o Mensajes
//     (action "dispatch"), y
//   - opcionalmente desde un cron con el header x-smyl-cron-secret, que procesa
//     todas las clínicas con recordatorios activos.
// Todas las operaciones son idempotentes: la clave hacia LANA es el id del
// recordatorio, así que un reintento nunca duplica el mensaje.


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const CRON_SECRET = (Deno.env.get("SMYL_REMINDERS_CRON_SECRET") || "").trim();
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const SOURCES = [
  "patient_first_name", "patient_name", "date", "time", "service",
  "professional", "branch", "branch_phone", "clinic", "text",
] as const;
type Source = typeof SOURCES[number];
type Variable = { source: Source; value?: string };

const SEND_LEAD_MS = 2 * 60 * 1000;
const MIN_NOTICE_MS = 2 * 60 * 60 * 1000;
const WAIT_LINK_MS = 60 * 60 * 1000;
const MAX_TRANSIENT_ATTEMPTS = 5;
const NO_WHATSAPP = "El paciente no tiene una conversación de WhatsApp vinculada en Mensajes.";

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

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sameSecret(given: string, expected: string): boolean {
  if (!expected || expected.length < 32 || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Los permisos se resuelven con las mismas funciones SQL que usa RLS, con el JWT de quien llama.
async function permissions(jwt: string, tenantId: string, keys: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  if (!SB_ANON_KEY) { keys.forEach((key) => { result[key] = false; }); return result; }
  const client = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  await Promise.all(keys.map(async (key) => {
    const { data, error } = await client.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: key });
    result[key] = !error && data === true;
  }));
  return result;
}

function systemHeaders(tenantId: string, idempotencyKey: string): Headers {
  // El recordatorio sale a nombre de la clínica (la cuenta propietaria), no de un miembro.
  return new Headers({
    "X-SMYL-Actor-Id": tenantId,
    "X-SMYL-Actor-Role": "owner",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent("Recordatorios SMYL"),
    "Idempotency-Key": idempotencyKey,
  });
}

// LANA exige saber quién consulta, incluso en lecturas (igual que lana-inbox).
function userHeaders(user: { id: string; email?: string }, tenantId: string): Headers {
  const name = text(user.email, 160).split("@")[0] || "Miembro del equipo";
  return new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(name),
  });
}

function validTimeZone(value: unknown): string {
  const zone = text(value, 60) || "America/Mexico_City";
  try { new Intl.DateTimeFormat("es-MX", { timeZone: zone }); return zone; } catch { return "America/Mexico_City"; }
}

type Claimed = {
  reminder_id: string; appointment_id: string; reminder_type: string; scheduled_for: string; attempt_count: number;
  starts_at: string; patient_id: string; patient_first_name: string | null; patient_last_name: string | null;
  service_name: string | null; professional_name: string | null; branch_name: string | null;
  branch_phone: string | null; branch_timezone: string | null;
};

function renderVariable(variable: Variable, row: Claimed, clinicName: string): string {
  const zone = validTimeZone(row.branch_timezone);
  const start = new Date(row.starts_at);
  const first = text(row.patient_first_name, 120);
  switch (variable.source) {
    case "patient_first_name": return first || "paciente";
    case "patient_name": return [first, text(row.patient_last_name, 120)].filter(Boolean).join(" ") || "paciente";
    // "miércoles 21 de octubre": sin la coma que agrega Intl, para que se lea bien dentro de la frase.
    case "date": return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(start).replace(",", "");
    case "time": return new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(start);
    case "service": return text(row.service_name, 120) || "tu cita";
    case "professional": return text(row.professional_name, 120) || clinicName;
    case "branch": return text(row.branch_name, 120) || clinicName;
    case "branch_phone": return text(row.branch_phone, 40) || "";
    case "clinic": return clinicName;
    case "text": return text(variable.value, 200);
  }
}

function normalizeVariables(value: unknown): Variable[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const rows: Variable[] = [];
  for (const item of value) {
    const source = item && typeof item === "object" ? String((item as Record<string, unknown>).source || "") : "";
    if (!SOURCES.includes(source as Source)) return null;
    const row: Variable = { source: source as Source };
    if (source === "text") {
      row.value = text((item as Record<string, unknown>).value, 200);
      if (!row.value) return null;
    }
    rows.push(row);
  }
  return rows;
}

async function clinicName(tenantId: string): Promise<string> {
  const { data } = await admin.from("camila_tenants").select("nombre,config").eq("id", tenantId).maybeSingle();
  const config = data?.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  return text(config.consultorio, 120) || text(data?.nombre, 120) || "tu clínica";
}

async function whatsappConversation(tenantId: string, patientId: string): Promise<string | null> {
  const { data } = await admin.from("camila_lana_handoffs")
    .select("lana_conversation_id")
    .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("lana_channel", "whatsapp")
    .order("updated_at", { ascending: false }).limit(1);
  return data && data[0] ? String(data[0].lana_conversation_id) : null;
}

async function cancelInLana(tenantId: string, conversationId: string, scheduledId: string): Promise<{ done: boolean; status: string }> {
  try {
    const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/cancel`, {
      method: "POST", headers: systemHeaders(tenantId, crypto.randomUUID()), body: "{}",
    }, 15000);
    const scheduled = remote.body.scheduled as Record<string, unknown> | undefined;
    // 404/409/422: ya se envió, ya estaba cancelado o ya no existe; no hay nada que cancelar.
    const done = remote.response.ok || [404, 409, 422].includes(remote.response.status);
    return { done, status: text(scheduled?.status, 40) || (done ? "cancelado" : "") };
  } catch {
    return { done: false, status: "" };
  }
}

async function processCancellations(tenantId: string): Promise<number> {
  let cancelled = 0;
  const { data: toCancel } = await admin.from("smyl_appointment_reminders")
    .select("id,provider_reference,provider_conversation_id")
    .eq("tenant_id", tenantId).eq("provider_cancel_required", true).limit(50);
  for (const row of toCancel || []) {
    if (!row.provider_reference || !row.provider_conversation_id) {
      await admin.from("smyl_appointment_reminders").update({ provider_cancel_required: false }).eq("id", row.id);
      continue;
    }
    const result = await cancelInLana(tenantId, row.provider_conversation_id, row.provider_reference);
    if (!result.done) continue;
    await admin.from("smyl_appointment_reminders")
      .update({ provider_cancel_required: false, provider_status: result.status }).eq("id", row.id);
    cancelled += 1;
  }
  return cancelled;
}

// Al desactivar, nada que esté en cola debe salir: se cancela aquí y en LANA.
async function cancelQueued(tenantId: string): Promise<number> {
  const { data: queued } = await admin.from("smyl_appointment_reminders")
    .select("id,provider_reference")
    .eq("tenant_id", tenantId).in("status", ["pending", "processing"]).limit(500);
  for (const row of queued || []) {
    await admin.from("smyl_appointment_reminders").update({
      status: "cancelled", provider_cancel_required: Boolean(row.provider_reference),
      last_error: "Recordatorios desactivados por la clínica.", next_attempt_at: null,
    }).eq("id", row.id).in("status", ["pending", "processing"]);
  }
  return processCancellations(tenantId);
}

type Summary = { scheduled: number; waiting: number; failed: number; skipped: number; cancelled_in_lana: number; synced: number; error?: string };

async function dispatchTenant(tenantId: string): Promise<Summary> {
  const summary: Summary = { scheduled: 0, waiting: 0, failed: 0, skipped: 0, cancelled_in_lana: 0, synced: 0 };
  const { data: settings } = await admin.from("smyl_reminder_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!settings?.enabled || !settings.template_id) return { ...summary, error: "disabled" };
  await admin.from("smyl_reminder_settings").update({ last_dispatch_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  const variables = normalizeVariables(settings.variables) || [];
  const clinic = await clinicName(tenantId);

  // 1. Citas movidas o canceladas cuyo recordatorio ya estaba programado en LANA.
  summary.cancelled_in_lana = await processCancellations(tenantId);

  // 2. Entregar a LANA los recordatorios pendientes.
  const { data: claimed, error: claimError } = await admin.rpc("smyl_claim_appointment_reminders", { p_tenant_id: tenantId, p_limit: 25 });
  if (claimError) return { ...summary, error: "No se pudieron leer los recordatorios pendientes." };
  const now = Date.now();
  for (const row of (claimed || []) as Claimed[]) {
    const startsAt = new Date(row.starts_at).getTime();
    const dueAt = new Date(row.scheduled_for).getTime();
    if (startsAt - now < MIN_NOTICE_MS) {
      await admin.from("smyl_appointment_reminders").update({
        status: "cancelled", last_error: "Se omitió: la cita está a menos de 2 horas.",
      }).eq("id", row.reminder_id).eq("status", "processing");
      summary.skipped += 1;
      continue;
    }
    const conversationId = await whatsappConversation(tenantId, row.patient_id);
    if (!conversationId) {
      const overdue = now >= dueAt;
      await admin.from("smyl_appointment_reminders").update(overdue
        ? { status: "failed", last_error: NO_WHATSAPP }
        : { status: "pending", last_error: NO_WHATSAPP, next_attempt_at: new Date(Math.min(now + WAIT_LINK_MS, dueAt)).toISOString() },
      ).eq("id", row.reminder_id).eq("status", "processing");
      if (overdue) summary.failed += 1; else summary.waiting += 1;
      continue;
    }
    const payload = {
      type: "template",
      send_at: new Date(Math.max(dueAt, now + SEND_LEAD_MS)).toISOString(),
      template_id: settings.template_id,
      template_variables: variables.map((variable) => renderVariable(variable, row, clinic).slice(0, 1000)),
    };
    let status = 0; let body: Record<string, unknown> = {};
    try {
      const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/scheduled`, {
        method: "POST", headers: systemHeaders(tenantId, row.reminder_id), body: JSON.stringify(payload),
      }, 15000);
      status = remote.response.status; body = remote.body;
    } catch (error) {
      body = { error: error instanceof Error && /LANA todavía no está conectada/.test(error.message) ? error.message : "LANA no respondió a tiempo." };
    }
    const scheduled = body.scheduled as Record<string, unknown> | undefined;
    if (status >= 200 && status < 300 && scheduled?.id != null) {
      const reference = String(scheduled.id).slice(0, 80);
      const { data: kept } = await admin.from("smyl_appointment_reminders").update({
        provider_reference: reference, provider_conversation_id: conversationId,
        provider_status: text(scheduled.status, 40) || "pendiente", last_error: "", delivery_channel: "whatsapp",
      }).eq("id", row.reminder_id).eq("status", "processing").select("id");
      // La cita se movió mientras LANA respondía: el trigger ya canceló la fila, así que se cancela allá también.
      if (!kept?.length) {
        const result = await cancelInLana(tenantId, conversationId, reference);
        await admin.from("smyl_appointment_reminders").update({
          provider_reference: reference, provider_conversation_id: conversationId,
          provider_cancel_required: !result.done, provider_status: result.status,
        }).eq("id", row.reminder_id);
        continue;
      }
      summary.scheduled += 1;
      continue;
    }
    const message = text(body.error, 400) || `LANA rechazó el recordatorio (HTTP ${status || "sin respuesta"}).`;
    const transient = status === 0 || status === 429 || status >= 500;
    if (transient && row.attempt_count < MAX_TRANSIENT_ATTEMPTS && now < startsAt - MIN_NOTICE_MS) {
      await admin.from("smyl_appointment_reminders").update({
        status: "pending", last_error: message,
        next_attempt_at: new Date(now + row.attempt_count * 5 * 60 * 1000).toISOString(),
      }).eq("id", row.reminder_id).eq("status", "processing");
      summary.waiting += 1;
    } else {
      await admin.from("smyl_appointment_reminders").update({ status: "failed", last_error: message })
        .eq("id", row.reminder_id).eq("status", "processing");
      summary.failed += 1;
    }
  }

  // 3. Sincronizar con LANA el resultado de los que ya debían salir.
  const { data: inFlight } = await admin.from("smyl_appointment_reminders")
    .select("id,provider_reference,provider_conversation_id")
    .eq("tenant_id", tenantId).eq("status", "processing").not("provider_reference", "is", null)
    .lte("scheduled_for", new Date(now + SEND_LEAD_MS).toISOString()).limit(30);
  const byConversation = new Map<string, { id: string; reference: string }[]>();
  for (const row of inFlight || []) {
    if (!row.provider_conversation_id) continue;
    const list = byConversation.get(row.provider_conversation_id) || [];
    list.push({ id: row.id, reference: String(row.provider_reference) });
    byConversation.set(row.provider_conversation_id, list);
  }
  for (const [conversationId, rows] of byConversation) {
    let items: Record<string, unknown>[] = [];
    try {
      const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/scheduled`, {
        method: "GET", headers: systemHeaders(tenantId, crypto.randomUUID()),
      }, 12000);
      if (!remote.response.ok) continue;
      items = Array.isArray(remote.body.scheduled) ? remote.body.scheduled as Record<string, unknown>[] : [];
    } catch { continue; }
    for (const row of rows) {
      const item = items.find((candidate) => String(candidate.id) === row.reference);
      if (!item) continue;
      const providerStatus = text(item.status, 40);
      const update: Record<string, unknown> = { provider_status: providerStatus };
      if (providerStatus === "enviado") { update.status = "sent"; update.sent_at = text(item.sent_at, 40) || new Date().toISOString(); }
      else if (providerStatus === "fallido" || providerStatus === "dead_letter") { update.status = "failed"; update.last_error = text(item.last_error, 400) || "LANA no pudo enviar el recordatorio."; }
      else if (providerStatus === "cancelado") update.status = "cancelled";
      await admin.from("smyl_appointment_reminders").update(update).eq("id", row.id).eq("status", "processing");
      summary.synced += 1;
    }
  }
  return summary;
}

async function templates(tenantId: string, headers: Headers): Promise<{ templates: Record<string, unknown>[]; error?: string }> {
  try {
    const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates", { method: "GET", headers }, 12000);
    if (!remote.response.ok) return { templates: [], error: text(remote.body.error, 300) || "LANA no devolvió las plantillas." };
    const list = Array.isArray(remote.body.templates) ? remote.body.templates as Record<string, unknown>[] : [];
    return {
      templates: list.map((item) => ({
        id: item.id, name: text(item.name, 200), language: text(item.language, 20), body: text(item.body, 2000),
        variable_count: Number(item.variable_count) || 0, category: text(item.category, 40), status: text(item.status, 40),
      })).filter((item) => uuid(item.id)),
    };
  } catch (error) {
    return { templates: [], error: error instanceof Error ? error.message : "LANA no está disponible." };
  }
}

async function overview(tenantId: string): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin.from("smyl_appointment_reminders")
    .select("status,provider_reference,last_error")
    .eq("tenant_id", tenantId).gte("scheduled_for", since).limit(1000);
  const counts = { scheduled: 0, waiting: 0, sent: 0, failed: 0 };
  for (const row of data || []) {
    if (row.status === "processing" && row.provider_reference) counts.scheduled += 1;
    else if (row.status === "pending" || row.status === "processing") counts.waiting += 1;
    else if (row.status === "sent") counts.sent += 1;
    else if (row.status === "failed") counts.failed += 1;
  }
  return counts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const cronSecret = req.headers.get("x-smyl-cron-secret") || "";
  if (cronSecret) {
    if (!sameSecret(cronSecret, CRON_SECRET)) return json(401, { error: "Secreto de cron no válido." });
    const { data: enabled } = await admin.from("smyl_reminder_settings").select("tenant_id").eq("enabled", true).limit(200);
    const results: Record<string, Summary> = {};
    for (const row of enabled || []) results[row.tenant_id] = await dispatchTenant(row.tenant_id).catch(() => ({ scheduled: 0, waiting: 0, failed: 0, skipped: 0, cancelled_in_lana: 0, synced: 0, error: "Error inesperado." }));
    return json(200, { tenants: Object.keys(results).length, results });
  }

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const tenantId = auth.tenantId!;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action, 40);
  const can = await permissions(jwt, tenantId, ["schedule.read", "schedule.manage", "messages.respond"]);
  if (!can["schedule.read"]) return json(403, { error: "Tu rol no permite consultar la agenda.", code: "permission_denied" });
  const canConfigure = can["schedule.manage"] && can["messages.respond"];

  if (action === "settings") {
    const { data: settings } = await admin.from("smyl_reminder_settings")
      .select("enabled,template_id,template_name,template_language,variables,last_dispatch_at,updated_at")
      .eq("tenant_id", tenantId).maybeSingle();
    const catalog = canConfigure ? await templates(tenantId, userHeaders(auth.user!, tenantId)) : { templates: [] };
    return json(200, {
      settings: settings || { enabled: false, template_id: null, template_name: "", template_language: "", variables: [], last_dispatch_at: null },
      can_configure: canConfigure, sources: SOURCES, overview: await overview(tenantId), ...catalog,
    });
  }

  if (action === "save_settings") {
    if (!canConfigure) return json(403, { error: "Tu rol no permite configurar recordatorios.", code: "permission_denied" });
    const enabled = body.enabled === true;
    // Apagar siempre debe funcionar, aunque LANA no responda o la plantilla ya no exista.
    if (!enabled) {
      const { error } = await admin.from("smyl_reminder_settings").upsert({ tenant_id: tenantId, enabled: false, updated_by: auth.user!.id }, { onConflict: "tenant_id" });
      if (error) return json(500, { error: "No se pudo guardar la configuración." });
      return json(200, { ok: true, cancelled_in_lana: await cancelQueued(tenantId) });
    }
    const templateId = body.template_id == null || body.template_id === "" ? null : uuid(body.template_id);
    const variables = normalizeVariables(body.variables);
    if (variables === null) return json(400, { error: "Las variables de la plantilla no son válidas." });
    if (enabled && !templateId) return json(400, { error: "Elige una plantilla aprobada para activar los recordatorios." });
    let templateName = ""; let templateLanguage = "";
    if (templateId) {
      const catalog = await templates(tenantId, userHeaders(auth.user!, tenantId));
      const template = catalog.templates.find((item) => item.id === templateId);
      if (!template) return json(400, { error: catalog.error || "La plantilla ya no está disponible en LANA." });
      if (variables.length !== Number(template.variable_count || 0)) {
        return json(400, { error: `La plantilla necesita ${template.variable_count} variables.` });
      }
      templateName = String(template.name || ""); templateLanguage = String(template.language || "");
    }
    const { error } = await admin.from("smyl_reminder_settings").upsert({
      tenant_id: tenantId, enabled, template_id: templateId, template_name: templateName,
      template_language: templateLanguage, variables, updated_by: auth.user!.id,
    }, { onConflict: "tenant_id" });
    if (error) return json(500, { error: "No se pudo guardar la configuración." });
    return json(200, { ok: true, summary: await dispatchTenant(tenantId) });
  }

  if (action === "dispatch") {
    const { data: settings } = await admin.from("smyl_reminder_settings").select("enabled,last_dispatch_at").eq("tenant_id", tenantId).maybeSingle();
    if (!settings?.enabled) return json(200, { skipped: "disabled" });
    const recent = settings.last_dispatch_at && Date.now() - new Date(settings.last_dispatch_at).getTime() < 60 * 1000;
    if (recent && !(body.force === true && can["schedule.manage"])) return json(200, { skipped: "recent" });
    return json(200, { summary: await dispatchTenant(tenantId) });
  }

  return json(400, { error: "Acción no reconocida." });
});
