// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/lana-attention/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/messages-scope.ts ──
const { messageAccess, visibleConversationIds } = (() => {
// Alcance de mensajes por rol: quién puede ver (y recibir avisos de) qué conversaciones.
//   clinic   → todas.
//   branches → solo las asignadas a una de sus sucursales; si aún no tienen sucursal, las de pacientes con cita en ellas.
//   own      → solo las de pacientes que atiende esa persona.
// Lo usan las funciones que devuelven avisos o conteos de conversaciones (lana-attention) para que cada sede reciba solo lo suyo.
type MessageScope = "clinic" | "branches" | "own";
interface MessageAccess { userId: string; isOwner: boolean; canRead: boolean; scope: MessageScope }

const RANK: Record<string, number> = { own: 0, branches: 1, clinic: 2 };
const str = (value: unknown, max = 80): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

// deno-lint-ignore no-explicit-any
type Db = any;

async function messageAccess(admin: Db, tenantId: string, userId: string): Promise<MessageAccess | null> {
  const { data } = await admin.from("camila_usuarios").select("id,rol,activo").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
  if (data && data.activo === false) return null;
  if (userId === tenantId || data?.rol === "dueño") return { userId, isOwner: true, canRead: true, scope: "clinic" };
  const { data: assignments } = await admin.from("smyl_member_roles").select("role_id").eq("tenant_id", tenantId).eq("user_id", userId);
  const roleIds = ((assignments || []) as Record<string, unknown>[]).map((row) => String(row.role_id || "")).filter(Boolean);
  if (!roleIds.length) return { userId, isOwner: false, canRead: false, scope: "own" };
  const [{ data: roles }, { data: grants }, { data: scopes }] = await Promise.all([
    admin.from("smyl_roles").select("id,active").eq("tenant_id", tenantId).in("id", roleIds).eq("active", true),
    admin.from("smyl_role_permissions").select("role_id,permission_key").eq("tenant_id", tenantId).in("role_id", roleIds),
    admin.from("smyl_role_scopes").select("role_id,domain,scope").eq("tenant_id", tenantId).in("role_id", roleIds),
  ]);
  const active = new Set(((roles || []) as Record<string, unknown>[]).map((row) => String(row.id || "")));
  if (!active.size) return { userId, isOwner: false, canRead: false, scope: "own" };
  const canRead = ((grants || []) as Record<string, unknown>[]).some((row) => active.has(String(row.role_id || "")) && str(row.permission_key) === "messages.read");
  let scope: MessageScope = "own";
  for (const row of (scopes || []) as Record<string, unknown>[]) {
    if (!active.has(String(row.role_id || "")) || str(row.domain, 30) !== "messages") continue;
    const candidate = str(row.scope, 20);
    if (candidate in RANK && RANK[candidate] > RANK[scope]) scope = candidate as MessageScope;
  }
  return { userId, isOwner: false, canRead, scope };
}

// Devuelve los ids de conversación que esta persona puede ver, entre los indicados.
async function visibleConversationIds(admin: Db, tenantId: string, access: MessageAccess, conversationIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(conversationIds.filter(Boolean)));
  if (!access.canRead || !ids.length) return new Set();
  if (access.scope === "clinic") return new Set(ids);

  const [{ data: assigned }, { data: handoffs }] = await Promise.all([
    admin.from("smyl_conversation_branches").select("conversation_id,branch_id").eq("tenant_id", tenantId).in("conversation_id", ids),
    admin.from("camila_lana_handoffs").select("lana_conversation_id,patient_id").eq("tenant_id", tenantId).in("lana_conversation_id", ids),
  ]);
  const branchOf = new Map<string, string>(((assigned || []) as Record<string, unknown>[]).map((row) => [String(row.conversation_id), String(row.branch_id)]));
  const patientOf = new Map<string, string>(((handoffs || []) as Record<string, unknown>[]).filter((row) => row.patient_id).map((row) => [String(row.lana_conversation_id), String(row.patient_id)]));
  const patients = Array.from(new Set(patientOf.values()));
  const allowed = new Set<string>();

  if (access.scope === "branches") {
    const { data: mine } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", access.userId);
    const myBranches = new Set(((mine || []) as Record<string, unknown>[]).map((row) => String(row.branch_id || "")).filter(Boolean));
    if (!myBranches.size) return allowed;
    const withVisit = new Set<string>();
    if (patients.length) {
      const { data: visits } = await admin.from("smyl_appointments").select("patient_id,branch_id").eq("tenant_id", tenantId).in("patient_id", patients).in("branch_id", Array.from(myBranches));
      for (const row of (visits || []) as Record<string, unknown>[]) withVisit.add(String(row.patient_id));
    }
    for (const id of ids) {
      const branch = branchOf.get(id);
      // La sucursal asignada manda: si es de otra sede, no se avisa aquí aunque el paciente tenga citas en esta.
      if (branch) { if (myBranches.has(branch)) allowed.add(id); continue; }
      const patient = patientOf.get(id);
      if (patient && withVisit.has(patient)) allowed.add(id);
    }
    return allowed;
  }

  // own: solo pacientes de su equipo de atención o con citas con esa persona.
  const { data: professional } = await admin.from("smyl_professionals").select("id").eq("tenant_id", tenantId).eq("user_id", access.userId).eq("active", true).maybeSingle();
  if (!professional?.id || !patients.length) return allowed;
  const [{ data: team }, { data: visits }] = await Promise.all([
    admin.from("smyl_patient_care_team").select("patient_id").eq("tenant_id", tenantId).eq("professional_id", professional.id).eq("active", true).in("patient_id", patients),
    admin.from("smyl_appointments").select("patient_id").eq("tenant_id", tenantId).eq("professional_id", professional.id).in("patient_id", patients),
  ]);
  const mine = new Set<string>([...((team || []) as Record<string, unknown>[]), ...((visits || []) as Record<string, unknown>[])].map((row) => String(row.patient_id)));
  for (const id of ids) { const patient = patientOf.get(id); if (patient && mine.has(patient)) allowed.add(id); }
  return allowed;
}

return { messageAccess, visibleConversationIds };
})();

