import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const CLIENT_ID = (Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || "").trim();
const CLIENT_SECRET = (Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY") || Deno.env.get("GOOGLE_GMAIL_TOKEN_ENCRYPTION_KEY") || "").trim();
const OAUTH_READY = (Deno.env.get("GOOGLE_CALENDAR_OAUTH_READY") || "").trim().toLowerCase() === "true";
const APP_URL = (Deno.env.get("SMYL_APP_URL") || "https://app.smyldesign.ai/app.html").trim();
const REDIRECT_URI = `${SB_URL}/functions/v1/google-calendar-oauth`;
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Cipher = { ciphertext: string; iv: string };
type OAuthState = {
  id: string;
  tenant_id: string;
  user_id: string;
  code_verifier_ciphertext: string;
  code_verifier_iv: string;
  return_url: string;
  expires_at: string;
  used_at: string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomUrlSafe(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sha256(value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function cryptoKey(): Promise<CryptoKey> {
  if (!ENCRYPTION_KEY) throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY no configurada.");
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY debe contener 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string): Promise<Cipher> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(),
    new TextEncoder().encode(value),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decrypt(ciphertext: string, iv: string): Promise<string> {
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await cryptoKey(),
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(clear);
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...makeCors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeReturnUrl(value: unknown): string {
  try {
    const url = new URL(String(value || APP_URL));
    if (url.origin !== "https://app.smyldesign.ai" && url.origin !== "https://rpartidaislas-cloud.github.io") return APP_URL;
    return url.toString();
  } catch {
    return APP_URL;
  }
}

function redirect(returnUrl: string, outcome: "connected" | "denied" | "error"): Response {
  const url = new URL(safeReturnUrl(returnUrl));
  url.searchParams.set("google_calendar", outcome);
  url.hash = "agenda";
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

async function hasPermission(jwt: string, tenantId: string): Promise<boolean> {
  if (!SB_ANON_KEY) return false;
  const client = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await client.rpc("smyl_has_permission", {
    p_tenant_id: tenantId,
    p_permission: "settings.manage",
  });
  return !error && data === true;
}

function configured(): boolean {
  return Boolean(OAUTH_READY && SB_URL && SB_SERVICE_ROLE_KEY && CLIENT_ID && CLIENT_SECRET && ENCRYPTION_KEY);
}

async function start(req: Request, tenantId: string, userId: string, returnUrl: unknown): Promise<Response> {
  if (!configured()) return json(req, { error: "Google Calendar todavía no está configurado para esta instalación." }, 503);

  const state = randomUrlSafe(32);
  const verifier = randomUrlSafe(64);
  const stateHash = base64Url(await sha256(state));
  const challenge = base64Url(await sha256(verifier));
  const sealed = await encrypt(verifier);
  const safeUrl = safeReturnUrl(returnUrl);

  await admin.from("smyl_google_calendar_oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await admin.from("smyl_google_calendar_oauth_states").insert({
    tenant_id: tenantId,
    user_id: userId,
    state_hash: stateHash,
    code_verifier_ciphertext: sealed.ciphertext,
    code_verifier_iv: sealed.iv,
    return_url: safeUrl,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) return json(req, { error: "No se pudo iniciar la conexión con Google Calendar." }, 500);

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", CLIENT_ID);
  authorization.searchParams.set("redirect_uri", REDIRECT_URI);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", SCOPE);
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  return json(req, { authorization_url: authorization.toString() });
}

async function callback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const stateValue = url.searchParams.get("state") || "";
  if (!stateValue || !configured()) return redirect(APP_URL, "error");
  const stateHash = base64Url(await sha256(stateValue));
  const { data, error } = await admin.from("smyl_google_calendar_oauth_states")
    .select("id,tenant_id,user_id,code_verifier_ciphertext,code_verifier_iv,return_url,expires_at,used_at")
    .eq("state_hash", stateHash)
    .maybeSingle();
  const row = data as OAuthState | null;
  if (error || !row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return redirect(APP_URL, "error");

  const claimed = await admin.from("smyl_google_calendar_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimed.error || !claimed.data) return redirect(row.return_url, "error");
  if (url.searchParams.get("error")) return redirect(row.return_url, "denied");

  const code = url.searchParams.get("code") || "";
  if (!code) return redirect(row.return_url, "error");
  try {
    const verifier = await decrypt(row.code_verifier_ciphertext, row.code_verifier_iv);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokens = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
    const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
    if (!tokenResponse.ok || !refreshToken) throw new Error("Google no devolvió un refresh token utilizable.");

    let calendarName = "Calendario principal";
    let calendarTimezone: string | null = null;
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
    if (accessToken) {
      const metadata = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (metadata.ok) {
        const calendar = await metadata.json() as Record<string, unknown>;
        calendarName = String(calendar.summary || calendarName).slice(0, 160);
        calendarTimezone = calendar.timeZone ? String(calendar.timeZone).slice(0, 80) : null;
      }
    }

    const sealed = await encrypt(refreshToken);
    const scopes = String(tokens.scope || SCOPE).split(/\s+/).filter(Boolean);
    const { error: saveError } = await admin.from("smyl_google_calendar_connections").upsert({
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      calendar_id: "primary",
      calendar_name: calendarName,
      calendar_timezone: calendarTimezone,
      refresh_token_ciphertext: sealed.ciphertext,
      refresh_token_iv: sealed.iv,
      granted_scopes: scopes,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,user_id" });
    if (saveError) throw new Error("No se pudo guardar la conexión.");
    return redirect(row.return_url, "connected");
  } catch (error) {
    console.error("[google-calendar-oauth] callback:", error instanceof Error ? error.message : "error inesperado");
    return redirect(row.return_url, "error");
  }
}

async function status(req: Request, tenantId: string, userId: string): Promise<Response> {
  const { data, error } = await admin.from("smyl_google_calendar_connections")
    .select("calendar_id,calendar_name,calendar_timezone,status,connected_at,last_verified_at,last_error")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return json(req, { error: "No se pudo consultar Google Calendar." }, 500);
  return json(req, data ? { connected: true, ...data } : { connected: false });
}

async function disconnect(req: Request, tenantId: string, userId: string): Promise<Response> {
  const { data, error } = await admin.from("smyl_google_calendar_connections")
    .select("refresh_token_ciphertext,refresh_token_iv")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return json(req, { error: "No se pudo desconectar Google Calendar." }, 500);
  if (data) {
    try {
      const token = await decrypt(data.refresh_token_ciphertext, data.refresh_token_iv);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch (revokeError) {
      console.warn("[google-calendar-oauth] revoke:", revokeError instanceof Error ? revokeError.message : "error inesperado");
    }
  }
  const removed = await admin.from("smyl_google_calendar_connections").delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  if (removed.error) return json(req, { error: "No se pudo desconectar Google Calendar." }, 500);
  return json(req, { connected: false });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: makeCors(req) });
  if (req.method === "GET") return callback(req);
  if (req.method !== "POST") return json(req, { error: "Método no permitido." }, 405);

  const cors = makeCors(req);
  const auth = await requireUser(req, cors);
  if (auth.response) return auth.response;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth.user || !auth.tenantId || !await hasPermission(jwt, auth.tenantId)) {
    return json(req, { error: "No tienes permiso para configurar conexiones." }, 403);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "status");
  if (action === "status") return status(req, auth.tenantId, auth.user.id);
  if (action === "start") return start(req, auth.tenantId, auth.user.id, body.return_url);
  if (action === "disconnect") return disconnect(req, auth.tenantId, auth.user.id);
  return json(req, { error: "Acción no válida." }, 400);
});

