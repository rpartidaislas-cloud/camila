// Conexión SMYL ↔ Facturapi (SOLO sandbox): guardar, verificar y desconectar la llave de pruebas de cada clínica.
// La llave se cifra aquí (AES-GCM, secreto FACTURAPI_ENCRYPTION_KEY) y nunca vuelve al navegador. Requiere finance.manage.
// No timbra ni cancela nada: eso es una etapa posterior.
import { requireUser, requirePermission } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { smylAdmin } from "../_shared/lana-linked.ts";
import { FACTURAPI_BASE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion } from "../_shared/facturapi-core.mjs";

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function consultarOrganizacion(key: string): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; error: string; auth: boolean }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/organizations/me`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return { ok: false, auth: true, error: "Facturapi rechazó la llave. Revisa que sea la llave secreta de pruebas de tu organización." };
    if (!res.ok) return { ok: false, auth: false, error: `Facturapi respondió ${res.status}. Intenta de nuevo en unos minutos.` };
    const org = leerOrganizacion(await res.json().catch(() => null));
    if (!org) return { ok: false, auth: false, error: "Facturapi respondió algo inesperado al consultar la organización." };
    return { ok: true, org };
  } catch {
    return { ok: false, auth: false, error: "No se pudo contactar a Facturapi. Intenta de nuevo." };
  }
}

async function evento(tenantId: string, actorId: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_facturapi_connection_events").insert({ tenant_id: tenantId, actor_id: actorId, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar:", error.message);
}

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  const denied = await requirePermission(auth, CORS, "finance.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId as string, actor = (auth.user as { id: string }).id;

  let body: Json;
  try { body = await req.json(); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  const { data: row } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();

  if (action === "status") return json(CORS, 200, { connection: vistaConexion(row) });

  if (!MASTER) { console.error("[facturapi] falta FACTURAPI_ENCRYPTION_KEY"); return json(CORS, 503, { error: "La integración con Facturapi aún no está configurada en el servidor." }); }

  if (action === "connect") {
    const v = validarLlave(body.api_key);
    if (!v.ok) return json(CORS, 400, { error: v.error });
    const r = await consultarOrganizacion(v.key);
    if (!r.ok) { await evento(tenantId, actor, "connected", "failed", { reason: r.auth ? "rejected" : "unreachable" }); return json(CORS, r.auth ? 400 : 502, { error: r.error }); }
    const { ciphertext, iv } = await cifrar(MASTER, tenantId, v.key);
    const now = new Date().toISOString();
    const { data, error } = await admin.from("smyl_facturapi_connections").upsert({
      tenant_id: tenantId, provider: "facturapi", environment: "test", organization_id: r.org.id, organization_name: r.org.name || null,
      secret_ciphertext: ciphertext, secret_iv: iv, key_fingerprint: await huella(v.key), status: "connected",
      connected_at: now, last_verified_at: now, last_error: null, updated_by: actor,
    }).select("*").single();
    if (error) { console.error("[facturapi] no se pudo guardar:", error.message); return json(CORS, 500, { error: "No se pudo guardar la conexión." }); }
    await evento(tenantId, actor, "connected", "success", { organization_id: r.org.id });
    return json(CORS, 200, { connection: vistaConexion(data) });
  }

  if (action === "verify") {
    if (!row || row.status === "disconnected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Facturapi no está conectado." });
    let key: string;
    try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
    catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
    const r = await consultarOrganizacion(key);
    const now = new Date().toISOString();
    const patch = r.ok
      ? { status: "connected", last_verified_at: now, last_error: null, organization_name: r.org.name || row.organization_name, updated_by: actor }
      : { status: r.auth ? "error" : row.status, last_error: r.error.slice(0, 500), updated_by: actor };
    const { data } = await admin.from("smyl_facturapi_connections").update(patch).eq("tenant_id", tenantId).select("*").single();
    await evento(tenantId, actor, "verified", r.ok ? "success" : "failed", r.ok ? {} : { reason: r.auth ? "rejected" : "unreachable" });
    return json(CORS, r.ok ? 200 : (r.auth ? 400 : 502), { connection: vistaConexion(data || row), ...(r.ok ? {} : { error: r.error }) });
  }

  if (action === "disconnect") {
    const { data, error } = await admin.from("smyl_facturapi_connections").update({
      status: "disconnected", secret_ciphertext: null, secret_iv: null, key_fingerprint: null, organization_id: null, organization_name: null,
      connected_at: null, last_verified_at: null, last_error: null, updated_by: actor,
    }).eq("tenant_id", tenantId).select("*").maybeSingle();
    if (error) return json(CORS, 500, { error: "No se pudo desconectar." });
    await evento(tenantId, actor, "disconnected", "success");
    return json(CORS, 200, { connection: vistaConexion(data) });
  }

  return json(CORS, 400, { error: "Acción no válida." });
});
