// MILA · Entrevista de historia clínica y dictado de exploración desde el celular (QR).
//
// Computadora (sesión de usuario + clinical.write):
//   create {patient_id}        → crea la sesión y devuelve el token del QR (una sola vez).
//   status {id}                → estado, consentimiento, borrador interpretado y consumo (sondeo).
//   close  {id}                → vacía transcripción y borrador (al aplicar o descartar).
// Celular (sin login; capacidad = token del QR y luego secreto de dispositivo):
//   pair    {id, token}        → vincula UN dispositivo; el token deja de servir para otro.
//   consent {id, device}       → registra que el paciente aceptó la grabación.
//   segment (multipart) {id, device, mode: history|exam, audio, duracion_segundos}
//                              → transcribe, reinterpreta todo lo dicho en ese modo y guarda el borrador.
//   finish  {id, device}       → el celular terminó; la computadora ya tiene el borrador.
//
// No se guarda audio. La transcripción y el borrador viven solo en smyl_mila_interviews hasta que el
// dentista aplica o descarta, o hasta que vence (90 min). Cada segmento registra segundos de MILA
// (smyl_consume) y los tokens reales de transcripción + interpretación (smyl_ai_usage_log).

import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import {
  EXAM_PROMPT,
  EXAM_SCHEMA,
  HISTORY_PROMPT,
  HISTORY_SCHEMA,
  INTERVIEW_GUIDE,
  normalizeExam,
  normalizeHistory,
} from "../_shared/mila-interview-contract.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
const EXTRACT_MODEL =
  Deno.env.get("OPENAI_MILA_INTERVIEW_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
// Tarifas opcionales (USD por millón de tokens) para estimar costo. Sin configurar, el costo queda vacío.
const PRICE_IN = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_IN") || "");
const PRICE_OUT = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_OUT") || "");

const SESSION_MINUTES = 90;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_SECONDS = 180;
const MAX_TRANSCRIPT = 60000;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Row = Record<string, any>;
type Usage = { input_tokens: number; output_tokens: number };

function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHash(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function extensionFor(mime: string): string {
  return ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a", "audio/aac": "aac" } as Record<string, string>)[mime] || "audio";
}
function usageOf(raw: Row): Usage {
  const u = raw && typeof raw.usage === "object" && raw.usage ? raw.usage : {};
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);
  return { input_tokens: n(u.input_tokens ?? u.prompt_tokens), output_tokens: n(u.output_tokens ?? u.completion_tokens) };
}
function extractOutputText(payload: Row): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  throw new Error("MILA no devolvió la interpretación.");
}
function cost(u: Usage): number | null {
  if (!Number.isFinite(PRICE_IN) || !Number.isFinite(PRICE_OUT)) return null;
  return Math.round(((u.input_tokens * PRICE_IN + u.output_tokens * PRICE_OUT) / 1e6) * 1e5) / 1e5;
}
function patientLabel(p: Row | null): string {
  if (!p) return "Paciente";
  const first = String(p.nombre || "").trim().split(/\s+/)[0] || "Paciente";
  const last = String(p.apellido || "").trim();
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

async function purgeExpired() {
  await admin.from("smyl_mila_interviews").delete().lt("expires_at", new Date().toISOString());
}

async function interpret(mode: "history" | "exam", transcript: string): Promise<{ result: Row; usage: Usage }> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      store: false,
      max_output_tokens: 6000,
      input: [
        { role: "system", content: [{ type: "input_text", text: mode === "history" ? HISTORY_PROMPT : EXAM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: `TRANSCRIPCIÓN:\n${transcript}` }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
          strict: true,
          schema: mode === "history" ? HISTORY_SCHEMA : EXAM_SCHEMA,
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(`Interpretación ${response.status}`);
  const parsed = JSON.parse(extractOutputText(payload));
  const result = mode === "history" ? normalizeHistory(parsed, transcript) : normalizeExam(parsed, transcript);
  return { result, usage: usageOf(payload) };
}

async function transcribe(audio: File, mime: string, mode: "history" | "exam"): Promise<{ text: string; seconds: number | null; usage: Usage }> {
  const form = new FormData();
  form.set("file", audio, `segmento.${extensionFor(mime)}`);
  form.set("model", TRANSCRIBE_MODEL);
  form.set("response_format", "json");
  form.set("language", "es");
  form.set("prompt", mode === "history"
    ? "Entrevista médica-odontológica en español de México entre dentista y paciente: alergias, medicamentos, enfermedades, cirugías, hábitos. Transcribe exactamente lo dicho."
    : "Dictado de exploración dental en español: piezas FDI (once, dieciséis, treinta y seis), superficies oclusal, mesial, distal, vestibular, lingual, palatina, incisal; caries, resina, amalgama, corona, endodoncia, ausente, implante, fractura. Transcribe exactamente lo dicho.");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const raw = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(`Transcripción ${response.status}`);
  const seconds = Number(raw.duration);
  return { text: typeof raw.text === "string" ? raw.text.trim() : "", seconds: Number.isFinite(seconds) ? seconds : null, usage: usageOf(raw) };
}

function publicStatus(row: Row) {
  const result = row.result || {};
  return {
    id: row.id,
    status: row.status,
    paired: !!row.device_hash,
    consent: !!row.consent_at,
    segments: row.segments,
    audio_seconds: row.audio_seconds,
    tokens: { input: Number(row.input_tokens) || 0, output: Number(row.output_tokens) || 0 },
    finished: !!result.finished_at,
    history: result.history || null,
    exam: result.exam || null,
    processing: !!(row.busy_until && Date.parse(row.busy_until) > Date.now()),
    expires_at: row.expires_at,
  };
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const isMultipart = (req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
  let form: FormData | null = null;
  let body: Row = {};
  try {
    if (isMultipart) form = await req.formData();
    else body = await req.json();
  } catch {
    return json(400, { error: "Solicitud inválida." });
  }
  const field = (name: string) => String(form ? form.get(name) ?? "" : body[name] ?? "");
  const action = isMultipart ? "segment" : field("action");
  const id = field("id");

  // -------------------------------------------------------------- computadora (dentista)
  if (action === "create" || action === "status" || action === "close") {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const denied = await requirePermission(auth, CORS, "clinical.write");
    if (denied) return denied;
    const tenantId = auth.tenantId!;
    const userId = auth.user!.id;

    if (action === "create") {
      if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
      const patientId = field("patient_id");
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: patient } = await admin.from("camila_pacientes").select("id,nombre,apellido")
        .eq("tenant_id", tenantId).eq("id", patientId).maybeSingle();
      if (!patient) return json(404, { error: "El paciente no pertenece a tu clínica." });
      await purgeExpired();
      // Una sola sesión abierta por paciente y profesional: la anterior se cierra y se vacía.
      await admin.from("smyl_mila_interviews").delete()
        .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("created_by", userId).neq("status", "closed");
      const token = randomToken();
      const expires = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();
      const { data: row, error } = await admin.from("smyl_mila_interviews").insert({
        tenant_id: tenantId, patient_id: patientId, created_by: userId,
        pair_token_hash: await sha256(token), expires_at: expires,
      }).select("id,expires_at").single();
      if (error || !row) return json(500, { error: "No se pudo crear la sesión de MILA." });
      return json(200, { id: row.id, token, expires_at: row.expires_at });
    }

    if (!UUID.test(id)) return json(400, { error: "Sesión inválida." });
    const { data: row } = await admin.from("smyl_mila_interviews").select("*")
      .eq("id", id).eq("tenant_id", tenantId).eq("created_by", userId).maybeSingle();
    if (!row) return json(404, { error: "La sesión de MILA ya no existe o venció." });

    if (action === "close") {
      await admin.from("smyl_mila_interviews").delete().eq("id", row.id);
      return json(200, { closed: true });
    }
    if (Date.parse(row.expires_at) < Date.now()) return json(410, { error: "La sesión de MILA venció." });
    return json(200, publicStatus(row));
  }

  // -------------------------------------------------------------- celular
  if (!UUID.test(id)) return json(400, { error: "Código QR inválido." });
  const { data: row } = await admin.from("smyl_mila_interviews").select("*").eq("id", id).maybeSingle();
  if (!row || row.status === "closed" || Date.parse(row.expires_at) < Date.now()) {
    return json(410, { error: "Este código ya no es válido. Genera uno nuevo desde la computadora." });
  }

  if (action === "pair") {
    const token = field("token");
    if (!token || !sameHash(await sha256(token), row.pair_token_hash)) return json(403, { error: "Código QR inválido." });
    if (row.device_hash) return json(409, { error: "Este código ya se usó en otro celular. Genera uno nuevo." });
    const device = randomToken();
    const { data: updated } = await admin.from("smyl_mila_interviews")
      .update({ device_hash: await sha256(device), status: "paired", updated_at: new Date().toISOString() })
      .eq("id", row.id).is("device_hash", null).select("id").maybeSingle();
    if (!updated) return json(409, { error: "Este código ya se usó en otro celular. Genera uno nuevo." });
    const { data: patient } = await admin.from("camila_pacientes").select("nombre,apellido")
      .eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    return json(200, { device, patient: patientLabel(patient), guide: INTERVIEW_GUIDE, expires_at: row.expires_at, max_segment_seconds: MAX_SEGMENT_SECONDS });
  }

  const device = field("device");
  if (!device || !row.device_hash || !sameHash(await sha256(device), row.device_hash)) {
    return json(403, { error: "Este celular no está vinculado a la sesión." });
  }

  if (action === "consent") {
    await admin.from("smyl_mila_interviews").update({ consent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { consent: true });
  }
  if (action === "finish") {
    const result = { ...(row.result || {}), finished_at: new Date().toISOString() };
    await admin.from("smyl_mila_interviews").update({ result, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { finished: true });
  }
  if (action === "state") return json(200, { consent: !!row.consent_at, segments: row.segments, history: row.result?.history || null, exam: row.result?.exam || null });
  if (action !== "segment" || !form) return json(400, { error: "Acción no válida." });

  // ---- segmento de audio
  if (!row.consent_at) return json(409, { error: "Primero registra el consentimiento del paciente." });
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
  const mode = field("mode") === "exam" ? "exam" : "history";
  const audio = form.get("audio");
  if (!(audio instanceof File)) return json(400, { error: "Falta el audio." });
  const mime = audio.type.split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return json(415, { error: "Formato de audio no permitido." });
  if (audio.size <= 0 || audio.size > MAX_BYTES) return json(413, { error: "El segmento debe pesar menos de 10 MB." });
  const clientSeconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(Number(field("duracion_segundos")) || 1)));

  // Un segmento a la vez por sesión (evita que dos envíos pisen la transcripción).
  const now = new Date();
  const { data: locked } = await admin.from("smyl_mila_interviews")
    .update({ busy_until: new Date(now.getTime() + 120_000).toISOString() })
    .eq("id", row.id).or(`busy_until.is.null,busy_until.lt.${now.toISOString()}`).select("*").maybeSingle();
  if (!locked) return json(429, { error: "MILA todavía procesa el segmento anterior. Intenta en unos segundos." });

  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
      .eq("tenant_id", row.tenant_id).eq("resource", "mila_seconds").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < clientSeconds) {
      await admin.from("smyl_mila_interviews").update({ busy_until: null }).eq("id", row.id);
      return json(402, { error: "No hay tiempo de MILA suficiente." });
    }
  }

  const segmentNo = (Number(locked.segments) || 0) + 1;
  const requestId = `${row.id}:${segmentNo}`;
  const started = Date.now();
  try {
    const heard = await transcribe(audio, mime, mode);
    const seconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(heard.seconds ?? clientSeconds)));
    const key = mode === "history" ? "transcript_history" : "transcript_exam";
    const fullTranscript = heard.text
      ? `${locked[key] ? `${locked[key]}\n` : ""}${heard.text}`.slice(-MAX_TRANSCRIPT)
      : String(locked[key] || "");

    let interpreted: Row | null = null;
    let interpretUsage: Usage = { input_tokens: 0, output_tokens: 0 };
    let interpretError = false;
    if (heard.text) {
      try {
        const out = await interpret(mode, fullTranscript);
        interpreted = out.result;
        interpretUsage = out.usage;
      } catch (error) {
        interpretError = true;
        console.warn("[mila-interview:interpret]", requestId, error instanceof Error ? error.message : error);
      }
    }
    const usage: Usage = {
      input_tokens: heard.usage.input_tokens + interpretUsage.input_tokens,
      output_tokens: heard.usage.output_tokens + interpretUsage.output_tokens,
    };

    // Consumo: segundos de MILA (saldo) + tokens reales (auditoría de IA).
    const { data: consumed, error: consumeError } = await admin.rpc("smyl_consume", {
      p_tenant_id: row.tenant_id,
      p_resource: "mila_seconds",
      p_quantity_units: seconds,
      p_idempotency_key: `mila-interview:${requestId}`,
      p_source_type: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
      p_source_id: requestId,
      p_provider: "openai",
      p_provider_model: TRANSCRIBE_MODEL,
      p_metadata: {
        context: mode,
        bytes: audio.size,
        extract_model: EXTRACT_MODEL,
        token_usage: {
          transcription_input_tokens: heard.usage.input_tokens,
          transcription_output_tokens: heard.usage.output_tokens,
          interpretation_input_tokens: interpretUsage.input_tokens,
          interpretation_output_tokens: interpretUsage.output_tokens,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.input_tokens + usage.output_tokens,
        },
      },
      p_enforce: CONSUMABLES_ENFORCED,
    });
    if (consumeError) console.error("[mila-interview:consume]", requestId, consumeError.message);
    const consumedRow = Array.isArray(consumed) ? consumed[0] : consumed;
    await admin.from("smyl_ai_usage_log").insert({
      tenant_id: row.tenant_id,
      feature: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
      model: EXTRACT_MODEL,
      request_id: requestId,
      outcome: interpretError ? "incomplete" : "ok",
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      duration_ms: seconds * 1000,
      estimated_cost_usd: cost(usage),
    }).then(({ error }) => { if (error) console.error("[mila-interview:usage-log]", requestId, error.message); });

    const result = { ...(locked.result || {}) };
    if (interpreted) result[mode] = { ...interpreted, updated_at: new Date().toISOString() };
    await admin.from("smyl_mila_interviews").update({
      [key]: fullTranscript,
      result,
      segments: segmentNo,
      audio_seconds: (Number(locked.audio_seconds) || 0) + seconds,
      input_tokens: (Number(locked.input_tokens) || 0) + usage.input_tokens,
      output_tokens: (Number(locked.output_tokens) || 0) + usage.output_tokens,
      busy_until: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    if (consumedRow && consumedRow.accepted === false) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, {
      heard: heard.text,
      seconds,
      tokens: { input: usage.input_tokens, output: usage.output_tokens },
      interpreted: !!interpreted,
      warning: !heard.text ? "No se reconoció voz en este segmento." : interpretError ? "Se guardó lo escuchado, pero MILA no pudo interpretarlo. Se reintentará con el siguiente segmento." : "",
      history: result.history || null,
      exam: result.exam || null,
      elapsed_ms: Date.now() - started,
    });
  } catch (error) {
    await admin.from("smyl_mila_interviews").update({ busy_until: null }).eq("id", row.id);
    console.error("[mila-interview:segment]", requestId, error instanceof Error ? error.message : error);
    return json(502, { error: "No se pudo procesar este segmento. Vuelve a grabarlo." });
  }
});
