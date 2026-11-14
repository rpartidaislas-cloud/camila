import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
const REWRITE_MODEL =
  Deno.env.get("OPENAI_MILA_REWRITE_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SECONDS = 120;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a"]);
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

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

function numericUsage(raw: Record<string, unknown>): Record<string, number> {
  const source = raw.usage && typeof raw.usage === "object" ? raw.usage as Record<string, unknown> : {};
  const result: Record<string, number> = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
  }
  return result;
}

function mergeUsage(...items: Array<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) result[key] = (result[key] || 0) + value;
  }
  return result;
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
  throw new Error("MILA no devolvió la redacción clínica.");
}

function numericFacts(text: string): string[] {
  return (text.match(/\b\d+(?:[.,]\d+)?\b/g) || []).map((value) => value.replace(",", ".")).sort();
}

function preservesNumericFacts(transcript: string, professionalText: string): boolean {
  return JSON.stringify(numericFacts(transcript)) === JSON.stringify(numericFacts(professionalText));
}

async function improveClinicalWriting(transcript: string): Promise<{
  professionalText: string;
  needsReview: boolean;
  reviewReasons: string[];
  usage: Record<string, number>;
}> {
  const schema = {
    type: "object",
    properties: {
      professional_text: { type: "string" },
      needs_review: { type: "boolean" },
      review_reasons: { type: "array", items: { type: "string" } },
    },
    required: ["professional_text", "needs_review", "review_reasons"],
    additionalProperties: false,
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: REWRITE_MODEL,
      store: false,
      max_output_tokens: 500,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: `Eres MILA, asistente de documentación odontológica. Mejora únicamente la redacción de una conclusión radiográfica dictada en español.
Conserva exactamente el significado clínico, la incertidumbre, las negaciones, las piezas FDI, superficies, medidas, fechas y cantidades. Corrige puntuación, concordancia, repeticiones y orden para producir una frase clínica clara y profesional de máximo 600 caracteres.
No inventes ni infieras hallazgos, diagnósticos, piezas, tratamientos, recomendaciones o causalidad. No conviertas una posibilidad en una afirmación. No agregues información de la imagen ni de conocimiento general.
Si una palabra, pieza o relación es ambigua, conserva una formulación neutral, marca needs_review=true y explica brevemente el punto en review_reasons. Si no hay ambigüedad, usa needs_review=false y una lista vacía.`,
          }],
        },
        { role: "user", content: [{ type: "input_text", text: `DICTADO:\n${transcript}` }] },
      ],
      text: { format: { type: "json_schema", name: "mila_radiograph_conclusion", strict: true, schema } },
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Redacción ${response.status}`);
  const parsed = JSON.parse(extractOutputText(payload)) as Record<string, unknown>;
  const professionalText = typeof parsed.professional_text === "string" ? parsed.professional_text.trim() : "";
  if (!professionalText || professionalText.length > 600) throw new Error("Redacción fuera de límite");
  if (!preservesNumericFacts(transcript, professionalText)) throw new Error("La redacción alteró datos numéricos");
  const reviewReasons = (Array.isArray(parsed.review_reasons) ? parsed.review_reasons : [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 4)
    .map((value) => value.trim().slice(0, 180));
  return {
    professionalText,
    needsReview: parsed.needs_review === true || reviewReasons.length > 0,
    reviewReasons,
    usage: numericUsage(payload),
  };
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const { user, tenantId } = auth;
  if (!user || !tenantId) return json(401, { error: "Necesitas iniciar sesión para dictar con MILA." });
  const denied = await requirePermission(auth, CORS, "clinical.write");
  if (denied) return denied;
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return json(400, { error: "El audio no llegó en un formato válido." }); }
  const audio = form.get("audio");
  if (!(audio instanceof File)) return json(400, { error: "Falta el audio del dictado." });
  const mime = audio.type.split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return json(415, { error: "Formato de audio no permitido." });
  if (audio.size <= 0 || audio.size > MAX_BYTES) return json(413, { error: "El dictado debe pesar menos de 10 MB." });
  const clientDuration = Math.max(1, Math.min(MAX_SECONDS, Math.ceil(Number(form.get("duracion_segundos")) || 1)));

  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
      .eq("tenant_id", tenantId).eq("resource", "mila_seconds").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < clientDuration) {
      return json(402, { error: "No hay tiempo de MILA suficiente para procesar este dictado." });
    }
  }

  const requestId = crypto.randomUUID();
  const providerForm = new FormData();
  providerForm.set("file", audio, `dictado.${extensionFor(mime)}`);
  providerForm.set("model", TRANSCRIBE_MODEL);
  providerForm.set("response_format", "json");
  providerForm.set("language", "es");
  providerForm.set("prompt", "Conclusión clínica odontológica en español. Transcribe exactamente lo dicho. Conserva piezas FDI, superficies dentales, medidas y términos clínicos. No agregues diagnósticos ni información.");

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: providerForm,
    });
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(`Transcripción ${response.status}`);
    const transcript = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!transcript) return json(422, { error: "No se reconoció texto en el dictado." });
    const providerDuration = Number(raw.duration);
    const measuredDuration = Number.isFinite(providerDuration)
      ? Math.max(1, Math.min(MAX_SECONDS, Math.ceil(providerDuration)))
      : clientDuration;
    const transcriptionUsage = numericUsage(raw);
    let professionalText = transcript;
    let needsReview = false;
    let reviewReasons: string[] = [];
    let polished = false;
    let rewriteUsage: Record<string, number> = {};
    try {
      const improved = await improveClinicalWriting(transcript);
      professionalText = improved.professionalText;
      needsReview = improved.needsReview;
      reviewReasons = improved.reviewReasons;
      rewriteUsage = improved.usage;
      polished = true;
    } catch (rewriteError) {
      needsReview = true;
      reviewReasons = ["MILA transcribió el dictado, pero no pudo mejorar la redacción de forma segura."];
      console.warn("[mila-clinical-dictation:rewrite]", requestId, rewriteError instanceof Error ? rewriteError.message : rewriteError);
    }
    const tokenUsage = mergeUsage(transcriptionUsage, rewriteUsage);
    const { data: usage, error: usageError } = await admin.rpc("smyl_consume", {
      p_tenant_id: tenantId,
      p_resource: "mila_seconds",
      p_quantity_units: measuredDuration,
      p_idempotency_key: `mila-clinical-dictation:${requestId}`,
      p_source_type: "mila_clinical_dictation",
      p_source_id: requestId,
      p_provider: "openai",
      p_provider_model: TRANSCRIBE_MODEL,
      p_metadata: {
        context: "radiograph_conclusion",
        bytes: audio.size,
        rewrite_model: REWRITE_MODEL,
        polished,
        needs_review: needsReview,
        token_usage: tokenUsage,
      },
      p_enforce: CONSUMABLES_ENFORCED,
    });
    if (usageError) throw new Error("No se pudo registrar el consumo de MILA.");
    const usageRow = Array.isArray(usage) ? usage[0] : usage;
    if (usageRow && usageRow.accepted === false) return json(402, { error: "No hay tiempo de MILA suficiente para este dictado." });
    return json(200, {
      transcript,
      professional_text: professionalText,
      polished,
      needs_review: needsReview,
      review_reasons: reviewReasons,
      duration_seconds: measuredDuration,
      token_usage: tokenUsage,
      usage_recorded: true,
    });
  } catch (error) {
    console.error("[mila-clinical-dictation]", requestId, error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo procesar el dictado. No se modificó la conclusión." });
  }
});
