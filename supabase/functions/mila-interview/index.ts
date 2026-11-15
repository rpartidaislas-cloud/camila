// MILA · Entrevista de historia clínica y dictado de exploración desde el celular (QR).
//
// Computadora (sesión de usuario + clinical.write):
//   create {patient_id}        → crea la sesión y devuelve el token del QR (una sola vez).
//   status {id}                → estado, consentimiento, alertas, borrador interpretado y consumo (sondeo).
//   close  {id}                → borra la sesión (transcripción y borrador) al aplicar o descartar.
// Celular (sin login; capacidad = token del QR y luego secreto de dispositivo):
//   pair    {id, token}        → vincula UN dispositivo; el token deja de servir para otro.
//   consent {id, device}       → registra que el paciente aceptó la grabación.
//   segment (multipart)        → modo «Yo pregunto»: transcribe y responde de inmediato; la interpretación
//                                corre en segundo plano (EdgeRuntime.waitUntil) y el celular la sondea con state.
//   realtime {id, device, sdp} → modo «MILA entrevista»: abre la conversación de voz con OpenAI Realtime.
//   realtime_turn / realtime_alert / realtime_finish → guardan los turnos, las alertas inmediatas y cierran.
//   state / finish
//
// No se guarda audio. La transcripción y el borrador viven solo en smyl_mila_interviews hasta que el
// dentista aplica o descarta, o hasta que vence (90 min). El consumo se mide en el servidor: segundos de
// MILA (smyl_consume) y tokens por llamada (smyl_ai_usage_log, request_id = "<sesión>:<paso>").

import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import {
  ALERT_LABELS,
  ALERT_TYPES,
  buildInterviewerInstructions,
  EXAM_PROMPT,
  EXAM_SCHEMA,
  firstName,
  HISTORY_PROMPT,
  HISTORY_SCHEMA,
  INTERVIEW_GUIDE,
  INTERVIEWER_TOOLS,
  normalizeExam,
  normalizeHistory,
} from "../_shared/mila-interview-contract.mjs";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-transcribe";
const EXTRACT_MODEL =
  Deno.env.get("OPENAI_MILA_INTERVIEW_MODEL") || Deno.env.get("OPENAI_MILA_NOTE_MODEL") || "gpt-5-mini";
// Menos razonamiento = respuesta más rápida. Vacío = no se envía (para modelos que no lo aceptan).
const EXTRACT_REASONING = Deno.env.get("OPENAI_MILA_INTERVIEW_REASONING") ?? "low";
const REALTIME_MODEL = Deno.env.get("OPENAI_REALTIME_MODEL") || "gpt-realtime-2.1";
// Voz femenina por defecto; se puede probar otra sin tocar código (ej. coral, shimmer, sage).
const REALTIME_VOICE = Deno.env.get("OPENAI_MILA_INTERVIEW_VOICE") || Deno.env.get("OPENAI_REALTIME_VOICE") || "marin";
const REALTIME_TRANSCRIBE_MODEL = Deno.env.get("OPENAI_REALTIME_TRANSCRIBE_MODEL") || "gpt-transcribe";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
// Tarifas opcionales (USD por millón de tokens) para estimar costo. Sin configurar, el costo queda vacío.
const PRICE_IN = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_IN") || "");
const PRICE_OUT = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_OUT") || "");