// ── lana-attention/index.ts ──
function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function safeIso(value: unknown): string {
  const text = String(value || "");
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : "";
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req, "GET, POST, OPTIONS");
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canResolve = auth.user.id === auth.tenantId;

  try {
    if (req.method === "POST") {
      if (!canResolve) return json(403, { error: "Solo el dueño de la clínica puede cerrar una solicitud de atención desde SMYL." });
      let input: Record<string, unknown>;
      try { input = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
      if (input.action !== "resolve") return json(400, { error: "Acción no reconocida." });
      const conversationId = uuid(input.conversation_id);
      if (!conversationId) return json(400, { error: "La conversación de LANA no es válida." });
      const remote = await lanaRequest(auth.tenantId, `/attention/${conversationId}/resolve`, { method: "POST", body: "{}" });
      if (!remote.response.ok) return json(remote.response.status === 404 ? 404 : 502, {
        error: String(remote.body.error || "LANA no pudo cerrar esta solicitud de atención."),
      });
      return json(200, { ok: true, conversation_id: conversationId, resolved: true });
    }

    // Cada persona recibe solo los avisos de lo que su rol puede ver (por sucursal o por pacientes propios).
    const access = await messageAccess(smylAdmin, auth.tenantId, auth.user.id);
    if (!access) return json(403, { error: "Tu acceso a esta clínica no está activo." });
    if (!access.canRead) return json(200, { ok: true, total: 0, items: [], can_resolve: false, restricted: true, privacy: "metadata_only" });
    const remote = await lanaRequest(auth.tenantId, "/attention?limit=40");
    if (!remote.response.ok) return json(502, { error: String(remote.body.error || "LANA no pudo consultar la atención pendiente.") });
    const remoteItems = Array.isArray(remote.body.items) ? remote.body.items as Array<Record<string, unknown>> : [];
    const ids = remoteItems.map((item) => uuid(item.id)).filter((id): id is string => Boolean(id));
    const links = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data, error } = await smylAdmin.from("camila_lana_handoffs")
        .select("lana_conversation_id,patient_id,case_id,created_at")
        .eq("tenant_id", auth.tenantId)
        .in("lana_conversation_id", ids);
      if (error) throw error;
      for (const link of data || []) links.set(String(link.lana_conversation_id), link as Record<string, unknown>);
    }

    const visible = await visibleConversationIds(smylAdmin, auth.tenantId, access, ids);
    const items = remoteItems.flatMap((item) => {
      const id = uuid(item.id);
      if (!id || !visible.has(id)) return [];
      const type = item.attention_type === "patient_replied" ? "patient_replied" : "human_requested";
      const channel = ["whatsapp", "messenger", "instagram"].includes(String(item.channel)) ? String(item.channel) : "lana";
      const link = links.get(id);
      return [{
        id,
        channel,
        contact_name: String(item.contact_name || "Paciente de LANA").trim().slice(0, 150) || "Paciente de LANA",
        attention_type: type,
        reason: type === "human_requested" ? "LANA solicita intervención humana" : "El paciente respondió durante la atención humana",
        waiting_since: safeIso(item.waiting_since),
        unread_count: Math.max(0, Math.min(99, Number(item.unread_count) || 0)),
        paused: item.paused === true,
        lana_url: `https://app.get-lana.com/admin.html?tab=chats&chat=${encodeURIComponent(id)}`,
        linked: link ? {
          patient_id: String(link.patient_id || ""),
          case_id: String(link.case_id || ""),
          created_at: safeIso(link.created_at),
        } : null,
      }];
    });
    return json(200, {
      ok: true,
      total: access.scope === "clinic" ? Math.max(items.length, Number(remote.body.total) || 0) : items.length,
      items,
      can_resolve: canResolve,
      privacy: "metadata_only",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("[lana-attention]", message || error);
    if (/no está conectada|requiere atención/i.test(message)) return json(409, { error: "Conecta o verifica LANA para consultar la bandeja clínica." });
    return json(500, { error: "No se pudo consultar la bandeja clínica de LANA." });
  }
});
