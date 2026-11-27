// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/smyl-pay/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/smyl-pay-core.mjs ──
const { MONTO_MINIMO, MONTO_MAXIMO, VIGENCIA_MINUTOS, TOLERANCIA_FIRMA_SEG, TOKEN_RE, UUID_RE, redondear2, aleatorioHex, sha256Hex, hmacHex, firmaValida, planDeCobro, conceptoDelEnlace, primerNombre, vistaPublicaEnlace, autorizarCargos, autorizarEnlace, enlacesVisibles } = (() => {
// Lógica pura del cobro en línea de SMYL (sin Deno ni red): token, firma del aviso de LANA, plan de aplicación y vista pública.
const MONTO_MINIMO = 10;
const MONTO_MAXIMO = 500000;
const VIGENCIA_MINUTOS = 3 * 24 * 60;
const TOLERANCIA_FIRMA_SEG = 300;
const TOKEN_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const redondear2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function aleatorioHex(bytes: any) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function sha256Hex(texto: any) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(texto))));
}
async function hmacHex(secreto: any, mensaje: any) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secreto)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(mensaje))));
}

// Aviso LANA -> SMYL: firma = "sha256=" + HMAC(secreto, `${timestamp}.${cuerpo}`), timestamp en segundos y reciente.
async function firmaValida(secreto: any, timestamp: any, cuerpo: any, firma: any, { ahoraSeg = Math.floor(Date.now() / 1000) } = {}) {
  const ts = Number(timestamp);
  if (!secreto || !Number.isFinite(ts) || Math.abs(ahoraSeg - ts) > TOLERANCIA_FIRMA_SEG) return false;
  const esperada = "sha256=" + (await hmacHex(secreto, `${timestamp}.${cuerpo}`));
  if (typeof firma !== "string" || firma.length !== esperada.length) return false;
  let d = 0;
  for (let i = 0; i < esperada.length; i++) d |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  return d === 0;
}

// Reparte el pago sobre los cargos abiertos (ya ordenados) y devuelve lo que cubre. `chargeIds` limita a esos cargos.
function planDeCobro(abiertos: any, { chargeIds = null } = {}) {
  const filas = (abiertos || [])
    .filter((c) => !chargeIds || chargeIds.includes(c.charge_id))
    .map((c) => ({ charge_id: c.charge_id, concept: String(c.concept || ""), amount: redondear2(c.open_amount) }))
    .filter((c) => c.amount > 0);
  const total = redondear2(filas.reduce((s, c) => s + c.amount, 0));
  if (!filas.length) return { ok: false, error: "no_balance", mensaje: "El paciente no tiene saldo pendiente." };
  if (total < MONTO_MINIMO) return { ok: false, error: "amount_too_low", mensaje: `El monto mínimo para cobrar en línea es $${MONTO_MINIMO}.` };
  if (total > MONTO_MAXIMO) return { ok: false, error: "amount_too_high", mensaje: `El monto máximo por enlace es $${MONTO_MAXIMO}.` };
  return { ok: true, total, allocations: filas };
}

function conceptoDelEnlace(allocations: any, clinica: any) {
  const n = allocations.length;
  const base = n === 1 ? allocations[0].concept : `${n} conceptos`;
  return `${clinica || "SMYL"} · ${base}`.slice(0, 240);
}

function primerNombre(nombre: any) {
  return String(nombre || "").trim().split(/\s+/)[0] || "";
}

// Lo único que ve quien abre el enlace: nunca ids internos, hash, secreto ni datos de otros pacientes.
function vistaPublicaEnlace(link: any, { clinica, paciente, recibo } = {}, ahora = Date.now()) {
  const vencido = link.status === "pending" && new Date(link.expires_at).getTime() <= ahora;
  return {
    status: vencido ? "expired" : link.status,
    clinic: clinica || "",
    patient: primerNombre(paciente),
    amount: Number(link.amount),
    currency: "MXN",
    lines: (link.allocations || []).map((a) => ({ concept: String(a.concept || ""), amount: Number(a.amount) })),
    expires_at: link.expires_at,
    paid_at: link.paid_at || null,
    method: link.method || null,
    receipt_folio: recibo ? String(recibo).padStart(6, "0") : null,
  };
}

