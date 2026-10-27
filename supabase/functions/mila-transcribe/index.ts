import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

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

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const { user, tenantId } = auth;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión para usar MILA." });
  // MILA graba y transcribe consultas: es una acción clínica, no basta con ser miembro del equipo.
  const sinPermiso = await requirePermission(auth, CORS, "clinical.write");
  if (sinPermiso) return sinPermiso;
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
