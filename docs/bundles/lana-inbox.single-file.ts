// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/lana-inbox/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/branch-match.ts ──
const { tokens, matchBranch, matchBranchInMessages } = (() => {
// Reconoce a qué sucursal se refiere un paciente cuando contesta «¿en cuál sucursal te atendemos?».
// Determinístico y auditable: solo asigna cuando el mensaje nombra UNA sucursal sin ambigüedad.
interface BranchRef { id: string; name: string }

const GENERIC_IN_NAME = new Set(["sucursal", "sede", "clinica", "consultorio", "dental"]);
const FILLER = new Set(["de", "del", "la", "el", "los", "las", "en", "a", "al", "por", "para", "me", "quiero", "prefiero", "mejor"]);

function tokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Palabras que identifican a la sucursal (sin «sucursal», «sede», «clínica»…). Si no queda ninguna, se usa el nombre completo.
function keyOf(name: string): string[] {
  const all = tokens(name).filter((word) => !FILLER.has(word));
  const key = all.filter((word) => !GENERIC_IN_NAME.has(word));
  return key.length ? key : all;
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > haystack.length) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    if (phrase.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

function matchBranch(text: string, branches: BranchRef[]): BranchRef | null {
  const spoken = tokens(text);
  const words = spoken.filter((word) => !FILLER.has(word)); // «plaza sol» también reconoce «plaza del sol»
  const hits = branches
    .map((branch) => ({ branch, key: keyOf(branch.name) }))
    .filter(({ key }) => key.length && (containsPhrase(spoken, key) || containsPhrase(words, key)));
  // «Centro» y «Centro Norte»: si una coincide solo porque está contenida en otra que también coincide, gana la más específica.
  const specific = hits.filter((hit) => !hits.some((other) => other !== hit && other.key.length > hit.key.length && containsPhrase(other.key, hit.key)));
  return specific.length === 1 ? specific[0].branch : null;
}

// Revisa los últimos mensajes del paciente (de más nuevo a más viejo) y devuelve la primera sucursal inequívoca.
function matchBranchInMessages(messages: { role?: string; content?: string }[], branches: BranchRef[], limit = 15): BranchRef | null {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0 && seen < limit; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    seen += 1;
    const hit = matchBranch(String(message.content || ""), branches);
    if (hit) return hit;
  }
  return null;
}

return { tokens, matchBranch, matchBranchInMessages };
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

// ── lana-inbox/index.ts ──
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MESSAGE_REWRITE_MODEL = Deno.env.get("OPENAI_MILA_MESSAGE_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Actor = {
  id: string;
  name: string;
  role: "owner" | "staff";
  role_code: string;
  role_name: string;
  permissions: string[];
  scopes: Record<string, DataScope>;
};

type DataScope = "own" | "care_team" | "branches" | "clinic";
const SCOPE_RANK: Record<DataScope, number> = { own: 1, care_team: 2, branches: 3, clinic: 4 };

const OWNER_PERMISSIONS = [
  "messages.read", "messages.respond", "messages.manage",
  "clinical.read", "clinical.write", "clinical.approve",
  "schedule.read", "schedule.manage",
];

function can(actor: Actor, permission: string): boolean {
  return actor.role === "owner" || actor.permissions.includes(permission);
}

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function messageId(value: unknown): string | null {
  const candidate = String(value || "").trim();
  return /^[1-9][0-9]{0,18}$/.test(candidate) ? candidate : null;
}

// Respuesta JSON para las funciones auxiliares del módulo. Desde el 2026-10-21 la versión con CORS vive dentro del
// manejador (necesita el Origin de cada petición) y las funciones de afuera fallaban con ReferenceError: la envoltura de
// Deno.serve (al final del archivo) agrega los encabezados CORS a toda respuesta que no los traiga.
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function responseUsage(payload: Record<string, unknown>): Record<string, number> {
  const source = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
  }
  if (!("total_tokens" in result) && (result.input_tokens || result.output_tokens)) {
    result.total_tokens = (result.input_tokens || 0) + (result.output_tokens || 0);
  }
  return result;
}

function responseOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") return part.text;
    }
  }
  throw new Error("MILA no devolvió una redacción.");
}

function stableMessageFacts(value: string): { numbers: string[]; urls: string[] } {
  return {
    numbers: (value.match(/\b\d+(?:[.,:/-]\d+)*\b/g) || []).map((item) => item.trim()).sort(),
    urls: (value.match(/https?:\/\/[^\s]+/gi) || []).map((item) => item.trim()).sort(),
  };
}