// ── Alcance por sucursal de los enlaces de pago ──
// La función usa el cliente administrativo, así que NADA de la base limita por sucursal: se decide aquí con las mismas reglas de Finanzas
// (smyl_can_access_finance_patient / smyl_can_access_finance_branch, evaluadas con la sesión de quien llama).
// `permisos` = { paciente(branchId|null) -> Promise<boolean>, sucursal(branchId) -> Promise<boolean> }

// ¿Puede quien llama operar sobre este paciente y estos cargos? Revisa una vez por sucursal distinta (incluida «sin sucursal»).
async function autorizarCargos(input: any) {
  const abiertos = input.abiertos || [], chargeIds = input.chargeIds || null, permisos = input.permisos;
  const incluidos = abiertos.filter((c) => !chargeIds || chargeIds.includes(c.charge_id));
  const ramas = [...new Set(incluidos.map((c) => (c.branch_id == null ? "" : String(c.branch_id))))];
  if (!ramas.length) ramas.push("");
  const denegadas = [];
  for (const rama of ramas) {
    if (!(await permisos.paciente(rama || null))) denegadas.push(rama || null);
  }
  return { ok: denegadas.length === 0, denegadas };
}

// ¿Puede quien llama ver/cancelar este enlace? Hay que poder ver al paciente Y la sucursal en que se creó el enlace.
async function autorizarEnlace(input: any) {
  const link = input.link, permisos = input.permisos;
  if (!(await permisos.paciente(link.branch_id || null))) return false;
  return Boolean(link.branch_id) ? await permisos.sucursal(String(link.branch_id)) : true;
}

// De una lista de enlaces, solo los de sucursales que quien llama puede ver (para `list`).
async function enlacesVisibles(input: any) {
  const out = [];
  const cache = new Map();
  for (const link of input.links || []) {
    const key = link.branch_id == null ? "" : String(link.branch_id);
    if (!cache.has(key)) cache.set(key, await autorizarEnlace({ link: { branch_id: link.branch_id }, permisos: input.permisos }));
    if (cache.get(key)) out.push(link);
  }
  return out;
}

return { MONTO_MINIMO, MONTO_MAXIMO, VIGENCIA_MINUTOS, TOLERANCIA_FIRMA_SEG, TOKEN_RE, UUID_RE, redondear2, aleatorioHex, sha256Hex, hmacHex, firmaValida, planDeCobro, conceptoDelEnlace, primerNombre, vistaPublicaEnlace, autorizarCargos, autorizarEnlace, enlacesVisibles };
})();

// ── smyl-pay/index.ts ──
// Cobro en línea de saldos de pacientes con OpenPay a través de LANA (pasarela general `pagos_solicitudes`).
//
// SMYL es dueño de la deuda y del recibo; LANA solo cobra con la cuenta OpenPay de la clínica. Esta función:
//   - Personal (JWT + finance.manage):  create | list | cancel   -> crea el enlace con el saldo calculado AQUÍ, nunca el del navegador.
//   - Público  (token opaco):           view                     -> lo que ve el paciente en pagar.html (sin datos internos).
//   - Servidor (HMAC de LANA):          POST …/callback          -> aviso de pago. Se confirma SIEMPRE con GET a LANA antes de registrar.
// El pago se registra una sola vez con smyl_post_online_payment (idempotente por enlace) y emite el recibo interno.

const admin = smylAdmin; // (el empaquetador del panel no soporta «x as y» en imports)
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const APP_ORIGIN = "https://app.smyldesign.ai";
const PAGAR_URL = `${APP_ORIGIN}/pagar.html`;
const CALLBACK_URL = `${SB_URL}/functions/v1/smyl-pay/callback`;
const MAX_BODY = 8192;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

