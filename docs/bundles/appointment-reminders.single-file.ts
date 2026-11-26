// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/appointment-reminders/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/lana-contract.mjs ──
const { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders, SMYL_PRODUCT, readLanaContract, decideLanaLink } = (() => {
const SMYL_LANA_CONTRACT_VERSION = "1.6";

const ALLOWED_ROOTS = new Set([
  "attention",
  "channels",
  "context",
  "contract",
  "conversations",
  "ia",
  "inbox",
  "payments",
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

// ── Aislamiento de contexto SMYL ↔ LANA ─────────────────────────────────────────────────────────────
// SMYL usa el motor de chat de LANA, pero cada clínica debe vivir en SU PROPIO tenant de LANA, marcado como producto
// "smyl": así el asistente usa el contexto y las herramientas dentales, nunca el catálogo/pedidos/precios comerciales.
// LANA declara esa marca en `GET /contract` → `contract.product` (y `contract.tenant_id`).
const SMYL_PRODUCT = "smyl";

// Interpreta la respuesta de /contract. Devuelve el producto y el id del tenant LANA, o null si LANA aún no los informa.
function readLanaContract(body: any) {
  const contract = body && typeof body === "object" && body.contract && typeof body.contract === "object" ? body.contract : null;
  const product = contract && typeof contract.product === "string" ? contract.product.trim().toLowerCase().slice(0, 40) : null;
  const rawTenant = contract && typeof contract.tenant_id === "string" ? contract.tenant_id.trim().toLowerCase() : "";
  const lanaTenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rawTenant) ? rawTenant : null;
  return { product: product || null, lanaTenantId };
}

// Decide si un tenant de LANA puede vincularse a una clínica de SMYL.
//  - strict (código de enlace manual): exige que LANA confirme product === "smyl"; sin confirmación se rechaza.
//  - no strict (alta automática o verificación de un enlace ya existente): sólo se rechaza un producto distinto de "smyl";
//    si LANA aún no informa el producto, se acepta pero queda marcado como "sin verificar".
// Resultado: { ok, verified, code, message }
function decideLanaLink(info: any, { strict }) {
  const product = info && info.product ? info.product : null;
  if (product === SMYL_PRODUCT) return { ok: true, verified: true, code: "", message: "" };
  if (product) {
    return { ok: false, verified: false, code: "wrong_product", message: "Este código pertenece a una cuenta comercial de LANA y no se puede usar en SMYL. Usa la activación automática." };
  }
  if (strict) {
    return { ok: false, verified: false, code: "product_unconfirmed", message: "LANA no confirmó que este código sea de una cuenta SMYL. Usa la activación automática o pide soporte." };
  }
  return { ok: true, verified: false, code: "", message: "" };
}

return { SMYL_LANA_CONTRACT_VERSION, normalizeLanaPath, lanaContractHeaders, SMYL_PRODUCT, readLanaContract, decideLanaLink };
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

// ── _shared/reminder-schedule.mjs ──
const { DEFAULT_WINDOW, parseHM, normalizeWindow, localParts, zonedInstant, insideWindow, sendAtWithinWindow } = (() => {
// SMYL · Cuándo sale un mensaje automático de cita (confirmación o recordatorio).
// Lógica pura, sin red ni base de datos: la usan la Edge Function appointment-reminders y las pruebas de Node.
//
// Regla: los mensajes solo salen dentro de una ventana del día en la hora de la sucursal (por omisión 9:00–20:00),
// para no avisar de madrugada ni de noche.
//   · «later»   (confirmaciones): si cae fuera de la ventana, sale al abrir la siguiente.
//   · «nearest» (recordatorios «24 h antes»): si cae fuera, sale en el borde de ventana MÁS CERCANO a la hora ideal
//     (al cerrar la anterior o al abrir la siguiente), siempre que quede ahora o después y antes de la cita.
// Si nada de lo anterior cabe antes de que empiece la cita, se envía en cuanto se pueda (mejor tarde que nunca).

const DEFAULT_WINDOW = Object.freeze({ start: '09:00', end: '20:00' });

function parseHM(value: any, fallback: any) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value == null ? '' : value));
  const hours = match ? Number(match[1]) : NaN, minutes = match ? Number(match[2]) : NaN;
  if (!(hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59)) return fallback;
  return hours * 60 + minutes;
}

// Normaliza la ventana: si falta, es inválida o no deja al menos una hora, usa la de por omisión.
function normalizeWindow(start: any, end: any) {
  const startMin = parseHM(start, parseHM(DEFAULT_WINDOW.start));
  const endMin = parseHM(end, parseHM(DEFAULT_WINDOW.end));
  if (endMin - startMin < 60) return { startMin: parseHM(DEFAULT_WINDOW.start), endMin: parseHM(DEFAULT_WINDOW.end) };
  return { startMin, endMin };
}

function zoneOrDefault(zone: any) {
  try { new Intl.DateTimeFormat('es-MX', { timeZone: zone }); return zone || 'America/Mexico_City'; } catch (_) { return 'America/Mexico_City'; }
}

// Año, mes, día y minutos desde medianoche de un instante, en la hora local de una zona.
function localParts(ms: any, zone: any) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zoneOrDefault(zone), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), minutes: get('hour') * 60 + get('minute') };
}

