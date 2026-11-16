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
import { lanaRequest } from "../_shared/lana-linked.ts";
import {
  ALERT_LABELS,
  ALERT_TYPES,
  buildFromForm,
  buildInterviewerInstructions,
  summarizeKnownHistory,
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
// Turnos de la conversación. «semantic» (por defecto): detector semántico —entiende cuándo terminó una idea, no solo si hay
// sonido— y el celular decide cuándo interrumpir a MILA (un «ajá», «o» o una tos no la cortan). «server»: el esquema anterior
// (VAD por volumen que corta a MILA con cualquier sonido); sirve de regreso rápido sin tocar el celular.
const TURN_MODE = (Deno.env.get("OPENAI_MILA_TURN_MODE") || "semantic").toLowerCase() === "server" ? "server" : "semantic";
const VAD_EAGERNESS = ["low", "medium", "high", "auto"].includes((Deno.env.get("OPENAI_MILA_VAD_EAGERNESS") || "").toLowerCase())
  ? (Deno.env.get("OPENAI_MILA_VAD_EAGERNESS") || "").toLowerCase() : "medium";
const REALTIME_TRANSCRIBE_MODEL = Deno.env.get("OPENAI_REALTIME_TRANSCRIBE_MODEL") || "gpt-transcribe";
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
// Tarifas opcionales (USD por millón de tokens) para estimar costo. Sin configurar, el costo queda vacío.
const PRICE_IN = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_IN") || "");
const PRICE_OUT = Number(Deno.env.get("MILA_INTERVIEW_USD_PER_MTOK_OUT") || "");

const SESSION_MINUTES = 90;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENT_SECONDS = 180;
const MAX_REALTIME_SECONDS = 45 * 60;
// Entrevista previa (el paciente solo): una conversación de voz, máx. 15 min; el enlace vence 1 día después de la cita o en 7 días.
const MAX_PREVISIT_REALTIME_SECONDS = 15 * 60;
const PREVISIT_TEMPLATE = "entrevista_previa_v1";
const APP_BASE = Deno.env.get("SMYL_APP_BASE_URL") || "https://app.smyldesign.ai";
const CRON_SECRET = (Deno.env.get("SMYL_REMINDERS_CRON_SECRET") || "").trim();
const CLINIC_TZ = "America/Mexico_City";
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
    consent_at: row.consent_at,
    kind: row.kind || "clinic",
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

// ---------------------------------------------------------------- entrevista previa (helpers)
async function clinicName(tenantId: string): Promise<string> {
  const { data } = await admin.from("camila_tenants").select("nombre,config").eq("id", tenantId).maybeSingle();
  const config = data?.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  return cleanText(config.consultorio, 120) || cleanText(data?.nombre, 120) || "tu clínica";
}
function appointmentLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const day = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: CLINIC_TZ }).format(d).replace(",", "");
  const hour = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: CLINIC_TZ }).format(d)
    .replace(/\s*([ap])\.?\s?m\.?/i, (_m, x) => ` ${x.toLowerCase()}m`);
  return `${day} a las ${hour}`;
}
async function nextAppointment(tenantId: string, patientId: string, appointmentId: string) {
  let q = admin.from("smyl_appointments").select("id,starts_at,status").eq("tenant_id", tenantId).eq("patient_id", patientId);
  if (UUID.test(appointmentId)) q = q.eq("id", appointmentId);
  else q = q.gte("starts_at", new Date().toISOString()).order("starts_at", { ascending: true });
  const { data } = await q.limit(5);
  return (data || []).find((r: Row) => !/cancel/i.test(String(r.status || ""))) || null;
}
async function whatsappConversation(tenantId: string, patientId: string): Promise<string | null> {
  const { data } = await admin.from("camila_lana_handoffs").select("lana_conversation_id")
    .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("lana_channel", "whatsapp")
    .order("updated_at", { ascending: false }).limit(1);
  return data && data[0] ? String(data[0].lana_conversation_id) : null;
}
/* Envía la plantilla aprobada «entrevista_previa_v1» por la conversación de WhatsApp del paciente (vía LANA). */
type Actor = { id: string; email?: string };
function actorHeaders(tenantId: string, user: Actor): Headers {
  return new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(cleanText(user.email, 160).split("@")[0] || "Equipo"),
  });
}
/* Id de la plantilla «entrevista_previa_v1» si ya está aprobada en LANA; null si no existe o no está aprobada. */
async function previsitTemplateId(tenantId: string, user: Actor): Promise<string | null> {
  const list = await lanaRequest(tenantId, "/inbox/whatsapp/templates", { method: "GET", headers: actorHeaders(tenantId, user) }, 12000);
  const templates = Array.isArray(list.body.templates) ? list.body.templates as Row[] : [];
  const template = templates.find((t) => String(t.name || "") === PREVISIT_TEMPLATE && !/reject|rechaz|pending|pendiente|paused|disabled/i.test(String(t.status || "")));
  return template?.id ? String(template.id) : null;
}
async function sendPrevisitWhatsApp(tenantId: string, patientId: string, user: Actor, variables: string[], idempotency: string, knownTemplate?: string | null) {
  const conversation = await whatsappConversation(tenantId, patientId);
  if (!conversation) return { sent: false, reason: "no_conversation" };
  const actor = actorHeaders(tenantId, user);
  try {
    const templateId = knownTemplate || await previsitTemplateId(tenantId, user);
    if (!templateId) return { sent: false, reason: "template_not_approved" };
    const template = { id: templateId };
    const headers = new Headers(actor);
    headers.set("Idempotency-Key", idempotency);
    const remote = await lanaRequest(tenantId, `/inbox/conversations/${conversation}/scheduled`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "template", send_at: new Date(Date.now() + 60_000).toISOString(), template_id: template.id, template_variables: variables.map((v) => v.slice(0, 1000)) }),
    }, 15000);
    if (!remote.response.ok) return { sent: false, reason: "lana_error", detail: cleanText(remote.body.error, 200) };
    return { sent: true, reason: "" };
  } catch (error) {
    console.warn("[mila-interview:previsit-whatsapp]", error instanceof Error ? error.message : error);
    return { sent: false, reason: "lana_unavailable" };
  }
}
async function auditConsent(row: Row, method: string) {
  // Constancia del consentimiento en el expediente: quién, cuándo, cómo. Sin contenido clínico.
  await admin.from("mila_audit_log").insert({
    tenant_id: row.tenant_id, user_id: row.kind === "previsit" ? null : row.created_by,
    event_type: "mila_interview_consent", entity_type: "patient", entity_id: row.patient_id,
    metadata: { interview_id: row.id, kind: row.kind || "clinic", method, at: new Date().toISOString() },
  }).then(({ error }) => { if (error) console.error("[mila-interview:consent-audit]", error.message); });
}
async function knownHistory(tenantId: string, patientId: string): Promise<string[]> {
  const { data } = await admin.from("smyl_patient_histories").select("document").eq("tenant_id", tenantId).eq("patient_id", patientId).maybeSingle();
  return data?.document ? summarizeKnownHistory(data.document) : [];
}
function sameDob(input: string, stored: unknown): boolean {
  const a = String(input || "").trim(), b = String(stored || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(a) && a === b;
}

// ---------------------------------------------------------------- entrevista previa: envío, registro por cita y envío automático
const AUTO_ACTOR = (tenantId: string): Actor => ({ id: tenantId, email: "MILA" });
const AUTO_MAX_PER_RUN = 25;
const AUTO_RESEND_DAYS = 30;
const AUTO_STALE_DAYS = 365;
const AUTO_THROTTLE_MS = 10 * 60_000;

/* Crea la entrevista previa (una vigente por paciente), la envía y deja constancia en la cita. */
async function createPrevisit(o: {
  tenantId: string; patient: Row; appt: Row | null; mode: string; via: "whatsapp" | "link";
  actor: Actor; origin: "manual" | "auto"; templateId?: string | null;
}): Promise<Row> {
  const { tenantId, patient, appt, mode, via, actor, origin } = o;
  const label = appt ? appointmentLabel(appt.starts_at) : "";
  const apptEnd = appt ? Date.parse(appt.starts_at) + 24 * 3600_000 : 0;
  const expires = new Date(Math.max(Date.now() + 2 * 3600_000, Math.min(apptEnd || Infinity, Date.now() + 7 * 24 * 3600_000))).toISOString();
  // Un solo envío vigente por paciente: el anterior sin responder se reemplaza.
  await admin.from("smyl_mila_interviews").delete()
    .eq("tenant_id", tenantId).eq("patient_id", patient.id).eq("kind", "previsit").is("submitted_at", null);
  const token = randomToken();
  const { data: created, error } = await admin.from("smyl_mila_interviews").insert({
    tenant_id: tenantId, patient_id: patient.id, created_by: actor.id, kind: "previsit", previsit_mode: mode,
    appointment_id: appt?.id || null, appointment_label: label || null, sent_via: via,
    pair_token_hash: await sha256(token), expires_at: expires,
  }).select("id,expires_at").single();
  if (error || !created) return { error: "No se pudo crear la entrevista previa." };
  const url = `${APP_BASE}/mila-movil.html#s=${created.id}&t=${encodeURIComponent(token)}`;
  let delivery = { sent: false, reason: via === "link" ? "link" : "" } as Row;
  if (via === "whatsapp") {
    delivery = await sendPrevisitWhatsApp(tenantId, patient.id, actor,
      [firstName(patient.nombre) || "paciente", label || "tu próxima cita", await clinicName(tenantId), url], `mila-previsit:${created.id}`, o.templateId);
  }
  if (appt?.id) await recordDispatch(tenantId, appt.id, patient.id, created.id, origin,
    via === "link" ? "link" : delivery.sent ? "sent" : "failed", via === "link" ? null : (delivery.reason || null), origin === "auto" ? null : actor.id);
  return { id: created.id, url, expires_at: created.expires_at, appointment: label, mode, ...delivery };
}

async function recordDispatch(tenantId: string, appointmentId: string, patientId: string, interviewId: string | null,
  origin: "manual" | "auto", status: "sent" | "link" | "failed" | "skipped" | "reviewed", reason: string | null, createdBy: string | null) {
  const { error } = await admin.from("smyl_mila_previsit_dispatches").upsert({
    tenant_id: tenantId, appointment_id: appointmentId, patient_id: patientId, interview_id: interviewId,
    origin, status, reason: reason ? reason.slice(0, 60) : null, created_by: createdBy, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,appointment_id" });
  if (error) console.error("[mila-interview:dispatch-log]", error.message);
}

type PrevisitSettings = { enabled: boolean; hours_before: number; mode: string; audience: string; last_dispatch_at: string | null };
const DEFAULT_SETTINGS: PrevisitSettings = { enabled: false, hours_before: 48, mode: "choice", audience: "stale", last_dispatch_at: null };
async function previsitSettings(tenantId: string): Promise<PrevisitSettings> {
  const { data } = await admin.from("smyl_mila_previsit_settings")
    .select("enabled,hours_before,mode,audience,last_dispatch_at").eq("tenant_id", tenantId).maybeSingle();
  return data ? data as PrevisitSettings : { ...DEFAULT_SETTINGS };
}

/* Envío automático: citas confirmadas dentro de la ventana, a pacientes sin historia (o vieja), sin envío reciente. */
async function dispatchPrevisits(tenantId: string, settings: PrevisitSettings): Promise<Row> {
  await admin.from("smyl_mila_previsit_settings").update({ last_dispatch_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  if (!settings.enabled) return { skipped: "disabled" };
  if (settings.mode !== "form" && !OPENAI_API_KEY) return { skipped: "mila_unconfigured" };
  const now = Date.now();
  const { data: appts } = await admin.from("smyl_appointments").select("id,patient_id,starts_at,status")
    .eq("tenant_id", tenantId).eq("status", "confirmed")
    .gt("starts_at", new Date(now + 3600_000).toISOString())
    .lte("starts_at", new Date(now + settings.hours_before * 3600_000).toISOString())
    .order("starts_at", { ascending: true }).limit(300);
  if (!appts?.length) return { sent: 0, failed: 0, skipped: 0 };
  const apptIds = appts.map((a: Row) => a.id);
  const patientIds = [...new Set(appts.map((a: Row) => String(a.patient_id)))];
  const [{ data: done }, { data: recent }, { data: histories }, { data: open }] = await Promise.all([
    admin.from("smyl_mila_previsit_dispatches").select("appointment_id").eq("tenant_id", tenantId).in("appointment_id", apptIds),
    admin.from("smyl_mila_previsit_dispatches").select("patient_id").eq("tenant_id", tenantId).in("patient_id", patientIds)
      .gt("created_at", new Date(now - AUTO_RESEND_DAYS * 86400_000).toISOString()),
    admin.from("smyl_patient_histories").select("patient_id,updated_at").eq("tenant_id", tenantId).in("patient_id", patientIds),
    admin.from("smyl_mila_interviews").select("patient_id").eq("tenant_id", tenantId).eq("kind", "previsit")
      .in("patient_id", patientIds).gt("expires_at", new Date().toISOString()),
  ]);
  const doneAppts = new Set((done || []).map((r: Row) => String(r.appointment_id)));
  const busy = new Set([...(recent || []), ...(open || [])].map((r: Row) => String(r.patient_id)));
  const historyAt = new Map((histories || []).map((r: Row) => [String(r.patient_id), Date.parse(r.updated_at) || 0]));
  const due = appts.filter((a: Row) => {
    if (doneAppts.has(String(a.id)) || busy.has(String(a.patient_id))) return false;
    const at = historyAt.get(String(a.patient_id));
    if (settings.audience === "no_history") return at === undefined;
    if (settings.audience === "stale") return at === undefined || at < now - AUTO_STALE_DAYS * 86400_000;
    return true;
  });
  if (!due.length) return { sent: 0, failed: 0, skipped: 0 };
  const actor = AUTO_ACTOR(tenantId);
  let templateId: string | null = null;
  try { templateId = await previsitTemplateId(tenantId, actor); } catch { return { skipped: "lana_unavailable" }; }
  // Sin plantilla aprobada no se registra nada: en cuanto Meta la apruebe, sale en la siguiente vuelta.
  if (!templateId) return { skipped: "template_not_approved" };
  const summary = { sent: 0, failed: 0, skipped: 0 };
  const seen = new Set<string>();
  for (const appt of due) {
    if (summary.sent + summary.failed >= AUTO_MAX_PER_RUN) break;
    const pid = String(appt.patient_id);
    if (seen.has(pid)) { summary.skipped++; continue; }
    seen.add(pid);
    if (!await whatsappConversation(tenantId, pid)) {
      await recordDispatch(tenantId, appt.id, pid, null, "auto", "failed", "no_conversation", null);
      summary.failed++;
      continue;
    }
    const { data: patient } = await admin.from("camila_pacientes").select("id,nombre").eq("tenant_id", tenantId).eq("id", pid).maybeSingle();
    if (!patient) { summary.skipped++; continue; }
    const out = await createPrevisit({ tenantId, patient, appt, mode: settings.mode, via: "whatsapp", actor, origin: "auto", templateId });
    if (out.sent) summary.sent++; else summary.failed++;
  }
  return summary;
}

/* Estado de la entrevista previa por cita, para las marcas de la agenda. */
async function previsitOverview(tenantId: string, appointmentIds: string[], withAlerts: boolean) {
  const ids = appointmentIds.filter((v) => UUID.test(v)).slice(0, 400);
  if (!ids.length) return {};
  const { data: rows } = await admin.from("smyl_mila_previsit_dispatches")
    .select("appointment_id,interview_id,origin,status,reason,created_at").eq("tenant_id", tenantId).in("appointment_id", ids);
  const interviewIds = (rows || []).map((r: Row) => r.interview_id).filter(Boolean);
  const { data: interviews } = interviewIds.length
    ? await admin.from("smyl_mila_interviews").select("id,consent_at,submitted_at,result,expires_at,previsit_mode").in("id", interviewIds)
    : { data: [] as Row[] };
  const byId = new Map((interviews || []).map((r: Row) => [String(r.id), r]));
  const out: Record<string, Row> = {};
  for (const r of rows || []) {
    const iv = r.interview_id ? byId.get(String(r.interview_id)) : null;
    let state = r.status as string;
    let alerts = 0;
    if (r.status === "failed" || r.status === "skipped") state = "failed";
    else if (r.status === "reviewed") state = "reviewed";
    else if (iv) {
      const res = iv.result || {};
      const answered = !!(iv.submitted_at || res.history || res.finished_at || res.realtime?.finished_at);
      state = answered ? "answered" : iv.consent_at ? "in_progress" : "sent";
      alerts = alertsOf(res).length;
    } else state = "expired";
    out[r.appointment_id] = {
      state, origin: r.origin, reason: r.reason || "", sent_at: r.created_at, interview_id: r.interview_id || null,
      ...(withAlerts ? { alerts } : { alerts: alerts ? 1 : 0 }),
    };
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  // Cron (pg_cron + pg_net, mismo secreto que los recordatorios): envío automático de la entrevista previa.
  const cronSecret = req.headers.get("x-smyl-cron-secret") || "";
  if (cronSecret) {
    if (!CRON_SECRET || !sameHash(await sha256(cronSecret), await sha256(CRON_SECRET))) return json(401, { error: "Secreto de cron no válido." });
    const { data: enabled } = await admin.from("smyl_mila_previsit_settings")
      .select("tenant_id,enabled,hours_before,mode,audience,last_dispatch_at").eq("enabled", true).limit(200);
    const results: Record<string, Row> = {};
    for (const row of enabled || []) {
      results[row.tenant_id] = await dispatchPrevisits(row.tenant_id, row as PrevisitSettings).catch((e) => ({ error: e instanceof Error ? e.message : "error" }));
    }
    return json(200, { tenants: Object.keys(results).length, results });
  }

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
  // -------------------------------------------------------------- agenda (marcas de entrevista previa)
  if (action === "previsit_overview") {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const denied = await requirePermission(auth, CORS, "schedule.read");
    if (denied) return denied;
    const tenantId = auth.tenantId!;
    const clinical = (await requirePermission(auth, CORS, "clinical.write")) === null;
    const ids = Array.isArray(body.appointment_ids) ? body.appointment_ids.map(String) : [];
    const settings = await previsitSettings(tenantId);
    // La agenda abierta también dispara el envío automático (como los recordatorios), como mucho cada 10 min.
    const stale = !settings.last_dispatch_at || Date.now() - Date.parse(settings.last_dispatch_at) > AUTO_THROTTLE_MS;
    if (settings.enabled && stale && HAS_WAIT_UNTIL) background(dispatchPrevisits(tenantId, settings));
    return json(200, { items: await previsitOverview(tenantId, ids, clinical), can_send: clinical, auto: settings.enabled });
  }

  if (["create", "status", "close", "previsit_create", "pending", "previsit_settings", "previsit_settings_save"].includes(action)) {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const denied = await requirePermission(auth, CORS, "clinical.write");
    if (denied) return denied;
    const tenantId = auth.tenantId!;
    const userId = auth.user!.id;

    if (action === "previsit_settings") {
      const settings = await previsitSettings(tenantId);
      const canConfigure = (await requirePermission(auth, CORS, "schedule.manage")) === null;
      let templateReady: boolean | null = null;
      try { templateReady = !!(await previsitTemplateId(tenantId, auth.user!)); } catch { templateReady = null; }
      return json(200, { settings, can_configure: canConfigure, template_ready: templateReady, voice_available: !!OPENAI_API_KEY });
    }
    if (action === "previsit_settings_save") {
      const denied2 = await requirePermission(auth, CORS, "schedule.manage");
      if (denied2) return denied2;
      const hours = Math.round(Number(body.hours_before));
      const next = {
        tenant_id: tenantId,
        enabled: body.enabled === true,
        hours_before: Number.isFinite(hours) ? Math.min(168, Math.max(12, hours)) : 48,
        mode: ["voice", "form", "choice"].includes(String(body.mode)) ? String(body.mode) : "choice",
        audience: ["no_history", "stale", "all"].includes(String(body.audience)) ? String(body.audience) : "stale",
        updated_by: userId, updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from("smyl_mila_previsit_settings").upsert(next, { onConflict: "tenant_id" });
      if (error) return json(500, { error: "No se pudo guardar la configuración." });
      const summary = next.enabled ? await dispatchPrevisits(tenantId, { ...next, last_dispatch_at: null }).catch(() => null) : null;
      return json(200, { ok: true, settings: next, summary });
    }

    if (action === "create") {
      if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
      const patientId = field("patient_id");
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: patient } = await admin.from("camila_pacientes").select("id,nombre,apellido")
        .eq("tenant_id", tenantId).eq("id", patientId).maybeSingle();
      if (!patient) return json(404, { error: "El paciente no pertenece a tu clínica." });
      await purgeExpired();
      // Las sesiones de este profesional que nunca empezaron se descartan; un borrador sin guardar se conserva (aparece en la Historia clínica).
      await admin.from("smyl_mila_interviews").delete()
        .eq("tenant_id", tenantId).eq("patient_id", patientId).eq("created_by", userId).eq("kind", "clinic").is("consent_at", null);
      const token = randomToken();
      const expires = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();
      const { data: row, error } = await admin.from("smyl_mila_interviews").insert({
        tenant_id: tenantId, patient_id: patientId, created_by: userId,
        pair_token_hash: await sha256(token), expires_at: expires,
      }).select("id,expires_at").single();
      if (error || !row) return json(500, { error: "No se pudo crear la sesión de MILA." });
      return json(200, { id: row.id, token, expires_at: row.expires_at });
    }

    // Entrevista previa: la clínica elige voz, formulario o que el paciente decida; se envía por WhatsApp o se copia el enlace.
    if (action === "previsit_create") {
      const patientId = field("patient_id");
      const mode = ["voice", "form", "choice"].includes(field("mode")) ? field("mode") : "choice";
      const via = field("via") === "whatsapp" ? "whatsapp" : "link";
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: patient } = await admin.from("camila_pacientes").select("id,nombre")
        .eq("tenant_id", tenantId).eq("id", patientId).maybeSingle();
      if (!patient) return json(404, { error: "El paciente no pertenece a tu clínica." });
      if (mode !== "form" && !OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía; usa el formulario." });
      await purgeExpired();
      const appt = await nextAppointment(tenantId, patientId, field("appointment_id"));
      const out = await createPrevisit({ tenantId, patient, appt, mode, via, actor: auth.user!, origin: "manual" });
      if (out.error) return json(500, { error: out.error });
      return json(200, out);
    }

    // Borradores de MILA de este paciente que nadie ha guardado (consultorio terminado o entrevista previa respondida).
    if (action === "pending") {
      const patientId = field("patient_id");
      if (!UUID.test(patientId)) return json(400, { error: "Paciente inválido." });
      const { data: rows } = await admin.from("smyl_mila_interviews")
        .select("id,kind,previsit_mode,appointment_label,sent_via,created_by,consent_at,submitted_at,result,expires_at,created_at")
        .eq("tenant_id", tenantId).eq("patient_id", patientId).neq("status", "closed")
        .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(5);
      const items = (rows || []).filter((r: Row) => r.kind === "previsit" || r.created_by === userId).map((r: Row) => {
        const res = r.result || {};
        return {
          id: r.id, kind: r.kind, mode: r.previsit_mode, appointment: r.appointment_label, sent_via: r.sent_via,
          consent_at: r.consent_at, submitted_at: r.submitted_at, created_at: r.created_at, expires_at: r.expires_at,
          has_history: !!res.history, finished: !!(res.finished_at || r.submitted_at || res.realtime?.finished_at),
          alerts: alertsOf(res), coverage: res.history?.coverage || null, source: res.history?.source || (res.realtime ? "voice" : "recording"),
        };
      });
      return json(200, { items });
    }

    if (!UUID.test(id)) return json(400, { error: "Sesión inválida." });
    const { data: found } = await admin.from("smyl_mila_interviews").select("*")
      .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    const row = found && (found.created_by === userId || found.kind === "previsit") ? found : null;
    if (!row) return json(404, { error: "La sesión de MILA ya no existe o venció." });

    if (action === "close") {
      if (row.kind === "previsit") {
        await admin.from("smyl_mila_previsit_dispatches").update({ status: "reviewed", updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("interview_id", row.id);
      }
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
    if (row.device_hash) return json(409, { error: row.kind === "previsit" ? "Este enlace ya se abrió en otro dispositivo. Ábrelo en el mismo celular o pide a tu clínica uno nuevo." : "Este código ya se usó en otro celular. Genera uno nuevo." });
    const device = randomToken();
    const { data: updated } = await admin.from("smyl_mila_interviews")
      .update({ device_hash: await sha256(device), status: "paired", updated_at: new Date().toISOString() })
      .eq("id", row.id).is("device_hash", null).select("id").maybeSingle();
    if (!updated) return json(409, { error: "Este código ya se usó en otro celular. Genera uno nuevo." });
    const { data: patient } = await admin.from("camila_pacientes").select("nombre,apellido,fecha_nacimiento")
      .eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    if (row.kind === "previsit") {
      // El enlace pudo reenviarse: solo el primer nombre y, si la ficha tiene fecha de nacimiento, se pide antes de seguir.
      const needsDob = !!patient?.fecha_nacimiento;
      if (!needsDob) await admin.from("smyl_mila_interviews").update({ identity_verified_at: new Date().toISOString() }).eq("id", row.id);
      return json(200, {
        device, kind: "previsit", patient: firstName(patient?.nombre) || "Paciente", clinic: await clinicName(row.tenant_id),
        appointment: row.appointment_label || "", mode: row.previsit_mode || "choice", needs_dob: needsDob,
        submitted: !!row.submitted_at, guide: INTERVIEW_GUIDE, expires_at: row.expires_at,
        voice_available: !!OPENAI_API_KEY, max_voice_seconds: MAX_PREVISIT_REALTIME_SECONDS,
      });
    }
    const full = [patient?.nombre, patient?.apellido].map((v) => cleanText(v, 80)).filter(Boolean).join(" ") || "Paciente";
    return json(200, { device, kind: "clinic", patient: full, guide: INTERVIEW_GUIDE, expires_at: row.expires_at, max_segment_seconds: MAX_SEGMENT_SECONDS });
  }

  const device = field("device");
  if (!device || !row.device_hash || !sameHash(await sha256(device), row.device_hash)) {
    return json(403, { error: "Este celular no está vinculado a la sesión." });
  }
  const result: Row = row.result || {};

  if (action === "verify") {
    if (row.kind !== "previsit" || row.identity_verified_at) return json(200, { verified: true });
    if ((Number(row.identity_attempts) || 0) >= 5) return json(429, { error: "Demasiados intentos. Pide a tu clínica un enlace nuevo." });
    const { data: patient } = await admin.from("camila_pacientes").select("fecha_nacimiento").eq("tenant_id", row.tenant_id).eq("id", row.patient_id).maybeSingle();
    if (!sameDob(field("dob"), patient?.fecha_nacimiento)) {
      await admin.from("smyl_mila_interviews").update({ identity_attempts: (Number(row.identity_attempts) || 0) + 1 }).eq("id", row.id);
      return json(403, { error: "La fecha no coincide con la que tiene tu clínica. Revisa e intenta de nuevo." });
    }
    await admin.from("smyl_mila_interviews").update({ identity_verified_at: new Date().toISOString() }).eq("id", row.id);
    return json(200, { verified: true });
  }
  if (row.kind === "previsit" && !row.identity_verified_at && action !== "state") return json(403, { error: "Primero confirma tu fecha de nacimiento." });
  if (row.kind === "previsit" && row.submitted_at && action !== "state") return json(409, { error: "Esta entrevista ya fue enviada. ¡Gracias! Tu dentista la revisará en tu cita." });

  if (action === "consent") {
    if (!row.consent_at) {
      await admin.from("smyl_mila_interviews").update({ consent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
      await auditConsent(row, row.kind === "previsit" ? "paciente_en_enlace" : "dentista_en_celular");
    }
    return json(200, { consent: true });
  }
  if (action === "form_submit") {
    if (row.kind !== "previsit" || row.previsit_mode === "voice") return json(400, { error: "Esta entrevista no usa formulario." });
    if (!row.consent_at) return json(409, { error: "Primero acepta el aviso de privacidad." });
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    if (JSON.stringify(answers).length > 30000) return json(413, { error: "Respuestas demasiado largas." });
    const history = { ...buildFromForm(answers), updated_at: new Date().toISOString() };
    const now = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({
      result: { ...result, history, finished_at: now }, submitted_at: now, updated_at: now,
    }).eq("id", row.id);
    return json(200, { submitted: true, coverage: history.coverage });
  }
  if (action === "finish") {
    const now = new Date().toISOString();
    await admin.from("smyl_mila_interviews").update({ result: { ...result, finished_at: now }, updated_at: now, ...(row.kind === "previsit" && result.history ? { submitted_at: now } : {}) }).eq("id", row.id);
    return json(200, { finished: true });
  }
  if (action === "state") {
    const pending = result.pending || {};
    return json(200, {
      consent: !!row.consent_at, segments: row.segments, history: result.history || null, exam: result.exam || null,
      alerts: alertsOf(result), interpreting: !!(pending.history || pending.exam), tokens: await sessionTokens(row.tenant_id, row.id),
      audio_seconds: row.audio_seconds,
      realtime_active: !!(result.realtime?.started_at && !result.realtime?.finished_at),
      verified: row.kind !== "previsit" || !!row.identity_verified_at, submitted: !!row.submitted_at,
    });
  }
  if (!row.consent_at) return json(409, { error: "Primero registra el consentimiento del paciente." });

  // ---- MILA entrevista: abrir la conversación de voz
  if (action === "realtime") {
    if (!OPENAI_API_KEY) return json(503, { error: "MILA no está configurada todavía." });
    const sdp = field("sdp");
    if (!sdp || sdp.length > 100_000) return json(400, { error: "Falta la oferta de audio." });
    if (row.kind === "previsit" && row.previsit_mode === "form") return json(400, { error: "Esta entrevista es por formulario." });
    if (row.kind === "previsit" && result.realtime?.finished_at) return json(409, { error: "Ya platicaste con MILA. Si falta algo puedes completarlo con el formulario." });
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
      instructions: buildInterviewerInstructions(firstName(patient?.nombre), {
        ...(continuation ? { continuation } : {}),
        known: await knownHistory(row.tenant_id, row.patient_id),
        ...(row.kind === "previsit" ? { previsit: { clinic: await clinicName(row.tenant_id), appointment: row.appointment_label || "" } } : {}),
      }),
      // Sin tope por respuesta: la voz consume muchos tokens y con un límite el resumen final se cortaba a media frase.
      max_output_tokens: "inf",
      audio: {
        input: {
          transcription: { model: REALTIME_TRANSCRIBE_MODEL, languages: ["es"] },
          // Filtra ruido del consultorio (compresor, succión, música); far_field porque el celular queda sobre la mesa, no pegado a la boca.
          noise_reduction: { type: "far_field" },
          turn_detection: TURN_MODE === "semantic"
            ? { type: "semantic_vad", eagerness: VAD_EAGERNESS, create_response: false, interrupt_response: false }
            : { type: "server_vad", threshold: 0.62, prefix_padding_ms: 300, silence_duration_ms: 800, create_response: true, interrupt_response: true },
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
      return json(200, { answer_sdp: answer, started_at: startedAt, turn_control: TURN_MODE === "semantic" ? "client" : "server" });
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
    const seconds = Math.max(1, Math.min(row.kind === "previsit" ? MAX_PREVISIT_REALTIME_SECONDS : MAX_REALTIME_SECONDS, Math.ceil((Date.now() - Date.parse(rt.started_at)) / 1000)));
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
      result: { ...(fresh?.result || {}), realtime: { ...rt, finished_at: finishedAt, seconds }, ...(row.kind === "previsit" ? { finished_at: finishedAt } : {}) },
      ...(row.kind === "previsit" ? { submitted_at: finishedAt } : {}),
      audio_seconds: (Number(fresh?.audio_seconds) || 0) + seconds,
      updated_at: finishedAt,
    }).eq("id", row.id);
    const transcript = String(fresh?.transcript_history || "");
    const next = transcript ? await interpretAndStore(row.id, row.tenant_id, "history", transcript, key) : fresh?.result;
    if (!accepted) return json(402, { error: "Se agotó el tiempo de MILA de la clínica." });
    return json(200, { history: next?.history || null, alerts: alertsOf(next || {}), tokens: await sessionTokens(row.tenant_id, row.id), seconds });
  }

  if (action !== "segment" || !form) return json(400, { error: "Acción no válida." });
  if (row.kind === "previsit") return json(400, { error: "La entrevista previa no usa grabación por segmentos." });

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
