import { createClient } from "npm:@supabase/supabase-js@2";
import { API_BASE, normalizeFacturapiPath } from "./facturapi-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_FACTURAPI_ENCRYPTION_KEY") || "").trim();
export const facturapiAdmin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function cryptoKey(): Promise<CryptoKey> {
  if (!ENCRYPTION_KEY) throw new Error("SMYL_FACTURAPI_ENCRYPTION_KEY no configurada.");
  const raw = base64ToBytes(ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("SMYL_FACTURAPI_ENCRYPTION_KEY debe contener exactamente 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function tenantBinding(tenantId: string): Uint8Array {
  return new TextEncoder().encode(`smyl:facturapi:test:${tenantId}`);
}

export async function encryptFacturapiSecret(secret: string, tenantId: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: tenantBinding(tenantId) },
    await cryptoKey(),
    new TextEncoder().encode(secret),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptFacturapiSecret(row: { secret_ciphertext: string; secret_iv: string }, tenantId: string): Promise<string> {
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(row.secret_iv), additionalData: tenantBinding(tenantId) },
    await cryptoKey(),
    base64ToBytes(row.secret_ciphertext),
  );
  return new TextDecoder().decode(clear);
}

export async function secretFingerprint(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest)).slice(0, 6).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function facturapiRequest(
  secret: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${secret}`);
    headers.set("Accept", "application/json");
    if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${API_BASE}${normalizeFacturapiPath(path)}`, { ...init, headers, signal: controller.signal });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}
