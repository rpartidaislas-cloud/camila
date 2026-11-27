// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/mila-interview/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/privacy-core.mjs ──
const { MENSAJE_IA_NO_PERMITIDA, MENSAJE_IA_SIN_AUTORIZACION, MENSAJE_IA_NO_VERIFICABLE, decidirIA } = (() => {
// Permiso del paciente para que sus datos pasen por herramientas de IA de proveedores externos (finalidad 'ai_processing').
// Regla (LFPDPPP: los datos de salud son sensibles y requieren consentimiento EXPRESO): solo se usa la IA cuando el paciente
// la autorizó ('granted'). Sin decisión registrada ('unknown') o si la retiró ('revoked') no se manda nada a la IA.
// Si no se puede comprobar (error de base de datos) también se bloquea: ante la duda no se manda nada a un tercero.
const MENSAJE_IA_NO_PERMITIDA = 'Este paciente no autorizó el uso de inteligencia artificial con sus datos. Captura o revisa esto manualmente.';
const MENSAJE_IA_SIN_AUTORIZACION = 'Este paciente aún no autoriza el uso de inteligencia artificial. Registra su autorización en Privacidad (o pídele que firme el aviso) antes de usar la IA.';
const MENSAJE_IA_NO_VERIFICABLE = 'No se pudo comprobar el permiso de IA del paciente. Inténtalo de nuevo en un momento.';

/** Convierte la respuesta de smyl_patient_privacy_state en una decisión: 'allowed' | 'missing' | 'revoked' | 'unavailable'. */
function decidirIA(result: any) {
  if (!result || result.error) return 'unavailable';
  const state = result.data;
  if (state === 'granted') return 'allowed';
  if (state === 'revoked') return 'revoked';
  if (state === 'unknown') return 'missing';
  return 'unavailable';
}

return { MENSAJE_IA_NO_PERMITIDA, MENSAJE_IA_SIN_AUTORIZACION, MENSAJE_IA_NO_VERIFICABLE, decidirIA };
})();

// ── _shared/privacy.ts ──
const { permisoIA, respuestaIAnegada } = (() => {
// Candado de privacidad para las funciones que mandan datos de un paciente a una IA externa. La regla vive en privacy-core.mjs.

type PermisoIA = 'allowed' | 'missing' | 'revoked' | 'unavailable';

// deno-lint-ignore no-explicit-any
async function permisoIA(admin: any, tenantId: string, patientId: string): Promise<PermisoIA> {
  try {
    const result = await admin.rpc('smyl_patient_privacy_state', { p_tenant: tenantId, p_patient: patientId, p_purpose: 'ai_processing' });
    return decidirIA(result);
  } catch { return 'unavailable'; }
}

/** Respuesta lista para devolver cuando NO se puede usar IA con este paciente; null si se puede continuar. */
function respuestaIAnegada(permiso: PermisoIA): { status: number; body: { error: string; code: string } } | null {
  if (permiso === 'allowed') return null;
  if (permiso === 'revoked') return { status: 403, body: { error: MENSAJE_IA_NO_PERMITIDA, code: 'patient_ai_not_allowed' } };
  if (permiso === 'missing') return { status: 403, body: { error: MENSAJE_IA_SIN_AUTORIZACION, code: 'patient_ai_consent_missing' } };
  return { status: 503, body: { error: MENSAJE_IA_NO_VERIFICABLE, code: 'patient_ai_unverifiable' } };
}

return { permisoIA, respuestaIAnegada };
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

// ── _shared/mila-interview-contract.mjs ──
const { HISTORY_SECTIONS, SECTION_LABELS, TEETH, SURFACES, CONDITION_CODES, HISTORY_SCHEMA, EXAM_SCHEMA, HISTORY_PROMPT, EXAM_PROMPT, plain, quoteFound, splitDate, normalizeHistory, surfaceAllowed, normalizeExam, INTERVIEW_GUIDE, ALERT_TYPES, ALERT_LABELS, INTERVIEWER_TOOLS, firstName, buildInterviewerInstructions, summarizeKnownHistory, FORM_ALERT_OPTIONS, FORM_HABIT_OPTIONS, buildFromForm } = (() => {
// MILA · Entrevista (historia clínica) y exploración dictada desde el celular.
// Contrato puro (sin red ni Deno) para que se pueda probar en Node: esquemas que se piden al modelo,
// prompts y normalización/validación de lo que devuelve. Lo que el modelo diga NUNCA se guarda en el
// expediente directamente: se convierte en un borrador que el dentista revisa en la computadora.

const HISTORY_SECTIONS = ['alerts', 'allergies', 'conditions', 'medications', 'surgeries', 'dental', 'habits'];
const SECTION_LABELS = {
  alerts: 'Alertas médicas', allergies: 'Alergias', conditions: 'Condiciones médicas', medications: 'Medicamentos',
  surgeries: 'Cirugías y hospitalizaciones', dental: 'Antecedentes dentales', habits: 'Hábitos', emergency_contact: 'Contacto de emergencia',
};
const TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map(String);
const SURFACES = ['whole', 'M', 'D', 'V', 'L', 'O', 'I'];
const CONDITION_CODES = ['caries', 'restoration', 'crown', 'endodontics', 'missing', 'implant', 'fracture', 'sealant', 'other'];
const STATUS = ['yes', 'no', 'unknown', 'not_asked'];
const SEVERITY = ['', 'low', 'moderate', 'high'];
const COND_STATUS = ['', 'active', 'controlled', 'resolved', 'unknown'];
const MAX_RECORDS = 20;

const str = { type: 'string' };
const statusProp = { type: 'string', enum: STATUS };
function obj(properties: any) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
function list(items: any) { return { type: 'array', items }; }

const HISTORY_SCHEMA = obj({
  alerts: obj({ status: statusProp, items: list(obj({ text: str, quote: str })) }),
  allergies: obj({ status: statusProp, records: list(obj({ substance: str, reaction: str, severity: { type: 'string', enum: SEVERITY }, quote: str })) }),
  conditions: obj({ status: statusProp, records: list(obj({ name: str, diagnosed_at: str, status: { type: 'string', enum: COND_STATUS }, quote: str })) }),
  medications: obj({ status: statusProp, records: list(obj({ name: str, dose: str, frequency: str, changed_at: str, quote: str })) }),
  surgeries: obj({ status: statusProp, records: list(obj({ procedure: str, date: str, quote: str })) }),
  dental: obj({ status: statusProp, history_text: str, last_visit: str, quote: str }),
  habits: obj({ status: statusProp, text: str, quote: str }),
  emergency_contact: obj({ text: str, quote: str }),
  notes: str,
  follow_ups: list(str),
});

const EXAM_SCHEMA = obj({
  findings: list(obj({
    tooth: str,
    surface: { type: 'string', enum: SURFACES },
    condition_code: { type: 'string', enum: CONDITION_CODES },
    condition_text: str,
    quote: str,
    uncertain: { type: 'boolean' },
  })),
  general_notes: list(obj({ text: str, quote: str })),
  follow_ups: list(str),
});

const HISTORY_PROMPT = `Eres MILA, asistente de documentación odontológica en español de México. Recibes la TRANSCRIPCIÓN COMPLETA de una entrevista entre un dentista y su paciente (puede estar desordenada, con interrupciones y sin indicar quién habla).
Si las líneas vienen etiquetadas, «MILA:» es la asistente que pregunta (sus frases NO son datos del paciente) y «Paciente:» es lo que respondió el paciente o su acompañante.
Tu tarea es llenar el borrador de la historia clínica SOLO con lo que el paciente afirmó o el dentista confirmó en voz alta.

Reglas obligatorias:
- No inventes, no infieras y no completes con conocimiento general. Si un dato no se dijo, déjalo vacío.
- status por sección: "yes" si refirió tenerlo; "no" si lo negó explícitamente ("no tomo nada", "ninguna alergia"); "unknown" si dijo que no sabe o no recuerda; "not_asked" si el tema no apareció.
- Si en una pregunta posterior el paciente corrige lo que dijo, usa la versión corregida.
- Un registro por elemento (una alergia, un medicamento, una cirugía…). Usa el nombre tal como se dijo, con ortografía correcta.
- Alergias: severity "high" solo si describe anafilaxia, dificultad para respirar, hinchazón de garganta o hospitalización; "moderate"/"low" solo si se describe; si no, "".
- Medicamentos: dosis y frecuencia solo si se dijeron (ej. "500 mg", "cada 12 horas").
- Fechas: formato AAAA-MM-DD, o AAAA-MM si solo se dijo mes y año. Si solo hay un año o una fecha relativa ("hace 3 años"), escribe el texto tal cual dicho (ej. "2019", "hace 3 años").
- alerts: condiciones que cambian la atención dental (anticoagulantes, marcapasos, embarazo, bifosfonatos, diabetes descontrolada, hipertensión, problemas de coagulación, cardiopatía, etc.) SOLO si se mencionaron.
- dental.history_text: empieza con «Motivo de consulta: …». Si hay dolor, agrega desde cuándo, intensidad 0-10, localización y qué lo empeora o alivia, solo si se dijeron. Después tratamientos dentales previos, complicaciones con anestesia, sensibilidad o sangrado. Frases clínicas breves.
- habits.text: tabaco, alcohol, bruxismo, respiración oral, onicofagia, dieta azucarada, higiene (frecuencia de cepillado, hilo dental) SOLO si se mencionaron.
- quote: fragmento textual breve (máx. 160 caracteres) de la transcripción que respalda el dato. Copia las palabras exactas.
- follow_ups: máximo 6 preguntas concretas que el dentista aún debería hacer o confirmar (ej. "Confirmar dosis del anticoagulante", "Preguntar por alergia a anestésicos locales"). Prioriza la seguridad clínica.
- notes: solo información clínica relevante que no cabe en otra sección; si no hay, "".`;

const EXAM_PROMPT = `Eres MILA, asistente de documentación odontológica en español de México. Recibes la TRANSCRIPCIÓN de lo que el dentista dictó en voz alta mientras exploraba la boca del paciente.
Convierte el dictado en hallazgos del odontograma con notación FDI (11-18, 21-28, 31-38, 41-48).

Reglas obligatorias:
- Registra SOLO lo dictado. No inventes piezas, superficies ni hallazgos y no hagas diagnósticos propios.
- Convierte números hablados a FDI ("dieciséis" o "uno seis" = 16; "treinta y seis" o "tres seis" = 36). Si la pieza no es clara o no es un número FDI válido, no inventes: usa tooth "" y marca uncertain=true.
- surface: O oclusal, M mesial, D distal, V vestibular/bucal/labial, L lingual/palatina, I incisal, whole si se refiere a toda la pieza o no se dijo la cara. Si se dictan varias caras (ej. "mesio-oclusal"), crea un hallazgo por cara.
- condition_code: caries, restoration (resina, amalgama, obturación), crown, endodontics, missing (ausente), implant, fracture, sealant u other. condition_text: frase breve y clínica tal como se dictó (ej. "Caries oclusal profunda", "Resina desadaptada").
- Si el dentista corrige ("no, perdón, era la 26"), usa la corrección y descarta lo anterior.
- Negaciones ("la 11 sin caries") NO son hallazgos.
- general_notes: observaciones que no son de una pieza (ej. "gingivitis generalizada", "cálculo en sector anteroinferior", "higiene deficiente").
- quote: fragmento textual breve (máx. 160 caracteres) que respalda el hallazgo.
- uncertain=true si hay cualquier ambigüedad.
- follow_ups: máximo 4 puntos que el dentista debería confirmar.`;

// ---------------------------------------------------------------- normalización

function text(v: any, max = 400) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max); }
function plain(v: any) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/* La cita debe salir de la transcripción: si no aparece (o casi), el dato queda marcado para revisar. */
function quoteFound(quote: any, transcript: any) {
  const q = plain(quote), t = plain(transcript);
  if (!q) return false;
  if (t.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length > 2);
  if (!words.length) return false;
  const hits = words.filter((w) => t.includes(w)).length;
  return hits / words.length >= 0.8;
}
function status(v: any) { return STATUS.includes(v) ? v : 'not_asked'; }
function oneOf(v: any, allowed: any) { return allowed.includes(v) ? v : ''; }
const DAY = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-\d{2}$/;
function validCalendar(value: any) {
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1900 || y > 2100 || m < 1 || m > 12) return false;
  if (d === undefined) return true;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}
/* Devuelve [valorParaElCampo, textoSobrante]. Un campo <input type=date|month> solo acepta su formato exacto. */
function splitDate(value: any, kind: any) {
  const v = text(value, 40);
  if (!v) return ['', ''];
  if (kind === 'month') {
    if (MONTH.test(v) && validCalendar(v)) return [v, ''];
    if (DAY.test(v) && validCalendar(v)) return [v.slice(0, 7), ''];
    return ['', v];
  }
  if (DAY.test(v) && validCalendar(v)) return [v, ''];
  return ['', v];
}
function withExtra(primary: any, extra: any) { return extra ? `${primary} (${extra})` : primary; }

/* Convierte la salida del modelo en: documento sugerido (mismas claves que smyl-history-model) + evidencias + pendientes. */
function normalizeHistory(raw: any, transcript: any) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const evidence = [];
  const needsReview = [];
  const doc = {};
  const coverage = {};
  function note(section: any, label: any, quote: any) {
    const q = text(quote, 160);
    const found = quoteFound(q, transcript);
    evidence.push({ section, label: text(label, 200), quote: q, verified: found });
    if (!found) needsReview.push(`${SECTION_LABELS[section]}: "${text(label, 80)}" no se encontró textual en la conversación.`);
  }
  function rows(section: any, input: any, build: any) {
    const out = [];
    for (const item of Array.isArray(input) ? input : []) {
      if (out.length >= MAX_RECORDS || !item || typeof item !== 'object') continue;
      const row = build(item);
      if (!row) continue;
      out.push(row);
    }
    return out;
  }
  const docStatus = (s, n) => (n ? 'yes' : s === 'not_asked' ? 'pending' : s === 'yes' ? 'pending' : s);

  const alerts = r.alerts || {};
  const alertItems = rows('alerts', alerts.items, (it) => { const t = text(it.text, 120); if (!t) return null; note('alerts', t, it.quote); return t; });
  doc.alerts = alertItems; doc.alerts_status = docStatus(status(alerts.status), alertItems.length);
  coverage.alerts = status(alerts.status);

  const al = r.allergies || {};
  doc.allergy_records = rows('allergies', al.records, (it) => {
    const substance = text(it.substance, 120); if (!substance) return null;
    note('allergies', substance, it.quote);
    return { substance, reaction: text(it.reaction, 160), severity: oneOf(it.severity, SEVERITY) };
  });
  doc.allergies_status = docStatus(status(al.status), doc.allergy_records.length);
  coverage.allergies = status(al.status);

  const co = r.conditions || {};
  doc.condition_records = rows('conditions', co.records, (it) => {
    const name = text(it.name, 120); if (!name) return null;
    const [diagnosed_at, extra] = splitDate(it.diagnosed_at, 'month');
    note('conditions', name, it.quote);
    return { name: withExtra(name, extra), diagnosed_at, status: oneOf(it.status, COND_STATUS) };
  });
  doc.conditions_status = docStatus(status(co.status), doc.condition_records.length);
  coverage.conditions = status(co.status);

  const me = r.medications || {};
  doc.medication_records = rows('medications', me.records, (it) => {
    const name = text(it.name, 120); if (!name) return null;
    const [changed_at, extra] = splitDate(it.changed_at, 'date');
    note('medications', name, it.quote);
    return { name: withExtra(name, extra && `desde ${extra}`), dose: text(it.dose, 60), frequency: text(it.frequency, 80), changed_at };
  });
  doc.medications_status = docStatus(status(me.status), doc.medication_records.length);
  coverage.medications = status(me.status);

  const su = r.surgeries || {};
  doc.surgery_records = rows('surgeries', su.records, (it) => {
    const procedure = text(it.procedure, 160); if (!procedure) return null;
    const [date, extra] = splitDate(it.date, 'date');
    note('surgeries', procedure, it.quote);
    return { procedure: withExtra(procedure, extra), date };
  });
  doc.surgeries_status = docStatus(status(su.status), doc.surgery_records.length);
  coverage.surgeries = status(su.status);

  const de = r.dental || {};
  const [lastVisit, visitExtra] = splitDate(de.last_visit, 'date');
  let dentalText = text(de.history_text, 1200);
  if (visitExtra) dentalText = [dentalText, `Última visita referida: ${visitExtra}.`].filter(Boolean).join(' ');
  doc.dental_history = dentalText; doc.last_dental_visit = lastVisit;
  doc.dental_status = docStatus(status(de.status), dentalText || lastVisit);
  if (dentalText || lastVisit) note('dental', dentalText || lastVisit, de.quote);
  coverage.dental = status(de.status);

  const ha = r.habits || {};
  doc.habits = text(ha.text, 600);
  doc.habits_status = docStatus(status(ha.status), doc.habits);
  if (doc.habits) note('habits', doc.habits, ha.quote);
  coverage.habits = status(ha.status);

  const ec = r.emergency_contact || {};
  doc.emergency_contact = text(ec.text, 160);
  if (doc.emergency_contact) note('emergency_contact', doc.emergency_contact, ec.quote);
  doc.notes = text(r.notes, 1500);

  const followUps = (Array.isArray(r.follow_ups) ? r.follow_ups : []).map((v) => text(v, 200)).filter(Boolean).slice(0, 6);
  return { document: doc, evidence: evidence.slice(0, 120), needs_review: needsReview.slice(0, 20), follow_ups: followUps, coverage };
}