const SESSION_MINUTES = 90;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_SECONDS = 180;
const MAX_REALTIME_SECONDS = 45 * 60;
const MAX_TRANSCRIPT = 60000;
const ALLOWED_MIME = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Row = Record<string, any>;
type Usage = { input_tokens: number; output_tokens: number };
type Mode = "history" | "exam";

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
function tokenCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 50_000_000) : 0;
}
function usageOf(raw: Row): Usage {
  const u = raw && typeof raw.usage === "object" && raw.usage ? raw.usage : {};
  return { input_tokens: tokenCount(u.input_tokens ?? u.prompt_tokens), output_tokens: tokenCount(u.output_tokens ?? u.completion_tokens) };
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
function cleanText(v: unknown, max: number): string {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}
const HAS_WAIT_UNTIL = typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function";
function background(task: Promise<unknown>) {
  const safe = task.catch((e) => console.error("[mila-interview:background]", e instanceof Error ? e.message : e));
  EdgeRuntime!.waitUntil(safe);
}

async function purgeExpired() {
  await admin.from("smyl_mila_interviews").delete().lt("expires_at", new Date().toISOString());
}

async function interpret(mode: Mode, transcript: string): Promise<{ result: Row; usage: Usage }> {
  const body: Row = {
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
  };
  if (EXTRACT_REASONING) body.reasoning = { effort: EXTRACT_REASONING };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(`Interpretación ${response.status}`);
  const parsed = JSON.parse(extractOutputText(payload));
  const result = mode === "history" ? normalizeHistory(parsed, transcript) : normalizeExam(parsed, transcript);
  return { result, usage: usageOf(payload) };
}

async function transcribe(audio: File, mime: string, mode: Mode): Promise<{ text: string; seconds: number | null; usage: Usage }> {
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

async function logUsage(tenantId: string, mode: Mode, model: string, requestId: string, usage: Usage, seconds: number, outcome: "ok" | "incomplete" | "error") {
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenantId,
    feature: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
    model: model.slice(0, 80),
    request_id: requestId.slice(0, 120),
    outcome,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    duration_ms: seconds * 1000,
    estimated_cost_usd: cost(usage),
  });
  if (error) console.error("[mila-interview:usage-log]", requestId, error.message);
}

