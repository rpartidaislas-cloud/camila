import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime-2.1";
const REALTIME_VOICE = Deno.env.get("OPENAI_REALTIME_VOICE") || "marin";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión para usar MILA." });
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