async function improveMessageWriting(sourceText: string): Promise<{ rewrittenText: string; usage: Record<string, number> }> {
  const schema = {
    type: "object",
    properties: { rewritten_text: { type: "string" } },
    required: ["rewritten_text"],
    additionalProperties: false,
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MESSAGE_REWRITE_MODEL,
      store: false,
      max_output_tokens: 1400,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: `Eres MILA, asistente de comunicación de una clínica dental. Corrige únicamente ortografía, puntuación, concordancia, repeticiones y claridad del mensaje escrito por una persona del equipo.
Conserva exactamente el significado, tono, intención, incertidumbre, negaciones, nombres, fechas, horas, montos, teléfonos, cantidades, enlaces y compromisos. Mantén saltos de línea y emojis cuando ayuden a la lectura.
No inventes ni agregues hechos, diagnósticos, tratamientos, precios, promociones, disponibilidad, políticas ni promesas. No cambies una pregunta por una afirmación ni una posibilidad por una certeza. No respondas al paciente: solo devuelve el mismo mensaje mejor redactado en español.`,
          }],
        },
        { role: "user", content: [{ type: "input_text", text: sourceText }] },
      ],
      text: { format: { type: "json_schema", name: "mila_message_rewrite", strict: true, schema } },
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Redacción ${response.status}`);
  const parsed = JSON.parse(responseOutputText(payload)) as Record<string, unknown>;
  const rewrittenText = typeof parsed.rewritten_text === "string" ? parsed.rewritten_text.trim() : "";
  if (!rewrittenText || rewrittenText.length > 4000) throw new Error("Redacción fuera de límite");
  if (JSON.stringify(stableMessageFacts(sourceText)) !== JSON.stringify(stableMessageFacts(rewrittenText))) {
    throw new Error("La redacción alteró datos verificables");
  }
  return { rewrittenText, usage: responseUsage(payload) };
}

async function actorFor(user: { id: string; email?: string }, tenantId: string): Promise<Actor | null> {
  const { data } = await admin.from("camila_usuarios")
    .select("id,nombre,email,rol,activo")
    .eq("id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (data && data.activo === false) return null;
  const isOwner = user.id === tenantId || data?.rol === "dueño";
  const fallback = text(user.email, 160).split("@")[0] || (isOwner ? "Dueño de la clínica" : "Miembro del equipo");
  let roleCode = isOwner ? "propietario" : "sin_rol";
  let roleName = isOwner ? "Propietario" : "Sin rol operativo";
  let permissions = isOwner ? [...OWNER_PERMISSIONS] : [];
  const scopes: Record<string, DataScope> = {
    patients: isOwner ? "clinic" : "own", schedule: isOwner ? "clinic" : "own",
    clinical: isOwner ? "clinic" : "own", messages: isOwner ? "clinic" : "own",
    finance: isOwner ? "clinic" : "own",
  };
  if (!isOwner) {
    const { data: assignments } = await admin.from("smyl_member_roles")
      .select("role_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id);
    const roleIds = (assignments || []).map((row: Record<string, unknown>) => String(row.role_id || "")).filter(Boolean);
    if (roleIds.length) {
      const [{ data: roles }, { data: grants }, { data: roleScopes }] = await Promise.all([
        admin.from("smyl_roles").select("id,code,name,active").eq("tenant_id", tenantId).in("id", roleIds).eq("active", true),
        admin.from("smyl_role_permissions").select("role_id,permission_key").eq("tenant_id", tenantId).in("role_id", roleIds),
        admin.from("smyl_role_scopes").select("role_id,domain,scope").eq("tenant_id", tenantId).in("role_id", roleIds),
      ]);
      const activeRoles = roles || [];
      if (activeRoles.length) {
        roleCode = activeRoles.map((row: Record<string, unknown>) => text(row.code, 40)).filter(Boolean).join(",");
        roleName = activeRoles.map((row: Record<string, unknown>) => text(row.name, 80)).filter(Boolean).join(" · ");
        const activeIds = new Set(activeRoles.map((row: Record<string, unknown>) => String(row.id || "")));
        permissions = Array.from(new Set((grants || [])
          .filter((row: Record<string, unknown>) => activeIds.has(String(row.role_id || "")))
          .map((row: Record<string, unknown>) => text(row.permission_key, 80))
          .filter(Boolean)));
        for (const row of roleScopes || []) {
          if (!activeIds.has(String(row.role_id || ""))) continue;
          const domain = text(row.domain, 30);
          const candidate = text(row.scope, 20) as DataScope;
          if (domain in scopes && candidate in SCOPE_RANK && SCOPE_RANK[candidate] > SCOPE_RANK[scopes[domain]]) scopes[domain] = candidate;
        }
      }
    }
  }
  return {
    id: user.id,
    name: text(data?.nombre, 160) || text(data?.email, 160) || fallback,
    role: isOwner ? "owner" : "staff",
    role_code: roleCode,
    role_name: roleName,
    permissions,
    scopes,
  };
}

function assignedActorId(conversation: Record<string, unknown>): string {
  const assignment = conversation.assignment && typeof conversation.assignment === "object"
    ? conversation.assignment as Record<string, unknown> : {};
  return String(conversation.assigned_actor_id || assignment.actor_id || "");
}

async function accessiblePatient(actor: Actor, tenantId: string, patientId: string, domain: "messages" | "clinical" = "messages"): Promise<boolean> {
  const scope = actor.scopes[domain] || "own";
  if (scope === "clinic") return true;
  if (scope === "branches") {
    const { data: branches } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", actor.id);
    const ids = (branches || []).map((row) => row.branch_id).filter(Boolean);
    if (!ids.length) return false;
    const { data } = await admin.from("smyl_appointments").select("id").eq("tenant_id", tenantId).eq("patient_id", patientId).in("branch_id", ids).limit(1);
    return Boolean(data?.length);
  }
  const { data: professional } = await admin.from("smyl_professionals").select("id").eq("tenant_id", tenantId).eq("user_id", actor.id).eq("active", true).maybeSingle();
  if (!professional?.id) return false;
  const [{ data: team }, { data: appointments }] = await Promise.all([
    admin.from("smyl_patient_care_team").select("patient_id").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("professional_id", professional.id).eq("active", true).limit(1),
    admin.from("smyl_appointments").select("id").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("professional_id", professional.id).limit(1),
  ]);
  return Boolean(team?.length || appointments?.length);
}

type BranchAssignment = { branch_id: string; source: string };

async function branchAssignments(tenantId: string, ids: string[]): Promise<Map<string, BranchAssignment>> {
  const result = new Map<string, BranchAssignment>();
  const unique = Array.from(new Set(ids.filter(Boolean))).slice(0, 200);
  if (!unique.length) return result;
  const { data } = await admin.from("smyl_conversation_branches").select("conversation_id,branch_id,source")
    .eq("tenant_id", tenantId).in("conversation_id", unique);
  for (const row of (data || []) as Record<string, unknown>[]) {
    result.set(String(row.conversation_id), { branch_id: String(row.branch_id), source: text(row.source, 20) || "manual" });
  }
  return result;
}

async function memberBranchIds(actor: Actor, tenantId: string): Promise<string[]> {
  const { data } = await admin.from("smyl_member_branches").select("branch_id").eq("tenant_id", tenantId).eq("user_id", actor.id);
  return ((data || []) as Record<string, unknown>[]).map((row) => String(row.branch_id || "")).filter(Boolean);
}

async function activeBranches(tenantId: string): Promise<{ id: string; name: string; is_default: boolean }[]> {
  const { data } = await admin.from("smyl_branches").select("id,name,is_default").eq("tenant_id", tenantId).eq("active", true).order("is_default", { ascending: false }).order("name");
  return ((data || []) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), name: text(row.name, 120), is_default: Boolean(row.is_default) }));
}

async function canAccessConversation(actor: Actor, tenantId: string, conversationId: string, conversation?: Record<string, unknown>): Promise<boolean> {
  if ((actor.scopes.messages || "own") === "clinic") return true;
  if (conversation && assignedActorId(conversation) === actor.id) return true;
  if ((actor.scopes.messages || "own") === "branches") {
    const assigned = (await branchAssignments(tenantId, [conversationId])).get(conversationId);
    // La sucursal asignada manda: quien no pertenece a ella no ve la conversación, aunque el paciente tenga citas en otra sede.
    if (assigned) return (await memberBranchIds(actor, tenantId)).includes(assigned.branch_id);
  }
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (handoff?.patient_id && await accessiblePatient(actor, tenantId, String(handoff.patient_id))) return true;
  if (!conversation) {
    const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages?limit=1`, { method: "GET", headers: actorHeaders(actor) }, 15000);
    const candidate = remote.body.conversation && typeof remote.body.conversation === "object" ? remote.body.conversation as Record<string, unknown> : {};
    return assignedActorId(candidate) === actor.id;
  }
  return false;
}

async function filterConversationPayload(actor: Actor, tenantId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!Array.isArray(body.conversations)) return body;
  const sliced = body.conversations.slice(0, 100);
  const ids = sliced.map((value) => value && typeof value === "object" ? uuid((value as Record<string, unknown>).id) : null).filter(Boolean) as string[];
  const [assignments, branches] = await Promise.all([branchAssignments(tenantId, ids), activeBranches(tenantId)]);
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  // Si el paciente acaba de decir en qué sucursal quiere atenderse, la conversación queda asignada sin esperar a una persona.
  if (branches.length > 1) {
    const inferred: Record<string, unknown>[] = [];
    for (const value of sliced) {
      if (!value || typeof value !== "object") continue;
      const conversation = value as Record<string, unknown>;
      const id = uuid(conversation.id);
      if (!id || assignments.has(id) || conversation.last_message_role !== "patient") continue;
      const hit = matchBranch(text(conversation.last_message, 600), branches);
      if (!hit) continue;
      assignments.set(id, { branch_id: hit.id, source: "ai" });
      inferred.push({ tenant_id: tenantId, conversation_id: id, branch_id: hit.id, source: "ai" });
    }
    if (inferred.length) {
      await admin.from("smyl_conversation_branches").upsert(inferred, { onConflict: "tenant_id,conversation_id", ignoreDuplicates: true });
    }
  }
  const clinicWide = (actor.scopes.messages || "own") === "clinic";
  const allowed: unknown[] = [];
  for (const value of sliced) {
    if (!value || typeof value !== "object") continue;
    const conversation = { ...(value as Record<string, unknown>) };
    const id = uuid(conversation.id);
    const assigned = id ? assignments.get(id) : undefined;
    conversation.branch = assigned ? { id: assigned.branch_id, name: names.get(assigned.branch_id) || "Sucursal", source: assigned.source } : null;
    if (clinicWide || (id && await canAccessConversation(actor, tenantId, id, conversation))) allowed.push(conversation);
  }
  const page = body.page && typeof body.page === "object" ? { ...(body.page as Record<string, unknown>), total: allowed.length } : body.page;
  return clinicWide ? { ...body, conversations: allowed } : { ...body, conversations: allowed, removed: [], page };
}

// Al abrir una conversación: muestra su sucursal y, si aún no tiene, la deduce de lo que dijo el paciente.
async function attachThreadBranch(tenantId: string, body: Record<string, unknown>): Promise<void> {
  const conversation = body.conversation && typeof body.conversation === "object" ? body.conversation as Record<string, unknown> : null;
  const id = conversation ? uuid(conversation.id) : null;
  if (!conversation || !id) return;
  const [assignments, branches] = await Promise.all([branchAssignments(tenantId, [id]), activeBranches(tenantId)]);
  let assigned = assignments.get(id);
  if (!assigned && branches.length > 1 && Array.isArray(body.messages)) {
    const hit = matchBranchInMessages(body.messages as { role?: string; content?: string }[], branches);
    if (hit) {
      assigned = { branch_id: hit.id, source: "ai" };
      await admin.from("smyl_conversation_branches").upsert(
        { tenant_id: tenantId, conversation_id: id, branch_id: hit.id, source: "ai" },
        { onConflict: "tenant_id,conversation_id", ignoreDuplicates: true },
      );
    }
  }
  const name = assigned ? branches.find((branch) => branch.id === assigned!.branch_id)?.name : "";
  conversation.branch = assigned ? { id: assigned.branch_id, name: name || "Sucursal", source: assigned.source } : null;
}

// Sincronización: si alguien cambió la sucursal de una conversación desde la última consulta, quien ya no puede verla la pierde
// de su bandeja y los demás recargan la lista (la sucursal vive en SMYL, así que LANA no la marca como cambiada).
async function attachBranchChanges(actor: Actor, tenantId: string, since: string | null, body: Record<string, unknown>): Promise<void> {
  const stamp = since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : "";
  if (!stamp) return;
  const { data } = await admin.from("smyl_conversation_branches").select("conversation_id").eq("tenant_id", tenantId).gt("assigned_at", stamp).limit(50);
  const changed = ((data || []) as Record<string, unknown>[]).map((row) => String(row.conversation_id));
  if (!changed.length) return;
  body.branch_changed = true;
  if ((actor.scopes.messages || "own") === "clinic") return;
  const removed = Array.isArray(body.removed_conversation_ids) ? [...body.removed_conversation_ids as unknown[]] : [];
  for (const id of changed) {
    if (!await canAccessConversation(actor, tenantId, id)) removed.push(id);
  }
  body.removed_conversation_ids = removed;
}

