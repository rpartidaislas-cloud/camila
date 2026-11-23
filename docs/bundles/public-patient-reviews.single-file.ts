// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/public-patient-reviews/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/limits.ts ──
const { ipDelRequest, checkLimitSinConsumir, checkAndConsumeLimit, checkAndConsumeLimitProspecto, checkLimitPorIpProspecto } = (() => {
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

// La IP para los topes sale de la cabecera que pone el borde de Cloudflare (el cliente no puede sobrescribirla). x-forwarded-for puede traer
// valores escritos por el propio cliente, así que solo se usa si no hay otra; antes iba primero y permitía saltarse el límite cambiando esa cabecera.
function ipDelRequest(req: Request): string {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf;
  const real = (req.headers.get('x-real-ip') || '').trim();
  if (real) return real;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || 'sin-ip';
  return 'sin-ip';
}

const MENSAJES_TENANT: Record<string, string> = {
  tenant_no_encontrado: 'No se encontró tu cuenta de clínica.',
  plan_inactivo: 'Tu plan no está activo. Revisa tu suscripción.',
  plan_vencido: 'Tu plan venció. Renueva tu suscripción para seguir generando simulaciones.',
  limite_alcanzado: 'Alcanzaste el límite de diagnósticos de tu plan en este periodo.',
};

// Si no se puede VERIFICAR el límite (RPC no desplegada, base degradada), se rechaza: es preferible un error visible y reintentable
// a dejar pasar gasto de IA o envíos sin tope. Antes estos casos fallaban abiertos.
function limiteNoVerificable(cors: Record<string, string>): LimitResult {
  return { allowed: false, response: limitDeny(cors, 503, 'No pudimos verificar tu límite de uso en este momento. Intenta de nuevo en unos minutos.') };
}

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

  if (error) {
    console.error('[limits] error verificando tenant:', error.message);
    return limiteNoVerificable(cors);
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
      console.error('[limits] error RPC camila_consumir_diagnostico:', error.message);
      return limiteNoVerificable(cors);
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
    return limiteNoVerificable(cors);
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

return { ipDelRequest, checkLimitSinConsumir, checkAndConsumeLimit, checkAndConsumeLimitProspecto, checkLimitPorIpProspecto };
})();

// ── public-patient-reviews/index.ts ──
// SMYL · Invitaciones de reseña y lectura pública.
// Los pacientes nunca escriben directamente en tablas ni reciben IDs clínicos.


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function response(status: number, body: Record<string, unknown>, cache = "no-store") {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}
function clean(value: unknown, max: number) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.has("perfil")) {
    const slug = clean(url.searchParams.get("perfil"), 80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return response(400, { error: "Perfil no válido." });
    const profile = await admin.from("smyl_professional_profiles").select("tenant_id,professional_id")
      .eq("slug", slug).eq("status", "published").maybeSingle();
    if (profile.error) return response(500, { error: "No pudimos cargar las reseñas." });
    if (!profile.data) return response(404, { error: "Perfil no disponible." });
    const rows = await admin.from("smyl_patient_reviews")
      .select("rating,body,public_name,published_at")
      .eq("tenant_id", profile.data.tenant_id).eq("professional_id", profile.data.professional_id)
      .eq("status", "published").order("published_at", { ascending: false }).limit(6);
    if (rows.error) return response(500, { error: "No pudimos cargar las reseñas." });
    const summary = await admin.rpc("smyl_public_review_summary", {
      p_tenant_id: profile.data.tenant_id, p_professional_id: profile.data.professional_id,
    });
    if (summary.error) return response(500, { error: "No pudimos cargar las reseñas." });
    const reviews = rows.data || [];
    const totals = Array.isArray(summary.data) ? summary.data[0] : summary.data;
    return response(200, { average: Number(totals?.average_rating || 0), count: Number(totals?.review_count || 0), reviews }, "public, max-age=120, s-maxage=120");
  }

  if (req.method === "GET") {
    const token = clean(url.searchParams.get("token"), 128);
    if (!/^[0-9a-f]{64}$/.test(token)) return response(400, { error: "Enlace no válido." });
    const tokenHash = await sha256(token);
    const invitation = await admin.from("smyl_review_invitations")
      .select("professional_id,appointment_id,expires_at,used_at,revoked_at")
      .eq("token_hash", tokenHash).maybeSingle();
    if (invitation.error) return response(500, { error: "No pudimos validar el enlace." });
    if (!invitation.data || invitation.data.revoked_at || new Date(invitation.data.expires_at) <= new Date()) {
      return response(404, { error: "Este enlace venció o ya no está disponible." });
    }
    const professional = await admin.from("smyl_professionals").select("display_name,specialty")
      .eq("id", invitation.data.professional_id).single();
    const appointment = await admin.from("smyl_appointments").select("starts_at,status")
      .eq("id", invitation.data.appointment_id).single();
    if (professional.error || appointment.error || appointment.data.status !== "completed") {
      return response(404, { error: "Este enlace ya no está disponible." });
    }
    return response(200, {
      available: !invitation.data.used_at,
      submitted: Boolean(invitation.data.used_at),
      professional_name: professional.data.display_name,
      specialty: professional.data.specialty,
      visit_date: appointment.data.starts_at,
      expires_at: invitation.data.expires_at,
    });
  }

  if (req.method === "POST") {
    const limit = await checkLimitPorIpProspecto(req, CORS);
    if (!limit.allowed) return limit.response!;
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response(400, { error: "Solicitud inválida." }); }
    if (clean(body.website, 100)) return response(200, { ok: true });
    const token = clean(body.token, 128);
    const rating = Number(body.rating);
    const text = clean(body.body, 1000);
    const nameStyle = clean(body.name_style, 20);
    if (!/^[0-9a-f]{64}$/.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 20) {
      return response(400, { error: "Completa tu calificación y comentario." });
    }
    const submitted = await admin.rpc("smyl_submit_patient_review", {
      p_token_hash: await sha256(token), p_rating: rating, p_body: text, p_name_style: nameStyle,
    });
    if (submitted.error) {
      const unavailable = /enlace|disponible|duplicate|unique|23505|P0002/i.test(submitted.error.message);
      return response(unavailable ? 409 : 400, { error: unavailable ? "Este enlace ya fue utilizado o venció." : "Revisa la información de tu reseña." });
    }
    return response(200, { ok: true, message: "Gracias. La clínica revisará tu reseña antes de publicarla." });
  }

  return response(405, { error: "Método no permitido." });
});
