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
const { FACTURAPI_BASE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion, FORMAS_PAGO, formaPagoSugerida, UUID_RE, construirFactura, mensajeFacturapi, clasificarRespuesta, leerFactura } = (() => {
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
  if (!row) return { status: "disconnected", environment: "test" };
  return {
    status: row.status, environment: row.environment, organization_name: row.organization_name || "",
    key_fingerprint: row.key_fingerprint || "", connected_at: row.connected_at, last_verified_at: row.last_verified_at, last_error: row.last_error || "",
  };
}

// ───────────── Timbrado (SOLO sandbox) ─────────────
// Todo lo de abajo es lógica pura: arma el comprobante a partir del borrador ya prevalidado, clasifica la respuesta de Facturapi
// y valida la factura que regresa. El CFDI siempre sale con la llave de pruebas (sk_test_…), sin validez fiscal.
const FORMAS_PAGO = {
  "01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia electrónica de fondos", "04": "Tarjeta de crédito", "28": "Tarjeta de débito",
};
// Forma de pago SAT sugerida según cómo se cobró en SMYL. «Otro» no se adivina: la persona la elige.
function formaPagoSugerida(method: any) {
  return { cash: "01", check: "02", transfer: "03", card: "04" }[String(method || "")] || "";
}
const UNIDADES = { E48: "Unidad de servicio", H87: "Pieza", ACT: "Actividad", EA: "Elemento", KGM: "Kilogramo", LTR: "Litro", XBX: "Caja" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (n) => Math.round(Number(n) * 100);
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

// draft: fila de smyl_cfdi_drafts. impuestos: { [charge_id]: { tax_treatment, tax_rate } } (viene del snapshot del servicio de cada cargo).
// Devuelve { ok:true, payload } o { ok:false, errors:[texto] }; nunca lanza.
function construirFactura(draft: any, impuestos: any, formaPago: any) {
  const errors = [];
  const fs = (draft && draft.fiscal_snapshot) || {};
  const issuer = (draft && draft.issuer_snapshot) || {};
  const concepts = Array.isArray(draft && draft.concepts_snapshot) ? draft.concepts_snapshot : [];
  if (!FORMAS_PAGO[formaPago]) errors.push("Elige la forma de pago real del cobro (efectivo, transferencia, tarjeta…).");
  if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(fs.rfc || "")) || ["XAXX010101000", "XEXX010101000"].includes(String(fs.rfc))) errors.push("El RFC del paciente no es válido para facturarle (no se admite el RFC genérico).");
  if (String(fs.legal_name || "").trim().length < 2) errors.push("Falta el nombre fiscal del paciente.");
  if (!/^\d{3}$/.test(String(fs.fiscal_regime || ""))) errors.push("Falta el régimen fiscal del paciente.");
  if (!/^\d{5}$/.test(String(fs.tax_postal_code || ""))) errors.push("Falta el código postal fiscal del paciente.");
  if (!/^[A-Z]\d{2}$/.test(String(fs.cfdi_use || ""))) errors.push("Falta el uso del CFDI.");
  if (fs.currency && fs.currency !== "MXN") errors.push("Por ahora solo se factura en pesos mexicanos.");
  if (!concepts.length) errors.push("El borrador no tiene conceptos.");
  const items = [];
  let total = 0;
  concepts.forEach((c, i) => {
    const name = String(c.description || "").trim() || `concepto ${i + 1}`;
    const qty = num(c.quantity), unit = num(c.unit_value), disc = num(c.discount || 0), tax = num(c.tax || 0), amount = num(c.amount);
    if (![qty, unit, disc, tax, amount].every(Number.isFinite) || qty <= 0 || unit < 0 || disc < 0 || tax < 0) { errors.push(`Los importes de «${name}» no son válidos.`); return; }
    if (!/^\d{8}$/.test(String(c.product_service_code || ""))) { errors.push(`«${name}» no tiene ClaveProdServ.`); return; }
    if (!/^[A-Z0-9]{1,8}$/.test(String(c.unit_code || ""))) { errors.push(`«${name}» no tiene ClaveUnidad.`); return; }
    const info = (impuestos && impuestos[c.charge_id]) || {};
    const base = cents(qty * unit) - cents(disc);
    let taxability, taxes, expectedTax;
    if (info.tax_treatment === "exempt") { taxability = "02"; taxes = [{ type: "IVA", rate: 0, factor: "Exento" }]; expectedTax = 0; }
    else if (info.tax_treatment === "non_object") { taxability = "01"; taxes = []; expectedTax = 0; }
    else if (info.tax_treatment === "rate" && Number.isFinite(num(info.tax_rate)) && num(info.tax_rate) > 0) {
      taxability = "02"; taxes = [{ type: "IVA", rate: num(info.tax_rate), factor: "Tasa" }]; expectedTax = Math.round(base * num(info.tax_rate));
    } else { errors.push(`Revisa el tratamiento de IVA del servicio «${name}» en el catálogo (exento, tasa o no objeto).`); return; }
    if (base <= 0) { errors.push(`El descuento de «${name}» es mayor que su importe.`); return; }
    if (cents(tax) !== expectedTax) { errors.push(`El IVA de «${name}» no coincide con el que calcula el SAT. Corrige el cargo.`); return; }
    if (cents(amount) !== base + expectedTax) { errors.push(`El total de «${name}» no coincide con sus importes.`); return; }
    total += cents(amount);
    const item = {
      quantity: qty,
      product: {
        description: name.slice(0, 1000), product_key: String(c.product_service_code), unit_key: String(c.unit_code), unit_name: UNIDADES[c.unit_code] || "Unidad",
        price: unit, tax_included: false, taxability, taxes,
      },
    };
    if (disc > 0) item.discount = disc;
    items.push(item);
  });
  if (!errors.length && total !== cents(fs.amount)) errors.push("El total de los conceptos no coincide con el pago.");
  if (errors.length) return { ok: false, errors };
  const customer = { legal_name: String(fs.legal_name).trim(), tax_id: fs.rfc, tax_system: String(fs.fiscal_regime), address: { zip: String(fs.tax_postal_code) } };
  if (fs.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(fs.email))) customer.email = String(fs.email);
  const payload = {
    type: "I", customer, use: fs.cfdi_use, payment_form: formaPago, payment_method: "PUE", currency: "MXN", export: "01", items,
    external_id: draft.id, idempotency_key: draft.idempotency_key,
  };
  if (/^[A-Z0-9-]{1,10}$/.test(String(issuer.invoice_series || ""))) payload.series = issuer.invoice_series;
  return { ok: true, payload, total: total / 100 };
}

