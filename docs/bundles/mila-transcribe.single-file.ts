// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/mila-transcribe/index.ts con sus archivos de _shared incluidos,
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

// ── mila-transcribe/index.ts ──
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
const NOTE_MODEL = Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a"]);

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extensionFor(mime: string): string {
  return ({
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
  } as Record<string, string>)[mime] || "audio";
}

function extractOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") return part.text;
    }
  }
  throw new Error("OpenAI no devolvió la nota estructurada.");
}

async function transcribe(audio: File): Promise<{ text: string; duration: number | null; raw: Record<string, unknown> }> {
  const form = new FormData();
  form.set("file", audio, audio.name || `consulta.${extensionFor(audio.type)}`);
  form.set("model", TRANSCRIBE_MODEL);
  form.set("response_format", "json");
  form.set("prompt", "Consulta dental en español. Conserva nombres de tratamientos, piezas dentales, medicamentos, dosis, fechas y cantidades tal como se escuchen. No agregues información.");
  form.append("languages[]", "es");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Transcripción OpenAI ${response.status}`);
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (!text) throw new Error("La grabación no produjo texto.");
  const duration = typeof raw.duration === "number" && Number.isFinite(raw.duration) ? Math.ceil(raw.duration) : null;
  return { text, duration, raw };
}

async function buildClinicalDraft(transcript: string): Promise<Record<string, unknown>> {
  const schema = {
    type: "object",
    properties: {
      motivo_consulta: { type: "string" },
      subjetivo: { type: "string" },
      objetivo: { type: "string" },
      evaluacion_borrador: { type: "string" },
      plan_sugerido: { type: "array", items: { type: "string" } },
      pendientes_confirmar: { type: "array", items: { type: "string" } },
      alertas: { type: "array", items: { type: "string" } },
      resumen_para_paciente: { type: "string" },
    },
    required: ["motivo_consulta", "subjetivo", "objetivo", "evaluacion_borrador", "plan_sugerido", "pendientes_confirmar", "alertas", "resumen_para_paciente"],
    additionalProperties: false,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NOTE_MODEL,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: `Eres MILA Transcribe, asistente de documentación dental. Convierte la transcripción en un BORRADOR clínico en español.
No inventes diagnósticos, hallazgos, piezas dentales, medicamentos, dosis ni antecedentes. Cuando un dato no esté explícito, usa "No mencionado" o colócalo en pendientes_confirmar. Separa lo dicho por el paciente de lo observado por el dentista. La evaluación y el plan siempre deben quedar como borrador sujeto a revisión profesional.`,
          }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: `TRANSCRIPCIÓN:\n${transcript}` }],
        },
      ],
      text: { format: { type: "json_schema", name: "mila_clinical_note", strict: true, schema } },
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Nota OpenAI ${response.status}`);
  return JSON.parse(extractOutputText(payload));
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión para usar MILA." });
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "La grabación no llegó en un formato válido." });
  }

  if (form.get("consent_confirmed") !== "true") {
    return json(400, { error: "Debes confirmar el consentimiento del paciente antes de grabar." });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) return json(400, { error: "Falta el archivo de audio." });
  const mime = audio.type.split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return json(415, { error: "Formato de audio no permitido." });
  if (audio.size <= 0 || audio.size > MAX_BYTES) return json(413, { error: "La grabación debe pesar menos de 25 MB." });

  const patientRaw = form.get("paciente_id");
  const pacienteId = patientRaw == null || patientRaw === "" ? null : String(patientRaw);
  if (pacienteId !== null && !isUuid(pacienteId)) return json(400, { error: "paciente_id inválido." });
  if (pacienteId) {
    const { data: paciente } = await admin.from("camila_pacientes").select("id").eq("id", pacienteId).eq("tenant_id", tenantId).maybeSingle();
    if (!paciente) return json(404, { error: "El paciente no pertenece a tu clínica." });
  }

  const clientDuration = Math.max(1, Math.min(14_400, Math.ceil(Number(form.get("duracion_segundos")) || 1)));
  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units").eq("tenant_id", tenantId).eq("resource", "mila_seconds").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < clientDuration) return json(402, { error: "No hay minutos de MILA suficientes para procesar esta grabación." });
  }

  const { data: session, error: sessionError } = await admin.from("mila_sessions").insert({
    tenant_id: tenantId,
    user_id: user.id,
    paciente_id: pacienteId,
    modo: "transcribe",
    estado: "procesando",
    modelo: TRANSCRIBE_MODEL,
    metadata: { note_model: NOTE_MODEL, consent_confirmed: true, consumables_enforced: CONSUMABLES_ENFORCED },
  }).select("id").single();
  if (sessionError || !session) return json(500, { error: "No se pudo reservar la sesión de transcripción." });

  const objectPath = `${tenantId}/${user.id}/${session.id}.${extensionFor(mime)}`;
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const { error: uploadError } = await admin.storage.from("mila-audio").upload(objectPath, bytes, {
      contentType: mime,
      upsert: false,
      cacheControl: "private, max-age=0",
    });
    if (uploadError) throw new Error("No se pudo guardar el audio de forma privada.");

    await admin.from("mila_recordings").insert({
      tenant_id: tenantId,
      session_id: session.id,
      object_path: objectPath,
      mime_type: mime,
      byte_size: audio.size,
      duracion_segundos: clientDuration,
    });

    const transcript = await transcribe(audio);
    const measuredDuration = transcript.duration || clientDuration;
    const note = await buildClinicalDraft(transcript.text);

    const { data: transcriptRow, error: transcriptError } = await admin.from("mila_transcripts").insert({
      tenant_id: tenantId,
      session_id: session.id,
      texto: transcript.text,
      idioma: "es",
      duracion_segundos: measuredDuration,
      segmentos: Array.isArray(transcript.raw.segments) ? transcript.raw.segments : null,
      modelo: TRANSCRIBE_MODEL,
    }).select("id").single();
    if (transcriptError || !transcriptRow) throw new Error("No se pudo guardar la transcripción.");

    const { data: noteRow, error: noteError } = await admin.from("mila_clinical_notes").insert({
      tenant_id: tenantId,
      session_id: session.id,
      paciente_id: pacienteId,
      contenido: note,
      status: "borrador",
    }).select("id").single();
    if (noteError || !noteRow) throw new Error("No se pudo guardar el borrador clínico.");

    await admin.from("mila_sessions").update({
      estado: "completada",
      duracion_segundos: measuredDuration,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);

    await admin.rpc("smyl_consume", {
      p_tenant_id: tenantId,
      p_resource: "mila_seconds",
      p_quantity_units: measuredDuration,
      p_idempotency_key: `mila-transcribe:${session.id}`,
      p_source_type: "mila_transcribe",
      p_source_id: session.id,
      p_provider: "openai",
      p_provider_model: TRANSCRIBE_MODEL,
      p_metadata: { note_model: NOTE_MODEL, bytes: audio.size },
      p_enforce: CONSUMABLES_ENFORCED,
    });

    await admin.from("mila_audit_log").insert({
      tenant_id: tenantId,
      user_id: user.id,
      session_id: session.id,
      event_type: "mila_transcription_completed",
      entity_type: "mila_clinical_note",
      entity_id: noteRow.id,
      metadata: { transcript_id: transcriptRow.id, duration_seconds: measuredDuration },
    });

    return json(200, {
      session_id: session.id,
      transcript_id: transcriptRow.id,
      note_id: noteRow.id,
      duration_seconds: measuredDuration,
      transcript: transcript.text,
      note,
      status: "borrador",
    });
  } catch (error) {
    const message = (error as Error).message || "Error procesando la grabación.";
    console.error("[mila-transcribe]", session.id, message);
    await admin.from("mila_sessions").update({
      estado: "error",
      ended_at: new Date().toISOString(),
      error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("id", session.id);
    return json(500, { error: "No se pudo procesar la grabación. El borrador no fue creado.", session_id: session.id });
  }
});
