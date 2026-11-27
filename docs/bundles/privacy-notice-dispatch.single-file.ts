// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/privacy-notice-dispatch/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/lana-crypto-core.mjs ──
const { LEGACY_KEY_VERSION, readKeyring, storedKeyVersion, encryptLanaKey, decryptLanaKey, reencryptIfNeeded } = (() => {
// Cifrado de la credencial de LANA con rotación de llave (sin dependencias de Deno: se prueba en Node).
//
// Variables de entorno:
//   SMYL_LANA_ENCRYPTION_KEY                 llave vigente (32 bytes en base64)
//   SMYL_LANA_ENCRYPTION_KEY_VERSION         etiqueta de la vigente (por omisión "1")
//   SMYL_LANA_ENCRYPTION_KEY_PREVIOUS        llave anterior, solo mientras dura la rotación (opcional)
//   SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION etiqueta de la anterior (por omisión: la vigente menos 1 si es número)
//
// Cada credencial guarda `key_version`. Las anteriores a este cambio no la tienen y se tratan como la versión "1".

const LEGACY_KEY_VERSION = "1";

function bytesToBase64(bytes: any) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: any) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cleanVersion(value: any) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(text)) return "";
  return text;
}

function readKeyring(env = {}) {
  const currentB64 = String(env.SMYL_LANA_ENCRYPTION_KEY || "").trim();
  if (!currentB64) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada.");
  const currentVersion = cleanVersion(env.SMYL_LANA_ENCRYPTION_KEY_VERSION || LEGACY_KEY_VERSION);
  if (!currentVersion) throw new Error("SMYL_LANA_ENCRYPTION_KEY_VERSION no es válida.");
  const keys = [{ version: currentVersion, b64: currentB64, current: true }];
  const previousB64 = String(env.SMYL_LANA_ENCRYPTION_KEY_PREVIOUS || "").trim();
  if (previousB64) {
    let previousVersion = cleanVersion(env.SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION);
    if (!previousVersion && /^\d+$/.test(currentVersion) && Number(currentVersion) > 1) previousVersion = String(Number(currentVersion) - 1);
    if (!previousVersion) throw new Error("Falta SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION.");
    if (previousVersion === currentVersion) throw new Error("La llave anterior y la vigente no pueden tener la misma versión.");
    if (previousB64 === currentB64) throw new Error("La llave anterior es igual a la vigente.");
    keys.push({ version: previousVersion, b64: previousB64, current: false });
  }
  for (const key of keys) {
    if (base64ToBytes(key.b64).length !== 32) throw new Error(`La llave de versión ${key.version} debe contener 32 bytes.`);
  }
  return { keys, currentVersion };
}

function storedKeyVersion(lana: any) {
  return cleanVersion(lana?.key_version) || LEGACY_KEY_VERSION;
}

async function importKey(subtle: any, key: any, usages: any) {
  return subtle.importKey("raw", base64ToBytes(key.b64), "AES-GCM", false, usages);
}

async function encryptLanaKey(apiKey: any, keyring: any, { subtle = globalThis.crypto.subtle, random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) } = {}) {
  const current = keyring.keys.find((key) => key.current);
  const iv = random(12);
  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv }, await importKey(subtle, current, ["encrypt"]), new TextEncoder().encode(apiKey));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv), key_version: current.version };
}

// Primero la llave que la credencial dice tener; si falla (p. ej. una versión mal anotada) prueba las demás.
async function decryptLanaKey(lana: any, keyring: any, { subtle = globalThis.crypto.subtle } = {}) {
  const wanted = storedKeyVersion(lana);
  const ordered = [...keyring.keys].sort((a, b) => Number(b.version === wanted) - Number(a.version === wanted));
  const iv = base64ToBytes(lana.api_key_iv);
  const data = base64ToBytes(lana.api_key_ciphertext);
  for (const key of ordered) {
    try {
      const clear = await subtle.decrypt({ name: "AES-GCM", iv }, await importKey(subtle, key, ["decrypt"]), data);
      return { apiKey: new TextDecoder().decode(clear), key_version: key.version, needsReencrypt: !key.current };
    } catch { /* siguiente llave */ }
  }
  throw new Error("No se pudo descifrar la credencial de LANA con las llaves configuradas.");
}

