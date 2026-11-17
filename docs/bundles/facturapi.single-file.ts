// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/facturapi/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/facturapi-core.mjs ──
const { FACTURAPI_BASE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion, LIVE_KEY_RE, CONFIRM_LIVE_TEXT, datosLegales, validarCsd, estadoOrganizacion, rfcCoincide, puedeActivarProduccion, leerLlave, mensajeCsd } = (() => {
// Lógica pura de la conexión Facturapi (sin Deno ni red): validación de llave, cifrado y lectura de la organización.
// Solo sandbox: la llave debe ser de pruebas (sk_test_…). Las llaves live se rechazan.
const FACTURAPI_BASE = "https://www.facturapi.io/v2";
const TEST_KEY_RE = /^sk_test_[A-Za-z0-9_-]{16,200}$/;
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Devuelve { ok:true, key } o { ok:false, error } con mensaje para la persona.
function validarLlave(raw: any) {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return { ok: false, error: "Pega la llave secreta de pruebas de Facturapi." };
  if (/^sk_live_/.test(key)) return { ok: false, error: "Esa es una llave de producción. Por ahora SMYL solo acepta la de pruebas (sk_test_…)." };
  if (/^sk_user_/.test(key)) return { ok: false, error: "Esa es una llave de usuario. Usa la llave secreta de pruebas de tu organización (sk_test_…)." };
  if (!TEST_KEY_RE.test(key)) return { ok: false, error: "La llave no tiene el formato de una llave secreta de pruebas (sk_test_…)." };
  return { ok: true, key };
}

async function huella(key: any) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(key))).slice(0, 12).toUpperCase();
}

async function aesKey(masterB64: any) {
  let raw;
  try { raw = unb64(String(masterB64 || "")); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new Error("FACTURAPI_ENCRYPTION_KEY debe ser 32 bytes en base64.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// El tenant va como dato autenticado: un cifrado copiado a otra clínica no descifra.
async function cifrar(masterB64: any, tenantId: any, texto: any) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(tenantId) }, await aesKey(masterB64), enc.encode(texto));
  return { ciphertext: b64(ct), iv: b64(iv) };
}
async function descifrar(masterB64: any, tenantId: any, ciphertext: any, iv: any) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(tenantId) }, await aesKey(masterB64), unb64(ciphertext));
  return dec.decode(pt);
}

// Lee la respuesta de GET /v2/organizations/me de forma tolerante.
function leerOrganizacion(body: any) {
  const o = body && typeof body === "object" ? body : {};
  const id = typeof o.id === "string" ? o.id : "";
  const nombre = String((o.legal && o.legal.legal_name) || o.name || o.legal_name || "").slice(0, 180);
  if (id.length < 3 || id.length > 120) return null;
  return { id, name: nombre };
}

// Vista segura para el navegador: nunca incluye llave ni texto cifrado.
function vistaConexion(row: any) {
  if (!row) return { status: "disconnected", environment: "test", mode: "platform", pending_steps: [], production_ready: false };
  return {
    status: row.status, environment: row.environment, mode: row.mode || "own_key", organization_name: row.organization_name || "",
    key_fingerprint: row.key_fingerprint || "", connected_at: row.connected_at, last_verified_at: row.last_verified_at, last_error: row.last_error || "",
    has_organization: !!row.organization_id, csd_valid_until: row.csd_valid_until || null, csd_serial: row.csd_serial || "",
    pending_steps: Array.isArray(row.pending_steps) ? row.pending_steps : [], production_ready: row.production_ready === true,
    live_enabled_at: row.live_enabled_at || null, live_key_fingerprint: row.live_key_fingerprint || "",
  };
}

// ── Modelo de plataforma: una organización de Facturapi por clínica ──
const LIVE_KEY_RE = /^sk_live_[A-Za-z0-9_-]{16,200}$/;
const CONFIRM_LIVE_TEXT = "FACTURAR EN PRODUCCION";
const RFC_RE = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

// Datos para PUT /organizations/{id}/legal. El RFC NO se envía: Facturapi lo toma del CSD.
function datosLegales(issuer: any) {
  const i = issuer || {};
  const legal = String(i.legal_name || "").trim();
  if (legal.length < 2 || !/^\d{3}$/.test(String(i.fiscal_regime || "")) || !/^\d{5}$/.test(String(i.tax_postal_code || ""))) return null;
  return { name: legal.slice(0, 100), legal_name: legal.slice(0, 240), tax_system: String(i.fiscal_regime), address: { zip: String(i.tax_postal_code) } };
}

