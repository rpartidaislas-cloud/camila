// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/public-appointment-request/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

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

// ── public-appointment-request/index.ts ──
// Solicitud pública desde la ficha profesional de SMYL.
// Crea o reutiliza al paciente y agrega una solicitud pendiente; nunca
// confirma una cita ni elige un horario clínico por cuenta de la clínica.


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function clean(value: unknown, max: number): string {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
function email(value: unknown): string {
  const out = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : "";
}
function phone(value: unknown): string {
  return clean(value, 60).replace(/[^\d+()\-\s]/g, "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return response(405, { error: "Método no permitido." });
  const limit = await checkLimitPorIpProspecto(req, CORS);
  if (!limit.allowed) return limit.response!;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(400, { error: "Solicitud inválida." }); }
  if (clean(body.website, 120)) return response(200, { ok: true }); // honeypot

  // Cloudflare Turnstile — solo activo cuando TURNSTILE_SECRET_KEY está configurado.
  // Fail-open intencionalmente: si el secret no está, el endpoint sigue funcionando
  // para no romper clínicas que aún no lo han configurado.
  if (TURNSTILE_SECRET) {
    const token = clean(body.cf_turnstile_response, 2048);
    if (!token) return response(400, { error: "Completa el desafío de seguridad." });
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) form.set("remoteip", ip);
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form,
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!verify.success) return response(403, { error: "Verificación fallida. Recarga la página e intenta de nuevo." });
  }

  const slug = clean(body.profile_slug, 80).toLowerCase();
  const fullName = clean(body.name, 150);
  const mail = email(body.email);
  const mobile = phone(body.phone);
  const message = clean(body.message, 1200);
  const serviceId = clean(body.service_id, 40);
  const branchId = clean(body.branch_id, 40);
  const requestedStart = clean(body.requested_start, 40);
  if (!slug || fullName.length < 2) return response(400, { error: "Escribe tu nombre." });
  if (!mail && mobile.replace(/\D/g, "").length < 10) return response(400, { error: "Escribe un correo o teléfono válido." });
  if (!serviceId || !branchId) return response(400, { error: "Selecciona tratamiento y ubicación." });

  const { data: directory, error: directoryError } = await admin
    .from("smyl_professional_directory")
    .select("tenant_id,slug,services,locations")
    .eq("slug", slug)
    .maybeSingle();
  if (directoryError) {
    console.error("[public-appointment-request] directory", directoryError.message);
    return response(500, { error: "No pudimos abrir la agenda. Intenta de nuevo." });
  }
  if (!directory) return response(404, { error: "Este perfil no está disponible." });

  const services = Array.isArray(directory.services) ? directory.services : [];
  const locations = Array.isArray(directory.locations) ? directory.locations : [];
  if (!services.some((item: Record<string, unknown>) => String(item.id) === serviceId)) {
    return response(400, { error: "El tratamiento no pertenece a este perfil." });
  }
  if (!locations.some((item: Record<string, unknown>) => String(item.id) === branchId)) {
    return response(400, { error: "La ubicación no pertenece a este perfil." });
  }

  const { data: profile, error: profileError } = await admin
    .from("smyl_professional_profiles")
    .select("professional_id")
    .eq("tenant_id", directory.tenant_id)
    .eq("slug", slug)
    .eq("status", "published")
    .single();
  if (profileError || !profile) return response(404, { error: "Este perfil no está disponible." });

  let patient: { id: string } | null = null;
  if (mail) {
    const found = await admin.from("camila_pacientes").select("id")
      .eq("tenant_id", directory.tenant_id).ilike("email", mail).limit(1).maybeSingle();
    patient = found.data;
  }
  if (!patient && mobile.replace(/\D/g, "").length >= 10) {
    const found = await admin.from("camila_pacientes").select("id")
      .eq("tenant_id", directory.tenant_id).eq("telefono", mobile).limit(1).maybeSingle();
    patient = found.data;
  }
  if (!patient) {
    const parts = fullName.split(/\s+/);
    const created = await admin.from("camila_pacientes").insert({
      tenant_id: directory.tenant_id,
      nombre: parts.shift() || fullName,
      apellido: parts.join(" "),
      email: mail,
      telefono: mobile,
      notas: "Contacto creado desde ficha profesional pública de SMYL.",
    }).select("id").single();
    if (created.error) {
      console.error("[public-appointment-request] patient", created.error.message);
      return response(500, { error: "No pudimos registrar tus datos. Intenta de nuevo." });
    }
    patient = created.data;
  }

  let preferred: string | null = null;
  if (requestedStart) {
    const parsed = new Date(requestedStart);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) preferred = parsed.toISOString();
  }
  const inserted = await admin.from("smyl_appointment_requests").insert({
    tenant_id: directory.tenant_id,
    patient_id: patient!.id,
    service_id: serviceId,
    professional_id: profile.professional_id,
    preferred_branch_id: branchId,
    requested_start: preferred,
    source: "patient_portal",
    patient_message: message,
    status: "pending",
  }).select("id").single();
  if (inserted.error) {
    console.error("[public-appointment-request] request", inserted.error.message);
    return response(500, { error: "No pudimos enviar la solicitud. Intenta de nuevo." });
  }

  return response(200, {
    ok: true,
    request_id: inserted.data.id,
    message: "Tu solicitud fue enviada. La clínica confirmará disponibilidad contigo.",
  });
});