// Devuelve la credencial ya cifrada con la llave vigente (o null si ya lo estaba).
async function reencryptIfNeeded(lana: any, keyring: any, deps = {}) {
  const decrypted = await decryptLanaKey(lana, keyring, deps);
  const stale = decrypted.needsReencrypt || storedKeyVersion(lana) !== keyring.currentVersion || !lana.key_version;
  if (!stale) return null;
  const encrypted = await encryptLanaKey(decrypted.apiKey, keyring, deps);
  return { ...lana, api_key_ciphertext: encrypted.ciphertext, api_key_iv: encrypted.iv, key_version: encrypted.key_version };
}

return { LEGACY_KEY_VERSION, readKeyring, storedKeyVersion, encryptLanaKey, decryptLanaKey, reencryptIfNeeded };
})();

// ── _shared/lana-linked.ts ──
const { LANA_API_BASE, linkedLanaApiKey, lanaRequest, smylAdmin } = (() => {

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  key_version?: string;
  estado: string;
};

function keyring() {
  return readKeyring({
    SMYL_LANA_ENCRYPTION_KEY: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY"),
    SMYL_LANA_ENCRYPTION_KEY_VERSION: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_VERSION"),
    SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_PREVIOUS"),
    SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION"),
  });
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
  // Descifra con la llave vigente o, durante una rotación, con la anterior. La reescritura con la llave nueva la hace lana-connection.
  return (await decryptLanaKey(lana as LanaConfig, keyring())).apiKey;
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

// ── _shared/privacy-dispatch-core.mjs ──
const { NOTICE_TEMPLATE, MAX_PER_RUN, firstNameOf, approvedTemplateId, noticeUrl, templateVariables, idempotencyKey } = (() => {
// Reglas puras del envío automático del aviso de privacidad por WhatsApp (sin red ni base de datos, para poder probarlas).
const NOTICE_TEMPLATE = 'aviso_privacidad_v1';
const MAX_PER_RUN = 5;

const BAD_STATUS = /reject|rechaz|pending|pendiente|paused|disabled/i;

/** Nombre de pila para el saludo; si la ficha aún es «Por registrar…» o está vacía, un saludo neutro. */
function firstNameOf(name: any) {
  const text = String(name == null ? '' : name).trim();
  if (!text || /^por registrar/i.test(text)) return 'paciente';
  return text.split(/\s+/)[0].slice(0, 40);
}

/** Id de la plantilla del aviso si LANA ya la tiene aprobada; null si no existe o no está aprobada. */
function approvedTemplateId(templates: any) {
  const found = (Array.isArray(templates) ? templates : []).find((t) => t && String(t.name || '') === NOTICE_TEMPLATE && !BAD_STATUS.test(String(t.status || '')));
  return found && found.id ? String(found.id) : null;
}

function noticeUrl(base: any, token: any) {
  return String(base || '').replace(/\/+$/, '') + '/aviso-firma.html?token=' + encodeURIComponent(token);
}

/** Variables de la plantilla, en el orden del catálogo: nombre, clínica, enlace. */
function templateVariables(o: any) {
  return [firstNameOf(o.firstName), String(o.clinic || 'tu clínica').trim().slice(0, 80) || 'tu clínica', noticeUrl(o.base, o.token)].map((v) => v.slice(0, 1000));
}

function idempotencyKey(tenantId: any, patientId: any) { return 'privacy-notice:' + tenantId + ':' + patientId; }

return { NOTICE_TEMPLATE, MAX_PER_RUN, firstNameOf, approvedTemplateId, noticeUrl, templateVariables, idempotencyKey };
})();

// ── privacy-notice-dispatch/index.ts ──
// Aviso de privacidad automático por WhatsApp a pacientes nuevos (ver la migración 20261124200000).
// La llama el panel con la sesión de quien lo abre (patients.manage). Si la clínica lo tiene apagado, no hace nada.
// Para cada paciente nuevo con WhatsApp ligado: reserva el envío (uno solo por paciente), crea el enlace de firma con la sesión de
// quien llama, y lo manda por LANA con la plantilla aprobada «aviso_privacidad_v1». Si algo falla se libera la reserva y se reintenta
// en la siguiente apertura. Nunca manda texto libre ni sale de la plantilla aprobada.

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const APP_BASE = Deno.env.get("SMYL_APP_BASE_URL") || "https://app.smyldesign.ai";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function actorHeaders(tenantId: string, user: { id: string; email?: string }): Headers {
  const name = String(user.email || "").split("@")[0].slice(0, 160) || "Equipo";
  return new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(name),
  });
}