function forbiddenConversation(): Response {
  return json(403, { error: "Esta conversación queda fuera del alcance de tu rol.", code: "conversation_scope_denied" });
}

async function listTeam(tenantId: string): Promise<Response> {
  const { data, error } = await admin.from("camila_usuarios")
    .select("id,nombre,email,rol,activo")
    .eq("tenant_id", tenantId)
    .eq("activo", true)
    .order("created_at", { ascending: true });
  if (error) return json(500, { error: "No se pudo consultar el equipo de la clínica." });
  return json(200, {
    ok: true,
    members: (data || []).map((member: Record<string, unknown>) => ({
      id: String(member.id || ""),
      name: text(member.nombre, 160) || text(member.email, 160) || "Miembro del equipo",
      role: member.rol === "dueño" ? "owner" : "staff",
    })),
  });
}

async function availabilityCatalog(tenantId: string): Promise<Response> {
  const [servicesResult, branchesResult, professionalsResult, linksResult] = await Promise.all([
    admin.from("smyl_services").select("id,name,duration_minutes,category").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).eq("active", true).order("name"),
    admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).eq("active", true).order("display_name"),
    admin.from("smyl_professional_services").select("professional_id,service_id").eq("tenant_id", tenantId),
  ]);
  const failed = [servicesResult, branchesResult, professionalsResult, linksResult].find((result) => result.error);
  if (failed?.error) return json(500, { error: "No se pudo consultar la configuración de Agenda." });
  return json(200, {
    ok: true,
    services: servicesResult.data || [],
    branches: branchesResult.data || [],
    professionals: professionalsResult.data || [],
    professional_services: linksResult.data || [],
  });
}

async function availableSlots(actor: Actor, tenantId: string, url: URL): Promise<Response> {
  const serviceId = uuid(url.searchParams.get("service_id"));
  const branchId = url.searchParams.get("branch_id") ? uuid(url.searchParams.get("branch_id")) : null;
  const professionalId = url.searchParams.get("professional_id") ? uuid(url.searchParams.get("professional_id")) : null;
  const from = new Date(String(url.searchParams.get("from") || ""));
  const to = new Date(String(url.searchParams.get("to") || ""));
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 12, 1), 30);
  if (!serviceId || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return json(400, { error: "Selecciona un servicio y un periodo válidos." });
  }
  if (url.searchParams.get("branch_id") && !branchId) return json(400, { error: "Sucursal no válida." });
  if (url.searchParams.get("professional_id") && !professionalId) return json(400, { error: "Profesional no válido." });
  const { data, error } = await admin.rpc("smyl_inbox_available_slots", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_service_id: serviceId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_branch_id: branchId,
    p_professional_id: professionalId,
    p_limit: limit,
  });
  if (error) {
    console.error("[lana-inbox] availability", error.message);
    const forbidden = error.code === "42501";
    return json(forbidden ? 403 : 400, { error: forbidden ? "Tu rol no permite consultar disponibilidad." : "No se pudo calcular la disponibilidad solicitada." });
  }
  return json(200, { ok: true, slots: data || [], generated_at: new Date().toISOString(), holds_created: false });
}