function json(cors: Record<string, string>, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Consulta la solicitud en LANA y, si está pagada y coincide, registra el pago en SMYL. Devuelve el enlace actualizado.
async function conciliar(link: Json): Promise<Json> {
  if (link.status === "paid" || !link.lana_request_id) return link;
  try {
    const { response, body } = await lanaRequest(link.tenant_id, `/payments/requests/${link.lana_request_id}`, { method: "GET" }, 8000);
    const req = (body as Json).request as Json | undefined;
    if (!response.ok || !req || req.status !== "paid") return link;
    // Misma solicitud y mismo monto que SMYL fijó; cualquier diferencia no se registra.
    if (req.reference !== link.id || Math.round(Number(req.amount) * 100) !== Math.round(Number(link.amount) * 100)) return link;
    const metodo = req.method === "spei" ? "transfer" : req.method === "paynet" ? "store" : "card";
    const { data, error } = await admin.rpc("smyl_post_online_payment", {
      p_link_id: link.id, p_lana_charge_id: String(req.openpay_charge_id || ""), p_method: metodo, p_paid_at: req.paid_at || new Date().toISOString(),
    });
    if (error) { console.error("[smyl-pay] no se pudo registrar el pago:", error.message); return link; }
    return (Array.isArray(data) ? data[0] : data) || link;
  } catch (e) {
    console.error("[smyl-pay] conciliación fallida:", (e as Error)?.message);
    return link;
  }
}

// Cancela la solicitud en LANA. Solo cuenta como cancelada si LANA lo confirma (o ya no la conoce): si no, el paciente aún podría pagarla.
async function cancelarEnLana(tenantId: string, link: Json): Promise<boolean> {
  if (!link.lana_request_id) return true;
  try {
    const { response } = await lanaRequest(tenantId, `/payments/requests/${link.lana_request_id}/cancel`, { method: "POST", body: "{}" }, 8000);
    return response.ok || response.status === 404;
  } catch (_) { return false; }
}

// El cobro en línea solo se acepta con la caja de la sucursal ABIERTA: un pago que entra con la caja cerrada no cae en ningún corte.
async function cajaAbierta(tenantId: string, branchId: unknown): Promise<boolean> {
  if (typeof branchId !== "string" || !UUID_RE.test(branchId)) return false;
  const { data, error } = await admin.from("smyl_cash_sessions").select("id").eq("tenant_id", tenantId).eq("branch_id", branchId).eq("status", "open").limit(1);
  if (error) return false;   // si no se puede comprobar, no se cobra
  return Array.isArray(data) && data.length > 0;
}

async function enlacePorToken(token: unknown): Promise<Json | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const { data } = await admin.from("smyl_payment_links").select("*").eq("token_hash", await sha256Hex(token)).maybeSingle();
  return data || null;
}

