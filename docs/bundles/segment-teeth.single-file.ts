// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/segment-teeth/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
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

// ── _shared/request-safety.ts ──
const { constantTimeEqual, parseAllowedHostSuffixes, isAllowedRemoteUrl, isAllowedImageSource, MAX_REMOTE_IMAGE_BYTES, readBodyWithLimit } = (() => {
// Utilidades de seguridad para Edge Functions que reciben URLs o secretos del exterior.

// Comparación de secretos en tiempo (casi) constante: no se corta en el primer byte distinto.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // La longitud sí se compara, pero se recorre siempre el máximo para no filtrar dónde difieren.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Sufijos de host permitidos para descargar imágenes o llamar callbacks. Por defecto solo
// Supabase (Storage y Edge Functions); se pueden añadir hosts con una lista separada por comas.
function parseAllowedHostSuffixes(extra: string | null | undefined): string[] {
  const base = [".supabase.co"];
  const more = String(extra || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))
    .map((s) => (s.startsWith(".") ? s : "." + s));
  return Array.from(new Set([...base, ...more]));
}

// Solo https, sin credenciales, puerto estándar, nombre de host (no IP ni localhost) y dentro de la
// lista permitida. Evita que una función con service role haga peticiones a hosts internos (SSRF).
function isAllowedRemoteUrl(raw: unknown, suffixes: string[]): boolean {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  return suffixes.some((s) => host.endsWith(s) || host === s.slice(1));
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i;

// Una imagen de entrada puede venir como data URL de imagen o como https permitido.
function isAllowedImageSource(raw: unknown, suffixes: string[], maxDataChars = 34_000_000): boolean {
  if (typeof raw !== "string") return false;
  if (raw.startsWith("data:")) return raw.length <= maxDataChars && DATA_IMAGE_RE.test(raw);
  return isAllowedRemoteUrl(raw, suffixes);
}

const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

// Lee una respuesta con tope de tamaño (Content-Length y bytes reales) para no cargar archivos enormes.
async function readBodyWithLimit(res: Response, maxBytes = MAX_REMOTE_IMAGE_BYTES): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("La imagen es demasiado grande.");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("La imagen es demasiado grande.");
  return buf;
}

return { constantTimeEqual, parseAllowedHostSuffixes, isAllowedRemoteUrl, isAllowedImageSource, MAX_REMOTE_IMAGE_BYTES, readBodyWithLimit };
})();

// ── _shared/limits.ts ──
const { checkLimitSinConsumir, checkAndConsumeLimit, checkAndConsumeLimitProspecto, checkLimitPorIpProspecto } = (() => {
// Tope de gasto server-side para las Edge Functions que llaman APIs de
// pago (Anthropic, Gemini, Replicate). Antes el límite de plan
// (limite_diagnosticos/diagnosticos_usados) solo se checaba en el cliente
// -- cualquiera que llamara al Edge Function directo, sin pasar por la UI,
// generaba simulaciones sin ningún tope real. Ver migración
// camila_limits.sql para las funciones de Postgres que hacen el chequeo
// atómico (RPC, SECURITY DEFINER, solo invocables por el service_role).
//
// Mientras _shared/auth.ts siga aceptando llamadas sin sesión (pedido
// explícito del usuario), este módulo también aplica un tope duro por
// IP/hora a esas llamadas anónimas -- no reemplaza el login, solo evita
// que un link compartido genere gasto sin límite.


const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

// 20/hora ≈ 5 simulaciones por IP por hora. Estaba en 5, que sonaba a "5
// simulaciones" pero en realidad era ~1: una sola simulación hace ~4
// llamadas a la Edge Function (validar encuadre, analizar proporciones,
// diagnóstico, generar imagen), así que la segunda simulación de cada hora
// se bloqueaba con "Demasiadas solicitudes" -- y como ese error no era ni
// caída de red ni timeout, la pantalla lo mostraba como "problema de
// conexión", mandando a reintentar algo que solo se arregla esperando.
// Sigue siendo un techo real contra abuso; el gasto de un dentista con
// sesión no pasa por aquí, lo limita el cupo de su plan.
const ANON_LIMITE_POR_HORA = Number(Deno.env.get('ANON_HOURLY_LIMIT') || '20');
const ANON_VENTANA_SEG = 3600;

// Perilla aparte para el modo prospecto (paciente que entra por el link
// público de una clínica). Hoy vale lo mismo que el anónimo, pero se deja
// separada a propósito: son dos poblaciones distintas y probablemente
// haya que ajustar una sin tocar la otra -- un prospecto además está
// respaldado por el cupo del plan de SU clínica, un anónimo puro no.
const PROSPECTO_LIMITE_POR_HORA = Number(Deno.env.get('PROSPECTO_HOURLY_LIMIT') || '20');

interface LimitResult {
  allowed: boolean;
  response: Response | null;
}

function limitDeny(cors: Record<string, string>, status: number, msg: string): Response {
  const headers: Record<string, string> = { ...cors, 'Content-Type': 'application/json' };
  if (status === 429) headers['Retry-After'] = '60';
  return new Response(JSON.stringify({ error: msg }), { status, headers });
}

function ipDelRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'sin-ip';
}

const MENSAJES_TENANT: Record<string, string> = {
  tenant_no_encontrado: 'No se encontró tu cuenta de clínica.',
  plan_inactivo: 'Tu plan no está activo. Revisa tu suscripción.',
  plan_vencido: 'Tu plan venció. Renueva tu suscripción para seguir generando simulaciones.',
  limite_alcanzado: 'Alcanzaste el límite de diagnósticos de tu plan en este periodo.',
};

// Verifica que la clínica pueda seguir generando, SIN descontarle nada.
// Existe porque una sola simulación hace VARIAS llamadas a la Edge
// Function `claude` (validar encuadre + analizar proporciones + analizar
// fotos + generar imagen, más los reintentos automáticos de conReintento):
// si cada una descontara un "diagnóstico", un plan de 40 daría ~10
// simulaciones reales en vez de 40, que no es lo que el dentista compró ni
// lo que dice su plan. Solo la generación de imagen descuenta (ver
// claude/index.ts); el resto pasa por aquí.
async function checkLimitSinConsumir(
  tenantId: string | null,
  cors: Record<string, string>
): Promise<LimitResult> {
  if (!tenantId) return { allowed: true, response: null };

  const { data, error } = await admin
    .from('camila_tenants')
    .select('activo, vence_en, diagnosticos_usados, limite_diagnosticos')
    .eq('id', tenantId)
    .maybeSingle();

  // Falla de infraestructura ajena al usuario -- mismo criterio que el
  // resto de este archivo: no bloquear por eso, dejar rastro en los logs.
  if (error) {
    console.error('[limits] error verificando tenant:', error.message);
    return { allowed: true, response: null };
  }
  if (!data) return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT.tenant_no_encontrado) };
  if (!data.activo) return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT.plan_inactivo) };
  if (data.vence_en && new Date(data.vence_en as string) < new Date()) {
    return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT.plan_vencido) };
  }
  if ((data.diagnosticos_usados as number) >= (data.limite_diagnosticos as number)) {
    return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT.limite_alcanzado) };
  }
  return { allowed: true, response: null };
}

