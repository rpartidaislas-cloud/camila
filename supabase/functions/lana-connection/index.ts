import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { lanaContractHeaders } from "../_shared/lana-contract.mjs";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const ENCRYPTION_KEY = (Deno.env.get("SMYL_LANA_ENCRYPTION_KEY") || "").trim();
const LANA_PLATFORM_SECRET = (Deno.env.get("SMYL_LANA_PLATFORM_SECRET") || "").trim();
const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const LANA_PROVISION_URL = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/smyl-provision";
const LANA_VERIFY_TIMEOUT_MS = 25000;
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaVerificationFailure = "invalid_credentials" | "temporary";

class LanaVerificationError extends Error {
  readonly failure: LanaVerificationFailure;
  readonly httpStatus: number;

  constructor(message: string, failure: LanaVerificationFailure, httpStatus: number) {
    super(message);
    this.name = "LanaVerificationError";
    this.failure = failure;
    this.httpStatus = httpStatus;
  }
}

type LanaConfig = {
  version: number;
  api_key_ciphertext: string;
  api_key_iv: string;
  fingerprint: string;
  estado: "conectada" | "requiere_atencion";
  connected_at: string;
  last_verified_at: string;
  last_error?: string | null;
  lana_tenant_id?: string;
  provisioned_automatically?: boolean;
};

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

async function readTenantProfile(tenantId: string): Promise<{ config: Record<string, unknown>; name: string; email: string }> {
  const { data, error } = await admin.from("camila_tenants")
    .select("nombre,email,config")
    .eq("id", tenantId)
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la clínica.");
  return {
    config: data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {},
    name: String(data.nombre || "Clínica dental").trim().slice(0, 160) || "Clínica dental",
    email: String(data.email || "").trim().toLowerCase().slice(0, 254),
  };
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
  const timer = setTimeout(() => controller.abort(), LANA_VERIFY_TIMEOUT_MS);
  try {
    // /contract autentica la API key sin consultar conversaciones ni cargar el
    // buzón. Es la comprobación más pequeña y estable para un arranque en frío.
    const response = await fetch(`${LANA_API_BASE}/contract`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...lanaContractHeaders(),
      },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new LanaVerificationError(
        "El código de enlace no es válido o fue revocado.",
        "invalid_credentials",
        401,
      );
    }
    if (!response.ok) {
      const retryableStatus = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new LanaVerificationError(
        retryableStatus
          ? "LANA está tardando más de lo habitual. Tu enlace se conserva; intenta verificar de nuevo."
          : "LANA no pudo confirmar la conexión en este momento. Tu enlace se conserva.",
        "temporary",
        retryableStatus ? 503 : 502,
      );
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || body.ok !== true || !body.contract || typeof body.contract !== "object") {
      throw new LanaVerificationError(
        "LANA devolvió una respuesta inesperada. Tu enlace se conserva.",
        "temporary",
        502,
      );
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LanaVerificationError(
        "LANA tardó demasiado en responder. Tu enlace se conserva; intenta verificar de nuevo.",
        "temporary",
        504,
      );
    }
    if (error instanceof LanaVerificationError) throw error;
    throw new LanaVerificationError(
      "No fue posible contactar a LANA. Tu enlace se conserva; intenta verificar de nuevo.",
      "temporary",
      503,
    );
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
    provisioned_automatically: lana.provisioned_automatically === true,
    can_manage: canManage,
  };
}