// Instante en que el reloj de la zona marca año-mes-día y minutos dados (resuelve el desfase de la zona).
function zonedInstant(year: any, month: any, day: any, minutes: any, zone: any) {
  const target = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const local = localParts(guess, zone);
    const shown = Date.UTC(local.year, local.month - 1, local.day, 0, local.minutes);
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function addDays(parts: any, days: any) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function insideWindow(ms: any, zone: any, win: any) {
  const { minutes } = localParts(ms, zone);
  return minutes >= win.startMin && minutes <= win.endMin;
}

function windowOpenOnOrAfter(ms: any, zone: any, win: any) {
  const local = localParts(ms, zone);
  if (local.minutes < win.startMin) return zonedInstant(local.year, local.month, local.day, win.startMin, zone);
  if (local.minutes > win.endMin) { const next = addDays(local, 1); return zonedInstant(next.year, next.month, next.day, win.startMin, zone); }
  return ms;
}

function windowCloseOnOrBefore(ms: any, zone: any, win: any) {
  const local = localParts(ms, zone);
  if (local.minutes > win.endMin) return zonedInstant(local.year, local.month, local.day, win.endMin, zone);
  if (local.minutes < win.startMin) { const prev = addDays(local, -1); return zonedInstant(prev.year, prev.month, prev.day, win.endMin, zone); }
  return ms;
}

/**
 * @param {object} input
 * @param {number} input.dueMs       momento ideal de envío (confirmación: ahora; recordatorio: cita − 24 h)
 * @param {number} input.nowMs       ahora
 * @param {number} input.startsMs    inicio de la cita
 * @param {string} input.zone        zona horaria de la sucursal
 * @param {{startMin:number,endMin:number}} input.window
 * @param {'later'|'nearest'} input.mode
 * @param {number} [input.leadMs]    margen mínimo desde ahora (por omisión 2 min)
 * @param {number} [input.minNoticeMs] tiempo mínimo antes de la cita para que el aviso tenga sentido (por omisión 2 h)
 * @returns {{ sendAtMs:number, moved:boolean }}
 */
// (Un solo parámetro, sin desestructurar en la firma: el empaquetador del panel de Supabase anota los parámetros con tipos.)
function sendAtWithinWindow(input: any) {
  const dueMs = input.dueMs, nowMs = input.nowMs, startsMs = input.startsMs, zone = input.zone, win = input.window, mode = input.mode;
  const leadMs = input.leadMs == null ? 2 * 60 * 1000 : input.leadMs;
  const minNoticeMs = input.minNoticeMs == null ? 2 * 60 * 60 * 1000 : input.minNoticeMs;
  const earliest = nowMs + leadMs;
  const desired = Math.max(dueMs, earliest);
  const deadline = startsMs - minNoticeMs;
  if (insideWindow(desired, zone, win)) return { sendAtMs: desired, moved: false };
  if (mode === 'nearest') {
    const before = windowCloseOnOrBefore(desired, zone, win);
    const after = windowOpenOnOrAfter(desired, zone, win);
    const beforeOk = before >= earliest, afterOk = after <= deadline;
    if (beforeOk && afterOk) { const pick = desired - before <= after - desired ? before : after; return { sendAtMs: pick, moved: true }; }
    if (beforeOk) return { sendAtMs: before, moved: true };
    if (afterOk) return { sendAtMs: after, moved: true };
    return { sendAtMs: desired, moved: false };
  }
  // Confirmaciones: al abrir la siguiente ventana, si aún queda tiempo antes de la cita.
  const after = windowOpenOnOrAfter(desired, zone, win);
  if (after <= deadline) return { sendAtMs: after, moved: after !== desired };
  // No cabe en ninguna ventana antes de la cita: sale ya.
  return { sendAtMs: desired, moved: false };
}

return { DEFAULT_WINDOW, parseHM, normalizeWindow, localParts, zonedInstant, insideWindow, sendAtWithinWindow };
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


const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const CRON_SECRET = (Deno.env.get("SMYL_REMINDERS_CRON_SECRET") || "").trim();
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const SOURCES = [
  "patient_first_name", "patient_name", "date", "time", "service",
  "professional", "branch", "branch_phone", "branch_whatsapp", "contact_phone", "clinic", "text",
] as const;
type Source = typeof SOURCES[number];
type Variable = { source: Source; value?: string };

const SEND_LEAD_MS = 2 * 60 * 1000;
const MIN_NOTICE_MS = 2 * 60 * 60 * 1000;
const WAIT_LINK_MS = 60 * 60 * 1000;
const MAX_TRANSIENT_ATTEMPTS = 5;
const NO_WHATSAPP = "El paciente no tiene una conversación de WhatsApp vinculada en Mensajes.";

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// «9:00» o «09:00:00» → «09:00:00»; null si no es una hora válida.
function hourMinute(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(value, 12));
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
}
function minutesOf(value: string): number { return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)); }

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
  branch_id: string | null; branch_whatsapp: string | null; professional_phone: string | null;
  whatsapp_consent: boolean | null; appointment_source: string | null;
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
    // «5:00 pm» sin puntos: las plantillas ponen un punto después de la hora y «p.m.» + «.» salía como «p.m..».
    case "time": return new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(start).replace(/\s*([ap])\.?\s?m\.?/i, (_m, x) => ` ${x.toLowerCase()}m`);
    case "service": return text(row.service_name, 120) || "tu cita";
    case "professional": return text(row.professional_name, 120) || clinicName;
    case "branch": return text(row.branch_name, 120) || clinicName;
    case "branch_phone": return text(row.branch_phone, 40) || "";
    // Donde el paciente responde: el WhatsApp de su sucursal (o el de la clínica) y, si no hay, el teléfono de la sucursal.
    case "branch_whatsapp": return text(row.branch_whatsapp, 40) || text(row.branch_phone, 40) || "";
    // Teléfono para llamar: el del dentista solo si él lo hizo público; si no, el WhatsApp o teléfono de la sucursal.
    case "contact_phone": return text(row.professional_phone, 40) || text(row.branch_whatsapp, 40) || text(row.branch_phone, 40) || "";
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

