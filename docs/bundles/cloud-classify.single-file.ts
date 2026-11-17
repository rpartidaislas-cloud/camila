// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/cloud-classify/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/ai-quota.ts ──
const { TOPES_RADIOGRAFIA_PREDETERMINADOS, leerTopesRadiografia, evaluarTope, inicioDiaUTC, inicioMesUTC } = (() => {
// Tope de análisis de IA por clínica (auditoría del panel admin, 2026-11-06): sin esto, una sesión (o un script con una
// sesión robada) podía lanzar análisis de radiografía sin límite y la factura de Anthropic la pagaba SMYL.
// Los límites son generosos para uso clínico normal y se ajustan con variables de entorno sin publicar código.

interface TopesIA {
  diario: number;
  mensual: number;
}

const TOPES_RADIOGRAFIA_PREDETERMINADOS: TopesIA = { diario: 60, mensual: 600 };

function entero(valor: string | undefined, predeterminado: number): number {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n > 0 ? n : predeterminado;
}

function leerTopesRadiografia(env: { get(name: string): string | undefined }): TopesIA {
  return {
    diario: entero(env.get("RADIOGRAPH_DAILY_LIMIT"), TOPES_RADIOGRAFIA_PREDETERMINADOS.diario),
    mensual: entero(env.get("RADIOGRAPH_MONTHLY_LIMIT"), TOPES_RADIOGRAFIA_PREDETERMINADOS.mensual),
  };
}

type ResultadoTope = { permitido: true } | { permitido: false; periodo: "diario" | "mensual"; mensaje: string };

function evaluarTope(usoDiario: number, usoMensual: number, topes: TopesIA): ResultadoTope {
  if (usoDiario >= topes.diario) {
    return { permitido: false, periodo: "diario", mensaje: `Tu clínica llegó al límite diario de ${topes.diario} análisis de radiografía. Podrás continuar mañana o pedir que se amplíe el límite.` };
  }
  if (usoMensual >= topes.mensual) {
    return { permitido: false, periodo: "mensual", mensaje: `Tu clínica llegó al límite mensual de ${topes.mensual} análisis de radiografía. Pide que se amplíe el límite para continuar.` };
  }
  return { permitido: true };
}

// Inicio del día/mes en UTC (suficiente para un tope de costo; no es una regla clínica).
function inicioDiaUTC(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
}
function inicioMesUTC(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();
}

return { TOPES_RADIOGRAFIA_PREDETERMINADOS, leerTopesRadiografia, evaluarTope, inicioDiaUTC, inicioMesUTC };
})();

// ── _shared/cloud-classify-core.mjs ──
const { CLOUD_CLASSIFY_MODEL, CLOUD_CLASSIFY_MAX_TOKENS, CLOUD_CLASSIFY_TIMEOUT_MS, MAX_IMAGE_BASE64, TOPES_PREDETERMINADOS, CATEGORIAS, CONFIANZAS, UUID_RE, CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, topesDeEntorno, evaluarTopeClasificacion, imagenValida, leerSugerencia } = (() => {
// Lógica pura de la sugerencia de tipo de archivo de la Nube (sin Deno ni red).
// La IA SOLO sugiere: no escribe nada. La persona confirma desde la pantalla y recién ahí se guarda el tipo.
const CLOUD_CLASSIFY_MODEL = "claude-haiku-5-5";
const CLOUD_CLASSIFY_MAX_TOKENS = 400;
const CLOUD_CLASSIFY_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BASE64 = 900_000; // ~650 KB de JPEG reducido
const TOPES_PREDETERMINADOS = { diario: 200, mensual: 3000 };
const CATEGORIAS = ["photo", "xray", "document", "consent", "other"];
const CONFIANZAS = ["high", "medium", "low"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "reason"],
  properties: {
    category: { type: "string", enum: CATEGORIAS },
    confidence: { type: "string", enum: CONFIANZAS },
    reason: { type: "string", description: "Una frase corta que explique qué se ve, máximo 160 caracteres." },
  },
};

const CLASSIFY_SYSTEM = [
  "Eres un asistente administrativo de una clínica dental. Clasifica el TIPO de un archivo de imagen para ordenarlo; no diagnostiques ni interpretes hallazgos.",
  "Tipos: photo (fotografía clínica: sonrisa, rostro o boca/intraoral), xray (radiografía: panorámica, periapical, aleta de mordida, cefalométrica o tomografía), document (documento o estudio escaneado o fotografiado), consent (formato de consentimiento o carta firmada), other (cualquier otra cosa).",
  "No recibes nombre del archivo ni datos de la persona. No intentes identificar a nadie. Si dudas entre dos tipos, elige el más probable y baja la confianza.",
  "Responde solo con el JSON del esquema.",
].join("\n");

function topesDeEntorno(env: any) {
  const entero = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    diario: entero(env.get("CLOUD_CLASSIFY_DAILY_LIMIT"), TOPES_PREDETERMINADOS.diario),
    mensual: entero(env.get("CLOUD_CLASSIFY_MONTHLY_LIMIT"), TOPES_PREDETERMINADOS.mensual),
  };
}
function evaluarTopeClasificacion(usoDiario: any, usoMensual: any, topes: any) {
  if (usoDiario >= topes.diario) return { permitido: false, mensaje: `Tu clínica llegó al límite diario de ${topes.diario} sugerencias de la IA. Podrás continuar mañana.` };
  if (usoMensual >= topes.mensual) return { permitido: false, mensaje: `Tu clínica llegó al límite mensual de ${topes.mensual} sugerencias de la IA.` };
  return { permitido: true };
}