// Llamar UNA vez por request, antes de gastar en la API externa. Si
// allowed=false, response ya trae el error listo para devolver tal cual.
async function checkAndConsumeLimit(
  req: Request,
  tenantId: string | null, // el tenantId resuelto por requireUser() -- NUNCA user.id crudo, ver _shared/auth.ts
  cors: Record<string, string>
): Promise<LimitResult> {
  if (tenantId) {
    const { data, error } = await admin.rpc('camila_consumir_diagnostico', { p_tenant_id: tenantId });
    if (error) {
      // Falla de infraestructura ajena al usuario (RPC no desplegada,
      // conexión a la BD caída, etc.) -- no lo bloqueamos por eso, mejor
      // dejar pasar y que quede en los logs.
      console.error('[limits] error RPC camila_consumir_diagnostico:', error.message);
      return { allowed: true, response: null };
    }
    const fila = Array.isArray(data) ? data[0] : data;
    if (!fila?.permitido) {
      const motivo = fila?.motivo || 'limite_alcanzado';
      return { allowed: false, response: limitDeny(cors, 402, MENSAJES_TENANT[motivo] || MENSAJES_TENANT.limite_alcanzado) };
    }
    return { allowed: true, response: null };
  }

  // Sin sesión (acceso anónimo temporalmente permitido, ver auth.ts).
  return checkLimitPorIp(req, ANON_LIMITE_POR_HORA, cors);
}

async function checkLimitPorIp(
  req: Request,
  limitePorHora: number,
  cors: Record<string, string>
): Promise<LimitResult> {
  const ip = ipDelRequest(req);
  const { data, error } = await admin.rpc('camila_anon_rate_check', {
    p_ip: ip,
    p_limite: limitePorHora,
    p_ventana_seg: ANON_VENTANA_SEG,
  });
  if (error) {
    console.error('[limits] error RPC camila_anon_rate_check:', error.message);
    return { allowed: true, response: null };
  }
  if (!data) {
    return {
      allowed: false,
      response: limitDeny(cors, 429, 'Demasiadas solicitudes desde esta conexión. Intenta de nuevo en un rato.'),
    };
  }
  return { allowed: true, response: null };
}

// Camino especial para el modo "prospecto" de simulacion.html (paciente
// sin cuenta, entra por un link público con el tenant_id de la clínica en
// la URL, ver ?clinica=<id> y entrarComoProspecto()). A diferencia del
// resto de este archivo, aquí el tenant_id NO viene de una sesión
// verificada -- lo manda el cliente sin más prueba que "conoce el link
// público de esa clínica". Por eso se exigen los DOS controles, no uno
// solo: el tope real de la clínica (protege su cupo pagado, y de paso
// confirma que el tenant_id es real) Y el tope genérico por IP (protege
// contra que alguien intente drenar el cupo de una clínica ajena a punta
// de scripts, ahora que conoce su tenant_id).
async function checkAndConsumeLimitProspecto(
  req: Request,
  tenantIdCliente: string,
  cors: Record<string, string>
): Promise<LimitResult> {
  const porIp = await checkLimitPorIp(req, PROSPECTO_LIMITE_POR_HORA, cors);
  if (!porIp.allowed) return porIp;
  return checkAndConsumeLimit(req, tenantIdCliente, cors);
}

// Tope por IP para las llamadas de prospecto que NO descuentan del plan
// (los análisis previos a la imagen). Sin esto, alguien podría spamear
// análisis con Anthropic gratis usando el link público de una clínica sin
// tocar nunca su contador.
async function checkLimitPorIpProspecto(
  req: Request,
  cors: Record<string, string>
): Promise<LimitResult> {
  return checkLimitPorIp(req, PROSPECTO_LIMITE_POR_HORA, cors);
}

return { checkLimitSinConsumir, checkAndConsumeLimit, checkAndConsumeLimitProspecto, checkLimitPorIpProspecto };
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

