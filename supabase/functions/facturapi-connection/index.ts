import { requireUser } from "../_shared/auth.ts";
import { organizationSummary, publicConnectionStatus, validateTestSecret } from "../_shared/facturapi-core.mjs";
import {
  decryptFacturapiSecret,
  encryptFacturapiSecret,
  facturapiAdmin,
  facturapiRequest,
  secretFingerprint,
} from "../_shared/facturapi.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Connection = {
  tenant_id: string;
  organization_id: string | null;
  organization_name: string | null;
  environment: "test";
  secret_ciphertext: string | null;
  secret_iv: string | null;
  key_fingerprint: string | null;
  status: "disconnected" | "connected" | "error";
  connected_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readConnection(tenantId: string): Promise<Connection | null> {
  const { data, error } = await facturapiAdmin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error("No se pudo consultar la conexión fiscal de la clínica.");
  return data as Connection | null;
}

async function event(tenantId: string, actorId: string, action: string, status: string, detail: Record<string, unknown> = {}) {
  const safeDetail = { ...detail };
  delete safeDetail.api_key;
  delete safeDetail.secret;
  await facturapiAdmin.from("smyl_facturapi_connection_events").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    status,
    detail: safeDetail,
  });
}

async function verifySecret(secret: string) {
  const { response, body } = await facturapiRequest(secret, "/organizations/me");
  if (response.status === 401 || response.status === 403) throw new Error("La llave Test fue rechazada por Facturapi.");
  if (!response.ok) throw new Error("Facturapi no pudo verificar la organización en este momento.");
  return organizationSummary(body);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
  const action = String(body.action || "status");
  const canManage = auth.user.id === auth.tenantId;

  try {
    const current = await readConnection(auth.tenantId);
    if (action === "status") return json(200, publicConnectionStatus(current, canManage));
    if (!canManage) return json(403, { error: "Solo el dueño de la clínica puede administrar Facturapi." });

    if (action === "connect") {
      const checked = validateTestSecret(body.api_key);
      if (!checked.ok) return json(400, { error: checked.error });
      const organization = await verifySecret(checked.value);
      const encrypted = await encryptFacturapiSecret(checked.value, auth.tenantId);
      const now = new Date().toISOString();
      const row = {
        tenant_id: auth.tenantId,
        provider: "facturapi",
        environment: "test",
        organization_id: organization.id,
        organization_name: organization.name,
        secret_ciphertext: encrypted.ciphertext,
        secret_iv: encrypted.iv,
        key_fingerprint: await secretFingerprint(checked.value),
        status: "connected",
        connected_at: current?.connected_at || now,
        last_verified_at: now,
        last_error: null,
        updated_by: auth.user.id,
        updated_at: now,
      };
      const { data, error } = await facturapiAdmin.from("smyl_facturapi_connections").upsert(row).select("*").single();
      if (error) throw new Error("No se pudo guardar la conexión cifrada.");
      await event(auth.tenantId, auth.user.id, "connected", "success", { organization_id: organization.id, environment: "test" });
      return json(200, { ok: true, ...publicConnectionStatus(data, true) });
    }

    if (action === "verify") {
      if (!current?.secret_ciphertext || !current.secret_iv || current.status === "disconnected") return json(409, { error: "Facturapi sandbox todavía no está conectado." });
      try {
        const organization = await verifySecret(await decryptFacturapiSecret({ secret_ciphertext: current.secret_ciphertext, secret_iv: current.secret_iv }, auth.tenantId));
        if (current.organization_id && organization.id !== current.organization_id) throw new Error("La llave ya no corresponde a la organización registrada.");
        const now = new Date().toISOString();
        const { data, error } = await facturapiAdmin.from("smyl_facturapi_connections").update({
          status: "connected",
          organization_name: organization.name,
          last_verified_at: now,
          last_error: null,
          updated_by: auth.user.id,
          updated_at: now,
        }).eq("tenant_id", auth.tenantId).select("*").single();
        if (error) throw new Error("No se pudo actualizar la verificación.");
        await event(auth.tenantId, auth.user.id, "verified", "success", { organization_id: organization.id });
        return json(200, { ok: true, ...publicConnectionStatus(data, true) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo verificar Facturapi.";
        await facturapiAdmin.from("smyl_facturapi_connections").update({ status: "error", last_error: message.slice(0, 500), updated_by: auth.user.id, updated_at: new Date().toISOString() }).eq("tenant_id", auth.tenantId);
        await event(auth.tenantId, auth.user.id, "verified", "failed", { message: message.slice(0, 500) });
        return json(502, { error: message, ...publicConnectionStatus({ ...current, status: "error", last_error: message }, true) });
      }
    }

    if (action === "disconnect") {
      const now = new Date().toISOString();
      const { data, error } = await facturapiAdmin.from("smyl_facturapi_connections").upsert({
        tenant_id: auth.tenantId,
        provider: "facturapi",
        environment: "test",
        organization_id: current?.organization_id || null,
        organization_name: current?.organization_name || null,
        secret_ciphertext: null,
        secret_iv: null,
        key_fingerprint: current?.key_fingerprint || null,
        status: "disconnected",
        connected_at: current?.connected_at || null,
        last_verified_at: current?.last_verified_at || null,
        last_error: null,
        updated_by: auth.user.id,
        updated_at: now,
      }).select("*").single();
      if (error) throw new Error("No se pudo desconectar Facturapi.");
      await event(auth.tenantId, auth.user.id, "disconnected", "success", { organization_id: current?.organization_id || null });
      return json(200, { ok: true, ...publicConnectionStatus(data, true) });
    }

    return json(400, { error: "Acción no reconocida." });
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "Facturapi tardó demasiado en responder."
      : error instanceof Error ? error.message : "No se pudo completar la operación de Facturapi.";
    console.error("[facturapi-connection]", message);
    return json(500, { error: message });
  }
});