async function datosPublicos(link: Json) {
  const [{ data: t }, { data: p }, { data: r }] = await Promise.all([
    admin.from("camila_tenants").select("nombre").eq("id", link.tenant_id).maybeSingle(),
    admin.from("camila_pacientes").select("nombre").eq("tenant_id", link.tenant_id).eq("id", link.patient_id).maybeSingle(),
    link.payment_id
      ? admin.from("smyl_finance_receipts").select("folio").eq("tenant_id", link.tenant_id).eq("payment_id", link.payment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { clinica: t?.nombre || "", paciente: p?.nombre || "", recibo: r?.folio || null };
}

async function manejarCallback(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({}, 413, { error: "too_large" });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json({}, 400, { error: "invalid_json" }); }
  if (typeof body.request_id !== "string" || !UUID_RE.test(body.request_id)) return json({}, 400, { error: "invalid_request" });
  const { data: link } = await admin.from("smyl_payment_links").select("*").eq("lana_request_id", body.request_id).maybeSingle();
  if (!link) return json({}, 401, { error: "bad_signature" }); // misma respuesta que una firma inválida: no revela qué solicitudes existen
  const ok = await firmaValida(link.callback_secret, req.headers.get("X-LANA-Timestamp"), raw, req.headers.get("X-LANA-Signature"));
  if (!ok) return json({}, 401, { error: "bad_signature" });
  // El cuerpo del aviso es solo una pista: lo que cuenta es lo que LANA confirma por GET.
  const actualizado = await conciliar(link);
  if (actualizado.status !== "paid") return json({}, 409, { error: "not_confirmed" });
  return json({}, 200, { ok: true });
}

const OPENPAY_ERROR_HUMANO: Record<string, string> = {
  invalid_credentials: "Openpay rechazó las llaves. En modo pruebas usa las del panel sandbox de Openpay.",
  openpay_unavailable: "No se pudo verificar con Openpay. Inténtalo de nuevo en un momento.",
};

// Marca en SMYL si la clínica cobra en línea (muestra u oculta «Enlace de pago»). No toca otras llaves de config.
async function marcarPagoEnLinea(tenantId: string, activo: boolean) {
  const { data } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = data?.config && typeof data.config === "object" && !Array.isArray(data.config) ? data.config as Json : {};
  if (config.pago_en_linea === activo) return;
  await admin.from("camila_tenants").update({ config: { ...config, pago_en_linea: activo } }).eq("id", tenantId);
}

async function accionesOpenpay(body: Json, tenantId: string, userId: string, CORS: Record<string, string>): Promise<Response> {
  const esDueno = userId === tenantId;
  let path = "/payments/openpay";
  let init: RequestInit = { method: "GET" };
  if (body.action === "openpay_status") {
    // lectura: quien puede cobrar
  } else if (!esDueno) {
    return json(CORS, 403, { error: "Solo el dueño de la clínica puede conectar o cambiar Openpay." });
  } else if (body.action === "openpay_connect") {
    const campos = ["merchant_id", "public_key", "private_key"];
    if (campos.some((c) => typeof body[c] !== "string" || !(body[c] as string).trim() || (body[c] as string).length > 200)) {
      return json(CORS, 400, { error: "Escribe el ID de comercio, la llave pública y la llave privada." });
    }
    path = "/payments/openpay/credentials";
    init = { method: "PUT", body: JSON.stringify({ merchant_id: body.merchant_id, public_key: body.public_key, private_key: body.private_key }) };
  } else if (body.action === "openpay_methods") {
    const cambios: Json = {};
    for (const k of ["active", "card", "spei", "paynet"]) if (typeof body[k] === "boolean") cambios[k] = body[k];
    if (!Object.keys(cambios).length) return json(CORS, 400, { error: "No hay cambios." });
    path = "/payments/openpay/methods";
    init = { method: "PUT", body: JSON.stringify(cambios) };
  } else if (body.action === "openpay_disconnect") {
    path = "/payments/openpay/disconnect";
    init = { method: "POST", body: "{}" };
  } else {
    return json(CORS, 400, { error: "Acción no válida." });
  }
  try {
    const { response, body: lana } = await lanaRequest(tenantId, path, init, 15000);
    const datos = lana as Json;
    if (!response.ok) {
      const code = String(datos.error_code || "");
      const msg = OPENPAY_ERROR_HUMANO[code] || (typeof datos.error === "string" ? datos.error : "El servidor de pagos no pudo completar la operación.");
      return json(CORS, response.status >= 400 && response.status < 500 ? response.status : 502, { error: msg, error_code: code || "lana_error" });
    }
    const openpay = (datos.openpay || {}) as Json;
    if (body.action !== "openpay_status") await marcarPagoEnLinea(tenantId, !!openpay.connected && !!openpay.active);
    return json(CORS, 200, { openpay, owner: esDueno });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return json(CORS, 409, { error: /LANA todav/.test(msg) ? "Conecta primero los canales de mensajería de la clínica; el cobro en línea usa esa misma conexión." : "No se pudo contactar al servidor de pagos.", error_code: "lana_unavailable" });
  }
}

async function accionesPersonal(req: Request, body: Json, CORS: Record<string, string>): Promise<Response> {
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: permitido } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "finance.manage" });
  if (permitido !== true) return json(CORS, 403, { error: "Tu rol no permite cobrar." });

  // Openpay de la clínica (task-id smyl-openpay-config): SMYL no tiene acceso al panel de LANA, así que la clínica conecta su
  // cuenta Openpay a su tenant de LANA desde aquí. Consultar: quien puede cobrar. Conectar, métodos y desconectar: solo el dueño.
  // Las llaves solo pasan hacia LANA (que las verifica con Openpay); nunca se guardan en SMYL ni vuelven al navegador.
  if (typeof body.action === "string" && body.action.startsWith("openpay_")) return await accionesOpenpay(body, tenantId, user.id, CORS);

  const patientId = body.patient_id;
  if (typeof patientId !== "string" || !UUID_RE.test(patientId)) return json(CORS, 400, { error: "Paciente inválido." });

  // El cliente administrativo NO aplica el alcance por sucursal de Finanzas: se comprueba aquí con las mismas funciones que usan las políticas,
  // evaluadas con la sesión de quien llama (auth.uid()).
  const permisos = {
    paciente: async (branchId: string | null) => (await asUser.rpc("smyl_can_access_finance_patient", { p_tenant: tenantId, p_patient: patientId, p_branch: branchId })).data === true,
    sucursal: async (branchId: string) => (await asUser.rpc("smyl_can_access_finance_branch", { p_tenant: tenantId, p_branch: branchId })).data === true,
  };

  if (body.action === "list") {
    const { data: todos } = await admin.from("smyl_payment_links")
      .select("id, amount, status, expires_at, paid_at, method, created_at, allocations, lana_request_id, tenant_id, branch_id")
      .eq("tenant_id", tenantId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(10);
    const data = await enlacesVisibles({ links: todos || [], permisos });
    const filas = await Promise.all((data || []).map((l: Json) => l.status === "pending" ? conciliar(l) : Promise.resolve(l)));
    return json(CORS, 200, {
      links: filas.map((l: Json) => ({ id: l.id, amount: Number(l.amount), status: vistaPublicaEnlace(l).status, expires_at: l.expires_at, paid_at: l.paid_at, method: l.method, created_at: l.created_at })),
    });
  }

  if (body.action === "cancel") {
    const id = body.link_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json(CORS, 400, { error: "Enlace inválido." });
    const { data: link } = await admin.from("smyl_payment_links").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (!link) return json(CORS, 404, { error: "Enlace no encontrado." });
    if (!(await autorizarEnlace({ link, permisos }))) return json(CORS, 403, { error: "Este enlace es de una sucursal o paciente fuera de tu alcance.", error_code: "branch_scope_denied" });
    const actual = await conciliar(link); // si ya se pagó, no se cancela
    if (actual.status === "paid") return json(CORS, 409, { error: "El enlace ya fue pagado.", status: "paid" });
    if (!(await cancelarEnLana(tenantId, link))) return json(CORS, 502, { error: "No se pudo cancelar el enlace en LANA. Inténtalo de nuevo; mientras tanto el paciente aún podría pagarlo." });
    await admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    return json(CORS, 200, { ok: true });
  }

  if (body.action !== "create") return json(CORS, 400, { error: "Acción no válida." });

  const chargeIds = Array.isArray(body.charge_ids) && body.charge_ids.length
    ? body.charge_ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x as string)).slice(0, 50) : null;
  const { data: abiertos, error: errAbiertos } = await admin.rpc("smyl_open_charges_for_link", { p_tenant: tenantId, p_patient: patientId, p_charge_ids: chargeIds });
  if (errAbiertos) return json(CORS, 500, { error: "No se pudo calcular el saldo." });
  const alcance = await autorizarCargos({ abiertos: abiertos || [], chargeIds, permisos });
  if (!alcance.ok) return json(CORS, 403, { error: "Este paciente tiene cargos de una sucursal fuera de tu alcance.", error_code: "branch_scope_denied" });
  const plan = planDeCobro(abiertos || [], { chargeIds });
  if (!plan.ok) return json(CORS, 422, { error: plan.mensaje, error_code: plan.error });

  const [{ data: paciente }, { data: clinica }] = await Promise.all([
    admin.from("camila_pacientes").select("nombre, apellido, email, telefono").eq("tenant_id", tenantId).eq("id", patientId).maybeSingle(),
    admin.from("camila_tenants").select("nombre").eq("id", tenantId).maybeSingle(),
  ]);
  if (!paciente) return json(CORS, 404, { error: "Paciente no encontrado." });

  // La sucursal del enlace sale de los cargos que SÍ se cobran (no de cualquier cargo abierto del paciente).
  let branchId = (abiertos || []).find((c: Json) => c.branch_id && plan.allocations.some((a: Json) => a.charge_id === c.charge_id))?.branch_id as string | undefined;
  if (!branchId) {
    const { data: sucursal } = await admin.from("smyl_branches").select("id").eq("tenant_id", tenantId)
      .order("is_default", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle();
    branchId = sucursal?.id;
  }
  if (!branchId) return json(CORS, 422, { error: "Crea una sucursal antes de cobrar en línea." });
  if (!(await permisos.sucursal(branchId))) return json(CORS, 403, { error: "La sucursal de este cobro está fuera de tu alcance.", error_code: "branch_scope_denied" });
  if (!(await cajaAbierta(tenantId, branchId))) return json(CORS, 409, { error: "La caja de esta sucursal está cerrada. Ábrela para poder cobrar en línea.", error_code: "cash_closed" });

  // Un enlace vigente por paciente: los anteriores se cancelan (si ya se pagaron se registran y se avisa).
  const { data: previos } = await admin.from("smyl_payment_links").select("*").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("status", "pending");
  for (const previo of previos || []) {
    const actual = await conciliar(previo);
    if (actual.status === "paid") continue;
    if (!(await cancelarEnLana(tenantId, previo))) return json(CORS, 409, { error: "No se pudo cancelar el enlace anterior en LANA. Inténtalo de nuevo.", error_code: "previous_link_not_cancelled" });
    await admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", previo.id).eq("status", "pending");
  }

  const token = aleatorioHex(32);
  const callbackSecret = aleatorioHex(32);
  const expiresAt = new Date(Date.now() + VIGENCIA_MINUTOS * 60_000).toISOString();
  const { data: link, error: errLink } = await admin.from("smyl_payment_links").insert({
    tenant_id: tenantId, patient_id: patientId, branch_id: branchId, token_hash: await sha256Hex(token), callback_secret: callbackSecret,
    amount: plan.total, allocations: plan.allocations, expires_at: expiresAt, created_by: user.id,
  }).select("id").single();
  if (errLink?.code === "23505") return json(CORS, 409, { error: "Ya se está generando un enlace para este paciente. Inténtalo de nuevo en un momento.", error_code: "link_in_progress" });
  if (errLink || !link) return json(CORS, 500, { error: "No se pudo crear el enlace." });

  const marcarFallido = () => admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", link.id);
  try {
    const { response, body: lana } = await lanaRequest(tenantId, "/payments/requests", {
      method: "POST",
      body: JSON.stringify({
        reference: link.id, concept: conceptoDelEnlace(plan.allocations, clinica?.nombre), amount: plan.total,
        token_hash: await sha256Hex(token), return_url: PAGAR_URL, callback_url: CALLBACK_URL, callback_secret: callbackSecret,
        expires_in_minutes: VIGENCIA_MINUTOS,
        customer: { name: `${paciente.nombre} ${paciente.apellido || ""}`.trim(), email: paciente.email || "", phone: paciente.telefono || "" },
      }),
    }, 15000);
    const requestId = (lana as Json).request?.id;
    if (!response.ok || !requestId) {
      await marcarFallido();
      const code = (lana as Json).error_code;
      const msg = code === "openpay_not_available"
        ? "Esta clínica aún no tiene OpenPay conectado y activo en LANA."
        : "LANA no pudo crear la solicitud de pago.";
      return json(CORS, response.status === 409 ? 409 : 502, { error: msg, error_code: code || "lana_error" });
    }
    await admin.from("smyl_payment_links").update({ lana_request_id: requestId, updated_at: new Date().toISOString() }).eq("id", link.id);
  } catch (e) {
    await marcarFallido();
    const msg = (e as Error)?.message || "";
    return json(CORS, 409, { error: /LANA todav/.test(msg) ? msg : "No se pudo contactar a LANA.", error_code: "lana_unavailable" });
  }
  return json(CORS, 200, { link_id: link.id, url: `${PAGAR_URL}#t=${token}`, amount: plan.total, expires_at: expiresAt });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/callback")) {
    if (req.method !== "POST") return json({}, 405, { error: "method_not_allowed" });
    return await manejarCallback(req);
  }
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "Solicitud demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }

  if (body.action === "view") {
    const link = await enlacePorToken(body.token);
    if (!link) return json(CORS, 404, { error: "Este enlace no existe o ya no está disponible." });
    const actual = await conciliar(link);
    const vista = vistaPublicaEnlace(actual, await datosPublicos(actual));
    // Enlace vigente pero la caja de la sucursal se cerró: la página no ofrece pagar (el estado real del enlace no cambia).
    if (actual.status === "pending" && !(await cajaAbierta(String(actual.tenant_id), actual.branch_id))) return json(CORS, 200, { ...vista, cash_closed: true });
    return json(CORS, 200, vista);
  }
  return await accionesPersonal(req, body, CORS);
});