// Mensaje de error de Facturapi para la persona (corto, sin datos del paciente ni de la llave).
function mensajeFacturapi(body: any, status: any) {
  const o = body && typeof body === "object" ? body : {};
  const text = String(o.message || o.error || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (text) return text;
  return status ? `Facturapi respondió ${status}.` : "Facturapi no respondió.";
}
// ok = timbrado confirmado; rejected = Facturapi lo rechazó y NO existe factura (se puede corregir y reintentar);
// unknown = no sabemos si se creó (red, 5xx, 409 de idempotencia): hay que verificar antes de reintentar.
function clasificarRespuesta(status: any, body: any) {
  const factura = leerFactura(body);
  if ((status === 200 || status === 201) && factura && factura.uuid) return "ok";
  if (status === 200 || status === 201) return "unknown";
  if (status === 409 || status === 408 || status === 425 || status === 429 || status >= 500 || !status) return "unknown";
  return status >= 400 ? "rejected" : "unknown";
}
// Lee solo lo necesario de la factura de Facturapi; descarta lo que no cumple el formato.
function leerFactura(body: any) {
  const o = body && typeof body === "object" ? body : null;
  if (!o || typeof o.id !== "string" || o.id.length < 3 || o.id.length > 120) return null;
  const folio = Number(o.folio_number);
  return {
    id: o.id,
    uuid: typeof o.uuid === "string" && UUID_RE.test(o.uuid) ? o.uuid.toLowerCase() : "",
    status: typeof o.status === "string" ? o.status.slice(0, 20) : "",
    series: typeof o.series === "string" && /^[A-Za-z0-9-]{0,25}$/.test(o.series) ? o.series : "",
    folio: Number.isInteger(folio) && folio > 0 && folio < 2_000_000_000 ? folio : null,
    total: Number.isFinite(Number(o.total)) ? Number(o.total) : null,
  };
}

return { FACTURAPI_BASE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion, FORMAS_PAGO, formaPagoSugerida, UUID_RE, construirFactura, mensajeFacturapi, clasificarRespuesta, leerFactura };
})();

