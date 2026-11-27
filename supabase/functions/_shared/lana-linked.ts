import { createClient } from "npm:@supabase/supabase-js@2";
import { lanaContractHeaders, normalizeLanaPath } from "./lana-contract.mjs";
import { decryptLanaKey, readKeyring } from "./lana-crypto-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
export const LANA_API_BASE = "https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type LanaConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  key_version?: string;
  estado: string;
};

function keyring() {
  return readKeyring({
    SMYL_LANA_ENCRYPTION_KEY: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY"),
    SMYL_LANA_ENCRYPTION_KEY_VERSION: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_VERSION"),
    SMYL_LANA_ENCRYPTION_KEY_PREVIOUS: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_PREVIOUS"),
    SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION: Deno.env.get("SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION"),
  });
}

export async function linkedLanaApiKey(tenantId: string): Promise<string> {
  const { data, error } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  if (error || !data) throw new Error("No se pudo consultar la configuración de la clínica.");
  const config = data.config && typeof data.config === "object" ? data.config as Record<string, unknown> : {};
  const integrations = config.integraciones && typeof config.integraciones === "object"
    ? config.integraciones as Record<string, unknown> : {};
  const lana = integrations.lana && typeof integrations.lana === "object"
    ? integrations.lana as Partial<LanaConfig> : null;
  if (!lana?.api_key_ciphertext || !lana.api_key_iv || lana.estado !== "conectada") {
    throw new Error("LANA todavía no está conectada o requiere atención.");
  }
  // Descifra con la llave vigente o, durante una rotación, con la anterior. La reescritura con la llave nueva la hace lana-connection.
  return (await decryptLanaKey(lana as LanaConfig, keyring())).apiKey;
}

export async function lanaRequest(
  tenantId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safePath = normalizeLanaPath(path);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await linkedLanaApiKey(tenantId)}`);
    headers.set("Accept", "application/json");
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    for (const [name, value] of Object.entries(lanaContractHeaders())) headers.set(name, value);
    const response = await fetch(`${LANA_API_BASE}${safePath}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

export { admin as smylAdmin };