async function appointmentRequests(tenantId: string, conversationId: string): Promise<Response> {
  const { data, error } = await admin.from("smyl_appointment_requests")
    .select("id,service_id,preferred_branch_id,preferred_professional_id,requested_start,requested_end,status,appointment_id,created_at,decided_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(20);
  if (error) return json(500, { error: "No se pudieron consultar las elecciones de horario." });
  return json(200, { ok: true, requests: data || [] });
}

async function appointmentContext(tenantId: string, conversationId: string): Promise<Response> {
  const { data: handoff, error: handoffError } = await admin.from("camila_lana_handoffs")
    .select("patient_id").eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (handoffError) return json(500, { error: "No se pudo consultar la continuidad de Agenda." });
  if (!handoff) return json(200, { ok: true, linked: false, items: [] });
  const { data: requests, error } = await admin.from("smyl_appointment_requests")
    .select("id,service_id,preferred_branch_id,preferred_professional_id,requested_start,requested_end,status,appointment_id,created_at,decided_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(10);
  if (error) return json(500, { error: "No se pudo consultar la continuidad de Agenda." });
  const rows = requests || [];
  const serviceIds = [...new Set(rows.map((row) => row.service_id).filter(Boolean))];
  const branchIds = [...new Set(rows.map((row) => row.preferred_branch_id).filter(Boolean))];
  const professionalIds = [...new Set(rows.map((row) => row.preferred_professional_id).filter(Boolean))];
  const appointmentIds = [...new Set(rows.map((row) => row.appointment_id).filter(Boolean))];
  const [servicesResult, branchesResult, professionalsResult, appointmentsResult] = await Promise.all([
    serviceIds.length ? admin.from("smyl_services").select("id,name,duration_minutes").eq("tenant_id", tenantId).in("id", serviceIds) : Promise.resolve({ data: [], error: null }),
    branchIds.length ? admin.from("smyl_branches").select("id,name,timezone").eq("tenant_id", tenantId).in("id", branchIds) : Promise.resolve({ data: [], error: null }),
    professionalIds.length ? admin.from("smyl_professionals").select("id,display_name,specialty").eq("tenant_id", tenantId).in("id", professionalIds) : Promise.resolve({ data: [], error: null }),
    appointmentIds.length ? admin.from("smyl_appointments").select("id,status,starts_at,ends_at").eq("tenant_id", tenantId).in("id", appointmentIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([servicesResult, branchesResult, professionalsResult, appointmentsResult].some((result) => result.error)) return json(500, { error: "No se pudieron completar los datos de Agenda." });
  const byId = (data: Record<string, unknown>[]) => new Map(data.map((row) => [String(row.id), row]));
  const services = byId((servicesResult.data || []) as Record<string, unknown>[]);
  const branches = byId((branchesResult.data || []) as Record<string, unknown>[]);
  const professionals = byId((professionalsResult.data || []) as Record<string, unknown>[]);
  const appointments = byId((appointmentsResult.data || []) as Record<string, unknown>[]);
  return json(200, { ok: true, linked: true, patient_id: handoff.patient_id, items: rows.map((row) => ({
    ...row, service: services.get(String(row.service_id)) || null,
    branch: branches.get(String(row.preferred_branch_id)) || null,
    professional: professionals.get(String(row.preferred_professional_id)) || null,
    appointment: row.appointment_id ? appointments.get(String(row.appointment_id)) || null : null,
  })) });
}

async function createAppointmentRequest(actor: Actor, tenantId: string, conversationId: string, body: Record<string, unknown>, idempotencyKey: string): Promise<Response> {
  const serviceId = uuid(body.service_id); const branchId = uuid(body.branch_id); const professionalId = uuid(body.professional_id);
  const startsAt = new Date(String(body.starts_at || ""));
  if (!serviceId || !branchId || !professionalId || !Number.isFinite(startsAt.getTime())) return json(400, { error: "La elección de horario está incompleta." });
  const { data, error } = await admin.rpc("smyl_inbox_create_appointment_request", {
    p_tenant_id: tenantId, p_actor_id: actor.id, p_conversation_id: conversationId,
    p_service_id: serviceId, p_branch_id: branchId, p_professional_id: professionalId,
    p_starts_at: startsAt.toISOString(), p_external_key: idempotencyKey,
  });
  if (error) {
    console.error("[lana-inbox] appointment request", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo registrar la elección." });
  }
  return json(200, { ok: true, request_id: data, status: "pending", appointment_created: false, message_sent: false });
}

async function confirmAppointmentRequest(actor: Actor, tenantId: string, requestId: string, appointmentId: string): Promise<Response> {
  const { data, error } = await admin.rpc("smyl_inbox_confirm_appointment_request", {
    p_tenant_id: tenantId, p_actor_id: actor.id, p_request_id: requestId, p_appointment_id: appointmentId,
  });
  if (error) {
    console.error("[lana-inbox] appointment confirm", error.message);
    return json(error.code === "42501" ? 403 : 409, { error: error.message || "No se pudo confirmar la cita." });
  }
  return json(200, { ok: true, appointment_id: data, status: "confirmed", message_sent: false });
}

function actorHeaders(actor: Actor, idempotencyKey?: string | null): Headers {
  const headers = new Headers({
    "X-SMYL-Actor-Id": actor.id,
    "X-SMYL-Actor-Role": actor.role,
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(actor.name),
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

// Resumen de conversación guardado (tabla smyl_conversation_summaries, sin acceso desde el navegador).
const SUMMARY_TABLE = "smyl_conversation_summaries";

function summaryList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 8);
}

function cleanSummary(body: Record<string, unknown>): Record<string, unknown> | null {
  const summary = text(body.summary, 4000);
  if (!summary) return null;
  return {
    summary,
    next_step: text(body.next_step, 600),
    open_questions: summaryList(body.open_questions),
    unconfirmed_facts: summaryList(body.unconfirmed_facts),
    requires_human: body.requires_human === true,
  };
}

function isoDate(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Quien tiene clinical.read y alcance clínico sobre el paciente del chat puede ver el resumen hecho con contexto clínico.
async function clinicalSummaryAllowed(actor: Actor, tenantId: string, conversationId: string): Promise<boolean> {
  if (!can(actor, "clinical.read")) return false;
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  return Boolean(handoff?.patient_id && await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical"));
}

async function storedSummary(actor: Actor, tenantId: string, conversationId: string): Promise<Record<string, unknown>> {
  const allowClinical = await clinicalSummaryAllowed(actor, tenantId, conversationId);
  let query = admin.from(SUMMARY_TABLE).select("summary,basis_at,generated_at,generated_by_name,includes_clinical")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId);
  if (!allowClinical) query = query.eq("includes_clinical", false);
  const { data, error } = await query.order("generated_at", { ascending: false }).limit(1);
  // Sin la migración aplicada la ficha sigue funcionando: simplemente no hay resumen guardado.
  if (error) return { ok: true, summary: null, storage: "unavailable" };
  const row = data && data[0];
  if (!row) return { ok: true, summary: null, storage: "ready" };
  return {
    ok: true, storage: "ready", summary: row.summary, basis_at: row.basis_at, generated_at: row.generated_at,
    generated_by_name: row.generated_by_name || "", includes_clinical: Boolean(row.includes_clinical),
  };
}

async function saveSummary(actor: Actor, tenantId: string, conversationId: string, summary: Record<string, unknown>, includesClinical: boolean, basisAt: string | null) {
  const generatedAt = new Date().toISOString();
  const { error } = await admin.from(SUMMARY_TABLE).upsert({
    tenant_id: tenantId, lana_conversation_id: conversationId, includes_clinical: includesClinical,
    summary, basis_at: basisAt, generated_by: actor.id, generated_by_name: text(actor.name, 120), generated_at: generatedAt,
  }, { onConflict: "tenant_id,lana_conversation_id,includes_clinical" });
  if (error) {
    console.warn("No se guardó el resumen de la conversación", error.code || error.message);
    return { stored: false };
  }
  return { stored: true, generated_at: generatedAt, generated_by_name: text(actor.name, 120), basis_at: basisAt };
}

type MedicalAlert = { kind: "alert" | "allergy"; label: string; detail: string; severity: string };

const ALLERGY_SEVERITY: Record<string, string> = { low: "Baja", moderate: "Moderada", high: "Alta" };
const HISTORY_STATUSES = ["yes", "no", "unknown", "pending"];

function historyText(value: unknown, max = 120): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Misma lógica que smyl-history-model.js: registros con detalle y, si no hay, las listas antiguas.
function historyAllergies(document: Record<string, unknown>): Array<{ substance: string; reaction: string; severity: string }> {
  const rows = Array.isArray(document.allergy_records)
    ? document.allergy_records.filter((row) => row && typeof row === "object").map((row) => {
      const record = row as Record<string, unknown>;
      return { substance: historyText(record.substance), reaction: historyText(record.reaction), severity: historyText(record.severity, 20) };
    }).filter((row) => row.substance || row.reaction)
    : [];
  if (rows.length) return rows;
  return (Array.isArray(document.allergies) ? document.allergies : [])
    .map((value) => ({ substance: historyText(value), reaction: "", severity: "" })).filter((row) => row.substance);
}

function historyReviewed(document: Record<string, unknown>, key: string, count: number): boolean {
  if (count) return true;
  const value = String(document[key] || "");
  const status = HISTORY_STATUSES.includes(value) ? value : "pending";
  return status === "no";
}

// Alertas médicas para la cabecera de la Ficha 360: etiquetas del alta del paciente + historia clínica vigente.
// Solo se arma después de comprobar el alcance clínico del rol (accessiblePatient … "clinical").
function medicalAlerts(patientTags: unknown, history: { document?: unknown; updated_at?: string | null } | null) {
  const document = history && history.document && typeof history.document === "object" ? history.document as Record<string, unknown> : {};
  const items: MedicalAlert[] = []; const seen = new Set<string>();
  const push = (item: MedicalAlert) => {
    const key = item.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!item.label || seen.has(key) || items.length >= 12) return;
    seen.add(key); items.push(item);
  };
  const allergies = historyAllergies(document);
  allergies.forEach((row) => push({
    kind: "allergy", label: row.substance || "Alergia sin sustancia", severity: row.severity in ALLERGY_SEVERITY ? row.severity : "",
    detail: [row.reaction ? `Reacción: ${row.reaction}` : "", ALLERGY_SEVERITY[row.severity] ? `Gravedad: ${ALLERGY_SEVERITY[row.severity]}` : ""].filter(Boolean).join(" · "),
  }));
  const historyAlerts = (Array.isArray(document.alerts) ? document.alerts : []).map((value) => historyText(value)).filter(Boolean);
  historyAlerts.forEach((label) => push({ kind: "alert", label, detail: "", severity: "" }));
  (Array.isArray(patientTags) ? patientTags : []).map((value) => historyText(value, 80)).filter(Boolean)
    .forEach((label) => push({ kind: "alert", label, detail: "", severity: "" }));
  items.sort((a, b) => Number(b.severity === "high") - Number(a.severity === "high") || Number(b.kind === "allergy") - Number(a.kind === "allergy"));
  const reviewed = historyReviewed(document, "alerts_status", historyAlerts.length) && historyReviewed(document, "allergies_status", allergies.length);
  return { items, reviewed, has_history: Boolean(history), history_updated_at: history?.updated_at || null };
}

async function clinicalContext(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const { data: handoff, error } = await admin.from("camila_lana_handoffs")
    .select("id,patient_id,case_id,lana_channel,created_at")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (error) return json(500, { error: "No se pudo consultar la Ficha 360." });
  if (!handoff) return json(200, { ok: true, linked: false, patient: null, case: null, clinical_images: [] });
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) {
    return json(403, { error: "El expediente queda fuera del alcance clínico de tu rol.", code: "patient_scope_denied" });
  }
  const caseQuery = handoff.case_id
    ? admin.from("camila_casos").select("id,nombre_paciente,telefono,email,score,score_lbl,resumen,diagnostico,total_cotizacion,simulacion_url,fotos_count,lana_cita_id,created_at")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const linksQuery = handoff.case_id
    ? admin.from("camila_lana_clinical_links").select("id,lana_message_id,media_type,status,label,created_at")
      .eq("tenant_id", tenantId).eq("case_id", handoff.case_id).order("created_at", { ascending: false }).limit(50)
    : Promise.resolve({ data: [], error: null });
  const [{ data: patient }, { data: caseRow }, { data: links }, { data: history }] = await Promise.all([
    admin.from("camila_pacientes").select("id,nombre,apellido,email,telefono,fecha_nacimiento,genero,notas,updated_at,consentimiento_whatsapp,alertas_medicas")
      .eq("tenant_id", tenantId).eq("id", handoff.patient_id).maybeSingle(),
    caseQuery,
    linksQuery,
    admin.from("smyl_patient_histories").select("document,updated_at")
      .eq("tenant_id", tenantId).eq("patient_id", handoff.patient_id).maybeSingle(),
  ]);
  return json(200, {
    ok: true,
    linked: true,
    handoff: { id: handoff.id, channel: handoff.lana_channel, created_at: handoff.created_at },
    patient: patient ? {
      id: patient.id, name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim(),
      email: patient.email || "", phone: patient.telefono || "", birth_date: patient.fecha_nacimiento || null,
      gender: patient.genero || null, notes: patient.notas || "", updated_at: patient.updated_at || null,
      whatsapp_consent: typeof patient.consentimiento_whatsapp === "boolean" ? patient.consentimiento_whatsapp : null,
      medical_alerts: medicalAlerts(patient.alertas_medicas, history),
    } : null,
    case: caseRow ? {
      id: caseRow.id, name: caseRow.nombre_paciente || "", score: caseRow.score ?? null,
      score_label: caseRow.score_lbl || null, summary: caseRow.resumen || "", diagnosis: caseRow.diagnostico || "",
      quote_total: caseRow.total_cotizacion ?? null, simulation_url: caseRow.simulacion_url || null,
      photo_count: Number(caseRow.fotos_count) || 0, lana_appointment_id: caseRow.lana_cita_id || null,
      created_at: caseRow.created_at || null,
    } : null,
    clinical_images: links || [],
  });
}

type PatientLinkIdentity = {
  id: string;
  channel: string;
  name: string;
  email: string;
  phone: string;
  lana_url: string;
};

async function patientLinkIdentity(actor: Actor, tenantId: string, conversationId: string): Promise<{ identity?: PatientLinkIdentity; response?: Response }> {
  const remote = await lanaRequest(tenantId, `/conversations/${conversationId}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (remote.response.status === 404) return { response: json(404, { error: "La conversación ya no está disponible." }) };
  if (!remote.response.ok) return { response: json(502, { error: "No se pudo identificar al contacto de la conversación." }) };
  const conversation = remote.body.conversacion && typeof remote.body.conversacion === "object"
    ? remote.body.conversacion as Record<string, unknown> : null;
  if (!conversation) return { response: json(502, { error: "El canal devolvió una identidad incompleta." }) };
  const channel = text(conversation.canal, 20);
  if (!["whatsapp", "messenger", "instagram"].includes(channel)) {
    return { response: json(409, { error: "El canal de la conversación no permite vinculación con pacientes." }) };
  }
  return {
    identity: {
      id: conversationId,
      channel,
      name: text(conversation.nombre, 150) || "Paciente de redes sociales",
      email: text(conversation.email, 254),
      phone: text(conversation.telefono, 60),
      lana_url: text(conversation.lana_url, 500) || "https://app.get-lana.com/admin.html?tab=chats",
    },
  };
}

async function patientLinkPreview(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const identity = resolved.identity;
  const [existingResult, candidatesResult] = await Promise.all([
    admin.from("camila_lana_handoffs")
      .select("patient_id,case_id,lana_channel,link_kind,created_at")
      .eq("tenant_id", tenantId)
      .eq("lana_conversation_id", conversationId)
      .maybeSingle(),
    admin.rpc("smyl_lana_patient_candidates", {
      p_tenant_id: tenantId,
      p_email: identity.email,
      p_telefono: identity.phone,
    }),
  ]);
  if (existingResult.error || candidatesResult.error) {
    console.error("[lana-inbox] patient link preview", existingResult.error?.message || candidatesResult.error?.message);
    return json(500, { error: "No se pudo revisar la identidad del paciente." });
  }
  return json(200, {
    ok: true,
    conversation: identity,
    existing_link: existingResult.data || null,
    candidates: candidatesResult.data || [],
  });
}

async function confirmPatientLink(actor: Actor, tenantId: string, conversationId: string, body: Record<string, unknown>): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const identity = resolved.identity;
  const selectedPatientId = body.patient_id ? uuid(body.patient_id) : null;
  if (body.patient_id && !selectedPatientId) return json(400, { error: "El expediente elegido no es válido." });
  const { data, error } = await admin.rpc("camila_confirmar_lana_handoff", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_channel: identity.channel,
    p_nombre: identity.name,
    p_email: identity.email,
    p_telefono: identity.phone,
    p_patient_id: selectedPatientId,
  });
  if (error) {
    console.error("[lana-inbox] patient link confirmation", error.message);
    return json(error.code === "42501" ? 403 : 409, {
      error: error.code === "42501" ? "Tu rol no permite crear o vincular pacientes." : "No se pudo preparar el expediente desde esta conversación.",
    });
  }
  return json(200, { ok: true, conversation: identity, link: Array.isArray(data) ? data[0] : data });
}

async function autoLinkConversationPatient(actor: Actor, tenantId: string, conversationId: string): Promise<Response> {
  const resolved = await patientLinkIdentity(actor, tenantId, conversationId);
  if (resolved.response || !resolved.identity) return resolved.response || json(502, { error: "No se pudo identificar al contacto." });
  const conversation = resolved.identity;
  const { data, error } = await admin.rpc("smyl_auto_link_lana_conversation", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_channel: conversation.channel,
    p_nombre: conversation.name,
    p_email: conversation.email,
    p_telefono: conversation.phone,
  });
  if (error) {
    console.error("[lana-inbox] automatic patient link", error.message);
    return json(error.code === "42501" ? 403 : 500, {
      error: error.code === "42501" ? "Tu rol no permite crear o vincular pacientes." : "No se pudo vincular el paciente automáticamente.",
      code: error.code === "42501" ? "permission_denied" : "automatic_patient_link_failed",
    });
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || ["ambiguous", "needs_identity"].includes(String(result.status || ""))) {
    const reason = result?.status === "needs_identity" ? "needs_identity" : "ambiguous";
    return json(200, { ok: true, linked: false, reason, needs_review: true });
  }
  const [{ data: patient }, { data: handoff }] = await Promise.all([
    admin.from("camila_pacientes")
      .select("id,nombre,apellido")
      .eq("tenant_id", tenantId)
      .eq("id", result.patient_id)
      .maybeSingle(),
    admin.from("camila_lana_handoffs")
      .select("link_kind")
      .eq("tenant_id", tenantId)
      .eq("lana_conversation_id", conversationId)
      .maybeSingle(),
  ]);
  return json(200, {
    ok: true,
    linked: true,
    status: result.status,
    existing_link: Boolean(result.existing_link),
    created_patient: Boolean(result.created_patient || handoff?.link_kind === "created_contact"),
    patient: patient ? { id: patient.id, name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim() } : null,
    case_id: result.case_id,
  });
}

async function copilotClinicalSnapshot(actor: Actor, tenantId: string, conversationId: string): Promise<Record<string, unknown>> {
  const { data: handoff } = await admin.from("camila_lana_handoffs")
    .select("patient_id,case_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff) return {
    patient_confirmed: false, case_confirmed: false, photo_count: 0,
    simulation_exists: false, simulation_authorized: false,
    proposal_status: null, appointment_linked: false,
  };
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) return {
    patient_confirmed: false, case_confirmed: false, clinical_access: false,
    photo_count: 0, simulation_exists: false, simulation_authorized: false,
    proposal_status: null, appointment_linked: false,
  };
  const caseResult = handoff.case_id
    ? await admin.from("camila_casos")
      .select("id,score_lbl,simulacion_url,fotos_count,lana_cita_id,lana_webhook_estado")
      .eq("tenant_id", tenantId).eq("id", handoff.case_id).maybeSingle()
    : { data: null, error: null };
  const [{ data: caseRow }, proposalResult] = await Promise.all([
    Promise.resolve(caseResult),
    admin.from("smyl_proposals")
      .select("status")
      .eq("tenant_id", tenantId).eq("patient_id", handoff.patient_id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const proposal = proposalResult.error ? null : proposalResult.data;
  return {
    patient_confirmed: true,
    case_confirmed: Boolean(caseRow),
    photo_count: Math.max(0, Number(caseRow?.fotos_count) || 0),
    case_status: text(caseRow?.score_lbl, 120) || null,
    simulation_exists: Boolean(caseRow?.simulacion_url),
    // `lana_webhook_estado=enviado` sólo aparece después de la acción explícita
    // del profesional en lana-webhook; existir una imagen no autoriza compartirla.
    simulation_authorized: Boolean(caseRow?.simulacion_url) && caseRow?.lana_webhook_estado === "enviado",
    proposal_status: proposal?.status || null,
    appointment_linked: Boolean(caseRow?.lana_cita_id),
  };
}

async function linkClinicalImage(
  tenantId: string,
  actor: Actor,
  conversationId: string,
  channel: string,
  rawMessageId: unknown,
  label: unknown,
): Promise<Response> {
  const id = messageId(rawMessageId);
  if (!id) return json(400, { error: "Mensaje no válido." });
  const { data: handoff } = await admin.from("camila_lana_handoffs").select("patient_id")
    .eq("tenant_id", tenantId).eq("lana_conversation_id", conversationId).maybeSingle();
  if (!handoff?.patient_id) return json(409, { error: "Primero identifica al paciente de esta conversación.", code: "handoff_required" });
  if (!await accessiblePatient(actor, tenantId, String(handoff.patient_id), "clinical")) {
    return json(403, { error: "El expediente queda fuera del alcance clínico de tu rol.", code: "patient_scope_denied" });
  }
  const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
    method: "GET", headers: actorHeaders(actor),
  }, 15000);
  if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudo validar la fotografía en LANA.") });
  const message = remote.body.message as Record<string, unknown> | undefined;
  if (!message || message.media_type !== "image" || message.deleted === true) {
    return json(409, { error: "Solo una fotografía disponible puede enviarse a revisión clínica." });
  }
  const { data, error } = await admin.rpc("camila_vincular_lana_imagen", {
    p_tenant_id: tenantId,
    p_actor_id: actor.id,
    p_lana_conversation_id: conversationId,
    p_lana_message_id: id,
    p_lana_channel: channel,
    p_label: text(label, 180) || "Fotografía recibida por chat",
  });
  if (error) {
    if (String(error.message || "").includes("LANA_HANDOFF_REQUIRED")) {
      return json(409, { error: "Primero confirma el paciente y el caso en Preparar expediente.", code: "handoff_required" });
    }
    console.error("[lana-inbox clinical-link]", error.message);
    return json(500, { error: "No se pudo vincular la fotografía al expediente." });
  }
  return json(200, { ok: true, link: data });
}

const INBOX_PRIORITIES = ["low", "normal", "high", "urgent"];
const INBOX_AI_FILTERS = ["ai", "human"];
const INBOX_WINDOW_FILTERS = ["open", "expiring", "expired", "none"];
const AI_FEEDBACK_RATINGS = ["helpful", "needs_improvement", "unsafe"];

// Contrato 1.6: los filtros avanzados se validan aquí para no reenviar a LANA
// valores que ella rechazaría, y para responder con un mensaje claro.
function invalidInboxFilter(url: URL): string | null {
  const assignee = url.searchParams.get("assignee");
  if (assignee && !["me", "unassigned"].includes(assignee) && !uuid(assignee)) return "El responsable indicado no es válido.";
  const stage = url.searchParams.get("stage_id");
  if (stage && stage !== "none" && !uuid(stage)) return "La etapa indicada no es válida.";
  const branch = url.searchParams.get("branch_id");
  if (branch && branch !== "none" && !uuid(branch)) return "La sucursal indicada no es válida.";
  const priority = url.searchParams.get("priority");
  if (priority && !INBOX_PRIORITIES.includes(priority)) return "La prioridad indicada no es válida.";
  const ai = url.searchParams.get("ai");
  if (ai && !INBOX_AI_FILTERS.includes(ai)) return "El filtro IA/humano no es válido.";
  const windowFilter = url.searchParams.get("window");
  if (windowFilter && !INBOX_WINDOW_FILTERS.includes(windowFilter)) return "El filtro de ventana de 24 h no es válido.";
  return null;
}

function queryPath(url: URL, action: string, conversationId: string | null): string | null {
  if (action === "operations") return "/inbox/operations";
  if (action === "ai_feedback") {
    const params = new URLSearchParams();
    for (const name of ["days", "limit", "rating"]) {
      const value = text(url.searchParams.get(name), 20);
      if (value) params.set(name, value);
    }
    return `/inbox/feedback${params.size ? `?${params}` : ""}`;
  }
  if (action === "stages") return "/inbox/stages";
  if (action === "quick_replies") return "/inbox/quick-replies";
  if (action === "templates") return "/inbox/whatsapp/templates";
  if (action === "scheduled" && conversationId) return `/inbox/conversations/${conversationId}/scheduled`;
  if (action === "sync") {
    const since = text(url.searchParams.get("since"), 60);
    return since ? `/inbox/sync?since=${encodeURIComponent(since)}` : null;
  }
  if (action === "messages" && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["limit", "before", "since"]) {
      const value = text(url.searchParams.get(name), 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/messages${params.size ? `?${params}` : ""}`;
  }
  if ((action === "search" || action === "shared") && conversationId) {
    const params = new URLSearchParams();
    for (const name of ["q", "limit", "before"]) {
      const value = text(url.searchParams.get(name), name === "q" ? 160 : 80);
      if (value) params.set(name, value);
    }
    return `/inbox/conversations/${conversationId}/${action}${params.size ? `?${params}` : ""}`;
  }
  if (action !== "list") return null;
  const params = new URLSearchParams();
  for (const name of ["filter", "channel", "limit", "offset", "q", "assignee", "stage_id", "branch_id", "priority", "ai", "window"]) {
    const value = text(url.searchParams.get(name), 40);
    if (value) params.set(name, value);
  }
  return `/inbox${params.size ? `?${params}` : ""}`;
}

async function handleInbox(req: Request): Promise<Response> {
  const CORS = inboxCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const requirePermission = (actor: Actor, permission: string, message: string): Response | null =>
    can(actor, permission) ? null : json(403, { error: message, code: "permission_denied" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const actor = await actorFor(auth.user, auth.tenantId);
  if (!actor) return json(403, { error: "Tu acceso al equipo de esta clínica no está activo." });

  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const action = text(url.searchParams.get("action"), 30) || "list";
      const denied = requirePermission(actor, "messages.read", "Tu rol no permite consultar las conversaciones de la clínica.");
      if (denied) return denied;
      if (action === "team") return await listTeam(auth.tenantId);
      if (action === "availability_catalog" || action === "availability") {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar disponibilidad de Agenda.");
        if (scheduleDenied) return scheduleDenied;
        return action === "availability_catalog"
          ? await availabilityCatalog(auth.tenantId)
          : await availableSlots(actor, auth.tenantId, url);
      }
      const conversationId = url.searchParams.get("conversation_id") ? uuid(url.searchParams.get("conversation_id")) : null;
      if (url.searchParams.get("conversation_id") && !conversationId) return json(400, { error: "Conversación no válida." });
      if (conversationId && !await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      if (action === "branches") {
        const all = await activeBranches(auth.tenantId);
        const mine = (actor.scopes.messages || "own") === "branches" ? new Set(await memberBranchIds(actor, auth.tenantId)) : null;
        return json(200, { branches: mine ? all.filter((branch) => mine.has(branch.id)) : all, actor });
      }
      if (action === "operations" && actor.scopes.messages !== "clinic") {
        return json(403, { error: "Los indicadores globales requieren alcance de toda la clínica.", code: "conversation_scope_denied" });
      }
      if (action === "appointment_requests" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar solicitudes de Agenda.");
        return scheduleDenied || await appointmentRequests(auth.tenantId, conversationId);
      }
      if (action === "appointment_context" && conversationId) {
        const scheduleDenied = requirePermission(actor, "schedule.read", "Tu rol no permite consultar la continuidad de Agenda.");
        return scheduleDenied || await appointmentContext(auth.tenantId, conversationId);
      }
      if (action === "conversation_summary" && conversationId) {
        return json(200, await storedSummary(actor, auth.tenantId, conversationId));
      }
      if (action === "clinical_context" && conversationId) {
        const clinicalDenied = requirePermission(actor, "clinical.read", "Tu rol no permite consultar el expediente clínico.");
        return clinicalDenied || await clinicalContext(actor, auth.tenantId, conversationId);
      }
      if (action === "message" && conversationId) {
        const id = messageId(url.searchParams.get("message_id"));
        if (!id) return json(400, { error: "Mensaje no válido." });
        const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/messages/${id}`, {
          method: "GET", headers: actorHeaders(actor),
        }, 15000);
        return json(remote.response.status, { ...remote.body, actor });
      }
      if (action === "ai_feedback") {
        if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede revisar la calidad de las respuestas de IA.", code: "permission_denied" });
        const rating = url.searchParams.get("rating");
        if (rating && !AI_FEEDBACK_RATINGS.includes(rating)) return json(400, { error: "La evaluación indicada no es válida." });
      }
      if (action === "list") {
        const invalid = invalidInboxFilter(url);
        if (invalid) return json(400, { error: invalid });
      }
      const path = queryPath(url, action, conversationId);
      if (!path) return json(400, { error: "Consulta de Inbox no reconocida." });
      const headers = actorHeaders(actor);
      const remote = await lanaRequest(auth.tenantId, path, { method: "GET", headers }, 15000);
      const scopedBody = ["list", "sync"].includes(action)
        ? await filterConversationPayload(actor, auth.tenantId, remote.body)
        : remote.body;
      if (action === "sync") { try { await attachBranchChanges(actor, auth.tenantId, url.searchParams.get("since"), scopedBody); } catch (_) { /* informativo */ } }
      if (action === "messages") { try { await attachThreadBranch(auth.tenantId, scopedBody); } catch (_) { /* la sucursal es informativa: no debe romper la conversación */ } }
      return json(remote.response.status, { ...scopedBody, actor });
    }

    if ((req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data")) {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite enviar archivos o mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const incoming = await req.formData().catch(() => null);
      if (!incoming) return json(400, { error: "Adjunto no válido." });
      const conversationId = uuid(incoming.get("conversation_id"));
      const file = incoming.get("file");
      if (!conversationId || !(file instanceof File)) return json(400, { error: "Falta la conversación o el archivo." });
      if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      const forwarded = new FormData();
      forwarded.append("file", file, file.name);
      forwarded.append("kind", text(incoming.get("kind"), 20));
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/attachments`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: forwarded,
      }, 60000);
      return json(remote.response.status, { ...remote.body, actor });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = text(body.action, 30);
    if (action === "pilot") {
      if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede aprobar el piloto." });
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const pilotAction = text(body.pilot_action, 20);
      const forwarded: Record<string, unknown> = { action: pilotAction };
      if (pilotAction === "verify") {
        forwarded.scenario_id = text(body.scenario_id, 40);
        forwarded.evidence = text(body.evidence, 500);
      }
      const remote = await lanaRequest(auth.tenantId, "/inbox/pilot", {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 20000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "stage_create" || action === "stage_update" || action === "stage_reorder" || action === "stage_seed_dental") {
      if (actor.role !== "owner") return json(403, { error: "Solo el dueño de la clínica puede configurar las etapas del Pipeline.", code: "permission_denied" });
      let path = "/inbox/stages";
      let method = "POST";
      let forwarded: Record<string, unknown> = {};
      if (action === "stage_create") {
        const name = text(body.name, 60);
        if (!name) return json(400, { error: "Escribe un nombre para la etapa." });
        forwarded = { name };
      } else if (action === "stage_update") {
        const stageId = uuid(body.stage_id);
        if (!stageId) return json(400, { error: "La etapa seleccionada no es válida." });
        if (body.name !== undefined) {
          const name = text(body.name, 60);
          if (!name) return json(400, { error: "Escribe un nombre para la etapa." });
          forwarded.name = name;
        }
        if (body.archived !== undefined) {
          if (typeof body.archived !== "boolean") return json(400, { error: "El estado archivado no es válido." });
          forwarded.archived = body.archived;
        }
        if (!Object.keys(forwarded).length) return json(400, { error: "No hay cambios que guardar." });
        path = `/inbox/stages/${stageId}`;
        method = "PUT";
      } else if (action === "stage_reorder") {
        const ids = Array.isArray(body.stage_ids) ? body.stage_ids.map((value) => uuid(value)) : [];
        if (!ids.length || ids.length > 24 || ids.some((value) => !value) || new Set(ids).size !== ids.length) {
          return json(400, { error: "El orden de etapas no es válido." });
        }
        forwarded = { stage_ids: ids };
        path = "/inbox/stages/order";
        method = "PUT";
      } else {
        path = "/inbox/stages/seed-dental";
      }
      const remote = await lanaRequest(auth.tenantId, path, {
        method, headers: actorHeaders(actor), body: JSON.stringify(forwarded),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    const conversationId = uuid(body.conversation_id);
    if (!conversationId) return json(400, { error: "Conversación no válida." });
    if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
    if (action === "patient_link_preview" || action === "patient_link_confirm") {
      const denied = requirePermission(actor, "patients.manage", "Tu rol no permite crear o vincular pacientes.");
      if (denied) return denied;
      if (action === "patient_link_preview") return await patientLinkPreview(actor, auth.tenantId, conversationId);
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      return await confirmPatientLink(actor, auth.tenantId, conversationId, body);
    }
    if (action === "auto_patient_link") {
      const denied = requirePermission(actor, "patients.manage", "Tu rol no permite crear o vincular pacientes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      return await autoLinkConversationPatient(actor, auth.tenantId, conversationId);
    }
    if (action === "appointment_request" || action === "appointment_confirm") {
      const scheduleDenied = requirePermission(actor, "schedule.manage", "Tu rol no permite administrar citas.");
      if (scheduleDenied) return scheduleDenied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      if (action === "appointment_request") return await createAppointmentRequest(actor, auth.tenantId, conversationId, body, idempotencyKey);
      const requestId = uuid(body.request_id);
      if (!requestId) return json(400, { error: "Solicitud no válida." });
      return await confirmAppointmentRequest(actor, auth.tenantId, requestId, idempotencyKey);
    }
    if (action === "clinical_link") {
      const denied = requirePermission(actor, "clinical.write", "Tu rol no permite incorporar archivos al expediente clínico.");
      if (denied) return denied;
      const channel = text(body.channel, 20);
      if (!["whatsapp", "messenger", "instagram"].includes(channel)) return json(400, { error: "Canal no válido." });
      return await linkClinicalImage(auth.tenantId, actor, conversationId, channel, body.message_id, body.label);
    }
    if (action === "rewrite_message") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite preparar respuestas para pacientes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const sourceText = typeof body.source_text === "string" ? body.source_text.trim() : "";
      if (sourceText.length < 2 || sourceText.length > 4000) {
        return json(400, { error: "Escribe un mensaje de entre 2 y 4,000 caracteres para mejorarlo." });
      }
      if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
      if (CONSUMABLES_ENFORCED) {
        const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
          .eq("tenant_id", auth.tenantId).eq("resource", "ai_credits").maybeSingle();
        if (!wallet || Number(wallet.balance_units) < 1) {
          return json(402, { error: "No hay créditos de MILA suficientes para mejorar este mensaje." });
        }
      }
      try {
        const improved = await improveMessageWriting(sourceText);
        const { data: usage, error: usageError } = await admin.rpc("smyl_consume", {
          p_tenant_id: auth.tenantId,
          p_resource: "ai_credits",
          p_quantity_units: 1,
          p_idempotency_key: `message-rewrite:${idempotencyKey}`,
          p_source_type: "message_rewrite",
          p_source_id: conversationId,
          p_provider: "openai",
          p_provider_model: MESSAGE_REWRITE_MODEL,
          p_metadata: {
            context: "chat_composer",
            token_usage: improved.usage,
            consumables_enforced: CONSUMABLES_ENFORCED,
          },
          p_enforce: CONSUMABLES_ENFORCED,
        });
        if (usageError) throw new Error("No se pudo registrar el consumo de MILA.");
        const usageRow = Array.isArray(usage) ? usage[0] : usage;
        if (usageRow && usageRow.accepted === false) {
          return json(402, { error: "No hay créditos de MILA suficientes para mejorar este mensaje." });
        }
        return json(200, {
          mode: "rewrite",
          rewritten_text: improved.rewrittenText,
          token_usage: improved.usage,
          usage_recorded: true,
          actor,
        });
      } catch (error) {
        console.error("[lana-inbox:rewrite-message]", idempotencyKey, error instanceof Error ? error.message : error);
        return json(502, { error: "MILA no pudo mejorar la redacción. Tu texto original no cambió." });
      }
    }
    if (action === "copilot") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite preparar respuestas para pacientes.");
      if (denied) return denied;
      const mode = body.mode === "summary" ? "summary" : "draft";
      const clinical = can(actor, "clinical.read")
        ? await copilotClinicalSnapshot(actor, auth.tenantId, conversationId)
        : { patient_confirmed: false, case_confirmed: false, clinical_access: false };
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot`, {
        method: "POST", headers: actorHeaders(actor),
        body: JSON.stringify({ mode, clinical_context: clinical }),
      }, 30000);
      if (mode === "summary" && remote.response.ok && remote.body && typeof remote.body === "object") {
        const summary = cleanSummary(remote.body as Record<string, unknown>);
        if (summary) {
          const includesClinical = clinical.patient_confirmed === true && clinical.clinical_access !== false;
          const saved = await saveSummary(actor, auth.tenantId, conversationId, summary, includesClinical, isoDate(body.basis_at));
          return json(remote.response.status, { ...remote.body, ...saved, actor });
        }
      }
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "feedback") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite evaluar respuestas del asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const id = messageId(body.message_id);
      const rating = text(body.rating, 30);
      if (!idempotencyKey || !id || !["helpful", "needs_improvement", "unsafe"].includes(rating)) {
        return json(400, { error: "Evaluación o Idempotency-Key no válidos." });
      }
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/copilot/feedback`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({
          message_id: id, rating,
          comment: text(body.comment, 1000), ideal_response: text(body.ideal_response, 4000),
        }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "set_branch") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite asignar conversaciones a una sucursal.");
      if (denied) return denied;
      const conversationId = uuid(body.conversation_id);
      if (!conversationId) return json(400, { error: "Falta la conversación." });
      if (!await canAccessConversation(actor, auth.tenantId, conversationId)) return forbiddenConversation();
      const target = body.branch_id === null || body.branch_id === undefined || body.branch_id === "" ? null : uuid(body.branch_id);
      if (body.branch_id && !target) return json(400, { error: "La sucursal indicada no es válida." });
      if (!target) {
        // Quitar la sucursal (volver a «Sin asignar») solo con alcance de toda la clínica: una sede no puede esconder una conversación suya.
        if ((actor.scopes.messages || "own") !== "clinic") return json(403, { error: "Solo quien ve toda la clínica puede devolver una conversación a «Sin asignar».", code: "permission_denied" });
        await admin.from("smyl_conversation_branches").delete().eq("tenant_id", auth.tenantId).eq("conversation_id", conversationId);
        return json(200, { ok: true, conversation_id: conversationId, branch: null, actor });
      }
      const branches = await activeBranches(auth.tenantId);
      const branch = branches.find((item) => item.id === target);
      if (!branch) return json(404, { error: "La sucursal no existe o está inactiva." });
      if ((actor.scopes.messages || "own") === "branches" && !(await memberBranchIds(actor, auth.tenantId)).includes(target)) {
        // Transferir a otra sede sí se permite (la conversación sale de su bandeja); asignar a una sede ajena sin pertenecer a ninguna no.
        const own = await memberBranchIds(actor, auth.tenantId);
        if (!own.length) return json(403, { error: "No perteneces a ninguna sucursal.", code: "permission_denied" });
      }
      const { error } = await admin.from("smyl_conversation_branches").upsert({
        tenant_id: auth.tenantId, conversation_id: conversationId, branch_id: target, source: "manual",
        assigned_by: auth.user.id, assigned_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,conversation_id" });
      if (error) return json(500, { error: "No se pudo asignar la sucursal." });
      return json(200, { ok: true, conversation_id: conversationId, branch: { id: branch.id, name: branch.name, source: "manual" }, actor });
    }
    if (action === "resume_with_context") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite reactivar el asistente.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      const summary = text(body.summary, 2000);
      if (!idempotencyKey || !summary) return json(400, { error: "Revisa el resumen y vuelve a intentarlo." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/resume-context`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify({ summary }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "configure_automation") {
      const denied = requirePermission(actor, "messages.manage", "Tu rol no permite cambiar las reglas automáticas del chat.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const hours = body.auto_reactivate_hours === null ? null : Number(body.auto_reactivate_hours);
      if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 168)) return json(400, { error: "Plazo de reactivación no válido." });
      const windowReactivation = body.window_reactivation === null
        ? null : body.window_reactivation === true ? true : body.window_reactivation === false ? false : undefined;
      if (windowReactivation === undefined) return json(400, { error: "Regla de ventana no válida." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/automation`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey),
        body: JSON.stringify({ auto_reactivate_hours: hours, window_reactivation: windowReactivation }),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "schedule") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite programar mensajes.");
      if (denied) return denied;
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });
      const type = body.type === "template" ? "template" : "text";
      const forwarded: Record<string, unknown> = { type, send_at: text(body.send_at, 60) };
      if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else forwarded.content = text(body.content, 4000);
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: JSON.stringify(forwarded),
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "cancel_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite cancelar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      if (!scheduledId) return json(400, { error: "Mensaje programado no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/cancel`, {
        method: "POST", headers: actorHeaders(actor, uuid(req.headers.get("Idempotency-Key"))), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (action === "retry_scheduled") {
      const denied = requirePermission(actor, "messages.respond", "Tu rol no permite reintentar mensajes programados.");
      if (denied) return denied;
      const scheduledId = messageId(body.scheduled_id);
      const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
      if (!scheduledId || !idempotencyKey) return json(400, { error: "Mensaje programado o Idempotency-Key no válido." });
      const remote = await lanaRequest(auth.tenantId, `/inbox/conversations/${conversationId}/scheduled/${scheduledId}/retry`, {
        method: "POST", headers: actorHeaders(actor, idempotencyKey), body: "{}",
      }, 15000);
      return json(remote.response.status, { ...remote.body, actor });
    }
    if (!["send", "read", "assign", "release", "pause", "resume", "resolve", "pin", "unpin", "stage", "priority", "branch", "star", "unstar", "delete"].includes(action)) {
      return json(400, { error: "Acción de Inbox no reconocida." });
    }
    const idempotencyKey = uuid(req.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json(400, { error: "Idempotency-Key debe ser un UUID válido." });

    const permission = ["send", "read", "star", "unstar"].includes(action) ? "messages.respond" : "messages.manage";
    const denied = requirePermission(actor, permission, permission === "messages.respond"
      ? "Tu rol no permite responder conversaciones."
      : "Tu rol no permite organizar ni controlar conversaciones.");
    if (denied) return denied;

    const forwarded: Record<string, unknown> = {};
    if (action === "send") {
      const type = text(body.type, 30) || "text";
      forwarded.type = type;
      if (type === "text") {
        forwarded.content = text(body.content, 4000);
        const replyId = body.reply_to_message_id ? messageId(body.reply_to_message_id) : null;
        if (body.reply_to_message_id && !replyId) return json(400, { error: "Mensaje citado no válido." });
        if (replyId) forwarded.reply_to_message_id = replyId;
      } else if (type === "template") {
        const templateId = uuid(body.template_id);
        if (!templateId) return json(400, { error: "Plantilla no válida." });
        forwarded.template_id = templateId;
        forwarded.template_variables = Array.isArray(body.template_variables)
          ? body.template_variables.slice(0, 20).map((value) => text(value, 1000)) : [];
      } else if (type === "location") {
        forwarded.latitude = Number(body.latitude); forwarded.longitude = Number(body.longitude);
        forwarded.name = text(body.name, 160); forwarded.address = text(body.address, 300);
      } else if (type === "forward") {
        const sourceConversationId = uuid(body.source_conversation_id);
        const sourceMessageId = messageId(body.source_message_id);
        if (!sourceConversationId || !sourceMessageId) return json(400, { error: "Mensaje de origen no válido." });
        if (!await canAccessConversation(actor, auth.tenantId, sourceConversationId)) return forbiddenConversation();
        forwarded.source_conversation_id = sourceConversationId;
        forwarded.source_message_id = sourceMessageId;
      } else return json(400, { error: "Tipo de mensaje no reconocido." });
    }
    if (action === "assign") {
      const targetId = uuid(body.target_actor_id) || actor.id;
      const { data: member } = await admin.from("camila_usuarios")
        .select("id,nombre,email,rol,activo")
        .eq("tenant_id", auth.tenantId)
        .eq("id", targetId)
        .eq("activo", true)
        .maybeSingle();
      if (!member) return json(404, { error: "El miembro seleccionado ya no está activo en esta clínica." });
      forwarded.target_actor_id = targetId;
      forwarded.target_actor_name = text(member.nombre, 160) || text(member.email, 160) || "Miembro del equipo";
    }
    if (action === "stage") {
      if (body.target_stage_id === null || body.target_stage_id === "") forwarded.target_stage_id = null;
      else {
        const targetStageId = uuid(body.target_stage_id);
        if (!targetStageId) return json(400, { error: "La etapa seleccionada no es válida." });
        forwarded.target_stage_id = targetStageId;
      }
    }

    if (action === "priority") {
      const priority = text(body.priority, 20);
      if (!INBOX_PRIORITIES.includes(priority)) return json(400, { error: "La prioridad indicada no es válida." });
      forwarded.priority = priority;
    }
    if (action === "branch") {
      // La sucursal es de SMYL: el nombre sale de la base, nunca del navegador.
      if (body.branch_id === null || body.branch_id === "") forwarded.branch_id = null;
      else {
        const branchId = uuid(body.branch_id);
        if (!branchId) return json(400, { error: "La sucursal indicada no es válida." });
        const { data: branch } = await admin.from("smyl_branches")
          .select("id,name,active")
          .eq("tenant_id", auth.tenantId)
          .eq("id", branchId)
          .maybeSingle();
        if (!branch || branch.active === false) return json(404, { error: "La sucursal ya no está activa en esta clínica." });
        if ((actor.scopes.messages || "own") !== "clinic") {
          const { data: member } = await admin.from("smyl_member_branches").select("branch_id")
            .eq("tenant_id", auth.tenantId).eq("user_id", actor.id).eq("branch_id", branchId).maybeSingle();
          if (!member) return json(403, { error: "Esa sucursal queda fuera del alcance de tu rol.", code: "conversation_scope_denied" });
        }
        forwarded.branch_id = branchId;
        forwarded.branch_name = text(branch.name, 160) || "Sucursal";
      }
    }

    const targetMessageId = ["star", "unstar", "delete"].includes(action) ? messageId(body.message_id) : null;
    if (["star", "unstar", "delete"].includes(action) && !targetMessageId) return json(400, { error: "Mensaje no válido." });
    const path = action === "send"
      ? `/inbox/conversations/${conversationId}/messages`
      : targetMessageId
      ? `/inbox/conversations/${conversationId}/messages/${targetMessageId}/${action}`
      : `/inbox/conversations/${conversationId}/${action}`;
    const headers = actorHeaders(actor, idempotencyKey);
    const remote = await lanaRequest(auth.tenantId, path, {
      method: "POST",
      headers,
      body: JSON.stringify(forwarded),
    }, action === "send" ? 30000 : 15000);
    return json(remote.response.status, { ...remote.body, actor });
  } catch (error) {
    console.error("[lana-inbox]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar el Inbox con LANA." });
  }
}

function inboxCors(req: Request): Record<string, string> {
  return { ...makeCors(req, "GET, POST, OPTIONS"), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key" };
}

Deno.serve(async (req: Request) => {
  const response = await handleInbox(req);
  const missing = Object.entries(inboxCors(req)).filter(([name]) => !response.headers.has(name));
  if (!missing.length) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of missing) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