async function templateId(tenantId: string, user: { id: string; email?: string }): Promise<string | null> {
  const list = await lanaRequest(tenantId, "/inbox/whatsapp/templates", { method: "GET", headers: actorHeaders(tenantId, user) }, 12000);
  return approvedTemplateId(list.body.templates);
}

Deno.serve(async (req: Request) => {
  const cors = makeCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });
  const auth = await requireUser(req, cors);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Inicia sesión." });
  const denied = await requirePermission(auth, cors, "patients.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId, user = auth.user;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo: se toma como dispatch */ }
  const action = String(body.action || "dispatch");

  try {
    const settings = await admin.from("smyl_privacy_settings").select("auto_send_notice").eq("tenant_id", tenantId).maybeSingle();
    if (settings.error) return json(503, { error: "No se pudo leer el ajuste." });
    const enabled = settings.data?.auto_send_notice === true;

    if (action === "status") {
      let ready = false, lanaOk = true;
      try { ready = (await templateId(tenantId, user)) !== null; } catch { lanaOk = false; }
      return json(200, { enabled, template_ready: ready, lana_available: lanaOk });
    }
    if (action !== "dispatch") return json(400, { error: "Acción no válida." });
    if (!enabled) return json(200, { enabled: false, sent: 0 });

    let tpl: string | null = null;
    try { tpl = await templateId(tenantId, user); } catch { return json(200, { enabled: true, sent: 0, reason: "lana_unavailable" }); }
    if (!tpl) return json(200, { enabled: true, sent: 0, reason: "template_not_approved" });

    const candidates = await admin.rpc("smyl_privacy_dispatch_candidates", { p_tenant: tenantId, p_limit: MAX_PER_RUN });
    if (candidates.error) return json(503, { error: "No se pudieron revisar los pacientes nuevos." });
    const rows = (candidates.data || []) as { patient_id: string; first_name: string | null; conversation_id: string }[];
    if (!rows.length) return json(200, { enabled: true, sent: 0, reason: "none" });

    const clinic = await admin.from("camila_tenants").select("nombre").eq("id", tenantId).maybeSingle();
    const clinicName = String(clinic.data?.nombre || "").trim() || "tu clínica";
    const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    let sent = 0, failed = 0;
    for (const row of rows) {
      const claim = await admin.rpc("smyl_privacy_dispatch_claim", { p_tenant: tenantId, p_patient: row.patient_id });
      if (claim.error || claim.data !== true) continue;
      let ok = false;
      try {
        const link = await asUser.rpc("smyl_create_consent_link", { p_patient_id: row.patient_id });
        const token = String(link.data || "");
        if (link.error || !/^[0-9a-f]{64}$/.test(token)) throw new Error("link");
        const headers = actorHeaders(tenantId, user);
        headers.set("Idempotency-Key", idempotencyKey(tenantId, row.patient_id));
        const remote = await lanaRequest(tenantId, `/inbox/conversations/${row.conversation_id}/scheduled`, {
          method: "POST", headers,
          body: JSON.stringify({ type: "template", send_at: new Date(Date.now() + 60_000).toISOString(), template_id: tpl,
            template_variables: templateVariables({ firstName: row.first_name, clinic: clinicName, base: APP_BASE, token }) }),
        }, 15000);
        ok = remote.response.ok;
      } catch (error) {
        console.warn("[privacy-notice-dispatch]", error instanceof Error ? error.message : "error");
      }
      await admin.rpc("smyl_privacy_dispatch_finish", { p_tenant: tenantId, p_patient: row.patient_id, p_ok: ok });
      if (ok) sent++; else failed++;
    }
    return json(200, { enabled: true, sent, failed });
  } catch {
    return json(503, { error: "No se pudo completar el envío. Se reintentará más tarde." });
  }
});