function surfaceAllowed(tooth: any, surface: any) {
  if (!TEETH.includes(String(tooth)) || !SURFACES.includes(surface)) return false;
  const unit = Number(String(tooth)[1]);
  if (surface === 'O') return unit >= 4;
  if (surface === 'I') return unit <= 3;
  return true;
}

function normalizeExam(raw: any, transcript: any) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const findings = [];
  const unplaced = [];
  const seen = new Set();
  for (const it of Array.isArray(r.findings) ? r.findings : []) {
    if (!it || typeof it !== 'object' || findings.length >= 60) continue;
    const condition = text(it.condition_text, 160);
    const quote = text(it.quote, 160);
    const tooth = String(it.tooth || '').replace(/\D/g, '');
    const code = CONDITION_CODES.includes(it.condition_code) ? it.condition_code : 'other';
    if (!condition) continue;
    if (!TEETH.includes(tooth)) { unplaced.push({ text: condition, quote, reason: 'Pieza no identificada' }); continue; }
    let surface = SURFACES.includes(it.surface) ? it.surface : 'whole';
    let uncertain = it.uncertain === true;
    if (!surfaceAllowed(tooth, surface)) { surface = 'whole'; uncertain = true; }
    const key = `${tooth}|${surface}|${plain(condition)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verified = quoteFound(quote, transcript);
    findings.push({ tooth, surface, condition_code: code, condition, quote, verified, uncertain: uncertain || !verified });
  }
  const general = (Array.isArray(r.general_notes) ? r.general_notes : [])
    .map((g) => ({ text: text(g && g.text, 240), quote: text(g && g.quote, 160) })).filter((g) => g.text).slice(0, 20);
  const followUps = (Array.isArray(r.follow_ups) ? r.follow_ups : []).map((v) => text(v, 200)).filter(Boolean).slice(0, 4);
  return { findings, unplaced: unplaced.slice(0, 20), general_notes: general, follow_ups: followUps };
}

/* Guía que ve el dentista en el celular. */
const INTERVIEW_GUIDE = [
  { key: 'allergies', title: 'Alergias', questions: ['¿Es alérgico a algún medicamento, anestesia, látex o alimento?', 'Si sí: ¿qué le pasó? ¿Tuvo que ir a urgencias?'] },
  { key: 'alerts', title: 'Alertas médicas', questions: ['¿Toma anticoagulantes o aspirina?', '¿Tiene marcapasos, problemas del corazón o de coagulación?', '¿Está embarazada o en lactancia?'] },
  { key: 'conditions', title: 'Condiciones médicas', questions: ['¿Tiene diabetes, presión alta, asma, tiroides u otra enfermedad?', '¿Desde cuándo? ¿Está controlada?'] },
  { key: 'medications', title: 'Medicamentos', questions: ['¿Qué medicamentos toma actualmente?', '¿Qué dosis y cada cuánto?'] },
  { key: 'surgeries', title: 'Cirugías y hospitalizaciones', questions: ['¿Lo han operado u hospitalizado?', '¿De qué y cuándo?'] },
  { key: 'dental', title: 'Motivo de consulta y antecedentes dentales', questions: ['¿Qué le trae hoy a consulta?', 'Si hay dolor: ¿desde cuándo? Del 0 al 10, ¿qué tanto duele? ¿Qué lo empeora?', '¿Cuándo fue su última visita al dentista?', '¿Ha tenido problemas con la anestesia, sangrado o sensibilidad?'] },
  { key: 'habits', title: 'Hábitos', questions: ['¿Fuma o toma alcohol?', '¿Aprieta o rechina los dientes?', '¿Cuántas veces se cepilla al día? ¿Usa hilo dental?'] },
  { key: 'emergency_contact', title: 'Contacto de emergencia', questions: ['¿A quién llamamos en caso de emergencia? Nombre y teléfono.'] },
];

// ---------------------------------------------------------------- MILA entrevista por voz (Realtime)

const ALERT_TYPES = ['alergia_grave', 'anticoagulante', 'cardiaco', 'embarazo', 'urgencia', 'otra'];
const ALERT_LABELS = {
  alergia_grave: 'Alergia grave', anticoagulante: 'Anticoagulante', cardiaco: 'Condición cardiaca o marcapasos', embarazo: 'Embarazo o lactancia', urgencia: 'Síntoma urgente', otra: 'Alerta clínica',
};

const INTERVIEWER_TOOLS = [
  {
    type: 'function',
    name: 'registrar_alerta',
    description: 'Avisa de inmediato al dentista de un dato que cambia la seguridad de la atención: alergia grave (anafilaxia, hinchazón de garganta, hospitalización), anticoagulantes o antiagregantes, marcapasos o enfermedad del corazón, embarazo o lactancia, u otra condición de riesgo. Úsala en cuanto el paciente lo diga; no lo menciones al paciente.',
    parameters: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ALERT_TYPES },
        detalle: { type: 'string', description: 'Frase breve con lo que dijo el paciente, ej. «Toma warfarina 5 mg diario».' },
      },
      required: ['tipo', 'detalle'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'entrevista_completa',
    description: 'Llámala solo después de que el paciente confirmó el resumen final y te despediste.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/* Primer nombre para el saludo; nunca apellidos ni otros datos. */
function firstName(nombre: any) {
  const first = String(nombre || '').trim().split(/\s+/)[0] || '';
  return first.replace(/[^\p{L}'-]/gu, '').slice(0, 40);
}

/* opts.continuation = { covered: [títulos], pending: [títulos] } cuando se retoma una entrevista ya iniciada.
 * opts.known = [frases] con lo que ya está registrado en la historia (paciente de seguimiento).
 * opts.previsit = { clinic, appointment } cuando el paciente responde solo, antes de su cita. */
function buildInterviewerInstructions(patientFirstName: any, opts = {}) {
  const name = firstName(patientFirstName);
  const cont = opts && opts.continuation;
  const known = (opts && Array.isArray(opts.known) ? opts.known : []).filter(Boolean).slice(0, 20);
  const pre = opts && opts.previsit;
  const sections = INTERVIEW_GUIDE.map((s, i) => `${i + 1}. ${s.title}: ${s.questions.join(' ')}`).join('\n');
  return `Eres MILA, asistente del consultorio dental. Estás entrevistando por voz a ${name ? `la persona paciente llamada ${name}` : 'la persona paciente'} para preparar su historia clínica. ${pre ? `La persona responde SOLA desde su celular, antes de su cita${pre.appointment ? ` (${pre.appointment})` : ''}${pre.clinic ? ` en ${pre.clinic}` : ''}; el dentista NO está presente y revisará todo después.` : 'El dentista está presente y revisará todo después.'}

Cómo hablas:
- Tu voz es la de una mujer latinoamericana: acento mexicano natural y cálido, sin sonar a doblaje ni a español de España. Entonación amable y cercana, ritmo pausado y claro, como una asistente de consultorio en México.
- Español de México, de usted, cálido y profesional. Frases cortas: UNA pregunta a la vez y espera la respuesta.
- Cada intervención tuya dura como máximo dos frases breves (por ejemplo, un acuse corto y la siguiente pregunta). No repitas lo que el paciente acaba de decir salvo para aclarar. La única excepción es el resumen final.
- Agilidad: en cuanto tengas la respuesta, contesta de inmediato y sin pensar en voz alta. Tu acuse es de una a tres palabras y lo varías («Gracias», «Entiendo», «Perfecto», «Muy bien»); nunca repitas el mismo dos veces seguidas. Cada frase tuya, de unas 15 palabras como máximo.
- No anuncies lo que vas a preguntar («ahora le voy a preguntar sobre…») ni expliques por qué lo preguntas salvo que te lo pidan: haz la pregunta directa.
- Si responde un simple «no» o «ninguna», pasa directo a la siguiente pregunta sin comentarlo. Si responde con una frase corta, no la repitas: solo acusa y sigue.
- Si hace una pausa para pensar o dice «mmm», «déjeme ver», espera; no llenes el silencio ni repitas la pregunta de inmediato.
- Preséntate como «MILA, asistente del consultorio${pre && pre.clinic ? ` de ${pre.clinic}` : ''}». No eres doctora ni das la consulta.
- Si no entendiste o la respuesta es ambigua, pide amablemente que la repita o aclare.
- Si la persona habla en otro idioma, responde en ese idioma.

Lo que NUNCA haces:
- No das diagnósticos, consejos médicos, opiniones sobre tratamientos, precios ni indicaciones de medicamentos. Si te preguntan algo así, responde: «Eso lo revisará el doctor en un momento» y sigue.
- No inventas datos ni asumes respuestas. No comentas ni juzgas lo que te cuentan.
- No pides datos que no estén en la guía (ni dirección, ni datos de pago, ni identificaciones).

Orden de la entrevista:
0. Saluda${name ? ` a ${name} por su nombre` : ''}, explica en una frase que harás unas preguntas de salud para su expediente y que el doctor lo revisará.
${sections}

Reglas de la entrevista:
- Si responde «sí» a algo, repregunta lo necesario (qué medicamento, dosis, cada cuánto, qué reacción tuvo, desde cuándo).
- En cuanto escuches una alergia grave, anticoagulante, marcapasos o enfermedad del corazón, embarazo u otra condición de riesgo, llama a la función registrar_alerta y continúa con naturalidad.
- Si el paciente quiere detenerse, respétalo y despídete.
- Al terminar, haz un RESUMEN breve en voz alta de lo que entendiste (alergias, medicamentos, enfermedades, cirugías, motivo de consulta, hábitos) y pregunta «¿Es correcto o quiere corregir algo?». Corrige lo que te indique.
- Después despídete diciendo ${pre ? 'que sus respuestas quedaron enviadas y el doctor las revisará en su cita' : 'que el doctor lo atenderá enseguida'} y llama a entrevista_completa.${pre ? `

ENTREVISTA PREVIA (el paciente está solo):
- Si menciona un síntoma que podría ser urgente (dolor en el pecho, falta de aire, hinchazón grande de cara o cuello, fiebre alta con hinchazón, sangrado que no se detiene, dolor intenso que no cede), dile con calma que no espere a su cita: que llame al consultorio${pre.clinic ? ` (${pre.clinic})` : ''} o, si es grave, al 911. Llama a registrar_alerta con tipo «urgencia». Después pregunta si quiere continuar.
- No confirmes ni cambies citas, no des precios y no prometas tratamientos: «Eso lo verá con el doctor en su cita».` : ''}${known.length ? `

PACIENTE DE SEGUIMIENTO. Esto ya está registrado en su historia:
${known.map((k) => `- ${k}`).join('\n')}
- No repitas toda la guía. Por cada tema, confirma en una frase si sigue igual («La última vez nos dijo que es alérgica a la penicilina, ¿sigue igual?») y pregunta si hay algo nuevo. Pregunta completo solo los temas que no aparecen arriba.` : ''}${cont ? `

ESTA ES UNA CONTINUACIÓN de una entrevista que ya empezó con la misma persona.
- No te presentes de nuevo: saluda brevemente («Seguimos con unas preguntas más»).
- Ya se cubrió: ${(cont.covered || []).join(', ') || 'nada todavía'}. No vuelvas a preguntar eso salvo que el paciente quiera corregir algo.
- Pregunta solo por: ${(cont.pending || []).join(', ') || 'lo que haya quedado incompleto'}. Después haz el resumen breve de lo nuevo y despídete.` : ''}`;
}

/* Frases cortas con lo que ya está en la historia, para que MILA confirme en vez de preguntar todo. */
function summarizeKnownHistory(doc: any) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const t = (v, max = 120) => text(v, max);
  const out = [];
  const allergies = list(d.allergy_records).map((r) => t(r && r.substance)).filter(Boolean);
  if (allergies.length) out.push(`Alergias: ${allergies.join(', ')}`);
  else if (d.allergies_status === 'no') out.push('Alergias: negó tener');
  const alerts = list(d.alerts).map((a) => t(a)).filter(Boolean);
  if (alerts.length) out.push(`Alertas médicas: ${alerts.join(', ')}`);
  const conditions = list(d.condition_records).map((r) => t(r && r.name)).filter(Boolean);
  if (conditions.length) out.push(`Condiciones: ${conditions.join(', ')}`);
  else if (d.conditions_status === 'no') out.push('Condiciones médicas: negó tener');
  const meds = list(d.medication_records).map((r) => [t(r && r.name), t(r && r.dose, 40), t(r && r.frequency, 60)].filter(Boolean).join(' ')).filter(Boolean);
  if (meds.length) out.push(`Medicamentos: ${meds.join('; ')}`);
  else if (d.medications_status === 'no') out.push('Medicamentos: negó tomar');
  const surgeries = list(d.surgery_records).map((r) => t(r && r.procedure)).filter(Boolean);
  if (surgeries.length) out.push(`Cirugías: ${surgeries.join(', ')}`);
  else if (d.surgeries_status === 'no') out.push('Cirugías: negó tener');
  if (t(d.habits)) out.push(`Hábitos: ${t(d.habits, 200)}`);
  return out.slice(0, 12);
}

// ---------------------------------------------------------------- Formulario previo a la cita
/* Opciones de alertas del formulario (casillas) → texto que entra en «Alertas médicas». */
const FORM_ALERT_OPTIONS = [
  ['anticoagulante', 'Toma anticoagulantes o aspirina diaria'],
  ['marcapasos', 'Usa marcapasos'],
  ['corazon', 'Enfermedad del corazón'],
  ['coagulacion', 'Problemas de coagulación o sangrado'],
  ['embarazo', 'Embarazo o lactancia'],
  ['bifosfonatos', 'Toma bifosfonatos (para huesos/osteoporosis)'],
];
const FORM_HABIT_OPTIONS = [
  ['fuma', 'Fuma'], ['alcohol', 'Toma alcohol con frecuencia'], ['bruxismo', 'Aprieta o rechina los dientes'],
  ['respiracion_oral', 'Respira por la boca'], ['unas', 'Se muerde las uñas'], ['azucar', 'Consume dulces o refrescos a diario'],
];
const YNU = ['yes', 'no', 'unknown'];

/* Convierte las respuestas del formulario en el mismo borrador que produce la entrevista por voz (sin IA, sin costo). */
function buildFromForm(raw: any) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const st = (v) => (YNU.includes(v) ? v : 'not_asked');
  const rows = (v, build) => (Array.isArray(v) ? v : []).slice(0, MAX_RECORDS).map((r) => (r && typeof r === 'object' ? build(r) : null)).filter(Boolean);
  const doc = {};
  const coverage = {};
  const evidence = [];
  const from = 'Respondido por el paciente en el formulario previo a la cita';
  const docStatus = (s, n) => (n ? 'yes' : s === 'not_asked' || s === 'yes' ? 'pending' : s);

  const alertKeys = (Array.isArray(a.alerts) ? a.alerts : []).filter((k) => FORM_ALERT_OPTIONS.some((o) => o[0] === k));
  const alertOther = text(a.alerts_other, 160);
  doc.alerts = alertKeys.map((k) => FORM_ALERT_OPTIONS.find((o) => o[0] === k)[1]).concat(alertOther ? [alertOther] : []);
  coverage.alerts = doc.alerts.length ? 'yes' : st(a.alerts_status);
  doc.alerts_status = docStatus(coverage.alerts, doc.alerts.length);

  doc.allergy_records = rows(a.allergies, (r) => { const substance = text(r.substance, 120); return substance ? { substance, reaction: text(r.reaction, 160), severity: ['low', 'moderate', 'high'].includes(r.severity) ? r.severity : '' } : null; });
  coverage.allergies = doc.allergy_records.length ? 'yes' : st(a.allergies_status);
  doc.allergies_status = docStatus(coverage.allergies, doc.allergy_records.length);

  doc.condition_records = rows(a.conditions, (r) => { const name = text(r.name, 120); const since = text(r.since, 40); return name ? { name: since ? `${name} (desde ${since})` : name, diagnosed_at: '', status: '' } : null; });
  coverage.conditions = doc.condition_records.length ? 'yes' : st(a.conditions_status);
  doc.conditions_status = docStatus(coverage.conditions, doc.condition_records.length);

  doc.medication_records = rows(a.medications, (r) => { const name = text(r.name, 120); return name ? { name, dose: text(r.dose, 60), frequency: text(r.frequency, 80), changed_at: '' } : null; });
  coverage.medications = doc.medication_records.length ? 'yes' : st(a.medications_status);
  doc.medications_status = docStatus(coverage.medications, doc.medication_records.length);

  doc.surgery_records = rows(a.surgeries, (r) => { const procedure = text(r.procedure, 160); const when = text(r.when, 40); return procedure ? { procedure: when ? `${procedure} (${when})` : procedure, date: '' } : null; });
  coverage.surgeries = doc.surgery_records.length ? 'yes' : st(a.surgeries_status);
  doc.surgeries_status = docStatus(coverage.surgeries, doc.surgery_records.length);

  const reason = text(a.reason, 300);
  const painLevel = Number.isFinite(Number(a.pain_level)) && a.pain_level !== '' && a.pain_level != null ? Math.max(0, Math.min(10, Math.round(Number(a.pain_level)))) : null;
  const dentalParts = [];
  if (reason) dentalParts.push(`Motivo de consulta: ${reason}.`);
  if (a.pain === 'yes') dentalParts.push(`Refiere dolor${painLevel != null ? ` ${painLevel}/10` : ''}${text(a.pain_since, 60) ? ` (inicio: ${text(a.pain_since, 60)})` : ''}${text(a.pain_trigger, 120) ? `; empeora con ${text(a.pain_trigger, 120)}` : ''}.`);
  if (a.pain === 'no') dentalParts.push('Niega dolor actual.');
  if (a.anesthesia_problems === 'yes') dentalParts.push(`Refiere problemas previos con anestesia${text(a.anesthesia_detail, 160) ? `: ${text(a.anesthesia_detail, 160)}` : ''}.`);
  const lastVisit = text(a.last_visit, 60);
  if (lastVisit) dentalParts.push(`Última visita al dentista: ${lastVisit}.`);
  doc.dental_history = dentalParts.join(' ').slice(0, 1200);
  doc.last_dental_visit = '';
  coverage.dental = doc.dental_history ? 'yes' : 'not_asked';
  doc.dental_status = doc.dental_history ? 'yes' : 'pending';

  const habitKeys = (Array.isArray(a.habits) ? a.habits : []).filter((k) => FORM_HABIT_OPTIONS.some((o) => o[0] === k));
  const brushing = text(a.brushing, 40);
  const habitParts = habitKeys.map((k) => FORM_HABIT_OPTIONS.find((o) => o[0] === k)[1]);
  if (brushing) habitParts.push(`Cepillado: ${brushing}`);
  if (a.floss === 'yes') habitParts.push('Usa hilo dental');
  if (a.floss === 'no') habitParts.push('No usa hilo dental');
  doc.habits = habitParts.join('; ').slice(0, 600);
  coverage.habits = doc.habits ? 'yes' : a.habits_none ? 'no' : 'not_asked';
  doc.habits_status = doc.habits ? 'yes' : a.habits_none ? 'no' : 'pending';

  const ecName = text(a.emergency_name, 80), ecPhone = text(a.emergency_phone, 30).replace(/[^\d+ ()-]/g, '');
  doc.emergency_contact = [ecName, ecPhone].filter(Boolean).join(' · ');
  doc.notes = text(a.notes, 800);

  for (const [section, label] of [['allergies', 'Alergias'], ['alerts', 'Alertas médicas'], ['conditions', 'Condiciones'], ['medications', 'Medicamentos'], ['surgeries', 'Cirugías'], ['dental', 'Motivo y antecedentes dentales'], ['habits', 'Hábitos']]) {
    if (coverage[section] && coverage[section] !== 'not_asked') evidence.push({ section, label, quote: from, verified: true });
  }
  const followUps = [];
  if (doc.medication_records.some((m) => !m.dose)) followUps.push('Confirmar dosis de los medicamentos que refirió');
  if (doc.allergy_records.some((r) => !r.reaction)) followUps.push('Preguntar qué reacción tuvo en sus alergias');
  for (const k of HISTORY_SECTIONS) if (!coverage[k] || coverage[k] === 'not_asked') followUps.push(`Preguntar en consulta: ${SECTION_LABELS[k]}`);
  const urgent = a.pain === 'yes' && painLevel != null && painLevel >= 8;
  return { document: doc, evidence, needs_review: urgent ? ['Refiere dolor intenso (8/10 o más): valorar prioridad de la cita.'] : [], follow_ups: followUps.slice(0, 6), coverage, source: 'form' };
}

return { HISTORY_SECTIONS, SECTION_LABELS, TEETH, SURFACES, CONDITION_CODES, HISTORY_SCHEMA, EXAM_SCHEMA, HISTORY_PROMPT, EXAM_PROMPT, plain, quoteFound, splitDate, normalizeHistory, surfaceAllowed, normalizeExam, INTERVIEW_GUIDE, ALERT_TYPES, ALERT_LABELS, INTERVIEWER_TOOLS, firstName, buildInterviewerInstructions, summarizeKnownHistory, FORM_ALERT_OPTIONS, FORM_HABIT_OPTIONS, buildFromForm };
})();

// ── mila-interview/index.ts ──
// MILA · Entrevista de historia clínica y dictado de exploración desde el celular (QR).
//
// Computadora (sesión de usuario + clinical.write):
//   create {patient_id}        → crea la sesión y devuelve el token del QR (una sola vez).
//   status {id}                → estado, consentimiento, alertas, borrador interpretado y consumo (sondeo).
//   close  {id}                → borra la sesión (transcripción y borrador) al aplicar o descartar.
// Celular (sin login; capacidad = token del QR y luego secreto de dispositivo):
//   pair    {id, token}        → vincula UN dispositivo; el token deja de servir para otro.
//   consent {id, device}       → registra que el paciente aceptó la grabación.
//   segment (multipart)        → modo «Yo pregunto»: transcribe y responde de inmediato; la interpretación
//                                corre en segundo plano (EdgeRuntime.waitUntil) y el celular la sondea con state.
//   realtime {id, device, sdp} → modo «MILA entrevista»: abre la conversación de voz con OpenAI Realtime.
//   realtime_turn / realtime_alert / realtime_finish → guardan los turnos, las alertas inmediatas y cierran.
//   state / finish
//
// No se guarda audio. La transcripción y el borrador viven solo en smyl_mila_interviews hasta que el
// dentista aplica o descarta, o hasta que vence (90 min). El consumo se mide en el servidor: segundos de
// MILA (smyl_consume) y tokens por llamada (smyl_ai_usage_log, request_id = "<sesión>:<paso>").


declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
const EXTRACT_MODEL =
  Deno.env.get("OPENAI_MILA_INTERVIEW_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
// Menos razonamiento = respuesta más rápida. Vacío = no se envía (para modelos que no lo aceptan).
const EXTRACT_REASONING = Deno.env.get("OPENAI_MILA_INTERVIEW_REASONING") ?? "low";
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime-2.1";
// Voz femenina por defecto; se puede probar otra sin tocar código (ej. coral, shimmer, sage).
const REALTIME_VOICE = Deno.env.get("OPENAI_MILA_INTERVIEW_VOICE") || Deno.env.get("OPENAI_REALTIME_VOICE") || "marin";
// Turnos de la conversación. «semantic» (por defecto): detector semántico —entiende cuándo terminó una idea, no solo si hay
// sonido— y el celular decide cuándo interrumpir a MILA (un «ajá», «o» o una tos no la cortan). «server»: el esquema anterior
// (VAD por volumen que corta a MILA con cualquier sonido); sirve de regreso rápido sin tocar el celular.
const TURN_MODE = (Deno.env.get("OPENAI_MILA_TURN_MODE") || "semantic").toLowerCase() === "server" ? "server" : "semantic";
const VAD_EAGERNESS = ["low", "medium", "high", "auto"].includes((Deno.env.get("OPENAI_MILA_VAD_EAGERNESS") || "").toLowerCase())
  ? (Deno.env.get("OPENAI_MILA_VAD_EAGERNESS") || "").toLowerCase() : "medium";
// Velocidad de la voz (1 = normal, 0.25–1.5). Un poco arriba de 1 quita sensación de lentitud sin atropellar; 1.0 la deja como antes.
const VOICE_SPEED = (() => { const n = Number(Deno.env.get("OPENAI_MILA_VOICE_SPEED") || "1.06"); return Number.isFinite(n) ? Math.min(1.25, Math.max(0.8, n)) : 1.06; })();
const REALTIME_TRANSCRIBE_MODEL = Deno.env.get("OPENAI_REALTIME_TRANSCRIBE_MODEL") || "gpt-transcribe";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
// Tarifas opcionales (USD por millón de tokens) para estimar costo. Sin configurar, el costo queda vacío.
const PRICE_IN = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_IN") || "");
const PRICE_OUT = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_OUT") || "");

const SESSION_MINUTES = 90;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_SECONDS = 180;
const MAX_REALTIME_SECONDS = 45 * 60;
// Entrevista previa (el paciente solo): una conversación de voz, máx. 15 min; el enlace vence 1 día después de la cita o en 7 días.
const MAX_PREVISIT_REALTIME_SECONDS = 15 * 60;
const PREVISIT_TEMPLATE = "entrevista_previa_v1";
const APP_BASE = Deno.env.get("SMYL_APP_BASE_URL") || "https://app.smyldesign.ai";
const CRON_SECRET = (Deno.env.get("SMYL_REMINDERS_CRON_SECRET") || "").trim();
const CLINIC_TZ = "America/Mexico_City";
const MAX_TRANSCRIPT = 60000;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Row = Record<string, any>;
type Usage = { input_tokens: number; output_tokens: number };
type Mode = "history" | "exam";

function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHash(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function extensionFor(mime: string): string {
  return ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "aac" } as Record<string, string>)[mime] || "audio";
}
function tokenCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 50_000_000) : 0;
}
function usageOf(raw: Row): Usage {
  const u = raw && typeof raw.usage === "object" && raw.usage ? raw.usage : {};
  return { input_tokens: tokenCount(u.input_tokens ?? u.prompt_tokens), output_tokens: tokenCount(u.output_tokens ?? u.completion_tokens) };
}
function extractOutputText(payload: Row): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  throw new Error("MILA no devolvió la interpretación.");
}
function cost(u: Usage): number | null {
  if (!Number.isFinite(PRICE_IN) || !Number.isFinite(PRICE_OUT)) return null;
  return Math.round(((u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT) / 1e6) * 1e5) / 1e5;
}
function cleanText(v: unknown, max: number): string {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}
const HAS_WAIT_UNTIL = typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function";
function background(task: Promise<unknown>) {
  const safe = task.catch((e) => console.error("[mila-interview:background]", e instanceof Error ? e.message : e));
  EdgeRuntime!.waitUntil(safe);
}

async function purgeExpired() {
  await admin.from("smyl_mila_interviews").delete().lt("expires_at", new Date().toISOString());
}

async function interpret(mode: Mode, transcript: string): Promise<{ result: Row; usage: Usage }> {
  const body: Row = {
    model: EXTRACT_MODEL,
    store: false,
    max_output_tokens: 6000,
    input: [
      { role: "system", content: [{ type: "input_text", text: mode === "history" ? HISTORY_PROMPT : EXAM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: `TRANSCRIPCIÓN:\n${transcript}` }] },
    ],
    text: {
      format: {
        type: "json_schema",
        name: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
        strict: true,
        schema: mode === "history" ? HISTORY_SCHEMA : EXAM_SCHEMA,
      },
    },
  };
  if (EXTRACT_REASONING) body.reasoning = { effort: EXTRACT_REASONING };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(`Interpretación ${response.status}`);
  const parsed = JSON.parse(extractOutputText(payload));
  const result = mode === "history" ? normalizeHistory(parsed, transcript) : normalizeExam(parsed, transcript);
  return { result, usage: usageOf(payload) };
}

async function transcribe(audio: File, mime: string, mode: Mode): Promise<{ text: string; seconds: number | null; usage: Usage }> {
  const form = new FormData();
  form.set("file", audio, `segmento.${extensionFor(mime)}`);
  form.set("model", TRANSCRIBE_MODEL);
  form.set("response_format", "json");
  form.set("language", "es");
  form.set("prompt", mode === "history"
    ? "Entrevista médica-odontológica en español de México entre dentista y paciente: alergias, medicamentos, enfermedades, cirugías, hábitos. Transcribe exactamente lo dicho."
    : "Dictado de exploración dental en español: piezas FDI (once, dieciséis, treinta y seis), superficies oclusal, mesial, distal, vestibular, lingual, palatina, incisal; caries, resina, amalgama, corona, endodoncia, ausente, implante, fractura. Transcribe exactamente lo dicho.");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const raw = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(`Transcripción ${response.status}`);
  const seconds = Number(raw.duration);
  return { text: typeof raw.text === "string" ? raw.text.trim() : "", seconds: Number.isFinite(seconds) ? seconds : null, usage: usageOf(raw) };
}

async function logUsage(tenantId: string, mode: Mode, model: string, requestId: string, usage: Usage, seconds: number, outcome: "ok" | "incomplete" | "error") {
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenantId,
    feature: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
    model: model.slice(0, 80),
    request_id: requestId.slice(0, 120),
    outcome,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    duration_ms: seconds * 1000,
    estimated_cost_usd: cost(usage),
  });
  if (error) console.error("[mila-interview:usage-log]", requestId, error.message);
}

async function consumeSeconds(tenantId: string, mode: Mode, key: string, seconds: number, model: string, metadata: Row) {
  const { data, error } = await admin.rpc("smyl_consume", {
    p_tenant_id: tenantId,
    p_resource: "mila_seconds",
    p_quantity_units: Math.max(1, seconds),
    p_idempotency_key: `mila-interview:${key}`,
    p_source_type: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
    p_source_id: key,
    p_provider: "openai",
    p_provider_model: model,
    p_metadata: metadata,
    p_enforce: CONSUMABLES_ENFORCED,
  });
  if (error) console.error("[mila-interview:consume]", key, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return !(row && row.accepted === false);
}

/* Interpreta lo transcrito y guarda el borrador sin pisar uno más reciente (dos segmentos pueden terminar en otro orden). */
async function interpretAndStore(rowId: string, tenantId: string, mode: Mode, transcript: string, requestId: string) {
  let outcome: "ok" | "error" = "ok";
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let result: Row | null = null;
  try {
    const out = await interpret(mode, transcript);
    result = out.result;
    usage = out.usage;
  } catch (error) {
    outcome = "error";
    console.warn("[mila-interview:interpret]", requestId, error instanceof Error ? error.message : error);
  }
  await logUsage(tenantId, mode, EXTRACT_MODEL, `${requestId}-int`, usage, 0, outcome);
  const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", rowId).maybeSingle();
  if (!fresh) return null;
  const current = fresh.result || {};
  const prior = current[mode];
  const pending = { ...(current.pending || {}) };
  if (Number(pending[mode] || 0) <= transcript.length) delete pending[mode];
  const next: Row = { ...current, pending };
  if (result && (!prior || Number(prior.source_chars || 0) <= transcript.length)) {
    next[mode] = { ...result, source_chars: transcript.length, updated_at: new Date().toISOString() };
  } else if (!result) {
    next.interpret_error = { mode, at: new Date().toISOString() };
  }
  await admin.from("smyl_mila_interviews").update({ result: next, updated_at: new Date().toISOString() }).eq("id", rowId);
  return next;
}

async function sessionTokens(tenantId: string, id: string): Promise<{ input: number; output: number }> {
  const { data } = await admin.from("smyl_ai_usage_log").select("input_tokens,output_tokens")
    .eq("tenant_id", tenantId).like("request_id", `${id}:%`).limit(1000);
  let input = 0, output = 0;
  for (const r of data || []) { input += Number(r.input_tokens) || 0; output += Number(r.output_tokens) || 0; }
  return { input, output };
}

function alertsOf(result: Row): Row[] {
  return Array.isArray(result?.alerts) ? result.alerts : [];
}

async function publicStatus(row: Row) {
  const result = row.result || {};
  const pending = result.pending || {};
  return {
    id: row.id,
    status: row.status,
    paired: !!row.device_hash,
    consent: !!row.consent_at,
    consent_at: row.consent_at,
    kind: row.kind || "clinic",
    segments: row.segments,
    audio_seconds: row.audio_seconds,
    tokens: await sessionTokens(row.tenant_id, row.id),
    finished: !!result.finished_at,
    history: result.history || null,
    exam: result.exam || null,
    alerts: alertsOf(result),
    realtime: result.realtime ? { active: !!result.realtime.started_at && !result.realtime.finished_at, finished: !!result.realtime.finished_at } : null,
    interpreting: !!(pending.history || pending.exam),
    processing: !!(row.busy_until && Date.parse(row.busy_until) > Date.now()),
    expires_at: row.expires_at,
  };
}

// ---------------------------------------------------------------- entrevista previa (helpers)
async function clinicName(tenantId: string): Promise<string> {
  const { data } = await admin.from("camila_tenants").select("nombre,config").eq("id", tenantId).maybeSingle();
  const config = data?.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  return cleanText(config.consultorio, 120) || cleanText(data?.nombre, 120) || "tu clínica";
}
function appointmentLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: CLINIC_TZ }).format(d).replace(",", "");
  const hour = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: CLINIC_TZ }).format(d)
    .replace(/\s*([ap])\.?\s?m\.?/i, (_m, x) => ` ${x.toLowerCase()}m`);
  return `${day} a las ${hour}`;
}
async function nextAppointment(tenantId: string, patientId: string, appointmentId: string) {
  let q = admin.from("smyl_appointments").select("id,starts_at,status").eq("tenant_id", tenantId).eq("patient_id", patientId);
  if (UUID.test(appointmentId)) q = q.eq("id", appointmentId);
  else q = q.gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true });
  const { data } = await q.limit(5);
  return (data || []).find((r: Row) => !/cancel/i.test(String(r.status || ""))) || null;
}
async function whatsappConversation(tenantId: string, patientId: string): Promise<string | null> {
  const { data } = await admin.from("camila_lana_handoffs").select("lana_conversation_id")
    .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("lana_channel", "whatsapp")
    .order("updated_at", { ascending: false }).limit(1);
  return data && data[0] ? String(data[0].lana_conversation_id) : null;
}
/* Envía la plantilla aprobada «entrevista_previa_v1» por la conversación de WhatsApp del paciente (vía LANA). */
type Actor = { id: string; email?: string };
function actorHeaders(tenantId: string, user: Actor): Headers {
  return new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(cleanText(user.email, 160).split("@")[0] || "Equipo"),
  });
}
/* Id de la plantilla «entrevista_previa_v1» si ya está aprobada en LANA; null si no existe o no está aprobada. */
async function previsitTemplateId(tenantId: string, user: Actor): Promise<string | null> {
  const list = await lanaRequest(tenantId, "/inbox/whatsapp/templates", { method: "GET", headers: actorHeaders(tenantId, user) }, 12000);
  const templates = Array.isArray(list.body.templates) ? list.body.templates as Row[] : [];
  const template = templates.find((t) => String(t.name || "") === PREVISIT_TEMPLATE && !/reject|rechaz|pending|pendiente|paused|disabled/i.test(String(t.status || "")));
  return template?.id ? String(template.id) : null;
}
async function sendPrevisitWhatsApp(tenantId: string, patientId: string, user: Actor, variables: string[], idempotency: string, knownTemplate?: string | null) {
  const conversation = await whatsappConversation(tenantId, patientId);
  if (!conversation) return { sent: false, reason: "no_conversation" };
  const actor = actorHeaders(tenantId, user);
  try {
    const templateId = knownTemplate || await previsitTemplateId(tenantId, user);
    if (!templateId) return { sent: false, reason: "template_not_approved" };
    const template = { id: templateId };
    const headers = new Headers(actor);
    headers.set("Idempotency-Key", idempotency);
    const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversation}/scheduled`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "template", send_at: new Date(Date.now() + 60_000).toISOString(), template_id: template.id, template_variables: variables.map((v) => v.slice(0, 1000)) }),
    }, 15000);
    if (!remote.response.ok) return { sent: false, reason: "lana_error", detail: cleanText(remote.body.error, 200) };
    return { sent: true, reason: "" };
  } catch (error) {
    console.warn("[mila-interview:previsit-whatsapp]", error instanceof Error ? error.message : error);
    return { sent: false, reason: "lana_unavailable" };
  }
}
async function auditConsent(row: Row, method: string) {
  // Constancia del consentimiento en el expediente: quién, cuándo, cómo. Sin contenido clínico.
  await admin.from("mila_audit_log").insert({
    tenant_id: row.tenant_id, user_id: row.kind === "previsit" ? null : row.created_by,
    event_type: "mila_interview_consent", entity_type: "patient", entity_id: row.patient_id,
    metadata: { interview_id: row.id, kind: row.kind || "clinic", method, at: new Date().toISOString() },
  }).then(({ error }) => { if (error) console.error("[mila-interview:consent-audit]", error.message); });
}
async function knownHistory(tenantId: string, patientId: string): Promise<string[]> {
  const { data } = await admin.from("smyl_patient_histories").select("document").eq("tenant_id", tenantId).eq("patient_id", patientId).maybeSingle();
  return data?.document ? summarizeKnownHistory(data.document) : [];
}
function sameDob(input: string, stored: unknown): boolean {
  const a = String(input || "").trim(), b = String(stored || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(a) && a === b;
}

// ---------------------------------------------------------------- entrevista previa: envío, registro por cita y envío automático
const AUTO_ACTOR = (tenantId: string): Actor => ({ id: tenantId, email: "MILA" });
const AUTO_MAX_PER_RUN = 25;
const AUTO_RESEND_DAYS = 30;
const AUTO_STALE_DAYS = 365;
const AUTO_THROTTLE_MS = 10 * 60_000;

/* Crea la entrevista previa (una vigente por paciente), la envía y deja constancia en la cita. */
async function createPrevisit(o: {
  tenantId: string; patient: Row; appt: Row | null; mode: string; via: "whatsapp" | "link";
  actor: Actor; origin: "manual" | "auto"; templateId?: string | null;
}): Promise<Row> {
  const { tenantId, patient, appt, via, actor, origin } = o;
  // Si el paciente no autorizó la IA, la entrevista previa se manda como formulario (sin voz ni asistente).
  let mode = o.mode;
  if (mode !== "form" && (await permisoIA(admin, tenantId, String(patient.id))) !== "allowed") mode = "form";
  const label = appt ? appointmentLabel(appt.starts_at) : "";
  const apptEnd = appt ? Date.parse(appt.starts_at) + 24 * 3600_000 : 0;
  const expires = new Date(Math.max(Date.now() + 2 * 3600_000, Math.min(apptEnd || Infinity, Date.now() + 7 * 24 * 3600_000))).toISOString();
  // Un solo envío vigente por paciente: el anterior sin responder se reemplaza.
  await admin.from("smyl_mila_interviews").delete()
    .eq("tenant_id", tenantId).eq("patient_id", patient.id).eq("kind", "previsit").is("submitted_at", null);
  const token = randomToken();
  const { data: created, error } = await admin.from("smyl_mila_interviews").insert({
    tenant_id: tenantId, patient_id: patient.id, created_by: actor.id, kind: "previsit", previsit_mode: mode,
    appointment_id: appt?.id || null, appointment_label: label || null, sent_via: via,
    pair_token_hash: await sha256(token), expires_at: expires,
  }).select("id,expires_at").single();
  if (error || !created) return { error: "No se pudo crear la entrevista previa." };
  const url = `${APP_BASE}/mila-movil.html#s=${created.id}&t=${encodeURIComponent(token)}`;
  let delivery = { sent: false, reason: via === "link" ? "link" : "" } as Row;
  if (via === "whatsapp") {
    delivery = await sendPrevisitWhatsApp(tenantId, patient.id, actor,
      [firstName(patient.nombre) || "paciente", label || "tu próxima cita", await clinicName(tenantId), url], `mila-previsit:${created.id}`, o.templateId);
  }
  if (appt?.id) await recordDispatch(tenantId, appt.id, patient.id, created.id, origin,
    via === "link" ? "link" : delivery.sent ? "sent" : "failed", via === "link" ? null : (delivery.reason || null), origin === "auto" ? null : actor.id);
  return { id: created.id, url, expires_at: created.expires_at, appointment: label, mode, ...delivery };
}

async function recordDispatch(tenantId: string, appointmentId: string, patientId: string, interviewId: string | null,
  origin: "manual" | "auto", status: "sent" | "link" | "failed" | "skipped" | "reviewed", reason: string | null, createdBy: string | null) {
  const { error } = await admin.from("smyl_mila_previsit_dispatches").upsert({
    tenant_id: tenantId, appointment_id: appointmentId, patient_id: patientId, interview_id: interviewId,
    origin, status, reason: reason ? reason.slice(0, 60) : null, created_by: createdBy, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,appointment_id" });
  if (error) console.error("[mila-interview:dispatch-log]", error.message);
}

type PrevisitSettings = { enabled: boolean; hours_before: number; mode: string; audience: string; last_dispatch_at: string | null };
const DEFAULT_SETTINGS: PrevisitSettings = { enabled: false, hours_before: 48, mode: "choice", audience: "stale", last_dispatch_at: null };
async function previsitSettings(tenantId: string): Promise<PrevisitSettings> {
  const { data } = await admin.from("smyl_mila_previsit_settings")
    .select("enabled,hours_before,mode,audience,last_dispatch_at").eq("tenant_id", tenantId).maybeSingle();
  return data ? data as PrevisitSettings : { ...DEFAULT_SETTINGS };
}

/* Envío automático: citas confirmadas dentro de la ventana, a pacientes sin historia (o vieja), sin envío reciente. */
async function dispatchPrevisits(tenantId: string, settings: PrevisitSettings): Promise<Row> {
  await admin.from("smyl_mila_previsit_settings").update({ last_dispatch_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  if (!settings.enabled) return { skipped: "disabled" };
  if (settings.mode !== "form" && !OPENAI_API_KEY) return { skipped: "mila_unconfigured" };
  const now = Date.now();
  const { data: appts } = await admin.from("smyl_appointments").select("id,patient_id,starts_at,status")
    .eq("tenant_id", tenantId).eq("status", "confirmed")
    .gt("starts_at", new Date(now + 3600_000).toISOString())
    .lte("starts_at", new Date(now + settings.hours_before * 3600_000).toISOString())
    .order("starts_at", { ascending: true }).limit(300);
  if (!appts?.length) return { sent: 0, failed: 0, skipped: 0 };
  const apptIds = appts.map((a: Row) => a.id);
  const patientIds = [...new Set(appts.map((a: Row) => String(a.patient_id)))];
  const [{ data: done }, { data: recent }, { data: histories }, { data: open }] = await Promise.all([
    admin.from("smyl_mila_previsit_dispatches").select("appointment_id").eq("tenant_id", tenantId).in("appointment_id", apptIds),
    admin.from("smyl_mila_previsit_dispatches").select("patient_id").eq("tenant_id", tenantId).in("patient_id", patientIds)
      .gt("created_at", new Date(now - AUTO_RESEND_DAYS * 86400_000).toISOString()),
    admin.from("smyl_patient_histories").select("patient_id,updated_at").eq("tenant_id", tenantId).in("patient_id", patientIds),
    admin.from("smyl_mila_interviews").select("patient_id").eq("tenant_id", tenantId).eq("kind", "previsit")
      .in("patient_id", patientIds).gt("expires_at", new Date().toISOString()),
  ]);
  const doneAppts = new Set((done || []).map((r: Row) => String(r.appointment_id)));
  const busy = new Set([...(recent || []), ...(open || [])].map((r: Row) => String(r.patient_id)));
  const historyAt = new Map((histories || []).map((r: Row) => [String(r.patient_id), Date.parse(r.updated_at) || 0]));
  const due = appts.filter((a: Row) => {
    if (doneAppts.has(String(a.id)) || busy.has(String(a.patient_id))) return false;
    const at = historyAt.get(String(a.patient_id));
    if (settings.audience === "no_history") return at === undefined;
    if (settings.audience === "stale") return at === undefined || at < now - AUTO_STALE_DAYS * 86400_000;
    return true;
  });
  if (!due.length) return { sent: 0, failed: 0, skipped: 0 };
  const actor = AUTO_ACTOR(tenantId);
  let templateId: string | null = null;
  try { templateId = await previsitTemplateId(tenantId, actor); } catch { return { skipped: "lana_unavailable" }; }
  // Sin plantilla aprobada no se registra nada: en cuanto Meta la apruebe, sale en la siguiente vuelta.
  if (!templateId) return { skipped: "template_not_approved" };
  const summary = { sent: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const appt of due) {
    if (summary.sent + summary.failed >= AUTO_MAX_PER_RUN) break;
    const pid = String(appt.patient_id);
    if (seen.has(pid)) { summary.skipped++; continue; }
    seen.add(pid);
    if (!await whatsappConversation(tenantId, pid)) {
      await recordDispatch(tenantId, appt.id, pid, null, "auto", "failed", "no_conversation", null);
      summary.failed++;
      continue;
    }
    const { data: patient } = await admin.from("camila_pacientes").select("id,nombre").eq("tenant_id", tenantId).eq("id", pid).maybeSingle();
    if (!patient) { summary.skipped++; continue; }
    const out = await createPrevisit({ tenantId, patient, appt, mode: settings.mode, via: "whatsapp", actor, origin: "auto", templateId });
    if (out.sent) summary.sent++; else summary.failed++;
  }
  return summary;
}

/* Estado de la entrevista previa por cita, para las marcas de la agenda. */
async function previsitOverview(tenantId: string, appointmentIds: string[], withAlerts: boolean) {
  const ids = appointmentIds.filter((v) => UUID.test(v)).slice(0, 400);
  if (!ids.length) return {};
  const { data: rows } = await admin.from("smyl_mila_previsit_dispatches")
    .select("appointment_id,interview_id,origin,status,reason,created_at").eq("tenant_id", tenantId).in("appointment_id", ids);
  const interviewIds = (rows || []).map((r: Row) => r.interview_id).filter(Boolean);
  const { data: interviews } = interviewIds.length
    ? await admin.from("smyl_mila_interviews").select("id,consent_at,submitted_at,result,expires_at,previsit_mode").in("id", interviewIds)
    : { data: [] as Row[] };
  const byId = new Map((interviews || []).map((r: Row) => [String(r.id), r]));
  const out: Record<string, Row> = {};
  for (const r of rows || []) {
    const iv = r.interview_id ? byId.get(String(r.interview_id)) : null;
    let state = r.status as string;
    let alerts = 0;
    if (r.status === "failed" || r.status === "skipped") state = "failed";
    else if (r.status === "reviewed") state = "reviewed";
    else if (iv) {
      const res = iv.result || {};
      const answered = !!(iv.submitted_at || res.history || res.finished_at || res.realtime?.finished_at);
      state = answered ? "answered" : iv.consent_at ? "in_progress" : "sent";
      alerts = alertsOf(res).length;
    } else state = "expired";
    out[r.appointment_id] = {
      state, origin: r.origin, reason: r.reason || "", sent_at: r.created_at, interview_id: r.interview_id || null,
      ...(withAlerts ? { alerts } : { alerts: alerts ? 1 : 0 }),
    };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  // Cron (pg_cron + pg_net, mismo secreto que los recordatorios): envío automático de la entrevista previa.
  const cronSecret = req.headers.get("x-smyl-cron-secret") || "";
  if (cronSecret) {
    if (!CRON_SECRET || !sameHash(await sha256(cronSecret), await sha256(CRON_SECRET))) return json(401, { error: "Secreto de cron no válido." });
    const { data: enabled } = await admin.from("smyl_mila_previsit_settings")
      .select("tenant_id,enabled,hours_before,mode,audience,last_dispatch_at").eq("enabled", true).limit(200);
    const results: Record<string, Row> = {};
    for (const row of enabled || []) {
      results[row.tenant_id] = await dispatchPrevisits(row.tenant_id, row as PrevisitSettings).catch((e) => ({ error: e instanceof Error ? e.message : "error" }));
    }
    return json(200, { tenants: Object.keys(results).length, results });
  }

  const isMultipart = (req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
  let form: FormData | null = null;
  let body: Row = {};
  try {
    if (isMultipart) form = await req.formData();
    else body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }
  const field = (name: string) => String(form ? form.get(name) ?? "" : body[name] ?? "");
  const action = isMultipart ? "segment" : field("action");
  const id = field("id");

  // -------------------------------------------------------------- computadora (dentista)
  // -------------------------------------------------------------- agenda (marcas de entrevista previa)
  if (action === "previsit_overview") {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const denied = await requirePermission(auth, CORS, "schedule.read");
    if (denied) return denied;
    const tenantId = auth.tenantId!;
    const clinical = (await requirePermission(auth, CORS, "clinical.write")) === null;
    const ids = Array.isArray(body.appointment_ids) ? body.appointment_ids.map(String) : [];
    const settings = await previsitSettings(tenantId);
    // La agenda abierta también dispara el envío automático (como los recordatorios), como mucho cada 10 min.
    const stale = !settings.last_dispatch_at || Date.now() - Date.parse(settings.last_dispatch_at) > AUTO_THROTTLE_MS;
    if (settings.enabled && stale && HAS_WAIT_UNTIL) background(dispatchPrevisits(tenantId, settings));
    return json(200, { items: await previsitOverview(tenantId, ids, clinical), can_send: clinical, auto: settings.enabled });
  }

  if (["create", "status", "close", "previsit_create", "pending", "previsit_settings", "previsit_settings_save"].includes(action)) {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const denied = await requirePermission(auth, CORS, "clinical.write");
    if (denied) return denied;
    const tenantId = auth.tenantId!;
    const userId = auth.user!.id;

    if (action === "previsit_settings") {
      const settings = await previsitSettings(tenantId);
      const canConfigure = (await requirePermission(auth, CORS, "schedule.manage")) === null;
      let templateReady: boolean | null = null;
      try { templateReady = !!(await previsitTemplateId(tenantId, auth.user!)); } catch { templateReady = null; }
      return json(200, { settings, can_configure: canConfigure, template_ready: templateReady, voice_available: !!OPENAI_API_KEY });
    }
    if (action === "previsit_settings_save") {
      const denied2 = await requirePermission(auth, CORS, "schedule.manage");
      if (denied2) return denied2;
      const hours = Math.round(Number(body.hours_before));
      const next = {
        tenant_id: tenantId,
        enabled: body.enabled === true,
        hours_before: Number.isFinite(hours) ? Math.min(168, Math.max(12, hours)) : 48,
        mode: ["voice", "form", "choice"].includes(String(body.mode)) ? String(body.mode) : "choice",
        audience: ["no_history", "stale", "all"].includes(String(body.audience)) ? String(body.audience) : "stale",
        updated_by: userId, updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("smyl_mila_previsit_settings").upsert(next, { onConflict: "tenant_id" });
      if (error) return json(500, { error: "No se pudo guardar la configuración." });
      const summary = next.enabled ? await dispatchPrevisits(tenantId, { ...next, last_dispatch_at: null }).catch(() => null) : null;
      return json(200, { ok: true, settings: next, summary });
    }

    if (action === "create") {
      if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
      const patientId = field("patient_id");
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: patient } = await admin.from("camila_pacientes").select("id,nombre,apellido")
        .eq("tenant_id", tenantId).eq("id", patientId).maybeSingle();
      if (!patient) return json(404, { error: "El paciente no pertenece a tu clínica." });
      const negada = respuestaIAnegada(await permisoIA(admin, tenantId, patientId));
      if (negada) return json(negada.status, negada.body);
      await purgeExpired();
      // Las sesiones de este profesional que nunca empezaron se descartan; un borrador sin guardar se conserva (aparece en la Historia clínica).
      await admin.from("smyl_mila_interviews").delete()
        .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("created_by", userId).eq("kind", "clinic").is("consent_at", null);
      const token = randomToken();
      const expires = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();
      const { data: row, error } = await admin.from("smyl_mila_interviews").insert({
        tenant_id: tenantId, patient_id: patientId, created_by: userId,
        pair_token_hash: await sha256(token), expires_at: expires,
      }).select("id,expires_at").single();
      if (error || !row) return json(500, { error: "No se pudo crear la sesión de MILA." });
      return json(200, { id: row.id, token, expires_at: row.expires_at });
    }

    // Entrevista previa: la clínica elige voz, formulario o que el paciente decida; se envía por WhatsApp o se copia el enlace.
    if (action === "previsit_create") {
      const patientId = field("patient_id");
      const mode = ["voice", "form", "choice"].includes(field("mode")) ? field("mode") : "choice";
      const via = field("via") === "whatsapp" ? "whatsapp" : "link";
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: patient } = await admin.from("camila_pacientes").select("id,nombre")
        .eq("tenant_id", tenantId).eq("id", patientId).maybeSingle();
      if (!patient) return json(404, { error: "El paciente no pertenece a tu clínica." });
      if (mode !== "form" && !OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía; usa el formulario." });
      await purgeExpired();
      const appt = await nextAppointment(tenantId, patientId, field("appointment_id"));
      const out = await createPrevisit({ tenantId, patient, appt, mode, via, actor: auth.user!, origin: "manual" });
      if (out.error) return json(500, { error: out.error });
      return json(200, out);
    }

    // Borradores de MILA de este paciente que nadie ha guardado (consultorio terminado o entrevista previa respondida).
    if (action === "pending") {
      const patientId = field("patient_id");
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: rows } = await admin.from("smyl_mila_interviews")
        .select("id,kind,previsit_mode,appointment_label,sent_via,created_by,consent_at,submitted_at,result,expires_at,created_at")
        .eq("tenant_id", tenantId).eq("patient_id", patientId).neq("status", "closed")
        .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(5);
      const items = (rows || []).filter((r: Row) => r.kind === "previsit" || r.created_by === userId).map((r: Row) => {
        const res = r.result || {};
        return {
          id: r.id, kind: r.kind, mode: r.previsit_mode, appointment: r.appointment_label, sent_via: r.sent_via,
          consent_at: r.consent_at, submitted_at: r.submitted_at, created_at: r.created_at, expires_at: r.expires_at,
          has_history: !!res.history, finished: !!(res.finished_at || r.submitted_at || res.realtime?.finished_at),
          alerts: alertsOf(res), coverage: res.history?.coverage || null, source: res.history?.source || (res.realtime ? "voice" : "recording"),
        };
      });
      return json(200, { items });
    }

    if (!UUID.test(id)) return json(400, { error: "Sesión inválida." });
    const { data: found } = await admin.from("smyl_mila_interviews").select("*")
      .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    const row = found && (found.created_by === userId || found.kind === "previsit") ? found : null;
    if (!row) return json(404, { error: "La sesión de MILA ya no existe o venció." });

    if (action === "close") {
      if (row.kind === "previsit") {
        await admin.from("smyl_mila_previsit_dispatches").update({ status: "reviewed", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("interview_id", row.id);
      }
      await admin.from("smyl_mila_interviews").delete().eq("id", row.id);
      return json(200, { closed: true });
    }
    if (Date.parse(row.expires_at) < Date.now()) return json(410, { error: "La sesión de MILA venció." });
    return json(200, await publicStatus(row));
  }

  // -------------------------------------------------------------- celular
  if (!UUID.test(id)) return json(400, { error: "Código QR inválido." });
  const { data: row } = await admin.from("smyl_mila_interviews").select("*").eq("id", id).maybeSingle();
  if (!row || row.status === "closed" || Date.parse(row.expires_at) < Date.now()) {
    return json(410, { error: "Este código ya no es válido. Genera uno nuevo desde la computadora." });
  }

  if (action === "pair") {
    const token = field("token");
    if (!token || !sameHash(await sha256(token), row.pair_token_hash)) return json(403, { error: "Código QR inválido." });
    if (row.device_hash) return json(409, { error: row.kind === "previsit" ? "Este enlace ya se abrió en otro dispositivo. Ábrelo en el mismo celular o pide a tu clínica uno nuevo." : "Este código ya se usó en otro celular. Genera uno nuevo." });
    const device = randomToken();
    const { data: updated } = await admin.from("smyl_mila_interviews")
      .update({ device_hash: await sha256(device), status: "paired", updated_at: new Date().toISOString() })
      .eq("id", row.id).is("device_hash", null).select("id").maybeSingle();
    if (!updated) return json(409, { error: "Este código ya se usó en otro celular. Genera uno nuevo." });
    const { data: patient } = await admin.from("camila_pacientes").select("nombre,apellido,fecha_nacimiento")
      .eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    if (row.kind === "previsit") {
      // El enlace pudo reenviarse: solo el primer nombre y, si la ficha tiene fecha de nacimiento, se pide antes de seguir.
      const needsDob = !!patient?.fecha_nacimiento;
      if (!needsDob) await admin.from("smyl_mila_interviews").update({ identity_verified_at: new Date().toISOString() }).eq("id", row.id);
      return json(200, {
        device, kind: "previsit", patient: firstName(patient?.nombre) || "Paciente", clinic: await clinicName(row.tenant_id),
        appointment: row.appointment_label || "", mode: row.previsit_mode || "choice", needs_dob: needsDob,
        submitted: !!row.submitted_at, guide: INTERVIEW_GUIDE, expires_at: row.expires_at,
        voice_available: !!OPENAI_API_KEY, max_voice_seconds: MAX_PREVISIT_REALTIME_SECONDS,
      });
    }
    const full = [patient?.nombre, patient?.apellido].map((v) => cleanText(v, 80)).filter(Boolean).join(" ") || "Paciente";
    return json(200, { device, kind: "clinic", patient: full, guide: INTERVIEW_GUIDE, expires_at: row.expires_at, max_segment_seconds: MAX_SEGMENT_SECONDS });
  }

  const device = field("device");
  if (!device || !row.device_hash || !sameHash(await sha256(device), row.device_hash)) {
    return json(403, { error: "Este celular no está vinculado a la sesión." });
  }
  const result: Row = row.result || {};

  if (action === "verify") {
    if (row.kind !== "previsit" || row.identity_verified_at) return json(200, { verified: true });
    if ((Number(row.identity_attempts) || 0) >= 5) return json(429, { error: "Demasiados intentos. Pide a tu clínica un enlace nuevo." });
    const { data: patient } = await admin.from("camila_pacientes").select("fecha_nacimiento").eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    if (!sameDob(field("dob"), patient?.fecha_nacimiento)) {
      await admin.from("smyl_mila_interviews").update({ identity_attempts: (Number(row.identity_attempts) || 0) + 1 }).eq("id", row.id);
      return json(403, { error: "La fecha no coincide con la que tiene tu clínica. Revisa e intenta de nuevo." });
    }
    await admin.from("smyl_mila_interviews").update({ identity_verified_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { verified: true });
  }
  if (row.kind === "previsit" && !row.identity_verified_at && action !== "state") return json(403, { error: "Primero confirma tu fecha de nacimiento." });
  if (row.kind === "previsit" && row.submitted_at && action !== "state") return json(409, { error: "Esta entrevista ya fue enviada. ¡Gracias! Tu dentista la revisará en tu cita." });

  if (action === "consent") {
    if (!row.consent_at) {
      await admin.from("smyl_mila_interviews").update({ consent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
      await auditConsent(row, row.kind === "previsit" ? "paciente_en_enlace" : "dentista_en_celular");
    }
    return json(200, { consent: true });
  }
  if (action === "form_submit") {
    if (row.kind !== "previsit" || row.previsit_mode === "voice") return json(400, { error: "Esta entrevista no usa formulario." });
    if (!row.consent_at) return json(409, { error: "Primero acepta el aviso de privacidad." });
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    if (JSON.stringify(answers).length > 30000) return json(413, { error: "Respuestas demasiado largas." });
    const history = { ...buildFromForm(answers), updated_at: new Date().toISOString() };
    const now = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({
      result: { ...result, history, finished_at: now }, submitted_at: now, updated_at: now,
    }).eq("id", row.id);
    return json(200, { submitted: true, coverage: history.coverage });
  }
  if (action === "finish") {
    const now = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({ result: { ...result, finished_at: now }, updated_at: now, ...(row.kind === "previsit" && result.history ? { submitted_at: now } : {}) }).eq("id", row.id);
    return json(200, { finished: true });
  }
  if (action === "state") {
    const pending = result.pending || {};
    return json(200, {
      consent: !!row.consent_at, segments: row.segments, history: result.history || null, exam: result.exam || null,
      alerts: alertsOf(result), interpreting: !!(pending.history || pending.exam), tokens: await sessionTokens(row.tenant_id, row.id),
      audio_seconds: row.audio_seconds,
      realtime_active: !!(result.realtime?.started_at && !result.realtime?.finished_at),
      verified: row.kind !== "previsit" || !!row.identity_verified_at, submitted: !!row.submitted_at,
    });
  }
  if (!row.consent_at) return json(409, { error: "Primero registra el consentimiento del paciente." });

  // ---- MILA entrevista: abrir la conversación de voz
  if (action === "realtime") {
    if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
    const sdp = field("sdp");
    if (!sdp || sdp.length > 100_000) return json(400, { error: "Falta la oferta de audio." });
    if (row.kind === "previsit" && row.previsit_mode === "form") return json(400, { error: "Esta entrevista es por formulario." });
    if (row.kind === "previsit" && result.realtime?.finished_at) return json(409, { error: "Ya platicaste con MILA. Si falta algo puedes completarlo con el formulario." });
    if (result.realtime?.started_at && !result.realtime?.finished_at) {
      return json(409, { error: "Ya hay una entrevista de MILA en curso en esta sesión." });
    }
    if (CONSUMABLES_ENFORCED) {
      const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
        .eq("tenant_id", row.tenant_id).eq("resource", "mila_seconds").maybeSingle();
      if (!wallet || Number(wallet.balance_units) < 120) return json(402, { error: "No hay tiempo de MILA suficiente para una entrevista." });
    }
    const { data: patient } = await admin.from("camila_pacientes").select("nombre")
      .eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    // «Continuar la entrevista»: MILA solo pregunta lo que faltó según el borrador ya interpretado.
    let continuation: { covered: string[]; pending: string[] } | null = null;
    if (field("continuar") === "true" && result.history?.coverage) {
      const cov = result.history.coverage as Record<string, string>;
      const covered: string[] = [], pending: string[] = [];
      for (const sec of INTERVIEW_GUIDE) {
        const done = sec.key === "emergency_contact" ? !!result.history?.document?.emergency_contact : (cov[sec.key] || "not_asked") !== "not_asked";
        (done ? covered : pending).push(sec.title);
      }
      continuation = { covered, pending };
    }
    const knownLines = await knownHistory(row.tenant_id, row.patient_id);
    const previsitClinic = row.kind === "previsit" ? await clinicName(row.tenant_id) : "";
    const buildSession = (withSpeed: boolean) => ({
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: buildInterviewerInstructions(firstName(patient?.nombre), {
        ...(continuation ? { continuation } : {}),
        known: knownLines,
        ...(row.kind === "previsit" ? { previsit: { clinic: previsitClinic, appointment: row.appointment_label || "" } } : {}),
      }),
      // Sin tope por respuesta: la voz consume muchos tokens y con un límite el resumen final se cortaba a media frase.
      max_output_tokens: "inf",
      audio: {
        input: {
          transcription: { model: REALTIME_TRANSCRIBE_MODEL, languages: ["es"] },
          // Filtra ruido del consultorio (compresor, succión, música); far_field porque el celular queda sobre la mesa, no pegado a la boca.
          noise_reduction: { type: "far_field" },
          turn_detection: TURN_MODE === "semantic"
            ? { type: "semantic_vad", eagerness: VAD_EAGERNESS, create_response: false, interrupt_response: false }
            : { type: "server_vad", threshold: 0.62, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: true, interrupt_response: true },
        },
        output: { voice: REALTIME_VOICE, ...(withSpeed && VOICE_SPEED !== 1 ? { speed: VOICE_SPEED } : {}) },
      },
      tools: INTERVIEWER_TOOLS,
      tool_choice: "auto",
    });
    const openCall = async (withSpeed: boolean) => {
      const provider = new FormData();
      provider.set("sdp", sdp);
      provider.set("session", JSON.stringify(buildSession(withSpeed)));
      const r = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: provider,
      });
      return { resp: r, answer: await r.text() };
    };
    try {
      let { resp, answer } = await openCall(true);
      // Si el servicio no acepta el parámetro de velocidad, se reintenta sin él: la entrevista nunca debe fallar por eso.
      if (!resp.ok && VOICE_SPEED !== 1 && /speed/i.test(answer)) {
        console.warn("[mila-interview:realtime] speed rechazado; reintentando sin velocidad", row.id);
        ({ resp, answer } = await openCall(false));
      }
      if (!resp.ok) {
        console.error("[mila-interview:realtime]", row.id, resp.status, answer.slice(0, 400));
        return json(502, { error: "No se pudo abrir la conversación de voz." });
      }
      const startedAt = new Date().toISOString();
      const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", row.id).maybeSingle();
      await admin.from("smyl_mila_interviews").update({
        result: { ...(fresh?.result || {}), realtime: { started_at: startedAt } },
        updated_at: startedAt,
      }).eq("id", row.id);
      return json(200, { answer_sdp: answer, started_at: startedAt, turn_control: TURN_MODE === "semantic" ? "client" : "server" });
    } catch (error) {
      console.error("[mila-interview:realtime]", row.id, error instanceof Error ? error.message : error);
      return json(502, { error: "No se pudo conectar con el servicio de voz." });
    }
  }

  if (action === "realtime_turn") {
    const role = field("role") === "mila" ? "MILA" : "Paciente";
    const text = cleanText(field("text"), 2000);
    if (!text) return json(200, { ok: true });
    const fullTranscript = `${row.transcript_history ? `${row.transcript_history}\n` : ""}${role}: ${text}`.slice(-MAX_TRANSCRIPT);
    await admin.from("smyl_mila_interviews").update({ transcript_history: fullTranscript, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { ok: true });
  }

  if (action === "realtime_alert") {
    const tipo = ALERT_TYPES.includes(field("tipo")) ? field("tipo") : "otra";
    const detalle = cleanText(field("detalle"), 240);
    const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", row.id).maybeSingle();
    const current = fresh?.result || {};
    const alerts = alertsOf(current).slice(0, 19);
    alerts.push({ tipo, label: (ALERT_LABELS as Record<string, string>)[tipo], detalle, at: new Date().toISOString() });
    await admin.from("smyl_mila_interviews").update({ result: { ...current, alerts }, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { ok: true, alerts });
  }

  if (action === "realtime_finish") {
    const rt = result.realtime || {};
    if (!rt.started_at) return json(409, { error: "No hay una entrevista de MILA en curso." });
    if (rt.finished_at) {
      return json(200, { history: result.history || null, alerts: alertsOf(result), tokens: await sessionTokens(row.tenant_id, row.id), seconds: rt.seconds || 0 });
    }
    const seconds = Math.max(1, Math.min(row.kind === "previsit" ? MAX_PREVISIT_REALTIME_SECONDS : MAX_REALTIME_SECONDS, Math.ceil((Date.now() - Date.parse(rt.started_at)) / 1000)));
    // Tokens de voz que reporta OpenAI en cada response.done; los suma el celular (se marcan como reportados por el cliente).
    const reported = body.usage && typeof body.usage === "object" ? body.usage : {};
    const voiceUsage: Usage = { input_tokens: tokenCount(reported.input_tokens), output_tokens: tokenCount(reported.output_tokens) };
    // Cada conversación (incluida una continuación) se mide por separado.
    const key = `${row.id}:rt${Date.parse(rt.started_at)}`;
    const accepted = await consumeSeconds(row.tenant_id, "history", key, seconds, REALTIME_MODEL, {
      context: "history_realtime_interview",
      token_usage: {
        ...voiceUsage,
        total_tokens: voiceUsage.input_tokens + voiceUsage.output_tokens,
        cached_input_tokens: tokenCount(reported.cached_input_tokens),
        input_audio_tokens: tokenCount(reported.input_audio_tokens),
        input_text_tokens: tokenCount(reported.input_text_tokens),
        output_audio_tokens: tokenCount(reported.output_audio_tokens),
        output_text_tokens: tokenCount(reported.output_text_tokens),
        usage_source: "client_reported_openai_response_done",
      },
      extract_model: EXTRACT_MODEL,
    });
    await logUsage(row.tenant_id, "history", REALTIME_MODEL, key, voiceUsage, seconds, "ok");
    const { data: fresh } = await admin.from("smyl_mila_interviews").select("result,transcript_history,audio_seconds").eq("id", row.id).maybeSingle();
    const finishedAt = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({
      result: { ...(fresh?.result || {}), realtime: { ...rt, finished_at: finishedAt, seconds }, ...(row.kind === "previsit" ? { finished_at: finishedAt } : {}) },
      ...(row.kind === "previsit" ? { submitted_at: finishedAt } : {}),
      audio_seconds: (Number(fresh?.audio_seconds) || 0) + seconds,
      updated_at: finishedAt,
    }).eq("id", row.id);
    const transcript = String(fresh?.transcript_history || "");
    const next = transcript ? await interpretAndStore(row.id, row.tenant_id, "history", transcript, key) : fresh?.result;
    if (!accepted) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, { history: next?.history || null, alerts: alertsOf(next || {}), tokens: await sessionTokens(row.tenant_id, row.id), seconds });
  }

  if (action !== "segment" || !form) return json(400, { error: "Acción no válida." });
  if (row.kind === "previsit") return json(400, { error: "La entrevista previa no usa grabación por segmentos." });

  // ---- modo «Yo pregunto»: segmento de audio
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
  const mode: Mode = field("mode") === "exam" ? "exam" : "history";
  const audio = form.get("audio");
  if (!(audio instanceof File)) return json(400, { error: "Falta el audio." });
  const mime = audio.type.split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return json(415, { error: "Formato de audio no permitido." });
  if (audio.size <= 0 || audio.size > MAX_BYTES) return json(413, { error: "El segmento debe pesar menos de 10 MB." });
  const clientSeconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(Number(field("duracion_segundos")) || 1)));

  // Un segmento a la vez por sesión (evita que dos envíos pisen la transcripción).
  const now = new Date();
  const { data: locked } = await admin.from("smyl_mila_interviews")
    .update({ busy_until: new Date(now.getTime() + 90_000).toISOString() })
    .eq("id", row.id).or(`busy_until.is.null,busy_until.lt.${now.toISOString()}`).select("*").maybeSingle();
  if (!locked) return json(429, { error: "MILA todavía procesa el segmento anterior. Intenta en unos segundos." });

  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
      .eq("tenant_id", row.tenant_id).eq("resource", "mila_seconds").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < clientSeconds) {
      await admin.from("smyl_mila_interviews").update({ busy_until: null }).eq("id", row.id);
      return json(402, { error: "No hay tiempo de MILA suficiente." });
    }
  }

  const segmentNo = (Number(locked.segments) || 0) + 1;
  const requestId = `${row.id}:${segmentNo}`;
  try {
    const heard = await transcribe(audio, mime, mode);
    const seconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(heard.seconds ?? clientSeconds)));
    const key = mode === "history" ? "transcript_history" : "transcript_exam";
    const fullTranscript = heard.text
      ? `${locked[key] ? `${locked[key]}\n` : ""}${heard.text}`.slice(-MAX_TRANSCRIPT)
      : String(locked[key] || "");
    const accepted = await consumeSeconds(row.tenant_id, mode, requestId, seconds, TRANSCRIBE_MODEL, {
      context: mode, bytes: audio.size, token_usage: { ...heard.usage, total_tokens: heard.usage.input_tokens + heard.usage.output_tokens },
    });
    await logUsage(row.tenant_id, mode, TRANSCRIBE_MODEL, requestId, heard.usage, seconds, "ok");
    const nextResult = { ...(locked.result || {}) };
    if (heard.text) nextResult.pending = { ...(nextResult.pending || {}), [mode]: fullTranscript.length };
    await admin.from("smyl_mila_interviews").update({
      [key]: fullTranscript,
      result: nextResult,
      segments: segmentNo,
      audio_seconds: (Number(locked.audio_seconds) || 0) + seconds,
      busy_until: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    // La interpretación no bloquea al celular: corre después de responder.
    if (heard.text) {
      const job = interpretAndStore(row.id, row.tenant_id, mode, fullTranscript, requestId);
      if (HAS_WAIT_UNTIL) background(job);
      else await job;
    }

    if (!accepted) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, {
      heard: heard.text,
      seconds,
      interpreting: !!heard.text,
      warning: heard.text ? "" : "No se reconoció voz en este segmento.",
      history: nextResult.history || null,
      exam: nextResult.exam || null,
    });
  } catch (error) {
    await admin.from("smyl_mila_interviews").update({ busy_until: null }).eq("id", row.id);
    console.error("[mila-interview:segment]", requestId, error instanceof Error ? error.message : error);
    return json(502, { error: "No se pudo procesar este segmento. Vuelve a grabarlo." });
  }
});