// Acepta solo una imagen JPEG reducida en base64 puro (sin prefijo data:) y de tamaño acotado.
function imagenValida(valor: any) {
  if (typeof valor !== "string" || valor.length < 100 || valor.length > MAX_IMAGE_BASE64) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) return false;
  return valor.startsWith("/9j/"); // firma JPEG (FF D8 FF)
}

// Valida y normaliza lo que devuelve el modelo; cualquier cosa fuera del contrato se descarta.
function leerSugerencia(texto: any) {
  let datos;
  try { datos = JSON.parse(String(texto || "")); } catch { return null; }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return null;
  if (!CATEGORIAS.includes(datos.category) || !CONFIANZAS.includes(datos.confidence)) return null;
  const razon = typeof datos.reason === "string" ? datos.reason.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return { category: datos.category, confidence: datos.confidence, reason: razon };
}

return { CLOUD_CLASSIFY_MODEL, CLOUD_CLASSIFY_MAX_TOKENS, CLOUD_CLASSIFY_TIMEOUT_MS, MAX_IMAGE_BASE64, TOPES_PREDETERMINADOS, CATEGORIAS, CONFIANZAS, UUID_RE, CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, topesDeEntorno, evaluarTopeClasificacion, imagenValida, leerSugerencia };
})();

// ── cloud-classify/index.ts ──
// Sugerir el TIPO de un archivo de la Nube con IA (foto, rayos X, documento, consentimiento u otro).
// Solo sugiere: no escribe nada. Recibe una copia reducida de la imagen (sin nombre ni datos del paciente) y devuelve
// {category, confidence, reason}; la persona confirma en pantalla. El modelo, el esquema y los topes los fija el servidor.

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const MAX_BODY = 1_100_000;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function medir(tenant: string, requestId: string | null, outcome: "ok" | "incomplete" | "error", usage: Json | null, ms: number, stop: unknown) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenant, feature: "cloud_classify", model: CLOUD_CLASSIFY_MODEL, request_id: requestId ? requestId.slice(0, 120) : null, outcome,
    input_tokens: n(usage?.input_tokens), output_tokens: n(usage?.output_tokens), cache_read_tokens: n(usage?.cache_read_input_tokens),
    cache_write_tokens: n(usage?.cache_creation_input_tokens), duration_ms: n(ms), stop_reason: typeof stop === "string" ? stop.slice(0, 40) : null,
    estimated_cost_usd: null,
  });
  if (error) console.error("[cloud-classify] no se pudo medir:", error.message);
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "La imagen es demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  if (typeof body.file_id !== "string" || !UUID_RE.test(body.file_id)) return json(CORS, 400, { error: "Archivo inválido." });
  if (!imagenValida(body.image_base64)) return json(CORS, 400, { error: "Envía una copia reducida en JPEG." });

  // Permiso y alcance: quien organiza la Nube y puede VER el archivo (la RLS decide por su sesión, no por el navegador).
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: puede } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "cloud.manage" });
  if (puede !== true) return json(CORS, 403, { error: "Tu rol no permite organizar los archivos de la Nube." });
  const { data: file } = await asUser.from("smyl_cloud_files").select("id, mime_type, status").eq("id", body.file_id).eq("tenant_id", tenantId).maybeSingle();
  if (!file || file.status !== "active") return json(CORS, 404, { error: "El archivo no existe o no tienes acceso." });
  if (!String(file.mime_type).startsWith("image/")) return json(CORS, 422, { error: "Solo se sugiere el tipo de imágenes." });

  const ahora = new Date();
  const [dia, mes] = await Promise.all(
    [inicioDiaUTC(ahora), inicioMesUTC(ahora)].map((desde) =>
      admin.from("smyl_ai_usage_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("feature", "cloud_classify").gte("created_at", desde)),
  );
  const tope = evaluarTopeClasificacion(dia.count || 0, mes.count || 0, topesDeEntorno(Deno.env));
  if (!tope.permitido) return json(CORS, 429, { error: tope.mensaje });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(CORS, 503, { error: "La IA no está configurada todavía." });
  const inicio = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUD_CLASSIFY_TIMEOUT_MS);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: CLOUD_CLASSIFY_MODEL, max_tokens: CLOUD_CLASSIFY_MAX_TOKENS, system: CLASSIFY_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image_base64 } },
          { type: "text", text: "Clasifica el tipo de esta imagen." },
        ] }],
        output_config: { format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
      }),
    }).finally(() => clearTimeout(timer));
    const message = await resp.json().catch(() => ({}));
    const duracion = Date.now() - inicio;
    if (!resp.ok) { await medir(tenantId, message?.id || null, "error", null, duracion, null); return json(CORS, 502, { error: "La IA no pudo analizar la imagen. Elige el tipo a mano." }); }
    const texto = Array.isArray(message.content) ? message.content.filter((b: Json) => b?.type === "text").map((b: Json) => b.text).join("") : "";
    const sugerencia = leerSugerencia(texto);
    await medir(tenantId, message.id || null, sugerencia ? "ok" : "incomplete", message.usage || null, duracion, message.stop_reason);
    if (!sugerencia) return json(CORS, 502, { error: "La IA no dio una respuesta clara. Elige el tipo a mano." });
    return json(CORS, 200, sugerencia);
  } catch (e) {
    await medir(tenantId, null, "error", null, Date.now() - inicio, null);
    return json(CORS, 502, { error: (e as Error)?.name === "AbortError" ? "La IA tardó demasiado. Intenta de nuevo." : "No se pudo contactar a la IA." });
  }
});