// ── facturapi/index.ts ──
// Conexión SMYL ↔ Facturapi (SOLO sandbox): guardar, verificar y desconectar la llave de pruebas de cada clínica.
// La llave se cifra aquí (AES-GCM, secreto FACTURAPI_ENCRYPTION_KEY) y nunca vuelve al navegador.
// Conexión (status/connect/verify/disconnect): requiere finance.manage.
// Timbrado SOLO sandbox (stamp/reconcile/download): requiere finance.invoice y que el borrador ya haya pasado la prevalidación local.
// No cancela nada: eso es una etapa posterior.

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const STAMP_TIMEOUT_MS = 40_000;
const RECONCILE_WAIT_MS = 2 * 60_000; // no se da por «no creada» una solicitud más reciente que esto
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function consultarOrganizacion(key: string): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; error: string; auth: boolean }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/organizations/me`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return { ok: false, auth: true, error: "Facturapi rechazó la llave. Revisa que sea la llave secreta de pruebas de tu organización." };
    if (!res.ok) return { ok: false, auth: false, error: `Facturapi respondió ${res.status}. Intenta de nuevo en unos minutos.` };
    const org = leerOrganizacion(await res.json().catch(() => null));
    if (!org) return { ok: false, auth: false, error: "Facturapi respondió algo inesperado al consultar la organización." };
    return { ok: true, org };
  } catch {
    return { ok: false, auth: false, error: "No se pudo contactar a Facturapi. Intenta de nuevo." };
  }
}

async function evento(tenantId: string, actorId: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_facturapi_connection_events").insert({ tenant_id: tenantId, actor_id: actorId, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar:", error.message);
}

// ───────────── Timbrado (sandbox) ─────────────
async function eventoTimbre(tenantId: string, actorId: string, draftId: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_cfdi_stamp_events").insert({ tenant_id: tenantId, actor_id: actorId, draft_id: draftId, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar el timbrado:", error.message);
}
async function llaveDeTenant(tenantId: string): Promise<{ key: string } | { error: string; status: number }> {
  if (!MASTER) return { error: "La integración con Facturapi aún no está configurada en el servidor.", status: 503 };
  const { data: row } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!row || row.status !== "connected" || !row.secret_ciphertext) return { error: "Conecta Facturapi (sandbox) en Cobros → Facturación antes de timbrar.", status: 409 };
  try {
    const key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv);
    if (!/^sk_test_/.test(key)) return { error: "Solo se timbra con una llave de pruebas (sk_test_…).", status: 409 };
    return { key };
  } catch { return { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi.", status: 500 }; }
}
async function llamarFacturapi(key: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Json | null; res: Response | null }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(STAMP_TIMEOUT_MS) });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.clone().json().catch(() => null) : null;
    return { status: res.status, body, res };
  } catch { return { status: 0, body: null, res: null }; }
}

async function timbrado(req: Request, CORS: Record<string, string>, tenantId: string, actor: string, body: Json): Promise<Response> {
  const draftId = typeof body.draft_id === "string" && UUID_RE.test(body.draft_id) ? body.draft_id : "";
  if (!draftId) return json(CORS, 400, { error: "Borrador inválido." });
  // El borrador se lee con la sesión de la persona: la RLS aplica su alcance (paciente/sucursal), no el navegador.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: draft } = await asUser.from("smyl_cfdi_drafts").select("*").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  if (!draft) return json(CORS, 404, { error: "No encontramos ese borrador o no tienes acceso." });
  const llave = await llaveDeTenant(tenantId);
  if ("error" in llave) return json(CORS, llave.status, { error: llave.error });
  const key = llave.key;
  const now = () => new Date().toISOString();
  const vista = async () => ((await admin.from("smyl_cfdi_drafts").select("*").eq("tenant_id", tenantId).eq("id", draftId).single()).data);

  if (body.action === "download") {
    if (draft.status !== "issued" || !draft.provider_invoice_id) return json(CORS, 409, { error: "Este comprobante aún no está timbrado." });
    const kind = body.kind === "xml" ? "xml" : "pdf";
    const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}/${kind}`);
    if (!r.res || !r.res.ok) { await eventoTimbre(tenantId, actor, draftId, "download", "failed", { kind, status: r.status }); return json(CORS, 502, { error: "Facturapi no pudo entregar el archivo. Intenta de nuevo." }); }
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return json(CORS, 502, { error: "El archivo recibido no es válido." });
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await eventoTimbre(tenantId, actor, draftId, "download", "success", { kind });
    const folio = draft.invoice_series ? `${draft.invoice_series}-${draft.invoice_folio}` : String(draft.external_uuid || draft.id).slice(0, 8);
    return json(CORS, 200, { filename: `CFDI-sandbox-${folio}.${kind}`, media_type: kind === "pdf" ? "application/pdf" : "application/xml", base64: btoa(bin) });
  }

  if (body.action === "reconcile") {
    if (draft.status === "issued") return json(CORS, 200, { draft, message: "Este comprobante ya está timbrado." });
    if (draft.status !== "submitted") return json(CORS, 409, { error: "Este borrador no tiene un timbrado pendiente de verificar." });
    const r = await llamarFacturapi(key, `/invoices?external_id=${encodeURIComponent(draftId)}&limit=1`);
    if (r.status === 0 || r.status >= 500 || !r.body) return json(CORS, 502, { error: "No se pudo consultar a Facturapi. Intenta de nuevo en un momento." });
    const found = leerFactura(Array.isArray(r.body.data) ? r.body.data[0] : null);
    if (found && found.uuid) {
      await admin.from("smyl_cfdi_drafts").update({ status: "issued", external_uuid: found.uuid, provider_invoice_id: found.id, invoice_series: found.series || null, invoice_folio: found.folio, stamped_at: now(), provider_message: "" })
        .eq("tenant_id", tenantId).eq("id", draftId).eq("status", "submitted");
      await eventoTimbre(tenantId, actor, draftId, "reconcile", "success", { found: true });
      return json(CORS, 200, { draft: await vista(), message: "El comprobante sí se había timbrado. Ya quedó registrado." });
    }
    const antiguo = draft.stamp_requested_at && Date.now() - new Date(draft.stamp_requested_at).getTime() > RECONCILE_WAIT_MS;
    if (!antiguo) return json(CORS, 409, { error: "La solicitud es muy reciente. Espera un par de minutos y verifica de nuevo." });
    await admin.from("smyl_cfdi_drafts").update({ status: "rejected", provider_message: "Facturapi no recibió la solicitud. Puedes intentar timbrar de nuevo." }).eq("tenant_id", tenantId).eq("id", draftId).eq("status", "submitted");
    await eventoTimbre(tenantId, actor, draftId, "reconcile", "success", { found: false });
    return json(CORS, 200, { draft: await vista(), message: "Facturapi no recibió esa solicitud: ya puedes intentar de nuevo." });
  }

  // stamp
  if (draft.status === "issued") return json(CORS, 409, { error: "Este comprobante ya está timbrado." });
  if (draft.status === "submitted") return json(CORS, 409, { error: "Ya hay un timbrado en proceso. Usa «Verificar estado»." });
  if (draft.status !== "draft" && draft.status !== "rejected") return json(CORS, 409, { error: "Este borrador no se puede timbrar." });
  if (draft.sandbox_status !== "passed") return json(CORS, 409, { error: "Primero pasa la prevalidación del borrador." });
  const formaPago = typeof body.payment_form === "string" ? body.payment_form : "";
  if (!FORMAS_PAGO[formaPago as keyof typeof FORMAS_PAGO]) return json(CORS, 400, { error: "Elige la forma de pago real del cobro." });
  // IVA de cada concepto: sale del snapshot del servicio que se guardó en el cargo (no de lo que mande el navegador).
  const ids = (Array.isArray(draft.concepts_snapshot) ? draft.concepts_snapshot : []).map((c: Json) => c.charge_id).filter((v: unknown) => typeof v === "string" && UUID_RE.test(v as string));
  const { data: cargos } = ids.length ? await admin.from("smyl_finance_charges").select("id, service_snapshot").eq("tenant_id", tenantId).in("id", ids) : { data: [] };
  const impuestos: Json = {};
  for (const c of cargos || []) impuestos[c.id] = { tax_treatment: c.service_snapshot?.tax_treatment, tax_rate: c.service_snapshot?.tax_rate };
  const armado = construirFactura(draft, impuestos, formaPago);
  if (!armado.ok) return json(CORS, 422, { error: armado.errors[0], errors: armado.errors });

  // Se «reclama» el borrador antes de llamar a Facturapi: dos clics o dos personas no pueden timbrar al mismo tiempo.
  const { data: claimed } = await admin.from("smyl_cfdi_drafts").update({
    status: "submitted", provider: "facturapi", payment_form: formaPago, stamp_attempts: (draft.stamp_attempts || 0) + 1, stamp_requested_at: now(), provider_message: "",
  }).eq("tenant_id", tenantId).eq("id", draftId).in("status", ["draft", "rejected"]).select("id").maybeSingle();
  if (!claimed) return json(CORS, 409, { error: "Otra persona ya está timbrando este borrador." });

  const r = await llamarFacturapi(key, "/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(armado.payload) });
  const clase = clasificarRespuesta(r.status, r.body);
  if (clase === "ok") {
    const f = leerFactura(r.body)!;
    const difiere = f.total !== null && Math.round(f.total * 100) !== Math.round(armado.total * 100);
    await admin.from("smyl_cfdi_drafts").update({
      status: "issued", external_uuid: f.uuid, provider_invoice_id: f.id, invoice_series: f.series || null, invoice_folio: f.folio, stamped_at: now(),
      provider_message: difiere ? "Aviso: el total que devolvió Facturapi difiere del cobro. Revísalo antes de entregar el comprobante." : "",
    }).eq("tenant_id", tenantId).eq("id", draftId);
    await eventoTimbre(tenantId, actor, draftId, "stamp", "success", { total_differs: difiere });
    return json(CORS, 200, { draft: await vista(), message: "Comprobante timbrado en sandbox (sin validez fiscal)." });
  }
  if (clase === "rejected") {
    const msg = mensajeFacturapi(r.body, r.status);
    await admin.from("smyl_cfdi_drafts").update({ status: "rejected", provider_message: msg.slice(0, 1000) }).eq("tenant_id", tenantId).eq("id", draftId);
    await eventoTimbre(tenantId, actor, draftId, "stamp", "failed", { status: r.status });
    return json(CORS, 422, { error: `Facturapi rechazó el comprobante: ${msg}`, draft: await vista() });
  }
  const msg = "No se confirmó el timbrado (Facturapi no respondió a tiempo o pidió esperar). Usa «Verificar estado» antes de intentar de nuevo.";
  await admin.from("smyl_cfdi_drafts").update({ provider_message: msg }).eq("tenant_id", tenantId).eq("id", draftId);
  await eventoTimbre(tenantId, actor, draftId, "stamp", "pending", { status: r.status });
  return json(CORS, 202, { draft: await vista(), message: msg });
}

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  let body: Json;
  try { body = await req.json(); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  const esTimbrado = action === "stamp" || action === "reconcile" || action === "download";
  const denied = await requirePermission(auth, CORS, esTimbrado ? "finance.invoice" : "finance.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId as string, actor = (auth.user as { id: string }).id;
  if (esTimbrado) return await timbrado(req, CORS, tenantId, actor, body);
  const { data: row } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();

  if (action === "status") return json(CORS, 200, { connection: vistaConexion(row) });

  if (!MASTER) { console.error("[facturapi] falta FACTURAPI_ENCRYPTION_KEY"); return json(CORS, 503, { error: "La integración con Facturapi aún no está configurada en el servidor." }); }

  if (action === "connect") {
    const v = validarLlave(body.api_key);
    if (!v.ok) return json(CORS, 400, { error: v.error });
    const r = await consultarOrganizacion(v.key);
    if (!r.ok) { await evento(tenantId, actor, "connected", "failed", { reason: r.auth ? "rejected" : "unreachable" }); return json(CORS, r.auth ? 400 : 502, { error: r.error }); }
    const { ciphertext, iv } = await cifrar(MASTER, tenantId, v.key);
    const now = new Date().toISOString();
    const { data, error } = await admin.from("smyl_facturapi_connections").upsert({
      tenant_id: tenantId, provider: "facturapi", environment: "test", organization_id: r.org.id, organization_name: r.org.name || null,
      secret_ciphertext: ciphertext, secret_iv: iv, key_fingerprint: await huella(v.key), status: "connected",
      connected_at: now, last_verified_at: now, last_error: null, updated_by: actor,
    }).select("*").single();
    if (error) { console.error("[facturapi] no se pudo guardar:", error.message); return json(CORS, 500, { error: "No se pudo guardar la conexión." }); }
    await evento(tenantId, actor, "connected", "success", { organization_id: r.org.id });
    return json(CORS, 200, { connection: vistaConexion(data) });
  }

  if (action === "verify") {
    if (!row || row.status === "disconnected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Facturapi no está conectado." });
    let key: string;
    try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
    catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
    const r = await consultarOrganizacion(key);
    const now = new Date().toISOString();
    const patch = r.ok
      ? { status: "connected", last_verified_at: now, last_error: null, organization_name: r.org.name || row.organization_name, updated_by: actor }
      : { status: r.auth ? "error" : row.status, last_error: r.error.slice(0, 500), updated_by: actor };
    const { data } = await admin.from("smyl_facturapi_connections").update(patch).eq("tenant_id", tenantId).select("*").single();
    await evento(tenantId, actor, "verified", r.ok ? "success" : "failed", r.ok ? {} : { reason: r.auth ? "rejected" : "unreachable" });
    return json(CORS, r.ok ? 200 : (r.auth ? 400 : 502), { connection: vistaConexion(data || row), ...(r.ok ? {} : { error: r.error }) });
  }

  if (action === "disconnect") {
    const { data, error } = await admin.from("smyl_facturapi_connections").update({
      status: "disconnected", secret_ciphertext: null, secret_iv: null, key_fingerprint: null, organization_id: null, organization_name: null,
      connected_at: null, last_verified_at: null, last_error: null, updated_by: actor,
    }).eq("tenant_id", tenantId).select("*").maybeSingle();
    if (error) return json(CORS, 500, { error: "No se pudo desconectar." });
    await evento(tenantId, actor, "disconnected", "success");
    return json(CORS, 200, { connection: vistaConexion(data) });
  }

  return json(CORS, 400, { error: "Acción no válida." });
});