// Al desactivar, nada que esté en cola debe salir: se cancela aquí y en LANA. `kind` limita a confirmaciones o a recordatorios.
const REMINDER_TYPES = ["24h", "2h", "48h", "custom"];
const NO_SHOW_WINDOW_MS = 24 * 60 * 60 * 1000; // el seguimiento de inasistencia se descarta si no sale en un día
async function cancelQueued(tenantId: string, kind: "reminder" | "confirmation" | "no_show" = "reminder"): Promise<number> {
  const types = kind === "confirmation" ? ["confirmation"] : kind === "no_show" ? ["no_show"] : REMINDER_TYPES;
  const { data: queued } = await admin.from("smyl_appointment_reminders")
    .select("id,provider_reference")
    .eq("tenant_id", tenantId).in("reminder_type", types).in("status", ["pending", "processing"]).limit(500);
  for (const row of queued || []) {
    await admin.from("smyl_appointment_reminders").update({
      status: "cancelled", provider_cancel_required: Boolean(row.provider_reference),
      last_error: kind === "confirmation" ? "Confirmaciones desactivadas por la clínica." : kind === "no_show" ? "Seguimiento de inasistencias desactivado por la clínica." : "Recordatorios desactivados por la clínica.", next_attempt_at: null,
    }).eq("id", row.id).in("status", ["pending", "processing"]);
  }
  return processCancellations(tenantId);
}

