// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/lana-webhook/index.ts con sus archivos de _shared incluidos,
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

// ── _shared/lana.ts ──
const { autorizarLana, enviarWebhookLana } = (() => {
interface ResultadoWebhookLana {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

const ESPERAS_REINTENTO_MS = [2000, 4000, 8000];

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function variablesLana(): { url: string; secret: string } {
  const url = (Deno.env.get("LANA_WEBHOOK_URL") || "").trim();
  const secret = (Deno.env.get("LANA_WEBHOOK_SECRET") || "").trim();
  if (!url || !secret) throw new Error("Faltan LANA_WEBHOOK_URL o LANA_WEBHOOK_SECRET.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("LANA_WEBHOOK_URL debe usar HTTPS.");
  return { url: parsed.toString(), secret };
}

function autorizarLana(req: Request): boolean {
  const esperado = (Deno.env.get("LANA_WEBHOOK_SECRET") || "").trim();
  const recibido = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!esperado || !recibido || esperado.length !== recibido.length) return false;
  // Comparación de tiempo constante suficiente para secretos ASCII/UTF-8 cortos.
  const a = new TextEncoder().encode(esperado);
  const b = new TextEncoder().encode(recibido);
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

async function enviarWebhookLana(payload: Record<string, unknown>): Promise<ResultadoWebhookLana> {
  const { url, secret } = variablesLana();
  let ultimoError = "";
  let ultimoStatus: number | undefined;

  // Un intento inicial y hasta tres reintentos: 2 s, 4 s y 8 s.
  for (let intento = 0; intento <= ESPERAS_REINTENTO_MS.length; intento += 1) {
    if (intento > 0) await esperar(ESPERAS_REINTENTO_MS[intento - 1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${secret}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      ultimoStatus = respuesta.status;
      if (respuesta.ok) return { ok: true, attempts: intento + 1, status: respuesta.status };
      const detalle = (await respuesta.text().catch(() => "")).slice(0, 500);
      ultimoError = `LANA respondió ${respuesta.status}${detalle ? `: ${detalle}` : ""}`;
      // Un 4xx es definitivo: repetir credenciales o payload inválidos no ayuda.
      if (respuesta.status < 500) return { ok: false, attempts: intento + 1, status: respuesta.status, error: ultimoError };
    } catch (error) {
      ultimoError = error instanceof Error ? error.message : "Error de red enviando webhook.";
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, attempts: ESPERAS_REINTENTO_MS.length + 1, status: ultimoStatus, error: ultimoError };
}


return { autorizarLana, enviarWebhookLana };
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

// ── lana-webhook/index.ts ──
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  // requireUser conserva un fallback anónimo para funciones históricas; esta
  // integración nunca lo acepta porque expone datos de una cita concreta.
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
  const simulacionId = String(body.simulacion_id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(simulacionId)) {
    return json(400, { error: "simulacion_id inválido." });
  }

  const { data: caso, error: casoError } = await admin.from("camila_casos")
    .select("id,tenant_id,lana_cita_id,lana_origen,simulacion_url,notas_doctor")
    .eq("id", simulacionId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (casoError) return json(500, { error: "No se pudo consultar la simulación." });
  if (!caso) return json(404, { error: "No se encontró la simulación en esta clínica." });
  if (caso.lana_origen !== "lana" || !caso.lana_cita_id) return json(409, { error: "La simulación no está asociada a una cita de LANA." });

  const urlSolicitada = String(body.url_resultado || "").trim();
  let urlResultado: string;
  try {
    const parsed = new URL(urlSolicitada);
    const origenPeticion = new URL(req.headers.get("Origin") || "");
    // El enlace que LANA guardará debe pertenecer a la misma aplicación
    // web que originó la petición. Así un usuario autenticado no puede usar
    // esta función para introducir en LANA una URL externa controlada por él.
    if (parsed.protocol !== "https:" || origenPeticion.protocol !== "https:" || parsed.origin !== origenPeticion.origin) {
      throw new Error();
    }
    urlResultado = parsed.toString();
  } catch {
    return json(400, { error: "url_resultado debe ser HTTPS y pertenecer al origen de SMYL." });
  }
  const imagen = typeof caso.simulacion_url === "string" && /^https:\/\//i.test(caso.simulacion_url)
    ? caso.simulacion_url : null;
  const timestamp = new Date().toISOString();
  const payload = {
    evento: "simulacion_guardada",
    tenant_id: auth.tenantId,
    cita_id: Number(caso.lana_cita_id),
    simulacion_id: caso.id,
    url_resultado: urlResultado,
    url_imagen: imagen,
    notas: caso.notas_doctor || undefined,
    timestamp,
  };

  const resultado = await enviarWebhookLana(payload);
  await admin.from("camila_casos").update({
    lana_webhook_estado: resultado.ok ? "enviado" : "error",
    lana_webhook_intentos: resultado.attempts,
    lana_webhook_ultimo_error: resultado.ok ? null : resultado.error,
    lana_webhook_enviado_at: resultado.ok ? timestamp : null,
  }).eq("id", caso.id).eq("tenant_id", auth.tenantId);

  if (!resultado.ok) return json(502, { error: "LANA no confirmó el webhook.", attempts: resultado.attempts });
  return json(200, { ok: true, attempts: resultado.attempts });
});
