// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/guardar-lead-prospecto/index.ts con sus archivos de _shared incluidos,
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

// ── guardar-lead-prospecto/index.ts ──
// supabase/functions/guardar-lead-prospecto/index.ts
//
// Guarda el caso de un prospecto (paciente sin cuenta, entró por el link
// público de una clínica -- simulacion.html?clinica=<tenant_id>). Sin
// sesión, camila_casos rechaza el INSERT directo (RLS exige ser miembro de
// la clínica) -- esta función corre con service role, valida que el
// tenant_id sea real/activo, y hace el INSERT por el prospecto. NO se
// exponen credenciales ni datos de otras clínicas: el único dato que el
// cliente controla es a cuál tenant_id atribuir el lead, y eso se valida
// contra camila_tenants antes de aceptar nada.


const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

// Campos que el cliente puede mandar -- cualquier otra cosa en el body se
// ignora (nunca se hace un INSERT con `...body` a pelo, para que un
// prospecto no pueda colar columnas que no le corresponden, p. ej.
// diagnosticos_usados o alguna columna futura sensible).
const CAMPOS_PERMITIDOS = [
  "id", "tenant_id", "nombre_paciente", "telefono", "email", "notas_doctor",
  "score", "score_lbl", "resumen", "diagnostico", "total_cotizacion",
  "simulacion_url", "simulacion_url_der", "simulacion_url_izq",
  "simulacion_url_extraoral", "simulacion_url_intraoral", "simulacion_url_tres_cuartos",
  "foto_frontal", "foto_perfil_der", "foto_perfil_izq", "foto_extraoral",
  "foto_intraoral", "foto_tres_cuartos", "cuestionario", "fotos_count",
  "diagnostico_claude", "prompt_gemini_usado", "editor_params", "created_at",
  "lana_cita_id", "lana_origen",
];

// Esta función es PÚBLICA (la llama el paciente desde el link de la clínica, sin sesión) y lo que
// guarda se muestra después dentro del panel del dentista. Por eso cada campo se valida por tipo y
// tamaño en el servidor: un valor con HTML/JS en `telefono` o `score` no debe llegar a la base.
const MAX_BODY_CHARS = 12_000_000; // fotos en base64 incluidas
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_FOTO = [
  "simulacion_url", "simulacion_url_der", "simulacion_url_izq",
  "simulacion_url_extraoral", "simulacion_url_intraoral", "simulacion_url_tres_cuartos",
  "foto_frontal", "foto_perfil_der", "foto_perfil_izq", "foto_extraoral",
  "foto_intraoral", "foto_tres_cuartos",
];
const CAMPOS_TEXTO_CORTO: Record<string, number> = {
  nombre_paciente: 200, score_lbl: 120, lana_origen: 40, notas_doctor: 5000, resumen: 5000,
};
const CAMPOS_ESTRUCTURADOS = ["diagnostico", "diagnostico_claude", "cuestionario", "editor_params", "prompt_gemini_usado"];