async function provisionRequest(
  tenantId: string,
  clinicName: string,
  ownerEmail: string,
): Promise<{ request_id: string; requested_clinic_name: string; requested_owner_email: string | null }> {
  const { data: existing, error: selectError } = await admin.from("camila_lana_provisioning")
    .select("request_id,requested_clinic_name,requested_owner_email")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (selectError) throw new Error("No se pudo preparar la activación de LANA.");
  if (existing) return existing;

  const row = {
    tenant_id: tenantId,
    requested_clinic_name: clinicName,
    requested_owner_email: ownerEmail || null,
    status: "pending",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("camila_lana_provisioning")
    .insert(row)
    .select("request_id,requested_clinic_name,requested_owner_email")
    .maybeSingle();
  if (!error && data) return data;

  // Dos clics simultáneos pueden competir por la PK. Recuperar la fila
  // ganadora conserva una sola Idempotency-Key por clínica.
  const retry = await admin.from("camila_lana_provisioning")
    .select("request_id,requested_clinic_name,requested_owner_email")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (retry.error || !retry.data) throw new Error("No se pudo preparar la activación de LANA.");
  return retry.data;
}

async function provisionLana(
  tenantId: string,
  clinicName: string,
  ownerEmail: string,
): Promise<{ apiKey: string; lanaTenantId: string }> {
  if (!LANA_PLATFORM_SECRET) throw new Error("La activación automática de LANA aún no está configurada.");
  const request = await provisionRequest(tenantId, clinicName, ownerEmail);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(LANA_PROVISION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LANA_PLATFORM_SECRET}`,
        "Content-Type": "application/json",
        "Idempotency-Key": request.request_id,
        ...lanaContractHeaders(),
      },
      body: JSON.stringify({
        smyl_tenant_id: tenantId,
        clinic_name: request.requested_clinic_name,
        owner_email: request.requested_owner_email || "",
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof data.api_key !== "string" || typeof data.lana_tenant_id !== "string") {
      throw new Error(typeof data.error === "string" ? data.error : "LANA no pudo preparar la cuenta.");
    }
    await admin.from("camila_lana_provisioning").update({
      status: "complete",
      lana_tenant_id: data.lana_tenant_id,
      last_error: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { apiKey: data.api_key, lanaTenantId: data.lana_tenant_id };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "LANA tardó demasiado en preparar la cuenta."
      : error instanceof Error ? error.message : "No se pudo preparar la cuenta de LANA.";
    await admin.from("camila_lana_provisioning").update({
      status: "failed",
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req, "GET, POST, OPTIONS");
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
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

    if (action === "provision") {
      if (!canManage) return json(403, { error: "Solo el dueño de la clínica puede activar LANA." });
      if (lana?.estado === "conectada") return json(200, { ok: true, ...publicStatus(lana, canManage) });
      if (lana) return json(409, { error: "La clínica ya tiene un enlace LANA. Verifícalo antes de crear otro." });
      const profile = await readTenantProfile(auth.tenantId);
      const provisioned = await provisionLana(auth.tenantId, profile.name, profile.email || auth.user.email || "");
      await verifyLanaApiKey(provisioned.apiKey);
      const encrypted = await encryptApiKey(provisioned.apiKey);
      const now = new Date().toISOString();
      const next: LanaConfig = {
        version: 1,
        api_key_ciphertext: encrypted.ciphertext,
        api_key_iv: encrypted.iv,
        fingerprint: await fingerprint(provisioned.apiKey),
        estado: "conectada",
        connected_at: now,
        last_verified_at: now,
        last_error: null,
        lana_tenant_id: provisioned.lanaTenantId,
        provisioned_automatically: true,
      };
      await writeLanaConfig(auth.tenantId, profile.config, next);
      return json(200, { ok: true, created: true, ...publicStatus(next, canManage) });
    }

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
        const verification = error instanceof LanaVerificationError ? error : null;
        const invalidCredentials = verification?.failure === "invalid_credentials";
        next = {
          ...lana,
          // Un timeout, 429 o 5xx no revoca una credencial. Conservar el estado
          // previo evita que una incidencia temporal bloquee todos los canales.
          estado: invalidCredentials ? "requiere_atencion" : lana.estado,
          last_error: error instanceof Error
            ? error.message
            : "No se pudo verificar la conexión. Tu enlace se conserva.",
        };
        await writeLanaConfig(auth.tenantId, config, next);
        return json(verification?.httpStatus || 500, {
          error: next.last_error,
          error_code: invalidCredentials ? "invalid_credentials" : "verification_temporary",
          retryable: !invalidCredentials,
          ...publicStatus(next, canManage),
        });
      }
      await writeLanaConfig(auth.tenantId, config, next);
      return json(200, { ok: true, ...publicStatus(next, canManage) });
    }

    return json(400, { error: "Acción no reconocida." });
  } catch (error) {
    console.error("[lana-connection]", error instanceof Error ? error.message : error);
    if (error instanceof LanaVerificationError) {
      return json(error.httpStatus, {
        error: error.message,
        error_code: error.failure === "invalid_credentials" ? "invalid_credentials" : "verification_temporary",
        retryable: error.failure === "temporary",
      });
    }
    return json(500, { error: "No se pudo completar la operación de LANA." });
  }
});
