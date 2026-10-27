// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/mila-realtime-session/index.ts con sus archivos de _shared incluidos,
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

// ── mila-realtime-session/index.ts ──
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime-2.1";
const REALTIME_VOICE = Deno.env.get("OPENAI_REALTIME_VOICE") || "marin";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const tools = [
  {
    type: "function",
    name: "buscar_paciente",
    description: "Busca pacientes de la clínica por nombre o teléfono antes de preparar una acción.",
    parameters: {
      type: "object",
      properties: { consulta: { type: "string", description: "Nombre, apellido o teléfono." } },
      required: ["consulta"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "buscar_opciones_clinica",
    description: "Consulta servicios, precios y opciones reales de agenda antes de preparar una cita o cotización.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["cita", "cotizacion"] },
        consulta: { type: "string", description: "Nombre aproximado del servicio, por ejemplo limpieza o carilla." },
      },
      required: ["tipo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "preparar_cita",
    description: "Prepara una cita para revisión humana. Nunca crea la cita sin confirmación explícita en pantalla.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        sucursal_id: { type: "string" },
        profesional_id: { type: "string" },
        servicio_id: { type: "string" },
        consultorio_id: { type: "string", description: "Opcional; sólo si hay un consultorio específico disponible." },
        inicia_en: { type: "string", description: "Fecha y hora ISO 8601 con zona horaria." },
        motivo: { type: "string" },
      },
      required: ["paciente_id", "sucursal_id", "profesional_id", "servicio_id", "inicia_en", "motivo"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "preparar_cotizacion",
    description: "Prepara una cotización con el tarifario real de la clínica. Requiere confirmación explícita antes de guardarla.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        partidas: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              servicio_id: { type: "string", description: "ID devuelto por buscar_opciones_clinica." },
              cantidad: { type: "integer", minimum: 1, maximum: 100 },
            },
            required: ["servicio_id", "cantidad"],
            additionalProperties: false,
          },
        },
        notas: { type: "string" },
      },
      required: ["paciente_id", "partidas"],
      additionalProperties: false,
    },
  },
];

const instructions = `Eres MILA, Motor Inteligente de Lenguaje y Acciones de SMYL, un asistente de operación para profesionales dentales.

Habla en español claro, breve y profesional. Tu trabajo es ayudar a encontrar pacientes, preparar citas y preparar cotizaciones. No emitas diagnósticos clínicos definitivos ni sustituyas el criterio del dentista.

REGLAS OBLIGATORIAS:
1. Antes de preparar una cita o cotización, identifica un paciente real con buscar_paciente. Si hay ambigüedad, pregunta.
2. Consulta siempre buscar_opciones_clinica y usa exclusivamente los IDs, servicios, precios, sucursales y profesionales que esa herramienta devuelva.
3. Nunca afirmes que una acción quedó guardada mientras la herramienta sólo diga requires_confirmation=true. Explica que falta confirmar en pantalla.
4. Nunca inventes precios. preparar_cotizacion usa el tarifario real de la clínica y exige un plan clínico revisado.
5. Repite fecha, hora, paciente, tratamientos e importe antes de solicitar confirmación.
6. No solicites contraseñas, tarjetas, expedientes completos ni datos que no sean necesarios.
7. Si el usuario pide algo fuera de las herramientas disponibles, explica que aún no puedes ejecutarlo y ofrece registrar la intención verbalmente.
8. Mantén las respuestas habladas normalmente por debajo de 25 segundos.`;

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const { user, tenantId } = auth;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión para usar MILA." });
  // MILA graba y transcribe consultas: es una acción clínica, no basta con ser miembro del equipo.
  const sinPermiso = await requirePermission(auth, CORS, "clinical.write");
  if (sinPermiso) return sinPermiso;
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }
  const sdp = typeof body.sdp === "string" ? body.sdp : "";
  if (!sdp || sdp.length > 100_000) return json(400, { error: "Falta la oferta de audio WebRTC." });

  const pacienteId = body.paciente_id == null || body.paciente_id === "" ? null : body.paciente_id;
  if (pacienteId !== null && !isUuid(pacienteId)) return json(400, { error: "paciente_id inválido." });
  if (pacienteId) {
    const { data: paciente } = await admin.from("camila_pacientes").select("id").eq("id", pacienteId).eq("tenant_id", tenantId).maybeSingle();
    if (!paciente) return json(404, { error: "El paciente no pertenece a tu clínica." });
  }

  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units").eq("tenant_id", tenantId).eq("resource", "mila_seconds").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < 60) return json(402, { error: "Tu clínica no tiene minutos de MILA disponibles." });
  }

  const { data: session, error: sessionError } = await admin.from("mila_sessions").insert({
    tenant_id: tenantId,
    user_id: user.id,
    paciente_id: pacienteId,
    modo: "conversa",
    estado: "iniciada",
    modelo: REALTIME_MODEL,
    metadata: { source: "web", consumables_enforced: CONSUMABLES_ENFORCED },
  }).select("id").single();
  if (sessionError || !session) {
    console.error("[mila-realtime-session] no se pudo crear sesión", sessionError?.message);
    return json(500, { error: "No se pudo iniciar la sesión de MILA." });
  }

  const realtimeSession = {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions,
    max_output_tokens: 900,
    audio: {
      input: {
        transcription: {
          model: Deno.env.get("OPENAI_REALTIME_TRANSCRIBE_MODEL") || "gpt-transcribe",
          languages: ["es"],
        },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 650, create_response: true },
      },
      output: { voice: REALTIME_VOICE },
    },
    tools,
    tool_choice: "auto",
  };

  try {
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(realtimeSession));
    const openaiResp = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const answerSdp = await openaiResp.text();
    if (!openaiResp.ok) {
      console.error("[mila-realtime-session] OpenAI", openaiResp.status, answerSdp.slice(0, 600));
      await admin.from("mila_sessions").update({ estado: "error", error_message: `OpenAI ${openaiResp.status}` }).eq("id", session.id);
      return json(502, { error: "No se pudo abrir la conversación de voz." });
    }

    const callId = openaiResp.headers.get("Location")?.split("/").pop() || null;
    await admin.from("mila_sessions").update({
      metadata: { source: "web", openai_call_id: callId, consumables_enforced: CONSUMABLES_ENFORCED },
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    await admin.from("mila_audit_log").insert({
      tenant_id: tenantId,
      user_id: user.id,
      session_id: session.id,
      event_type: "mila_conversation_started",
      entity_type: "mila_session",
      entity_id: session.id,
    });

    return json(200, { session_id: session.id, answer_sdp: answerSdp });
  } catch (error) {
    console.error("[mila-realtime-session]", (error as Error).message);
    await admin.from("mila_sessions").update({ estado: "error", error_message: "No se pudo conectar con el proveedor." }).eq("id", session.id);
    return json(502, { error: "No se pudo conectar con el servicio de voz." });
  }
});