function validarFila(body: Record<string, unknown>): { fila?: Record<string, unknown>; error?: string } {
  const fila: Record<string, unknown> = {};
  for (const campo of CAMPOS_PERMITIDOS) {
    const valor = body[campo];
    if (valor === undefined || valor === null) continue;
    if (campo === "id") {
      if (typeof valor !== "string" || !UUID_RE.test(valor)) return { error: "id inválido." };
      fila.id = valor.toLowerCase();
    } else if (campo === "tenant_id") {
      continue; // se asigna aparte, ya validado contra camila_tenants
    } else if (campo === "telefono") {
      const t = String(valor).trim();
      if (t && !/^[0-9+()\-.\s]{1,30}$/.test(t)) return { error: "Teléfono inválido." };
      fila.telefono = t || null;
    } else if (campo === "email") {
      const e = String(valor).trim();
      if (e && (e.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e))) return { error: "Correo inválido." };
      fila.email = e || null;
    } else if (campo === "score") {
      const n = Number(valor);
      if (typeof valor === "boolean" || !Number.isFinite(n) || n < 0 || n > 100) return { error: "score inválido." };
      fila.score = n;
    } else if (campo === "total_cotizacion") {
      const n = Number(valor);
      if (typeof valor === "boolean" || !Number.isFinite(n) || n < 0 || n > 100_000_000) return { error: "total_cotizacion inválido." };
      fila.total_cotizacion = n;
    } else if (campo === "fotos_count") {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 0 || n > 50) return { error: "fotos_count inválido." };
      fila.fotos_count = n;
    } else if (campo === "lana_cita_id") {
      const n = Number(valor);
      if (!Number.isInteger(n) || n < 0) return { error: "lana_cita_id inválido." };
      fila.lana_cita_id = n;
    } else if (campo === "created_at") {
      const d = new Date(String(valor));
      const ahora = Date.now();
      if (Number.isNaN(d.getTime()) || d.getTime() > ahora + 86_400_000 || d.getTime() < ahora - 31 * 86_400_000) continue;
      fila.created_at = d.toISOString();
    } else if (campo in CAMPOS_TEXTO_CORTO) {
      if (typeof valor !== "string" || valor.length > CAMPOS_TEXTO_CORTO[campo]) return { error: `${campo} inválido.` };
      fila[campo] = valor;
    } else if (CAMPOS_FOTO.includes(campo)) {
      if (typeof valor !== "string" || valor.length > MAX_BODY_CHARS) return { error: `${campo} inválido.` };
      fila[campo] = valor;
    } else if (CAMPOS_ESTRUCTURADOS.includes(campo)) {
      if (typeof valor === "string") {
        if (valor.length > 200_000) return { error: `${campo} demasiado grande.` };
      } else if (typeof valor === "object") {
        if (JSON.stringify(valor).length > 200_000) return { error: `${campo} demasiado grande.` };
      } else {
        return { error: `${campo} inválido.` };
      }
      fila[campo] = valor;
    }
    // Cualquier otro campo se ignora (ver CAMPOS_PERMITIDOS).
  }
  return { fila };
}

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError(405, "Método no permitido.");

  // Tope genérico por IP -- protección barata contra spam de leads falsos
  // (no cuesta dinero de API como las llamadas de IA, pero sí ensucia el
  // panel del dentista). No exige sesión, así que se usa tal cual con
  // tenantId=null -- eso dispara la rama anónima de checkAndConsumeLimit.
  const { allowed, response: limitError } = await checkAndConsumeLimit(req, null, CORS);
  if (!allowed) return limitError!;

  let body: Record<string, unknown> = {};
  try {
    const crudo = await req.text();
    if (crudo.length > MAX_BODY_CHARS) return jsonError(413, "La solicitud es demasiado grande.");
    body = JSON.parse(crudo);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("no es un objeto");
  } catch {
    return jsonError(400, "Body inválido.");
  }

  const tenantId = String(body?.tenant_id || "");
  if (!UUID_RE.test(tenantId)) return jsonError(400, "tenant_id inválido.");
  const nombre = String(body?.nombre_paciente || "").trim();
  if (!tenantId) return jsonError(400, "Falta tenant_id.");
  if (!nombre) return jsonError(400, "Falta el nombre del paciente.");

  const { data: tenant, error: tenantErr } = await admin
    .from("camila_tenants")
    .select("id, activo")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    console.error("[guardar-lead-prospecto] error consultando tenant:", tenantErr.message);
    return jsonError(500, "No se pudo verificar la clínica. Intenta de nuevo.");
  }
  if (!tenant || !tenant.activo) return jsonError(404, "No se encontró esta clínica o no está activa.");

  const validada = validarFila(body);
  if (validada.error) return jsonError(400, validada.error);
  const fila: Record<string, unknown> = { ...validada.fila, es_prospecto: true };
  fila.tenant_id = tenantId; // siempre el ya validado arriba, nunca el crudo del body

  // Un upsert por `id` que manda el cliente podría pisar (o mover de clínica) un caso que ya existe.
  // Si el id ya existe, solo se acepta que sea un caso de prospecto de ESTA misma clínica.
  if (typeof fila.id === "string") {
    const { data: existente, error: existenteErr } = await admin
      .from("camila_casos")
      .select("id, tenant_id, es_prospecto")
      .eq("id", fila.id)
      .maybeSingle();
    if (existenteErr) {
      console.error("[guardar-lead-prospecto] error consultando caso existente:", existenteErr.message);
      return jsonError(500, "No se pudo guardar tu información. Intenta de nuevo.");
    }
    if (existente && (existente.tenant_id !== tenantId || existente.es_prospecto !== true)) {
      return jsonError(409, "Ese identificador ya está en uso.");
    }
  }

  const { error: insertErr } = await admin
    .from("camila_casos")
    .upsert(fila, { onConflict: "id" });
  if (insertErr) {
    console.error("[guardar-lead-prospecto] error guardando caso:", insertErr.message);
    return jsonError(500, "No se pudo guardar tu información. Intenta de nuevo.");
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
});