// Archivos del CSD recibidos del navegador. `cer` y `key` son { name, size }.
function validarCsd({ cer, key: any, password } = {}) {
  const ok = (f, ext) => f && typeof f.name === "string" && f.name.toLowerCase().endsWith(ext) && Number.isFinite(f.size) && f.size >= 200 && f.size <= 65536;
  if (!ok(cer, ".cer")) return { ok: false, error: "Sube el archivo del certificado (termina en .cer)." };
  if (!ok(key, ".key")) return { ok: false, error: "Sube el archivo de la llave privada (termina en .key)." };
  if (typeof password !== "string" || password.length < 1 || password.length > 200) return { ok: false, error: "Escribe la contraseña de tu llave privada." };
  return { ok: true };
}

// Estado de la organización según GET /organizations/{id}.
function estadoOrganizacion(org: any) {
  const o = org && typeof org === "object" ? org : {};
  const steps = Array.isArray(o.pending_steps) ? o.pending_steps.filter((s) => s && typeof s.type === "string").map((s) => ({ type: s.type.slice(0, 40), description: String(s.description || "").slice(0, 200) })) : [];
  const cert = o.certificate && typeof o.certificate === "object" ? o.certificate : {};
  return {
    production_ready: o.is_production_ready === true && steps.length === 0,
    pending_steps: steps,
    has_certificate: cert.has_certificate === true,
    csd_valid_until: typeof cert.expires_at === "string" ? cert.expires_at : null,
    csd_serial: typeof cert.serial_number === "string" ? cert.serial_number.slice(0, 80) : null,
    tax_id: o.legal && typeof o.legal.tax_id === "string" ? o.legal.tax_id.toUpperCase() : "",
    name: String((o.legal && (o.legal.legal_name || o.legal.name)) || "").slice(0, 180),
  };
}

// El RFC del certificado debe ser el de la clínica; si no, se rechaza el CSD.
function rfcCoincide(rfcCertificado: any, rfcClinica: any) {
  const a = String(rfcCertificado || "").toUpperCase(), b = String(rfcClinica || "").toUpperCase();
  return RFC_RE.test(a) && a === b;
}

// Compuerta de producción: todo debe cumplirse en el servidor.
function puedeActivarProduccion({ mode, status: any, productionReady: any, issuerReviewed: any, policyReviewed: any, confirmText } = {}) {
  if (mode !== "platform") return { ok: false, error: "La producción se activa solo con la cuenta de plataforma de SMYL." };
  if (status !== "connected") return { ok: false, error: "Primero activa la facturación de la clínica." };
  if (!issuerReviewed) return { ok: false, error: "Faltan los datos fiscales revisados de la clínica." };
  if (!policyReviewed) return { ok: false, error: "Falta la confirmación de tu contador." };
  if (!productionReady) return { ok: false, error: "Facturapi aún no marca la organización lista para producción. Revisa los pasos pendientes." };
  if (String(confirmText || "").trim().toUpperCase() !== CONFIRM_LIVE_TEXT) return { ok: false, error: `Para confirmar escribe: ${CONFIRM_LIVE_TEXT}` };
  return { ok: true };
}

// La forma de la respuesta de llaves de Facturapi varía (texto, lista de textos o de objetos): se lee de forma defensiva.
function leerLlave(body: any, re: any) {
  const dig = (x) => {
    if (typeof x === "string") return re.test(x.trim()) ? x.trim() : null;
    if (Array.isArray(x)) { for (const i of x) { const k = dig(i); if (k) return k; } return null; }
    if (x && typeof x === "object") { for (const k of ["secret_key", "key", "value", "secret", "api_key", "data"]) { const r = dig(x[k]); if (r) return r; } }
    return null;
  };
  return dig(body);
}