async function consumeSeconds(tenantId: string, mode: Mode, key: string, seconds: number, model: string, metadata: Row) {
  const { data, error } = await admin.rpc("smyl_consume", {
    p_tenant_id: tenantId,
    p_resource: "mila_seconds",
    p_quantity_units: Math.max(1, seconds),
    p_idempotency_key: `mila-interview:${key}`,
    p_source_type: mode === "history" ? "mila_history_interview" : "mila_exam_dictation",
    p_source_id: key,
    p_provider: "openai",
    p_provider_model: model,
    p_metadata: metadata,
    p_enforce: CONSUMABLES_ENFORCED,
  });
  if (error) console.error("[mila-interview:consume]", key, error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return !(row && row.accepted === false);
}

/* Interpreta lo transcrito y guarda el borrador sin pisar uno más reciente (dos segmentos pueden terminar en otro orden). */
async function interpretAndStore(rowId: string, tenantId: string, mode: Mode, transcript: string, requestId: string) {
  let outcome: "ok" | "error" = "ok";
  let usage: Usage = { input_tokens: 0, output_tokens: 0 };
  let result: Row | null = null;
  try {
    const out = await interpret(mode, transcript);
    result = out.result;
    usage = out.usage;
  } catch (error) {
    outcome = "error";
    console.warn("[mila-interview:interpret]", requestId, error instanceof Error ? error.message : error);
  }
  await logUsage(tenantId, mode, EXTRACT_MODEL, `${requestId}-int`, usage, 0, outcome);
  const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", rowId).maybeSingle();
  if (!fresh) return null;
  const current = fresh.result || {};
  const prior = current[mode];
  const pending = { ...(current.pending || {}) };
  if (Number(pending[mode] || 0) <= transcript.length) delete pending[mode];
  const next: Row = { ...current, pending };
  if (result && (!prior || Number(prior.source_chars || 0) <= transcript.length)) {
    next[mode] = { ...result, source_chars: transcript.length, updated_at: new Date().toISOString() };
  } else if (!result) {
    next.interpret_error = { mode, at: new Date().toISOString() };
  }
  await admin.from("smyl_mila_interviews").update({ result: next, updated_at: new Date().toISOString() }).eq("id", rowId);
  return next;
}

async function sessionTokens(tenantId: string, id: string): Promise<{ input: number; output: number }> {
  const { data } = await admin.from("smyl_ai_usage_log").select("input_tokens,output_tokens")
    .eq("tenant_id", tenantId).like("request_id", `${id}:%`).limit(1000);
  let input = 0, output = 0;
  for (const r of data || []) { input += Number(r.input_tokens) || 0; output += Number(r.output_tokens) || 0; }
  return { input, output };
}

function alertsOf(result: Row): Row[] {
  return Array.isArray(result?.alerts) ? result.alerts : [];
}

async function publicStatus(row: Row) {
  const result = row.result || {};
  const pending = result.pending || {};
  return {
    id: row.id,
    status: row.status,
    paired: !!row.device_hash,
    consent: !!row.consent_at,
    segments: row.segments,
    audio_seconds: row.audio_seconds,
    tokens: await sessionTokens(row.tenant_id, row.id),
    finished: !!result.finished_at,
    history: result.history || null,
    exam: result.exam || null,
    alerts: alertsOf(result),
    realtime: result.realtime ? { active: !!result.realtime.started_at && !result.realtime.finished_at, finished: !!result.realtime.finished_at } : null,
    interpreting: !!(pending.history || pending.exam),
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
    return json(200, await publicStatus(row));
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
    const full = [patient?.nombre, patient?.apellido].map((v) => cleanText(v, 80)).filter(Boolean).join(" ") || "Paciente";
    return json(200, { device, patient: full, guide: INTERVIEW_GUIDE, expires_at: row.expires_at, max_segment_seconds: MAX_SEGMENT_SECONDS });
  }

  const device = field("device");
  if (!device || !row.device_hash || !sameHash(await sha256(device), row.device_hash)) {
    return json(403, { error: "Este celular no está vinculado a la sesión." });
  }
  const result: Row = row.result || {};

  if (action === "consent") {
    await admin.from("smyl_mila_interviews").update({ consent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { consent: true });
  }
  if (action === "finish") {
    await admin.from("smyl_mila_interviews").update({ result: { ...result, finished_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { finished: true });
  }
  if (action === "state") {
    const pending = result.pending || {};
    return json(200, {
      consent: !!row.consent_at, segments: row.segments, history: result.history || null, exam: result.exam || null,
      alerts: alertsOf(result), interpreting: !!(pending.history || pending.exam), tokens: await sessionTokens(row.tenant_id, row.id),
      audio_seconds: row.audio_seconds,
      realtime_active: !!(result.realtime?.started_at && !result.realtime?.finished_at),
    });
  }
  if (!row.consent_at) return json(409, { error: "Primero registra el consentimiento del paciente." });

  // ---- MILA entrevista: abrir la conversación de voz
  if (action === "realtime") {
    if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
    const sdp = field("sdp");
    if (!sdp || sdp.length > 100_000) return json(400, { error: "Falta la oferta de audio." });
    if (result.realtime?.started_at && !result.realtime?.finished_at) {
      return json(409, { error: "Ya hay una entrevista de MILA en curso en esta sesión." });
    }
    if (CONSUMABLES_ENFORCED) {
      const { data: wallet } = await admin.from("smyl_wallets").select("balance_units")
        .eq("tenant_id", row.tenant_id).eq("resource", "mila_seconds").maybeSingle();
      if (!wallet || Number(wallet.balance_units) < 120) return json(402, { error: "No hay tiempo de MILA suficiente para una entrevista." });
    }
    const { data: patient } = await admin.from("camila_pacientes").select("nombre")
      .eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    // «Continuar la entrevista»: MILA solo pregunta lo que faltó según el borrador ya interpretado.
    let continuation: { covered: string[]; pending: string[] } | null = null;
    if (field("continuar") === "true" && result.history?.coverage) {
      const cov = result.history.coverage as Record<string, string>;
      const covered: string[] = [], pending: string[] = [];
      for (const sec of INTERVIEW_GUIDE) {
        const done = sec.key === "emergency_contact" ? !!result.history?.document?.emergency_contact : (cov[sec.key] || "not_asked") !== "not_asked";
        (done ? covered : pending).push(sec.title);
      }
      continuation = { covered, pending };
    }
    const session = {
      type: "realtime",
      model: REALTIME_MODEL,
      instructions: buildInterviewerInstructions(firstName(patient?.nombre), continuation ? { continuation } : {}),
      // Sin tope por respuesta: la voz consume muchos tokens y con un límite el resumen final se cortaba a media frase.
      max_output_tokens: "inf",
      audio: {
        input: {
          transcription: { model: REALTIME_TRANSCRIBE_MODEL, languages: ["es"] },
          // Filtra ruido del consultorio (compresor, succión, música); far_field porque el celular queda sobre la mesa, no pegado a la boca.
          noise_reduction: { type: "far_field" },
          turn_detection: { type: "server_vad", threshold: 0.62, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: true, interrupt_response: true },
        },
        output: { voice: REALTIME_VOICE },
      },
      tools: INTERVIEWER_TOOLS,
      tool_choice: "auto",
    };
    try {
      const provider = new FormData();
      provider.set("sdp", sdp);
      provider.set("session", JSON.stringify(session));
      const resp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: provider,
      });
      const answer = await resp.text();
      if (!resp.ok) {
        console.error("[mila-interview:realtime]", row.id, resp.status, answer.slice(0, 400));
        return json(502, { error: "No se pudo abrir la conversación de voz." });
      }
      const startedAt = new Date().toISOString();
      const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", row.id).maybeSingle();
      await admin.from("smyl_mila_interviews").update({
        result: { ...(fresh?.result || {}), realtime: { started_at: startedAt } },
        updated_at: startedAt,
      }).eq("id", row.id);
      return json(200, { answer_sdp: answer, started_at: startedAt });
    } catch (error) {
      console.error("[mila-interview:realtime]", row.id, error instanceof Error ? error.message : error);
      return json(502, { error: "No se pudo conectar con el servicio de voz." });
    }
  }

  if (action === "realtime_turn") {
    const role = field("role") === "mila" ? "MILA" : "Paciente";
    const text = cleanText(field("text"), 2000);
    if (!text) return json(200, { ok: true });
    const fullTranscript = `${row.transcript_history ? `${row.transcript_history}\n` : ""}${role}: ${text}`.slice(-MAX_TRANSCRIPT);
    await admin.from("smyl_mila_interviews").update({ transcript_history: fullTranscript, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { ok: true });
  }

  if (action === "realtime_alert") {
    const tipo = ALERT_TYPES.includes(field("tipo")) ? field("tipo") : "otra";
    const detalle = cleanText(field("detalle"), 240);
    const { data: fresh } = await admin.from("smyl_mila_interviews").select("result").eq("id", row.id).maybeSingle();
    const current = fresh?.result || {};
    const alerts = alertsOf(current).slice(0, 19);
    alerts.push({ tipo, label: (ALERT_LABELS as Record<string, string>)[tipo], detalle, at: new Date().toISOString() });
    await admin.from("smyl_mila_interviews").update({ result: { ...current, alerts }, updated_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { ok: true, alerts });
  }

  if (action === "realtime_finish") {
    const rt = result.realtime || {};
    if (!rt.started_at) return json(409, { error: "No hay una entrevista de MILA en curso." });
    if (rt.finished_at) {
      return json(200, { history: result.history || null, alerts: alertsOf(result), tokens: await sessionTokens(row.tenant_id, row.id), seconds: rt.seconds || 0 });
    }
    const seconds = Math.max(1, Math.min(MAX_REALTIME_SECONDS, Math.ceil((Date.now() - Date.parse(rt.started_at)) / 1000)));
    // Tokens de voz que reporta OpenAI en cada response.done; los suma el celular (se marcan como reportados por el cliente).
    const reported = body.usage && typeof body.usage === "object" ? body.usage : {};
    const voiceUsage: Usage = { input_tokens: tokenCount(reported.input_tokens), output_tokens: tokenCount(reported.output_tokens) };
    // Cada conversación (incluida una continuación) se mide por separado.
    const key = `${row.id}:rt${Date.parse(rt.started_at)}`;
    const accepted = await consumeSeconds(row.tenant_id, "history", key, seconds, REALTIME_MODEL, {
      context: "history_realtime_interview",
      token_usage: {
        ...voiceUsage,
        total_tokens: voiceUsage.input_tokens + voiceUsage.output_tokens,
        cached_input_tokens: tokenCount(reported.cached_input_tokens),
        input_audio_tokens: tokenCount(reported.input_audio_tokens),
        input_text_tokens: tokenCount(reported.input_text_tokens),
        output_audio_tokens: tokenCount(reported.output_audio_tokens),
        output_text_tokens: tokenCount(reported.output_text_tokens),
        usage_source: "client_reported_openai_response_done",
      },
      extract_model: EXTRACT_MODEL,
    });
    await logUsage(row.tenant_id, "history", REALTIME_MODEL, key, voiceUsage, seconds, "ok");
    const { data: fresh } = await admin.from("smyl_mila_interviews").select("result,transcript_history,audio_seconds").eq("id", row.id).maybeSingle();
    const finishedAt = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({
      result: { ...(fresh?.result || {}), realtime: { ...rt, finished_at: finishedAt, seconds } },
      audio_seconds: (Number(fresh?.audio_seconds) || 0) + seconds,
      updated_at: finishedAt,
    }).eq("id", row.id);
    const transcript = String(fresh?.transcript_history || "");
    const next = transcript ? await interpretAndStore(row.id, row.tenant_id, "history", transcript, key) : fresh?.result;
    if (!accepted) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, { history: next?.history || null, alerts: alertsOf(next || {}), tokens: await sessionTokens(row.tenant_id, row.id), seconds });
  }

  if (action !== "segment" || !form) return json(400, { error: "Acción no válida." });

  // ---- modo «Yo pregunto»: segmento de audio
  if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
  const mode: Mode = field("mode") === "exam" ? "exam" : "history";
  const audio = form.get("audio");
  if (!(audio instanceof File)) return json(400, { error: "Falta el audio." });
  const mime = audio.type.split(";")[0].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return json(415, { error: "Formato de audio no permitido." });
  if (audio.size <= 0 || audio.size > MAX_BYTES) return json(413, { error: "El segmento debe pesar menos de 10 MB." });
  const clientSeconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(Number(field("duracion_segundos")) || 1)));

  // Un segmento a la vez por sesión (evita que dos envíos pisen la transcripción).
  const now = new Date();
  const { data: locked } = await admin.from("smyl_mila_interviews")
    .update({ busy_until: new Date(now.getTime() + 90_000).toISOString() })
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
  try {
    const heard = await transcribe(audio, mime, mode);
    const seconds = Math.max(1, Math.min(MAX_SEGMENT_SECONDS, Math.ceil(heard.seconds ?? clientSeconds)));
    const key = mode === "history" ? "transcript_history" : "transcript_exam";
    const fullTranscript = heard.text
      ? `${locked[key] ? `${locked[key]}\n` : ""}${heard.text}`.slice(-MAX_TRANSCRIPT)
      : String(locked[key] || "");
    const accepted = await consumeSeconds(row.tenant_id, mode, requestId, seconds, TRANSCRIBE_MODEL, {
      context: mode, bytes: audio.size, token_usage: { ...heard.usage, total_tokens: heard.usage.input_tokens + heard.usage.output_tokens },
    });
    await logUsage(row.tenant_id, mode, TRANSCRIBE_MODEL, requestId, heard.usage, seconds, "ok");
    const nextResult = { ...(locked.result || {}) };
    if (heard.text) nextResult.pending = { ...(nextResult.pending || {}), [mode]: fullTranscript.length };
    await admin.from("smyl_mila_interviews").update({
      [key]: fullTranscript,
      result: nextResult,
      segments: segmentNo,
      audio_seconds: (Number(locked.audio_seconds) || 0) + seconds,
      busy_until: null,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);

    // La interpretación no bloquea al celular: corre después de responder.
    if (heard.text) {
      const job = interpretAndStore(row.id, row.tenant_id, mode, fullTranscript, requestId);
      if (HAS_WAIT_UNTIL) background(job);
      else await job;
    }

    if (!accepted) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, {
      heard: heard.text,
      seconds,
      interpreting: !!heard.text,
      warning: heard.text ? "" : "No se reconoció voz en este segmento.",
      history: nextResult.history || null,
      exam: nextResult.exam || null,
    });
  } catch (error) {
    await admin.from("smyl_mila_interviews").update({ busy_until: null }).eq("id", row.id);
    console.error("[mila-interview:segment]", requestId, error instanceof Error ? error.message : error);
    return json(502, { error: "No se pudo procesar este segmento. Vuelve a grabarlo." });
  }
});
