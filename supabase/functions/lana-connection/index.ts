import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_LANA_ENCRYPTION_KEY") || "").trim();
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  version: number;
  api_key_ciphertext: string;
  api_key_iv: string;
  fingerprint: string;
  estado: "conectada" | "requiere_atencion";
  connected_at: string;
  last_verified_at: string;
  last_error?: string | null;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cryptoKey(): Promise<CryptoKey> {
  if (!ENCRYPTION_KEY) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada.");
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("SMYL_LANA_ENCRYPTION_KEY debe contener 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptApiKey(apiKey: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(),
    new TextEncoder().encode(apiKey),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptApiKey(config: LanaConfig): Promise<string> {
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(config.api_key_iv) },
    await cryptoKey(),
    base64ToBytes(config.api_key_ciphertext),
  );
  return new TextDecoder().decode(clear);
}

async function fingerprint(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest)).slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function readTenantConfig(tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la configuración de la clínica.");
  return data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
}

function readLanaConfig(config: Record<string, unknown>): LanaConfig | null {
  const integrations = config.integraciones;
  if (!integrations || typeof integrations !== "object") return null;
  const lana = (integrations as Record<string, unknown>).lana;
  if (!lana || typeof lana !== "object") return null;
  const value = lana as Partial<LanaConfig>;
  if (!value.api_key_ciphertext || !value.api_key_iv || !value.fingerprint) return null;
  return value as LanaConfig;
}

async function writeLanaConfig(
  tenantId: string,
  current: Record<string, unknown>,
  lana: LanaConfig,
): Promise<void> {
  const integrations = current.integraciones && typeof current.integraciones === "object"
    ? current.integraciones as Record<string, unknown>
    : {};
  const next = {
    ...current,
    integraciones: { ...integrations, lana },
  };
  const { error } = await admin.from("camila_tenants").update({ config: next }).eq("id", tenantId);
  if (error) throw new Error("No se pudo guardar la conexión de LANA.");
}

async function verifyLanaApiKey(apiKey: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`${LANA_API_BASE}/conversations?limit=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error("El código de enlace no es válido o fue revocado.");
    if (!response.ok) throw new Error("LANA no pudo confirmar la conexión en este momento.");
    const body = await response.json().catch(() => null);
    if (!body || !Array.isArray(body.conversaciones)) throw new Error("LANA devolvió una respuesta inesperada.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("LANA tardó demasiado en responder. Intenta de nuevo.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function publicStatus(lana: LanaConfig | null, canManage: boolean): Record<string, unknown> {
  if (!lana) return { connected: false, estado: "pendiente", can_manage: canManage };
  return {
    connected: lana.estado === "conectada",
    estado: lana.estado,
    fingerprint: lana.fingerprint,
    connected_at: lana.connected_at,
    last_verified_at: lana.last_verified_at,
    last_error: lana.last_error || null,
    can_manage: canManage,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  const canManage = auth.user.id === auth.tenantId;
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
  }
  const action = req.method === "GET"
    ? new URL(req.url).searchParams.get("action") || "status"
    : String(body.action || "");

  try {
    const config = await readTenantConfig(auth.tenantId);
    const lana = readLanaConfig(config);

    if (action === "status") return json(200, publicStatus(lana, canManage));

    if (action === "connect") {
      if (!canManage) return json(403, { error: "Solo el dueño de la clínica puede conectar LANA." });
      const apiKey = String(body.api_key || "").trim();
      if (apiKey.length < 24 || apiKey.length > 256 || /\s/.test(apiKey)) {
        return json(400, { error: "El código de enlace no tiene un formato válido." });
      }
      await verifyLanaApiKey(apiKey);
      const encrypted = await encryptApiKey(apiKey);
      const now = new Date().toISOString();
      const next: LanaConfig = {
        version: 1,
        api_key_ciphertext: encrypted.ciphertext,
        api_key_iv: encrypted.iv,
        fingerprint: await fingerprint(apiKey),
        estado: "conectada",
        connected_at: lana?.connected_at || now,
        last_verified_at: now,
        last_error: null,
      };
      await writeLanaConfig(auth.tenantId, config, next);
      return json(200, { ok: true, ...publicStatus(next, canManage) });
    }

    if (action === "verify") {
      if (!lana) return json(409, { error: "LANA todavía no está conectada." });
      let next = { ...lana };
      try {
        await verifyLanaApiKey(await decryptApiKey(lana));
        next = { ...lana, estado: "conectada", last_verified_at: new Date().toISOString(), last_error: null };
      } catch (error) {
        next = {
          ...lana,
          estado: "requiere_atencion",
          last_error: error instanceof Error ? error.message : "No se pudo verificar la conexión.",
        };
      }
      await writeLanaConfig(auth.tenantId, config, next);
      if (next.estado !== "conectada") return json(502, { error: next.last_error, ...publicStatus(next, canManage) });
      return json(200, { ok: true, ...publicStatus(next, canManage) });
    }

    return json(400, { error: "Acción no reconocida." });
  } catch (error) {
    console.error("[lana-connection]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo completar la operación de LANA." });
  }
});