// Al enviar un mensaje de una cita, la conversación queda en la sucursal de esa cita (sin pisar una asignación previa):
// así la respuesta del paciente llega ya ordenada y la ven los dentistas de esa sucursal.
async function assignConversationBranch(tenantId: string, conversationId: string, branchId: string | null): Promise<void> {
  if (!branchId) return;
  try {
    await admin.from("smyl_conversation_branches").upsert(
      { tenant_id: tenantId, conversation_id: conversationId, branch_id: branchId, source: "appointment" },
      { onConflict: "tenant_id,conversation_id", ignoreDuplicates: true },
    );
  } catch { /* la asignación es una comodidad: nunca debe impedir el mensaje */ }
}

type Summary = { scheduled: number; waiting: number; failed: number; skipped: number; cancelled_in_lana: number; synced: number; error?: string };

async function dispatchTenant(tenantId: string): Promise<Summary> {
  const summary: Summary = { scheduled: 0, waiting: 0, failed: 0, skipped: 0, cancelled_in_lana: 0, synced: 0 };
  const { data: settings } = await admin.from("smyl_reminder_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  const remindersOn = Boolean(settings?.enabled && settings.template_id);
  const confirmOn = Boolean(settings?.confirmation_enabled && settings.confirmation_template_id);
  const noShowOn = Boolean(settings?.no_show_enabled && settings.no_show_template_id);
  if (!settings || (!remindersOn && !confirmOn && !noShowOn)) return { ...summary, error: "disabled" };
  await admin.from("smyl_reminder_settings").update({ last_dispatch_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  const reminderVariables = normalizeVariables(settings.variables) || [];
  const confirmVariables = normalizeVariables(settings.confirmation_variables) || [];
  const noShowVariables = normalizeVariables(settings.no_show_variables) || [];
  const sendWindow = normalizeWindow(settings.send_window_start, settings.send_window_end);
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
    const isNoShow = row.reminder_type === "no_show";
    if (!isNoShow && startsAt - now < MIN_NOTICE_MS) {
      await admin.from("smyl_appointment_reminders").update({
        status: "cancelled", last_error: "Se omitió: la cita está a menos de 2 horas.",
      }).eq("id", row.reminder_id).eq("status", "processing");
      summary.skipped += 1;
      continue;
    }
    const isConfirmation = row.reminder_type === "confirmation";
    // Un tipo apagado (o sin plantilla) no sale aunque la fila ya exista.
    const is48h = row.reminder_type === "48h";
    if (isNoShow ? !noShowOn : isConfirmation ? !confirmOn : (!remindersOn || (is48h && settings.reminder_48h_enabled !== true))) {
      await admin.from("smyl_appointment_reminders").update({
        status: "cancelled", last_error: isNoShow ? "Se omitió: el seguimiento de inasistencias está desactivado." : isConfirmation ? "Se omitió: las confirmaciones están desactivadas." : is48h ? "Se omitió: el aviso de 48 horas está desactivado." : "Se omitió: los recordatorios están desactivados.",
      }).eq("id", row.reminder_id).eq("status", "processing");
      summary.skipped += 1;
      continue;
    }
    // Consentimiento: «false» significa «no registrado», por eso solo se exige cuando la clínica lo pide.
    if (settings.require_consent === true && row.whatsapp_consent !== true) {
      await admin.from("smyl_appointment_reminders").update({
        status: "cancelled", last_error: "Se omitió: el paciente no tiene registrado su consentimiento de WhatsApp.",
      }).eq("id", row.reminder_id).eq("status", "processing");
      summary.skipped += 1;
      continue;
    }
    const conversationId = await whatsappConversation(tenantId, row.patient_id);
    if (!conversationId) {
      // Recordatorio: espera hasta su hora. Confirmación: espera hasta poco antes de la cita (el paciente puede vincularse antes).
      const limitAt = isNoShow ? dueAt + NO_SHOW_WINDOW_MS : isConfirmation ? startsAt - MIN_NOTICE_MS : dueAt;
      const overdue = now >= limitAt;
      await admin.from("smyl_appointment_reminders").update(overdue
        ? { status: "failed", last_error: NO_WHATSAPP }
        : { status: "pending", last_error: NO_WHATSAPP, next_attempt_at: new Date(Math.min(now + WAIT_LINK_MS, limitAt)).toISOString() },
      ).eq("id", row.reminder_id).eq("status", "processing");
      if (overdue) summary.failed += 1; else summary.waiting += 1;
      continue;
    }
    // Solo dentro de la ventana de envío de la sucursal (por omisión 9:00–20:00).
    const timing = sendAtWithinWindow({
      dueMs: isConfirmation ? now : dueAt, nowMs: now, startsMs: isNoShow ? now + NO_SHOW_WINDOW_MS + MIN_NOTICE_MS : startsAt, zone: validTimeZone(row.branch_timezone),
      window: sendWindow, mode: isConfirmation || isNoShow ? "later" : "nearest", leadMs: SEND_LEAD_MS, minNoticeMs: MIN_NOTICE_MS,
    });
    const templateId = isNoShow ? settings.no_show_template_id : isConfirmation ? settings.confirmation_template_id : settings.template_id;
    const variables = isNoShow ? noShowVariables : isConfirmation ? confirmVariables : reminderVariables;
    const payload = {
      type: "template",
      send_at: new Date(timing.sendAtMs).toISOString(),
      template_id: templateId,
      // Meta rechaza parámetros vacíos: un dato que falta (p. ej. sin teléfono) se escribe como un guion.
      template_variables: variables.map((variable) => renderVariable(variable, row, clinic).slice(0, 1000) || "—"),
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
      await assignConversationBranch(tenantId, conversationId, row.branch_id);
      summary.scheduled += 1;
      continue;
    }
    const message = text(body.error, 400) || `LANA rechazó el recordatorio (HTTP ${status || "sin respuesta"}).`;
    const transient = status === 0 || status === 429 || status >= 500;
    if (transient && row.attempt_count < MAX_TRANSIENT_ATTEMPTS && now < (isNoShow ? dueAt + NO_SHOW_WINDOW_MS : startsAt - MIN_NOTICE_MS)) {
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
    .select("status,provider_reference,last_error,reminder_type")
    .eq("tenant_id", tenantId).gte("scheduled_for", since).limit(1000);
  // Los cuatro primeros cuentan recordatorios (igual que antes); confirmation_* cuenta las confirmaciones.
  const counts: Record<string, number> = { scheduled: 0, waiting: 0, sent: 0, failed: 0, confirmation_scheduled: 0, confirmation_waiting: 0, confirmation_sent: 0, confirmation_failed: 0, no_show_scheduled: 0, no_show_waiting: 0, no_show_sent: 0, no_show_failed: 0 };
  for (const row of data || []) {
    const prefix = row.reminder_type === "confirmation" ? "confirmation_" : row.reminder_type === "no_show" ? "no_show_" : "";
    if (row.status === "processing" && row.provider_reference) counts[prefix + "scheduled"] += 1;
    else if (row.status === "pending" || row.status === "processing") counts[prefix + "waiting"] += 1;
    else if (row.status === "sent") counts[prefix + "sent"] += 1;
    else if (row.status === "failed") counts[prefix + "failed"] += 1;
  }
  return counts;
}

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const cronSecret = req.headers.get("x-smyl-cron-secret") || "";
  if (cronSecret) {
    if (!sameSecret(cronSecret, CRON_SECRET)) return json(401, { error: "Secreto de cron no válido." });
    const [byReminders, byConfirmation, byNoShow] = await Promise.all([
      admin.from("smyl_reminder_settings").select("tenant_id").eq("enabled", true).limit(200),
      admin.from("smyl_reminder_settings").select("tenant_id").eq("confirmation_enabled", true).limit(200),
      admin.from("smyl_reminder_settings").select("tenant_id").eq("no_show_enabled", true).limit(200),
    ]);
    const enabled = [...new Map([...(byReminders.data || []), ...(byConfirmation.data || []), ...(byNoShow.data || [])].map((row) => [row.tenant_id, row])).values()];
    const results: Record<string, Summary> = {};
    for (const row of enabled) results[row.tenant_id] = await dispatchTenant(row.tenant_id).catch(() => ({ scheduled: 0, waiting: 0, failed: 0, skipped: 0, cancelled_in_lana: 0, synced: 0, error: "Error inesperado." }));
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
      .select("enabled,reminder_48h_enabled,template_id,template_name,template_language,variables,last_dispatch_at,updated_at,confirmation_enabled,confirmation_template_id,confirmation_template_name,confirmation_template_language,confirmation_variables,confirmation_since,no_show_enabled,no_show_template_id,no_show_template_name,no_show_template_language,no_show_variables,no_show_since,send_window_start,send_window_end,require_consent,whatsapp_mode,whatsapp_phone")
      .eq("tenant_id", tenantId).maybeSingle();
    const catalog = canConfigure ? await templates(tenantId, userHeaders(auth.user!, tenantId)) : { templates: [] };
    return json(200, {
      settings: settings || {
        enabled: false, reminder_48h_enabled: false, template_id: null, template_name: "", template_language: "", variables: [], last_dispatch_at: null,
        confirmation_enabled: false, confirmation_template_id: null, confirmation_template_name: "", confirmation_template_language: "", confirmation_variables: [], confirmation_since: null,
        no_show_enabled: false, no_show_template_id: null, no_show_template_name: "", no_show_template_language: "", no_show_variables: [], no_show_since: null,
        send_window_start: "09:00:00", send_window_end: "20:00:00", require_consent: false, whatsapp_mode: "single", whatsapp_phone: "",
      },
      can_configure: canConfigure, sources: SOURCES, overview: await overview(tenantId), ...catalog,
    });
  }

  if (action === "save_settings") {
    if (!canConfigure) return json(403, { error: "Tu rol no permite configurar recordatorios.", code: "permission_denied" });
    const kind = text(body.kind, 20) || "reminder";

    // Preferencias comunes: ventana de envío, consentimiento y cómo usa la clínica su WhatsApp (un número o uno por sucursal).
    if (kind === "preferences") {
      const start = hourMinute(body.send_window_start), end = hourMinute(body.send_window_end);
      if (!start || !end || minutesOf(end) - minutesOf(start) < 60) return json(400, { error: "La ventana de envío debe durar al menos una hora." });
      const mode = body.whatsapp_mode === "per_branch" ? "per_branch" : "single";
      const phone = text(body.whatsapp_phone, 40).replace(/[^0-9+()\-\s]/g, "").trim();
      const { error } = await admin.from("smyl_reminder_settings").upsert({
        tenant_id: tenantId, send_window_start: start, send_window_end: end, require_consent: body.require_consent === true,
        whatsapp_mode: mode, whatsapp_phone: phone, updated_by: auth.user!.id,
      }, { onConflict: "tenant_id" });
      if (error) return json(500, { error: "No se pudo guardar la configuración." });
      return json(200, { ok: true });
    }

    if (kind !== "reminder" && kind !== "confirmation" && kind !== "no_show") return json(400, { error: "Tipo de mensaje no reconocido." });
    const confirmation = kind === "confirmation";
    const noShow = kind === "no_show";
    const col = confirmation
      ? { enabled: "confirmation_enabled", id: "confirmation_template_id", name: "confirmation_template_name", language: "confirmation_template_language", variables: "confirmation_variables" }
      : noShow
        ? { enabled: "no_show_enabled", id: "no_show_template_id", name: "no_show_template_name", language: "no_show_template_language", variables: "no_show_variables" }
        : { enabled: "enabled", id: "template_id", name: "template_name", language: "template_language", variables: "variables" };
    const enabled = body.enabled === true;
    // Apagar siempre debe funcionar, aunque LANA no responda o la plantilla ya no exista.
    if (!enabled) {
      const { error } = await admin.from("smyl_reminder_settings").upsert({ tenant_id: tenantId, [col.enabled]: false, updated_by: auth.user!.id }, { onConflict: "tenant_id" });
      if (error) return json(500, { error: "No se pudo guardar la configuración." });
      return json(200, { ok: true, cancelled_in_lana: await cancelQueued(tenantId, confirmation ? "confirmation" : noShow ? "no_show" : "reminder") });
    }
    const templateId = body.template_id == null || body.template_id === "" ? null : uuid(body.template_id);
    const variables = normalizeVariables(body.variables);
    if (variables === null) return json(400, { error: "Las variables de la plantilla no son válidas." });
    if (enabled && !templateId) return json(400, { error: confirmation ? "Elige una plantilla aprobada para activar las confirmaciones." : noShow ? "Elige una plantilla aprobada para activar el seguimiento de inasistencias." : "Elige una plantilla aprobada para activar los recordatorios." });
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
    const row: Record<string, unknown> = {
      tenant_id: tenantId, ...(confirmation || noShow ? {} : { reminder_48h_enabled: body.reminder_48h === true }), [col.enabled]: enabled, [col.id]: templateId, [col.name]: templateName,
      [col.language]: templateLanguage, [col.variables]: variables, updated_by: auth.user!.id,
    };
    if (confirmation) {
      // La confirmación solo cubre las citas agendadas desde que se enciende: nunca se manda en retroactivo.
      const { data: previous } = await admin.from("smyl_reminder_settings").select("confirmation_enabled,confirmation_since").eq("tenant_id", tenantId).maybeSingle();
      row.confirmation_since = previous?.confirmation_enabled && previous.confirmation_since ? previous.confirmation_since : new Date().toISOString();
    }
    if (noShow) {
      // El seguimiento solo cubre inasistencias marcadas desde que se enciende: nunca en retroactivo.
      const { data: previous } = await admin.from("smyl_reminder_settings").select("no_show_enabled,no_show_since").eq("tenant_id", tenantId).maybeSingle();
      row.no_show_since = previous?.no_show_enabled && previous.no_show_since ? previous.no_show_since : new Date().toISOString();
    }
    const { error } = await admin.from("smyl_reminder_settings").upsert(row, { onConflict: "tenant_id" });
    if (error) return json(500, { error: "No se pudo guardar la configuración." });
    return json(200, { ok: true, summary: await dispatchTenant(tenantId) });
  }

  if (action === "dispatch") {
    const { data: settings } = await admin.from("smyl_reminder_settings").select("enabled,confirmation_enabled,no_show_enabled,last_dispatch_at").eq("tenant_id", tenantId).maybeSingle();
    if (!settings?.enabled && !settings?.confirmation_enabled && !settings?.no_show_enabled) return json(200, { skipped: "disabled" });
    const recent = settings.last_dispatch_at && Date.now() - new Date(settings.last_dispatch_at).getTime() < 60 * 1000;
    if (recent && !(body.force === true && can["schedule.manage"])) return json(200, { skipped: "recent" });
    return json(200, { summary: await dispatchTenant(tenantId) });
  }

  return json(400, { error: "Acción no reconocida." });
});
