import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
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
    const tokenUsage = numericUsage(raw);
    const { data: usage, error: usageError } = await admin.rpc("smyl_consume", {
      p_tenant_id: tenantId,
      p_resource: "mila_seconds",
      p_quantity_units: measuredDuration,
      p_idempotency_key: `mila-clinical-dictation:${requestId}`,
      p_source_type: "mila_clinical_dictation",
      p_source_id: requestId,
      p_provider: "openai",
      p_provider_model: TRANSCRIBE_MODEL,
      p_metadata: { context: "radiograph_conclusion", bytes: audio.size, token_usage: tokenUsage },
      p_enforce: CONSUMABLES_ENFORCED,
    });
    if (usageError) throw new Error("No se pudo registrar el consumo de MILA.");
    const usageRow = Array.isArray(usage) ? usage[0] : usage;
    if (usageRow && usageRow.accepted === false) return json(402, { error: "No hay tiempo de MILA suficiente para este dictado." });
    return json(200, {
      transcript,
      duration_seconds: measuredDuration,
      token_usage: tokenUsage,
      usage_recorded: true,
    });
  } catch (error) {
    console.error("[mila-clinical-dictation]", requestId, error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo procesar el dictado. No se modificó la conclusión." });
  }
});