// Mensajes claros para los errores más comunes de la API.
function mensajeCsd(code: any) {
  switch (code) {
    case "certificate_files_invalid": return "El certificado o la llave privada no son válidos. Revisa que sean los archivos de tu CSD (no la e.firma) y que la contraseña sea la de la llave.";
    case "certificate_files_required": return "Sube los dos archivos: el .cer y el .key.";
    case "certificate_expired": return "Tu certificado ya venció. Genera uno nuevo en el SAT.";
    default: return "Facturapi no aceptó el certificado. Revisa los archivos y la contraseña.";
  }
}

return { FACTURAPI_BASE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion, LIVE_KEY_RE, CONFIRM_LIVE_TEXT, datosLegales, validarCsd, estadoOrganizacion, rfcCoincide, puedeActivarProduccion, leerLlave, mensajeCsd };
})();

// ── facturapi/index.ts ──
// Conexión SMYL ↔ Facturapi.
//  · own_key (avanzado): la clínica trae su propia llave de pruebas (sk_test_…).
//  · platform: SMYL crea una organización de Facturapi por clínica con la User Secret Key de la plataforma
//    (FACTURAPI_USER_KEY), carga sus datos fiscales y su CSD, y la pasa a producción con una compuerta explícita.
// Las llaves se cifran aquí (AES-GCM, FACTURAPI_ENCRYPTION_KEY, tenant como dato autenticado) y nunca vuelven al navegador.
// El CSD y su contraseña viajan en memoria hacia Facturapi: no se guardan, no se registran. No timbra ni cancela: etapa posterior.

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
const USER_KEY = Deno.env.get("FACTURAPI_USER_KEY") || "";
const MAX_UPLOAD_BYTES = 200 * 1024;
const MAX_CSD_FAILS_PER_HOUR = 5;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Nunca se registra el cuerpo de las respuestas: pueden traer llaves.
async function fp(path: string, init: RequestInit = {}, key = USER_KEY): Promise<{ ok: boolean; status: number; body: Json | string | null }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}${path}`, {
      ...init, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(20000),
    });
    let body: Json | string | null = null;
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    return { ok: res.ok, status: res.status, body };
  } catch { return { ok: false, status: 0, body: null }; }
}

async function consultarOrganizacion(key: string): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; error: string; auth: boolean }> {
  const r = await fp("/organizations/me", {}, key);
  if (r.status === 401 || r.status === 403) return { ok: false, auth: true, error: "Facturapi rechazó la llave. Revisa que sea la llave secreta de pruebas de tu organización." };
  if (r.status === 0) return { ok: false, auth: false, error: "No se pudo contactar a Facturapi. Intenta de nuevo." };
  if (!r.ok) return { ok: false, auth: false, error: `Facturapi respondió ${r.status}. Intenta de nuevo en unos minutos.` };
  const org = leerOrganizacion(r.body);
  if (!org) return { ok: false, auth: false, error: "Facturapi respondió algo inesperado al consultar la organización." };
  return { ok: true, org };
}

async function evento(tenantId: string, actor: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_facturapi_connection_events").insert({ tenant_id: tenantId, actor_id: actor, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar:", error.message);
}

async function leerFila(tenantId: string) {
  const { data } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  return data;
}
// Actualiza si la fila existe e inserta si no. No se usa upsert: Postgres valida las restricciones de la fila propuesta
// (estado/llaves/producción) antes de resolver el conflicto, y una actualización parcial las violaría.
async function guardar(tenantId: string, actor: string, patch: Json) {
  const existing = await leerFila(tenantId);
  const q = existing
    ? admin.from("smyl_facturapi_connections").update({ ...patch, updated_by: actor }).eq("tenant_id", tenantId)
    : admin.from("smyl_facturapi_connections").insert({ tenant_id: tenantId, updated_by: actor, ...patch });
  const { data, error } = await q.select("*").single();
  if (error) { console.error("[facturapi] no se pudo guardar:", error.message); throw new Error("No se pudo guardar la conexión."); }
  return data;
}
async function emisor(tenantId: string) {
  const { data } = await admin.from("smyl_issuer_fiscal_profiles").select("*").eq("tenant_id", tenantId).maybeSingle();
  return data;
}

// Trae el estado real de la organización y lo guarda.
async function sincronizar(tenantId: string, actor: string, row: Json) {
  const r = await fp(`/organizations/${encodeURIComponent(row.organization_id)}`);
  if (!r.ok || typeof r.body !== "object" || !r.body) throw new Error("No se pudo consultar a Facturapi. Intenta de nuevo.");
  const st = estadoOrganizacion(r.body);
  const data = await guardar(tenantId, actor, {
    pending_steps: st.pending_steps, production_ready: st.production_ready, csd_valid_until: st.csd_valid_until, csd_serial: st.csd_serial,
    last_verified_at: new Date().toISOString(), last_error: null,
  });
  return { data, st };
}

async function llaveDeOrganizacion(orgId: string, ambiente: "test" | "live", crearSiFalta: boolean): Promise<string | null> {
  const re = ambiente === "live" ? LIVE_KEY_RE : TEST_KEY_RE;
  const got = await fp(`/organizations/${encodeURIComponent(orgId)}/apikeys/${ambiente}`);
  let key = got.ok ? leerLlave(got.body, re) : null;
  if (!key && crearSiFalta) {
    const made = await fp(`/organizations/${encodeURIComponent(orgId)}/apikeys/${ambiente}`, { method: "PUT" });
    key = made.ok ? leerLlave(made.body, re) : null;
  }
  return key;
}

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const denied = await requirePermission(auth, CORS, "finance.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId as string, actor = (auth.user as { id: string }).id;

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES) return json(CORS, 413, { error: "La solicitud es demasiado grande." });
  const esMultipart = (req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
  let body: Json = {}, form: FormData | null = null;
  try {
    if (esMultipart) { form = await req.formData(); body = { action: String(form.get("action") || "") }; }
    else body = await req.json();
  } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  const row = await leerFila(tenantId);

  if (action === "status") return json(CORS, 200, { connection: vistaConexion(row) });

  if (!MASTER) { console.error("[facturapi] falta FACTURAPI_ENCRYPTION_KEY"); return json(CORS, 503, { error: "La integración con Facturapi aún no está configurada en el servidor." }); }
  const platformActions = ["provision", "sync", "upload_csd", "enable_live", "disable_live"];
  if (platformActions.includes(action) && !USER_KEY) { console.error("[facturapi] falta FACTURAPI_USER_KEY"); return json(CORS, 503, { error: "La facturación automática aún no está configurada en el servidor." }); }

  try {
    // ── cuenta propia (avanzado), solo pruebas ──
    if (action === "connect") {
      if (row?.mode === "platform" && row?.organization_id) return json(CORS, 409, { error: "Esta clínica usa la cuenta de SMYL. Desconéctala primero si quieres usar tu propia cuenta." });
      const v = validarLlave(body.api_key);
      if (!v.ok) return json(CORS, 400, { error: v.error });
      const r = await consultarOrganizacion(v.key);
      if (!r.ok) { await evento(tenantId, actor, "connected", "failed", { reason: r.auth ? "rejected" : "unreachable" }); return json(CORS, r.auth ? 400 : 502, { error: r.error }); }
      const { ciphertext, iv } = await cifrar(MASTER, tenantId, v.key);
      const now = new Date().toISOString();
      const data = await guardar(tenantId, actor, {
        provider: "facturapi", mode: "own_key", environment: "test", organization_id: r.org.id, organization_name: r.org.name || null,
        secret_ciphertext: ciphertext, secret_iv: iv, key_fingerprint: await huella(v.key), status: "connected",
        connected_at: now, last_verified_at: now, last_error: null,
      });
      await evento(tenantId, actor, "connected", "success", { organization_id: r.org.id, mode: "own_key" });
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "verify") {
      if (!row || row.status === "disconnected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Facturapi no está conectado." });
      if (row.mode === "platform") {
        const { data } = await sincronizar(tenantId, actor, row);
        await evento(tenantId, actor, "verified", "success");
        return json(CORS, 200, { connection: vistaConexion(data) });
      }
      let key: string;
      try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
      catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
      const r = await consultarOrganizacion(key);
      const now = new Date().toISOString();
      const patch = r.ok
        ? { status: "connected", last_verified_at: now, last_error: null, organization_name: r.org.name || row.organization_name }
        : { status: r.auth ? "error" : row.status, last_error: r.error.slice(0, 500) };
      const data = await guardar(tenantId, actor, patch);
      await evento(tenantId, actor, "verified", r.ok ? "success" : "failed", r.ok ? {} : { reason: r.auth ? "rejected" : "unreachable" });
      return json(CORS, r.ok ? 200 : (r.auth ? 400 : 502), { connection: vistaConexion(data), ...(r.ok ? {} : { error: r.error }) });
    }

    // ── plataforma ──
    if (action === "provision") {
      if (row?.mode === "own_key" && row?.status === "connected") return json(CORS, 409, { error: "Ya conectaste tu propia cuenta de Facturapi. Desconéctala primero para usar la de SMYL." });
      const iss = await emisor(tenantId);
      if (!iss || iss.fiscal_status !== "reviewed") return json(CORS, 409, { error: "Primero completa y confirma los datos fiscales de la clínica." });
      const legal = datosLegales(iss);
      if (!legal) return json(CORS, 409, { error: "Faltan datos fiscales de la clínica (razón social, régimen o código postal)." });
      let orgId: string | null = row?.mode === "platform" ? row.organization_id : null;
      if (!orgId) {
        const created = await fp("/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: legal.name }) });
        const id = created.ok && created.body && typeof created.body === "object" ? (created.body as Json).id : null;
        if (typeof id !== "string") { await evento(tenantId, actor, "organization_created", "failed", { status: created.status }); return json(CORS, 502, { error: "Facturapi no pudo crear la organización. Intenta de nuevo." }); }
        orgId = id;
        // Se guarda de inmediato para que un reintento no duplique organizaciones.
        await guardar(tenantId, actor, { provider: "facturapi", mode: "platform", environment: "test", organization_id: orgId, organization_name: legal.name, status: "disconnected", secret_ciphertext: null, secret_iv: null, key_fingerprint: null });
        await evento(tenantId, actor, "organization_created", "success", { organization_id: orgId });
      }
      const put = await fp(`/organizations/${encodeURIComponent(orgId)}/legal`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legal) });
      if (!put.ok) return json(CORS, 502, { error: "Facturapi no aceptó los datos fiscales. Revisa razón social, régimen y código postal." });
      const testKey = await llaveDeOrganizacion(orgId, "test", true);
      if (!testKey) return json(CORS, 502, { error: "Facturapi no entregó la llave de pruebas. Intenta de nuevo." });
      const { ciphertext, iv } = await cifrar(MASTER, tenantId, testKey);
      const now = new Date().toISOString();
      await guardar(tenantId, actor, {
        mode: "platform", environment: "test", organization_id: orgId, organization_name: legal.name, secret_ciphertext: ciphertext, secret_iv: iv,
        key_fingerprint: await huella(testKey), status: "connected", connected_at: row?.connected_at || now, last_error: null,
      });
      const cur = await leerFila(tenantId);
      const { data } = await sincronizar(tenantId, actor, cur);
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "sync") {
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const { data } = await sincronizar(tenantId, actor, row);
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "upload_csd") {
      if (!form) return json(CORS, 400, { error: "Solicitud inválida." });
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const cer = form.get("cer"), key = form.get("key"), password = form.get("password");
      if (!(cer instanceof File) || !(key instanceof File) || typeof password !== "string") return json(CORS, 400, { error: "Sube el .cer, el .key y escribe la contraseña." });
      const v = validarCsd({ cer: { name: cer.name, size: cer.size }, key: { name: key.name, size: key.size }, password });
      if (!v.ok) return json(CORS, 400, { error: v.error });
      const desde = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("smyl_facturapi_connection_events").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("action", "csd_uploaded").eq("status", "failed").gte("created_at", desde);
      if ((count || 0) >= MAX_CSD_FAILS_PER_HOUR) return json(CORS, 429, { error: "Demasiados intentos con el certificado. Espera una hora e inténtalo de nuevo." });
      const iss = await emisor(tenantId);
      const out = new FormData();
      out.append("cer", new Blob([await cer.arrayBuffer()]), "certificado.cer");
      out.append("key", new Blob([await key.arrayBuffer()]), "llave.key");
      out.append("password", password);
      const put = await fp(`/organizations/${encodeURIComponent(row.organization_id)}/certificate`, { method: "PUT", body: out });
      if (!put.ok) {
        const code = put.body && typeof put.body === "object" ? String((put.body as Json).code || "") : "";
        await evento(tenantId, actor, "csd_uploaded", "failed", { code: code.slice(0, 60) });
        return json(CORS, put.status === 0 ? 502 : 400, { error: put.status === 0 ? "No se pudo contactar a Facturapi. Intenta de nuevo." : mensajeCsd(code) });
      }
      const { data, st } = await sincronizar(tenantId, actor, row);
      if (iss && !rfcCoincide(st.tax_id, iss.rfc)) {
        await fp(`/organizations/${encodeURIComponent(row.organization_id)}/certificate`, { method: "DELETE" });
        await evento(tenantId, actor, "csd_uploaded", "failed", { code: "rfc_mismatch" });
        await sincronizar(tenantId, actor, row).catch(() => null);
        return json(CORS, 409, { error: `El RFC del certificado (${st.tax_id || "desconocido"}) no coincide con el de la clínica (${iss.rfc}). Sube el CSD de la clínica o corrige sus datos fiscales.` });
      }
      await evento(tenantId, actor, "csd_uploaded", "success", { serial: st.csd_serial });
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "enable_live") {
      const perm = await requirePermission(auth, CORS, "finance.invoice");
      if (perm) return perm;
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const { data: fresh, st } = await sincronizar(tenantId, actor, row);
      const iss = await emisor(tenantId);
      const { data: pac } = await admin.from("smyl_cfdi_pac_readiness").select("fiscal_policy_reviewed_at").eq("tenant_id", tenantId).maybeSingle();
      const gate = puedeActivarProduccion({
        mode: fresh.mode, status: fresh.status, productionReady: fresh.production_ready, issuerReviewed: iss?.fiscal_status === "reviewed",
        policyReviewed: !!pac?.fiscal_policy_reviewed_at, confirmText: body.confirm_text,
      });
      if (!gate.ok) return json(CORS, 409, { error: gate.error, connection: vistaConexion(fresh) });
      if (!iss || !rfcCoincide(st.tax_id, iss.rfc)) return json(CORS, 409, { error: "El RFC del certificado no coincide con el de la clínica. Vuelve a subir el CSD correcto.", connection: vistaConexion(fresh) });
      const liveKey = await llaveDeOrganizacion(row.organization_id, "live", true);
      if (!liveKey) { await evento(tenantId, actor, "went_live", "failed", { reason: "no_live_key" }); return json(CORS, 502, { error: "Facturapi no entregó la llave de producción. Revisa los pasos pendientes de la organización." }); }
      const enc = await cifrar(MASTER, tenantId, liveKey);
      const now = new Date().toISOString();
      const data = await guardar(tenantId, actor, {
        environment: "live", live_secret_ciphertext: enc.ciphertext, live_secret_iv: enc.iv, live_key_fingerprint: await huella(liveKey),
        live_enabled_at: now, live_enabled_by: actor, last_error: null,
      });
      await evento(tenantId, actor, "went_live", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "disable_live") {
      const perm = await requirePermission(auth, CORS, "finance.invoice");
      if (perm) return perm;
      if (!row) return json(CORS, 409, { error: "Facturapi no está conectado." });
      const data = await guardar(tenantId, actor, { environment: "test", live_secret_ciphertext: null, live_secret_iv: null, live_key_fingerprint: null, live_enabled_at: null, live_enabled_by: null });
      await evento(tenantId, actor, "went_test", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "disconnect") {
      // En plataforma se conserva la organización (y su CSD en Facturapi); solo se retiran las llaves de SMYL.
      const data = await guardar(tenantId, actor, {
        status: "disconnected", environment: "test", secret_ciphertext: null, secret_iv: null, key_fingerprint: null,
        live_secret_ciphertext: null, live_secret_iv: null, live_key_fingerprint: null, live_enabled_at: null, live_enabled_by: null,
        connected_at: null, last_verified_at: null, last_error: null,
        ...(row?.mode === "platform" ? {} : { organization_id: null, organization_name: null, pending_steps: [], production_ready: false, csd_valid_until: null, csd_serial: null }),
      });
      await evento(tenantId, actor, "disconnected", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }
  } catch (e) {
    console.error("[facturapi] error:", (e as Error)?.message);
    return json(CORS, 500, { error: (e as Error)?.message || "No se pudo completar la acción." });
  }

  return json(CORS, 400, { error: "Acción no válida." });
});
