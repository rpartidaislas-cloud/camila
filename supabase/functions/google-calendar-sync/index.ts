import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const CLIENT_ID = (Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || "").trim();
const CLIENT_SECRET = (Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY") || "").trim();
const INTERNAL_SECRET = (Deno.env.get("GOOGLE_CALENDAR_SYNC_SECRET") || "").trim();
const admin = createClient(SB_URL, SERVICE_KEY);

type Connection = {
  id: string; tenant_id: string; user_id: string; professional_id: string;
  calendar_id: string; refresh_token_ciphertext: string; refresh_token_iv: string;
  sync_token: string | null; channel_id: string | null; channel_resource_id: string | null;
  channel_expires_at: string | null;
};

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...makeCors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value); const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes;
}
async function key(): Promise<CryptoKey> {
  const raw = base64ToBytes(ENCRYPTION_KEY); return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}
async function decrypt(ciphertext: string, iv: string): Promise<string> {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await key(), base64ToBytes(ciphertext));
  return new TextDecoder().decode(clear);
}
async function accessToken(connection: Connection): Promise<string> {
  const refresh = await decrypt(connection.refresh_token_ciphertext, connection.refresh_token_iv);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") throw new Error("Google requiere volver a autorizar el calendario.");
  return data.access_token;
}
async function google(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
}
function eventId(appointmentId: string): string { return `s${appointmentId.replace(/-/g, "")}`; }
function googleDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null; const row = value as Record<string, unknown>;
  const raw = row.dateTime || row.date; return raw ? new Date(String(raw)).toISOString() : null;
}
function base64Url(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hash(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function ensureWatch(connection: Connection, token: string): Promise<void> {
  if (connection.channel_expires_at && new Date(connection.channel_expires_at).getTime() > Date.now() + 24 * 60 * 60 * 1000) return;
  if (connection.channel_id && connection.channel_resource_id) {
    await google(token, "/channels/stop", { method: "POST", body: JSON.stringify({ id: connection.channel_id, resourceId: connection.channel_resource_id }) }).catch(() => null);
  }
  const channelId = crypto.randomUUID();
  const channelToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
  const response = await google(token, `/calendars/${encodeURIComponent(connection.calendar_id)}/events/watch`, { method: "POST", body: JSON.stringify({ id: channelId, type: "web_hook", address: `${SB_URL}/functions/v1/google-calendar-webhook`, token: channelToken, expiration }) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || !body.resourceId) throw new Error(`No se pudo activar la escucha de Google (${response.status}).`);
  await admin.from("smyl_google_calendar_connections").update({ channel_id: channelId, channel_resource_id: String(body.resourceId), channel_token_hash: await hash(channelToken), channel_expires_at: new Date(Number(body.expiration || expiration)).toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
}
async function connectionForUser(tenantId: string, userId: string): Promise<Connection | null> {
  const { data, error } = await admin.from("smyl_google_calendar_connections").select("*").eq("tenant_id", tenantId).eq("user_id", userId).eq("status", "connected").maybeSingle();
  if (error) throw error; return data as Connection | null;
}
async function hasPermission(jwt: string, tenantId: string): Promise<boolean> {
  const client = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await client.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "schedule.manage" });
  return !error && data === true;
}
async function markFailure(connection: Connection, error: unknown): Promise<void> {
  const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
  await admin.from("smyl_google_calendar_connections").update({ status: /autorizar/i.test(message) ? "requires_attention" : "connected", last_error: message, updated_at: new Date().toISOString() }).eq("id", connection.id);
}
async function processOutbound(connection: Connection, token: string): Promise<number> {
  const now = new Date().toISOString();
  const { data: jobs, error } = await admin.from("smyl_google_calendar_sync_jobs").select("*").eq("connection_id", connection.id).in("status", ["pending", "failed"]).lte("next_attempt_at", now).order("id").limit(50);
  if (error) throw error; let completed = 0;
  for (const job of jobs || []) {
    await admin.from("smyl_google_calendar_sync_jobs").update({ status: "processing", attempts: Number(job.attempts || 0) + 1, updated_at: now }).eq("id", job.id);
    try {
      const [{ data: appointment }, { data: link }] = await Promise.all([
        admin.from("smyl_appointments").select("id,tenant_id,branch_id,professional_id,service_id,starts_at,ends_at,status").eq("tenant_id", connection.tenant_id).eq("id", job.appointment_id).maybeSingle(),
        admin.from("smyl_google_calendar_event_links").select("*").eq("connection_id", connection.id).eq("appointment_id", job.appointment_id).maybeSingle(),
      ]);
      if (!appointment) throw new Error("La cita ya no existe.");
      const id = link?.google_event_id || eventId(appointment.id);
      if (job.operation === "delete" || appointment.status === "cancelled") {
        const response = await google(token, `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google Calendar respondió ${response.status}.`);
      } else {
        const [{ data: branch }, { data: service }] = await Promise.all([
          admin.from("smyl_branches").select("name").eq("tenant_id", connection.tenant_id).eq("id", appointment.branch_id).maybeSingle(),
          admin.from("smyl_services").select("name").eq("tenant_id", connection.tenant_id).eq("id", appointment.service_id).maybeSingle(),
        ]);
        const payload = { id, summary: `Cita SMYL${service?.name ? ` · ${String(service.name).slice(0, 80)}` : ""}`, description: "Administrada desde SMYL. Sin datos clínicos.", location: branch?.name || undefined, start: { dateTime: appointment.starts_at }, end: { dateTime: appointment.ends_at }, extendedProperties: { private: { smylAppointmentId: appointment.id, smylConnectionId: connection.id } } };
        const method = link ? "PATCH" : "POST";
        const path = link ? `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(id)}` : `/calendars/${encodeURIComponent(connection.calendar_id)}/events`;
        let response = await google(token, path, { method, body: JSON.stringify(payload) });
        if (!response.ok && !link && response.status === 409) response = await google(token, `/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        const saved = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) throw new Error(`Google Calendar respondió ${response.status}.`);
        await admin.from("smyl_google_calendar_event_links").upsert({ tenant_id: connection.tenant_id, connection_id: connection.id, appointment_id: appointment.id, google_event_id: String(saved.id || id), google_etag: saved.etag ? String(saved.etag) : null, last_synced_at: now, updated_at: now }, { onConflict: "connection_id,appointment_id" });
      }
      await admin.from("smyl_google_calendar_sync_jobs").update({ status: "done", last_error: "", updated_at: now }).eq("id", job.id); completed += 1;
    } catch (jobError) {
      const attempts = Number(job.attempts || 0) + 1;
      await admin.from("smyl_google_calendar_sync_jobs").update({ status: "failed", last_error: String(jobError instanceof Error ? jobError.message : jobError).slice(0, 1000), next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000).toISOString(), updated_at: now }).eq("id", job.id);
    }
  }
  return completed;
}
async function upsertChange(connection: Connection, event: Record<string, unknown>, type: "reschedule" | "cancel" | "create", appointmentId: string | null): Promise<void> {
  const eventIdValue = String(event.id || ""); if (!eventIdValue) return;
  const row = { tenant_id: connection.tenant_id, connection_id: connection.id, professional_id: connection.professional_id, appointment_id: appointmentId, google_event_id: eventIdValue, change_type: type, google_summary: String(event.summary || "Evento de Google").slice(0, 300), proposed_start: googleDate(event.start), proposed_end: googleDate(event.end), updated_at: new Date().toISOString() };
  const { data: existing } = await admin.from("smyl_google_calendar_change_requests").select("id").eq("connection_id", connection.id).eq("google_event_id", eventIdValue).eq("change_type", type).eq("status", "pending").maybeSingle();
  if (existing) await admin.from("smyl_google_calendar_change_requests").update(row).eq("id", existing.id);
  else await admin.from("smyl_google_calendar_change_requests").insert(row);
}
async function processInbound(connection: Connection, token: string): Promise<number> {
  let syncToken = connection.sync_token; let pageToken = ""; let changes = 0; let retried = false;
  let allowUnlinkedCreates = Boolean(connection.sync_token);
  do {
    const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "2500" });
    if (syncToken) params.set("syncToken", syncToken); else params.set("timeMin", new Date(Date.now() - 30 * 86400000).toISOString());
    if (pageToken) params.set("pageToken", pageToken);
    const response = await google(token, `/calendars/${encodeURIComponent(connection.calendar_id)}/events?${params}`);
    if (response.status === 410 && !retried) { syncToken = null; pageToken = ""; retried = true; allowUnlinkedCreates = false; await admin.from("smyl_google_calendar_connections").update({ sync_token: null }).eq("id", connection.id); continue; }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>; if (!response.ok) throw new Error(`No se pudieron leer cambios de Google (${response.status}).`);
    for (const item of (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[]) {
      const id = String(item.id || "");
      const { data: link } = await admin.from("smyl_google_calendar_event_links").select("appointment_id").eq("connection_id", connection.id).eq("google_event_id", id).maybeSingle();
      const privateData = (item.extendedProperties as Record<string, unknown> | undefined)?.private as Record<string, unknown> | undefined;
      const appointmentId = link?.appointment_id || (privateData?.smylConnectionId === connection.id ? String(privateData.smylAppointmentId || "") : "") || null;
      if (!appointmentId) { if (allowUnlinkedCreates && item.status !== "cancelled" && googleDate(item.start)) { await upsertChange(connection, item, "create", null); changes += 1; } continue; }
      const { data: appointment } = await admin.from("smyl_appointments").select("starts_at,ends_at,status").eq("tenant_id", connection.tenant_id).eq("id", appointmentId).maybeSingle();
      if (!appointment) continue;
      if (item.status === "cancelled") { if (appointment.status !== "cancelled") { await upsertChange(connection, item, "cancel", appointmentId); changes += 1; } }
      else {
        const start = googleDate(item.start), end = googleDate(item.end);
        if (start && end && (new Date(start).getTime() !== new Date(appointment.starts_at).getTime() || new Date(end).getTime() !== new Date(appointment.ends_at).getTime())) { await upsertChange(connection, item, "reschedule", appointmentId); changes += 1; }
      }
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
    if (!pageToken && typeof body.nextSyncToken === "string") syncToken = body.nextSyncToken;
  } while (pageToken || (retried && !syncToken));
  await admin.from("smyl_google_calendar_connections").update({ sync_token: syncToken, last_sync_at: new Date().toISOString(), last_error: null, status: "connected", updated_at: new Date().toISOString() }).eq("id", connection.id);
  return changes;
}
async function runConnection(connection: Connection): Promise<{ outbound: number; inbound: number }> {
  try { const token = await accessToken(connection); await ensureWatch(connection, token); return { outbound: await processOutbound(connection, token), inbound: await processInbound(connection, token) }; }
  catch (error) { await markFailure(connection, error); throw error; }
}
async function listChanges(req: Request, connection: Connection): Promise<Response> {
  const { data, error } = await admin.from("smyl_google_calendar_change_requests").select("id,appointment_id,google_event_id,change_type,google_summary,proposed_start,proposed_end,status,created_at").eq("connection_id", connection.id).eq("status", "pending").order("created_at", { ascending: false });
  if (error) return json(req, { error: "No se pudieron consultar los cambios." }, 500); return json(req, { changes: data || [] });
}
async function review(req: Request, jwt: string, connection: Connection, body: Record<string, unknown>): Promise<Response> {
  const decision = String(body.decision || ""); const id = String(body.change_id || "");
  const { data: change } = await admin.from("smyl_google_calendar_change_requests").select("*").eq("id", id).eq("connection_id", connection.id).eq("status", "pending").maybeSingle();
  if (!change) return json(req, { error: "El cambio ya fue atendido o no existe." }, 404);
  if (decision === "accept") {
    if (change.change_type === "create") {
      const appointmentId = String(body.appointment_id || "");
      const { data: created } = await admin.from("smyl_appointments").select("id,professional_id").eq("tenant_id", connection.tenant_id).eq("id", appointmentId).maybeSingle();
      if (!created || created.professional_id !== connection.professional_id) return json(req, { error: "La cita debe pertenecer al dentista que conectó este calendario." }, 409);
      await admin.from("smyl_google_calendar_event_links").upsert({ tenant_id: connection.tenant_id, connection_id: connection.id, appointment_id: created.id, google_event_id: change.google_event_id, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "connection_id,appointment_id" });
      change.appointment_id = created.id;
    } else {
    const { data: appointment } = await admin.from("smyl_appointments").select("branch_id,room_id,updated_at").eq("tenant_id", connection.tenant_id).eq("id", change.appointment_id).maybeSingle();
    if (!appointment) return json(req, { error: "La cita ya no existe." }, 404);
    const user = createClient(SB_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const result = change.change_type === "cancel"
      ? await user.rpc("smyl_transition_appointment", { p_appointment_id: change.appointment_id, p_status: "cancelled", p_reason: "Cambio aceptado desde Google Calendar", p_expected_updated_at: appointment.updated_at })
      : await user.rpc("smyl_reschedule_appointment", { p_appointment_id: change.appointment_id, p_branch_id: appointment.branch_id, p_room_id: appointment.room_id, p_starts_at: change.proposed_start, p_expected_updated_at: appointment.updated_at });
    if (result.error) return json(req, { error: result.error.message }, 409);
    }
  }
  if (!['accept', 'reject'].includes(decision)) return json(req, { error: "Decisión no válida." }, 400);
  await admin.from("smyl_google_calendar_change_requests").update({ appointment_id: change.appointment_id || null, status: decision === "accept" ? "accepted" : "rejected", decided_by: connection.user_id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", change.id);
  if (decision === "reject" && change.appointment_id) await admin.from("smyl_google_calendar_sync_jobs").upsert({ tenant_id: connection.tenant_id, connection_id: connection.id, appointment_id: change.appointment_id, operation: "upsert", status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: "", updated_at: new Date().toISOString() }, { onConflict: "connection_id,appointment_id" });
  return json(req, { ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: makeCors(req) });
  if (req.method !== "POST") return json(req, { error: "Método no permitido." }, 405);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const internal = INTERNAL_SECRET && req.headers.get("x-smyl-calendar-secret") === INTERNAL_SECRET;
  if (internal) {
    const { data } = await admin.from("smyl_google_calendar_connections").select("*").eq("id", String(body.connection_id || "")).eq("status", "connected").maybeSingle();
    if (!data) return json(req, { error: "Conexión no disponible." }, 404);
    try { return json(req, await runConnection(data as Connection)); } catch { return json(req, { error: "No se pudo sincronizar." }, 502); }
  }
  const cors = makeCors(req); const auth = await requireUser(req, cors); if (auth.response) return auth.response;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth.user || !auth.tenantId || !await hasPermission(jwt, auth.tenantId)) return json(req, { error: "No tienes permiso para sincronizar la agenda." }, 403);
  const connection = await connectionForUser(auth.tenantId, auth.user.id); if (!connection) return json(req, { error: "Conecta Google Calendar primero." }, 409);
  const action = String(body.action || "run");
  if (action === "list_changes") return listChanges(req, connection);
  if (action === "review") return review(req, jwt, connection, body);
  if (action === "run") { try { return json(req, await runConnection(connection)); } catch (error) { return json(req, { error: String(error instanceof Error ? error.message : error) }, 502); } }
  return json(req, { error: "Acción no válida." }, 400);
});