// ── _shared/mask-utils.ts ──
const { calculateGptCanvas, calculateOutputSize, cropBitmapToSource, extractMaskComponents } = (() => {
interface MaskComponent {
  bbox: [number, number, number, number];
  pixelCount: number;
  fileData: Uint8Array;
  contentType: "image/svg+xml";
  fileExtension: "svg";
}

interface OutputSize {
  width: number;
  height: number;
  value: string;
}

interface GptCanvas {
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
  padded: boolean;
}

interface CroppedBitmap {
  width: number;
  height: number;
  bitmap: Uint8Array;
}

const MIN_OUTPUT_PIXELS = 655_360;
const MAX_OUTPUT_PIXELS = 8_294_400;
const MAX_OUTPUT_EDGE = 3_840;

function multipleOf16(value: number): number {
  return Math.max(16, Math.ceil(value / 16) * 16);
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Dimensiones de imagen inválidas.");
  }
}

// Los recortes clínicos pueden ser panorámicos, especialmente cuando se
// comparan original y propuesta lado a lado. En vez de deformarlos o
// recortarlos, se centran sobre un lienzo negro con relación máxima 3:1.
function calculateGptCanvas(sourceWidth: number, sourceHeight: number): GptCanvas {
  assertDimensions(sourceWidth, sourceHeight);
  const width = Math.round(sourceWidth);
  const height = Math.round(sourceHeight);
  let canvasWidth = width;
  let canvasHeight = height;

  if (width / height > 3) canvasHeight = Math.ceil(width / 3);
  if (height / width > 3) canvasWidth = Math.ceil(height / 3);

  return {
    width: canvasWidth,
    height: canvasHeight,
    sourceX: Math.floor((canvasWidth - width) / 2),
    sourceY: Math.floor((canvasHeight - height) / 2),
    padded: canvasWidth !== width || canvasHeight !== height,
  };
}

// GPT Image 2 admite tamaños flexibles, pero exige múltiplos de 16, un
// mínimo de píxeles y una relación máxima 3:1. La app ya manda un recorte de
// sonrisa; sólo se escala el lienzo de salida, nunca se recorta ni deforma.
function calculateOutputSize(sourceWidth: number, sourceHeight: number): OutputSize {
  assertDimensions(sourceWidth, sourceHeight);
  const ratio = sourceWidth / sourceHeight;
  if (ratio > 3 || ratio < 1 / 3) {
    throw new Error("El recorte dental excede la relación 3:1 admitida por GPT Image.");
  }

  let scale = Math.max(1, Math.sqrt(MIN_OUTPUT_PIXELS / (sourceWidth * sourceHeight)));
  let width = multipleOf16(sourceWidth * scale);
  let height = multipleOf16(sourceHeight * scale);

  if (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE || width * height > MAX_OUTPUT_PIXELS) {
    scale = Math.min(
      MAX_OUTPUT_EDGE / sourceWidth,
      MAX_OUTPUT_EDGE / sourceHeight,
      Math.sqrt(MAX_OUTPUT_PIXELS / (sourceWidth * sourceHeight)),
    );
    width = Math.max(16, Math.floor(sourceWidth * scale / 16) * 16);
    height = Math.max(16, Math.floor(sourceHeight * scale / 16) * 16);
  }

  return { width, height, value: `${width}x${height}` };
}

// Recorta del bitmap devuelto por GPT el margen agregado antes de enviarlo.
// El cálculo usa proporciones porque GPT puede devolver una resolución distinta
// a la del lienzo de entrada, pero conserva el mismo sistema de coordenadas.
function cropBitmapToSource(
  bitmapWidth: number,
  bitmapHeight: number,
  bitmap: Uint8Array,
  inputWidth: number,
  inputHeight: number,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): CroppedBitmap {
  assertDimensions(bitmapWidth, bitmapHeight);
  assertDimensions(inputWidth, inputHeight);
  assertDimensions(sourceWidth, sourceHeight);
  if (bitmap.byteLength !== bitmapWidth * bitmapHeight * 4) {
    throw new Error("La máscara GPT tiene un tamaño de bitmap inválido.");
  }

  const scaleX = bitmapWidth / inputWidth;
  const scaleY = bitmapHeight / inputHeight;
  const left = Math.max(0, Math.min(bitmapWidth - 1, Math.round(sourceX * scaleX)));
  const top = Math.max(0, Math.min(bitmapHeight - 1, Math.round(sourceY * scaleY)));
  const right = Math.max(left + 1, Math.min(bitmapWidth, Math.round((sourceX + sourceWidth) * scaleX)));
  const bottom = Math.max(top + 1, Math.min(bitmapHeight, Math.round((sourceY + sourceHeight) * scaleY)));
  const width = right - left;
  const height = bottom - top;
  const cropped = new Uint8Array(width * height * 4);

  for (let row = 0; row < height; row++) {
    const sourceStart = ((top + row) * bitmapWidth + left) * 4;
    const sourceEnd = sourceStart + width * 4;
    cropped.set(bitmap.subarray(sourceStart, sourceEnd), row * width * 4);
  }

  return { width, height, bitmap: cropped };
}

function componentSvg(width: number, height: number, pixels: number[]): Uint8Array {
  pixels.sort((a, b) => a - b);
  let path = "";
  let cursor = 0;
  while (cursor < pixels.length) {
    const first = pixels[cursor];
    const y = Math.floor(first / width);
    const startX = first - y * width;
    let endX = startX;
    cursor++;
    while (cursor < pixels.length) {
      const next = pixels[cursor];
      const nextY = Math.floor(next / width);
      const nextX = next - nextY * width;
      if (nextY !== y || nextX !== endX + 1) break;
      endX = nextX;
      cursor++;
    }
    const runWidth = endX - startX + 1;
    path += `M${startX} ${y}h${runWidth}v1h-${runWidth}z`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">` +
    `<path fill="#fff" d="${path}"/></svg>`;
  return new TextEncoder().encode(svg);
}

function isForeground(bitmap: Uint8Array, offset: number): boolean {
  const red = bitmap[offset];
  const green = bitmap[offset + 1];
  const blue = bitmap[offset + 2];
  const alpha = bitmap[offset + 3];
  if (alpha < 72) return false;
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  // El prompt pide blanco puro sobre negro. Esta tolerancia conserva el
  // antialias de los bordes, pero excluye fondos, sombras y colores espurios.
  return luminance >= 150 && minimum >= 118 && maximum - minimum <= 90;
}

function extractMaskComponents(
  width: number,
  height: number,
  bitmap: Uint8Array,
  sourceWidth = width,
  sourceHeight = height,
): MaskComponent[] {
  if (bitmap.byteLength !== width * height * 4) {
    throw new Error("La máscara GPT tiene un tamaño de bitmap inválido.");
  }

  const foreground = new Uint8Array(width * height);
  let foregroundCount = 0;
  for (let index = 0; index < foreground.length; index++) {
    if (!isForeground(bitmap, index * 4)) continue;
    foreground[index] = 1;
    foregroundCount++;
  }

  const coverage = foregroundCount / foreground.length;
  if (coverage < 0.0004 || coverage > 0.24) {
    throw new Error("GPT devolvió una máscara dental con cobertura inválida.");
  }

  const visited = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  const minimumArea = Math.max(40, Math.round(foreground.length * 0.000035));
  const rawComponents: Array<{ pixels: number[]; bbox: [number, number, number, number] }> = [];

  for (let seed = 0; seed < foreground.length; seed++) {
    if (!foreground[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const current = queue[head++];
      pixels.push(current);
      const y = Math.floor(current / width);
      const x = current - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const left = current - 1;
      const right = current + 1;
      const up = current - width;
      const down = current + width;
      if (x > 0 && foreground[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x + 1 < width && foreground[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0 && foreground[up] && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      if (y + 1 < height && foreground[down] && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
    }

    if (pixels.length < minimumArea) continue;
    rawComponents.push({ pixels, bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1] });
  }

  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  return rawComponents
    .sort((a, b) => b.pixels.length - a.pixels.length)
    .slice(0, 64)
    .map((component) => ({
      bbox: [
        component.bbox[0] * scaleX,
        component.bbox[1] * scaleY,
        component.bbox[2] * scaleX,
        component.bbox[3] * scaleY,
      ] as [number, number, number, number],
      pixelCount: component.pixels.length,
      fileData: componentSvg(width, height, component.pixels),
      contentType: "image/svg+xml" as const,
      fileExtension: "svg" as const,
    }));
}

return { calculateGptCanvas, calculateOutputSize, cropBitmapToSource, extractMaskComponents };
})();

// ── segment-teeth/index.ts ──
// supabase/functions/segment-teeth/index.ts
//
// VERSIÓN 9 -- GPT Image 2 reemplaza al SAM 3 generalista de Replicate.
// GPT produce una máscara binaria alineada con el recorte; esta función la
// convierte de forma determinista en componentes individuales, calcula cajas,
// conserva la notación FDI y publica exactamente el mismo contrato `masks` que
// ya consumen la simulación pública y el editor clínico.
//
// Uso:
//   { imageUrl, casoId, tenantId, target: "tooth" }  <- default, como antes
//   { imageUrl, casoId, tenantId, target: "gum" }    <- encía visible
//   { imageUrl, casoId, tenantId, target: "treatment" } <- dientes maxilares + encía asociada
//
// Para "gum" NO se asigna notación FDI (no aplica), solo se numeran por
// índice y se guardan en una columna separada (segmentacion_encia) para
// no pisar la segmentación de dientes ya guardada.


const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_SEGMENTATION_MODEL =
  Deno.env.get("OPENAI_SEGMENTATION_MODEL") || "gpt-image-2-2026-04-21";
const configuredQuality = (Deno.env.get("OPENAI_SEGMENTATION_QUALITY") || "medium").toLowerCase();
const OPENAI_SEGMENTATION_QUALITY = ["low", "medium", "high"].includes(configuredQuality)
  ? configuredQuality
  : "medium";
const configuredTimeout = Number(Deno.env.get("OPENAI_SEGMENTATION_TIMEOUT_MS") || "120000");
const OPENAI_SEGMENTATION_TIMEOUT_MS = Number.isFinite(configuredTimeout)
  ? Math.max(30_000, Math.min(150_000, configuredTimeout))
  : 120_000;
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola en toda
// Edge Function; SB_URL / SB_SERVICE_ROLE_KEY son secrets manuales que
// existían en el proyecto viejo (el prefijo SUPABASE_ está reservado y no se
// puede definir a mano). Este archivo leía SOLO los manuales, que nunca se
// configuraron en el proyecto "Smyl" -- createClient recibía cadenas vacías
// y reventaba con "supabaseUrl is required" en cada llamada. No se notó
// antes porque hasta hace poco nada del flujo normal llamaba a esta función;
// ahora la composición de la simulación la usa en cada caso.
// Mismo orden de preferencia que _shared/auth.ts y _shared/limits.ts.
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const STORAGE_BUCKET = "camila-masks";

const IOU_THRESHOLD = 0.3;

type Target = "tooth" | "gum" | "treatment";

interface Candidate {
  bbox: [number, number, number, number];
  pixelCount: number;
  fileData: Uint8Array;
  contentType: "image/svg+xml";
  fileExtension: "svg";
}

interface RegionMask {
  index: number;
  bbox: [number, number, number, number];
  pixelCount: number;
  maskUrl: string;
  maskPath: string;
  fdi: string | null;       // null siempre para "gum"
  parentFdi: string | null; // null siempre para "gum"
}

function promptParaTarget(target: Target): string {
  if (target === "treatment") {
    return [
      "Create a pixel-aligned binary semantic segmentation mask of ONLY the visible MAXILLARY teeth and the directly associated visible upper gingiva in the supplied smile photograph.",
      "This is a strict dental treatment edit region, not a mouth or face mask.",
      "Keep exactly the same canvas, crop, scale, perspective and position as the input.",
      "Output pure white (#FFFFFF) on every visible upper tooth crown and on visible upper gingiva immediately surrounding those teeth, including natural papillae and gingival margins.",
      "Output pure black (#000000) on lower teeth, lower gingiva, lips, tongue, oral cavity, skin, facial hair, nose, shadows, background and every other structure.",
      "Never include the upper or lower lip, even where its pink color resembles gingiva. Never include mandibular teeth or tissue.",
      "Do not invent, enlarge, straighten or reshape any structure. Do not create a smile design.",
      "Use flat solid fills: no texture, gradients, antialias haze, outlines, labels, symbols or explanatory text.",
    ].join(" ");
  }
  if (target === "gum") {
    return [
      "Create a pixel-aligned binary semantic segmentation mask of the visible gingiva in the supplied dental photograph.",
      "Keep exactly the same canvas, crop, scale, perspective and position as the input.",
      "Black padding may surround the photograph; keep that padding pure black and never segment it.",
      "Output pure white (#FFFFFF) only where visible pink gingival tissue exists and pure black (#000000) everywhere else.",
      "Exclude teeth, lips, tongue, skin, shadows, instruments and background.",
      "Use flat solid fills: no texture, gradients, antialias haze, outlines, labels, symbols or explanatory text.",
    ].join(" ");
  }
  return [
    "Create a pixel-aligned binary instance-style segmentation mask of every visible human tooth in the supplied dental photograph.",
    "If the image contains two side-by-side panels, preserve both panels exactly and segment each panel independently without moving or merging them across the center seam.",
    "Keep exactly the same canvas, crop, scale, perspective and tooth positions as the input.",
    "Black padding may surround the photograph; keep that padding pure black and never segment it.",
    "Output pure white (#FFFFFF) only on visible dental crown/enamel surfaces and pure black (#000000) everywhere else.",
    "Exclude gingiva, lips, tongue, skin, oral cavity, shadows, braces, instruments and background.",
    "Keep each visible tooth as an individually separated white component with a narrow black interproximal boundary at real tooth contacts.",
    "Do not invent, enlarge, straighten or reshape any tooth. Do not create a smile design.",
    "Use flat solid fills: no texture, gradients, colored regions, outlines, labels, symbols or explanatory text.",
  ].join(" ");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// Hosts desde los que se acepta descargar la imagen de entrada (por defecto solo Supabase Storage);
// se pueden añadir más con SEGMENT_TEETH_ALLOWED_HOSTS (lista separada por comas).
const SUFIJOS_IMAGEN_PERMITIDOS = parseAllowedHostSuffixes(Deno.env.get("SEGMENT_TEETH_ALLOWED_HOSTS"));
const UUID_CASO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadSourceImage(imageUrl: string) {
  let bytes: Uint8Array;
  let mimeType = "image/jpeg";
  const dataMatch = imageUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s);
  if (dataMatch) {
    mimeType = dataMatch[1] || mimeType;
    bytes = base64ToBytes(dataMatch[2]);
  } else {
    // Sin redirecciones (un 3xx podría llevar a un host interno) y con tope de tamaño.
    const response = await fetch(imageUrl, { redirect: "error" });
    if (!response.ok) throw new Error(`No se pudo leer la imagen dental (${response.status}).`);
    mimeType = (response.headers.get("content-type") || mimeType).split(";")[0];
    bytes = await readBodyWithLimit(response);
  }
  if (!mimeType.startsWith("image/") || !bytes.byteLength) {
    throw new Error("La entrada de segmentación no es una imagen válida.");
  }
  const decoded = await decodeImage(bytes);
  return { bytes, mimeType, width: decoded.width, height: decoded.height, decoded };
}

interface GptMaskResult {
  bytes: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  sourceX: number;
  sourceY: number;
  padded: boolean;
  usage: unknown;
  providerRequestId: string | null;
  partialCount: number;
}

async function callOpenAIMask(
  imageUrl: string,
  target: Target,
  requestId: string,
  onProgress: (payload: Record<string, unknown>) => void,
): Promise<GptMaskResult> {
  const source = await loadSourceImage(imageUrl);
  const canvas = calculateGptCanvas(source.width, source.height);
  let inputBytes = source.bytes;
  let inputMimeType = source.mimeType;
  if (canvas.padded) {
    const paddedImage = new Image(canvas.width, canvas.height);
    paddedImage.fill(0x000000ff);
    paddedImage.composite(source.decoded, canvas.sourceX, canvas.sourceY);
    inputBytes = await paddedImage.encode(1);
    inputMimeType = "image/png";
  }
  const outputSize = calculateOutputSize(canvas.width, canvas.height);
  const form = new FormData();
  form.append("model", OPENAI_SEGMENTATION_MODEL);
  form.append(
    "image[]",
    new Blob([inputBytes], { type: inputMimeType }),
    inputMimeType === "image/png" ? "dental-input.png" : "dental-input.jpg",
  );
  form.append("prompt", promptParaTarget(target));
  form.append("quality", OPENAI_SEGMENTATION_QUALITY);
  form.append("size", outputSize.value);
  form.append("output_format", "png");
  form.append("background", "opaque");
  form.append("stream", "true");
  form.append("partial_images", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_SEGMENTATION_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        Accept: "text/event-stream",
        "X-Client-Request-Id": requestId,
      },
      body: form,
      signal: controller.signal,
    });
    const providerRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw;
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch { /* respuesta no JSON */ }
      throw new Error(`OpenAI segmentation error ${response.status}: ${detail || "sin detalle"}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    let finalBase64 = "";
    let usage: unknown = null;
    let partialCount = 0;

    if (!contentType.includes("text/event-stream")) {
      const data = await response.json();
      finalBase64 = data?.data?.[0]?.b64_json || "";
      usage = data?.usage || null;
    } else if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const processBlock = (block: string) => {
        const dataText = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!dataText || dataText === "[DONE]") return;
        let event: any;
        try { event = JSON.parse(dataText); } catch { return; }
        if (event?.type === "image_edit.partial_image") {
          partialCount++;
          onProgress({
            event: "gpt_segmentation_progress",
            requestId,
            partialCount,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } else if (event?.type === "image_edit.completed") {
          finalBase64 = event?.b64_json || finalBase64;
          usage = event?.usage || usage;
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let separator: RegExpExecArray | null;
        while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const block = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          processBlock(block);
        }
        if (done) break;
      }
      if (buffer.trim()) processBlock(buffer);
    }

    if (!finalBase64) throw new Error("OpenAI terminó la segmentación sin entregar una máscara final.");
    const bytes = base64ToBytes(finalBase64);
    const decoded = await decodeImage(bytes);
    console.log(JSON.stringify({
      event: "gpt_segmentation_success",
      requestId,
      target,
      model: OPENAI_SEGMENTATION_MODEL,
      quality: OPENAI_SEGMENTATION_QUALITY,
      sourceSize: `${source.width}x${source.height}`,
      inputCanvas: `${canvas.width}x${canvas.height}`,
      padded: canvas.padded,
      outputSize: `${decoded.width}x${decoded.height}`,
      partialCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      usage,
      providerRequestId,
    }));
    return {
      bytes,
      maskWidth: decoded.width,
      maskHeight: decoded.height,
      sourceWidth: source.width,
      sourceHeight: source.height,
      inputWidth: canvas.width,
      inputHeight: canvas.height,
      sourceX: canvas.sourceX,
      sourceY: canvas.sourceY,
      padded: canvas.padded,
      usage,
      providerRequestId,
      partialCount,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function computeIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const interX1 = Math.max(ax, bx), interY1 = Math.max(ay, by);
  const interX2 = Math.min(ax + aw, bx + bw), interY2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, interX2 - interX1), interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;
  const unionArea = aw * ah + bw * bh - interArea;
  return unionArea === 0 ? 0 : interArea / unionArea;
}

// Nota: para "gum" esto casi no elimina nada -- las 9 islas de encía
// normalmente no se traslapan entre sí (son regiones separadas por los
// dientes), así que sobreviven todas. Es seguro reutilizar la misma
// función para ambos casos.
function applyNMS(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.pixelCount - a.pixelCount);
  const kept: Candidate[] = [];
  for (const cand of sorted) {
    if (!kept.some((k) => computeIoU(cand.bbox, k.bbox) > IOU_THRESHOLD)) kept.push(cand);
  }
  return kept;
}

// Descarta detecciones que probablemente son VARIOS dientes fusionados en
// una sola caja (el modelo a veces no separa bien dientes muy juntos).
// Se detecta comparando el ancho contra la mediana de los demás -- un
// diente real no debería ser 2x+ más ancho que el resto. SOLO aplica a
// "tooth" -- la encía es naturalmente irregular y grande, no se filtra.
//
// AJUSTE v8: la mediana de ancho se calcula SOLO entre candidatos de
// tamaño "normal" (por encima de la mediana de píxeles), no entre TODOS.
// Antes, cuando había muchos fragmentos chiquitos de ruido, esos bajaban
// la mediana de ancho artificialmente y terminaban descartando dientes
// completos y normales por "parecer" demasiado anchos en la comparación.
function filtrarBlobsFusionados(candidates: Candidate[]): Candidate[] {
  if (candidates.length < 3) return candidates; // muy pocos datos para juzgar

  const pixelCounts = candidates.map((c) => c.pixelCount).sort((a, b) => a - b);
  const medianaPixeles = pixelCounts[Math.floor(pixelCounts.length / 2)];
  const referencia = candidates.filter((c) => c.pixelCount >= medianaPixeles);
  const anchosReferencia = referencia.map((c) => c.bbox[2]).sort((a, b) => a - b);
  if (anchosReferencia.length < 2) return candidates;

  const medianaAncho = anchosReferencia[Math.floor(anchosReferencia.length / 2)];
  const LIMITE = 2.2; // qué tanto más ancho que la mediana se tolera

  return candidates.filter((c) => c.bbox[2] <= medianaAncho * LIMITE);
}

// --- Mapeo FDI: SOLO se aplica cuando target === "tooth" ---
function assignFdiNotation(survivors: Candidate[]) {
  const width = Math.max(...survivors.map((m) => m.bbox[0] + m.bbox[2])) + 20;
  const midlineX = width / 2;

  const withCenters = survivors.map((m) => ({
    ...m,
    cx: m.bbox[0] + m.bbox[2] / 2,
    cy: m.bbox[1] + m.bbox[3] / 2,
    fdi: null as string | null,
    parentFdi: null as string | null,
  }));

  const sortedByY = [...withCenters].sort((a, b) => a.cy - b.cy);
  let maxGap = 0, splitAt = 0;
  for (let i = 1; i < sortedByY.length; i++) {
    const gap = sortedByY[i].cy - sortedByY[i - 1].cy;
    if (gap > maxGap) { maxGap = gap; splitAt = i; }
  }
  const upperRow = sortedByY.slice(0, splitAt);
  const lowerRow = sortedByY.slice(splitAt);

  // AJUSTE v8: antes se usaba un umbral FIJO (PRIMARY_PIXEL_THRESHOLD =
  // 450px) para decidir "diente principal" vs "fragmento" -- no se
  // adaptaba a fotos donde los dientes salen más chicos o más grandes en
  // píxeles (según el encuadre/distancia), así que dientes completos y
  // reales podían quedar mal clasificados como fragmentos. Ahora el
  // umbral es RELATIVO al tamaño típico de blob en ESTA fila de ESTA foto.
  function numberRow(row: typeof withCenters, quadRight: number, quadLeft: number) {
    const pixelCounts = row.map((m) => m.pixelCount).sort((a, b) => a - b);
    const medianaFila = pixelCounts.length ? pixelCounts[Math.floor(pixelCounts.length / 2)] : 0;
    const umbralPrimario = Math.max(80, medianaFila * 0.4);

    const primary = row.filter((m) => m.pixelCount >= umbralPrimario);
    const fragments = row.filter((m) => m.pixelCount < umbralPrimario);

    const right = primary.filter((m) => m.cx < midlineX).sort((a, b) => (midlineX - a.cx) - (midlineX - b.cx));
    const left = primary.filter((m) => m.cx >= midlineX).sort((a, b) => (a.cx - midlineX) - (b.cx - midlineX));

    right.forEach((m, i) => (m.fdi = `${quadRight}${i + 1}`));
    left.forEach((m, i) => (m.fdi = `${quadLeft}${i + 1}`));

    fragments.forEach((f) => {
      let nearest: typeof primary[0] | null = null;
      let minDist = Infinity;
      primary.forEach((p) => {
        const d = Math.hypot(f.cx - p.cx, f.cy - p.cy);
        if (d < minDist) { minDist = d; nearest = p; }
      });
      f.parentFdi = nearest ? (nearest as any).fdi : null;
    });

    return [...primary, ...fragments];
  }

  const upperResult = numberRow(upperRow, 1, 2);
  const lowerResult = numberRow(lowerRow, 4, 3);

  return [...upperResult, ...lowerResult];
}

// Para regiones continuas (encía o tratamiento) no hay FDI: se ordenan de
// izquierda a derecha sin aplicar lógica de piezas dentales.
function tagAsRegion(survivors: Candidate[]) {
  const sorted = [...survivors].sort((a, b) => a.bbox[0] - b.bbox[0]);
  return sorted.map((m) => ({ ...m, fdi: null as string | null, parentFdi: null as string | null }));
}

async function uploadAll(
  taggedMasks: Array<Candidate & { fdi: string | null; parentFdi: string | null }>,
  supabase: ReturnType<typeof createClient>,
  casoId: string,
  target: Target
): Promise<RegionMask[]> {
  const folder = casoId || `sin-caso-${Date.now()}`;
  const prefix = target === "gum" ? "gum_mask" : target === "treatment" ? "treatment_mask" : "mask";
  const masks: RegionMask[] = [];

  for (let i = 0; i < taggedMasks.length; i++) {
    const cand = taggedMasks[i];
    const path = `${folder}/${prefix}_${i}.${cand.fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, cand.fileData, { contentType: cand.contentType, upsert: true });

    if (uploadError) {
      console.error(`Error subiendo ${path}:`, uploadError);
      continue;
    }

    // El bucket es privado -- esta función corre con el service role (se
    // salta RLS), así que puede firmar la URL aunque el cliente que la
    // recibe no tenga permiso directo sobre el objeto.
    const { data: signedUrlData, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 60 * 5);
    if (signError) {
      console.error(`Error firmando ${path}:`, signError);
      continue;
    }

    masks.push({
      index: i,
      bbox: cand.bbox,
      pixelCount: cand.pixelCount,
      maskUrl: signedUrlData.signedUrl,
      maskPath: path,
      fdi: cand.fdi,
      parentFdi: cand.parentFdi,
    });
  }

  return masks;
}

serve(async (req) => {
  const corsHeaders = { ...makeCors(req), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Falta de configuración, no del usuario: sin esto el fallo salía como
  // "supabaseUrl is required" o como un error crudo del proveedor a media
  // simulación, imposible de diagnosticar desde el celular de la doctora.
  const faltantes: string[] = [];
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) faltantes.push("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  if (!OPENAI_API_KEY) faltantes.push("OPENAI_API_KEY");
  if (faltantes.length) {
    console.error("[segment-teeth] faltan secrets:", faltantes.join(", "));
    return new Response(
      JSON.stringify({ error: "La segmentación no está configurada en el servidor (falta " + faltantes.join(" y ") + "). Avisa a soporte." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Esta función gasta créditos de GPT Image y escribe en camila_casos con el
  // service role (que se salta RLS). Sin esta verificación aceptaba cualquier
  // POST sin credenciales.
  const { user, tenantId: tenantIdSesion, response: authError } = await requireUser(req, corsHeaders);
  if (authError) return authError;

  // La segmentación es un paso interno de UNA simulación. La generación
  // principal ya descuenta esa simulación del plan; volver a descontar por
  // cada máscara haría que un solo resultado consumiera tres usos. Aquí se
  // valida que el plan tenga cupo y se conserva el límite por IP, sin sumar
  // otro uso clínico. Un anónimo sin tenant mantiene el control estricto.
  const tenantHeaderProspecto = user ? null : req.headers.get("x-tenant-id");
  let limitCheck;
  if (tenantHeaderProspecto) {
    const porIp = await checkLimitPorIpProspecto(req, corsHeaders);
    limitCheck = porIp.allowed
      ? await checkLimitSinConsumir(tenantHeaderProspecto, corsHeaders)
      : porIp;
  } else if (!user) {
    limitCheck = await checkAndConsumeLimit(req, null, corsHeaders);
  } else {
    limitCheck = await checkLimitSinConsumir(tenantIdSesion, corsHeaders);
  }
  const { allowed, response: limitError } = limitCheck;
  if (!allowed) return limitError!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "El cuerpo de segmentación no es JSON válido." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { imageUrl, casoId, tenantId: tenantIdBody, target: targetRaw } = body || {};
  const target: Target = targetRaw === "gum" || targetRaw === "treatment" ? targetRaw : "tooth";
  if (!imageUrl) {
    return new Response(JSON.stringify({ error: "imageUrl es requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // requireUser ya garantiza que hay una sesión real llegados a este punto.
  // tenantIdSesion mantiene unidos los casos creados por dueño y staff.
  const tenantId = tenantIdSesion || tenantIdBody || null;

  // La imagen solo puede venir como data URL de imagen o como https de un host permitido
  // (esta función corre con service role: no debe poder pedirle URLs internas).
  if (!isAllowedImageSource(imageUrl, SUFIJOS_IMAGEN_PERMITIDOS)) {
    return new Response(JSON.stringify({ error: "imageUrl no es una imagen permitida." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Las máscaras se guardan en camila-masks/<casoId>/ con service role y upsert: el caso no puede ser
  // de otra clínica (ni, para un prospecto anónimo, un caso real de la clínica) o se pisarían sus máscaras.
  if (casoId !== undefined && casoId !== null && casoId !== "") {
    if (typeof casoId !== "string" || !UUID_CASO_RE.test(casoId)) {
      return new Response(JSON.stringify({ error: "casoId inválido." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: casoExistente, error: casoExistenteError } = await createClient(SB_URL, SB_SERVICE_ROLE_KEY)
      .from("camila_casos")
      .select("tenant_id, es_prospecto")
      .eq("id", casoId)
      .maybeSingle();
    if (casoExistenteError) {
      return new Response(JSON.stringify({ error: "No se pudo verificar el caso. Intenta de nuevo." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ajeno = casoExistente && casoExistente.tenant_id !== tenantId;
    const realParaAnonimo = casoExistente && !user && casoExistente.es_prospecto !== true;
    if (ajeno || realParaAnonimo) {
      return new Response(JSON.stringify({ error: "Ese caso no está disponible para esta solicitud." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  const requestId = typeof body?.requestId === "string" && body.requestId.trim()
    ? body.requestId.trim().slice(0, 120)
    : crypto.randomUUID();
  const encoder = new TextEncoder();
  let clienteCerro = false;

  const responseStream = new ReadableStream<Uint8Array>({
    start(output) {
      // El espacio inicial y los keepalives posteriores son JSON válido como
      // whitespace. resp.json()/JSON.parse siguen funcionando, pero Safari ya
      // no mantiene una conexión completamente ociosa mientras GPT procesa.
      output.enqueue(encoder.encode(" \n"));
      const heartbeat = setInterval(() => {
        if (!clienteCerro) {
          try { output.enqueue(encoder.encode(" \n")); } catch { /* conexión cerrada */ }
        }
      }, 8_000);

      const work = (async () => {
        try {
          console.log(JSON.stringify({
            event: "gpt_segmentation_attempt",
            requestId,
            target,
            model: OPENAI_SEGMENTATION_MODEL,
            quality: OPENAI_SEGMENTATION_QUALITY,
          }));
          const gptMask = await callOpenAIMask(imageUrl, target, requestId, (progress) => {
            console.log(JSON.stringify(progress));
            if (!clienteCerro) {
              try { output.enqueue(encoder.encode(" \n")); } catch { /* conexión cerrada */ }
            }
          });
          const decodedMask = await decodeImage(gptMask.bytes);
          const sourceMask = cropBitmapToSource(
            gptMask.maskWidth,
            gptMask.maskHeight,
            decodedMask.bitmap,
            gptMask.inputWidth,
            gptMask.inputHeight,
            gptMask.sourceX,
            gptMask.sourceY,
            gptMask.sourceWidth,
            gptMask.sourceHeight,
          );
          const allCandidates = extractMaskComponents(
            sourceMask.width,
            sourceMask.height,
            sourceMask.bitmap,
            gptMask.sourceWidth,
            gptMask.sourceHeight,
          ) as Candidate[];
          if (!allCandidates.length) {
            throw new Error("GPT no separó ningún componente dental utilizable.");
          }

          const survivors = applyNMS(allCandidates);
          const survivorsFiltrados = target === "tooth" ? filtrarBlobsFusionados(survivors) : survivors;
          if (!survivorsFiltrados.length) {
            throw new Error("GPT no dejó componentes dentales válidos después del control geométrico.");
          }
          const tagged = target === "tooth" ? assignFdiNotation(survivorsFiltrados) : tagAsRegion(survivorsFiltrados);
          const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
          const masks = await uploadAll(tagged, supabase, casoId, target);
          if (masks.length !== tagged.length) {
            throw new Error("No fue posible publicar todas las máscaras dentales generadas.");
          }

          // La región de tratamiento es efímera y sólo protege una generación;
          // no sustituye las segmentaciones clínicas persistentes del caso.
          if (casoId && tenantId && target !== "treatment") {
            const columnaDestino = target === "gum" ? "segmentacion_encia" : "segmentacion";
            const { error: dbError } = await supabase
              .from("camila_casos")
              .update({
                [columnaDestino]: {
                  masks,
                  generatedAt: new Date().toISOString(),
                  provider: "openai",
                  model: OPENAI_SEGMENTATION_MODEL,
                },
              })
              .eq("id", casoId)
              .eq("tenant_id", tenantId);
            if (dbError) console.error(`Error guardando segmentación (${target}):`, dbError);
          }

          const payload = {
            requestId,
            target,
            masks,
            count: masks.length,
            totalDetectedBeforeNMS: allCandidates.length,
            provider: "openai",
            model: OPENAI_SEGMENTATION_MODEL,
            quality: OPENAI_SEGMENTATION_QUALITY,
            providerRequestId: gptMask.providerRequestId,
          };
          console.log(JSON.stringify({
            event: "gpt_segmentation_delivery",
            requestId,
            target,
            count: masks.length,
            totalDetectedBeforeNMS: allCandidates.length,
          }));
          if (!clienteCerro) output.enqueue(encoder.encode(JSON.stringify(payload)));
        } catch (err) {
          console.error(`[segment-teeth] ${requestId} error procesando la segmentación GPT:`, err);
          const message = (err as Error)?.name === "AbortError"
            ? "La segmentación dental con GPT tardó más del límite permitido."
            : "La segmentación dental con GPT no produjo una máscara utilizable. Intenta nuevamente sin repetir tus fotografías.";
          if (!clienteCerro) {
            try {
              output.enqueue(encoder.encode(JSON.stringify({
                error: message,
                errorCode: "GPT_SEGMENTATION_FAILED",
                requestId,
              })));
            } catch { /* conexión cerrada */ }
          }
        } finally {
          clearInterval(heartbeat);
          if (!clienteCerro) {
            try { output.close(); } catch { /* conexión cerrada */ }
          }
        }
      })();

      (globalThis as any).EdgeRuntime?.waitUntil?.(work);
    },
    cancel() {
      clienteCerro = true;
    },
  });

  return new Response(responseStream, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Access-Control-Expose-Headers": "x-smyl-request-id, x-smyl-provider, x-smyl-model",
      "X-SMYL-Request-Id": requestId,
      "X-SMYL-Provider": "openai",
      "X-SMYL-Model": OPENAI_SEGMENTATION_MODEL,
    },
  });
});
