// Conexión SMYL ↔ Facturapi.
//  · own_key (avanzado): la clínica trae su propia llave de pruebas (sk_test_…).
//  · platform: SMYL crea una organización de Facturapi por clínica con la User Secret Key de la plataforma
//    (FACTURAPI_USER_KEY), carga sus datos fiscales y su CSD, y la pasa a producción con una compuerta explícita.
// Las llaves se cifran aquí (AES-GCM, FACTURAPI_ENCRYPTION_KEY, tenant como dato autenticado) y nunca vuelven al navegador.
// El CSD y su contraseña viajan en memoria hacia Facturapi: no se guardan, no se registran. No timbra ni cancela: etapa posterior.
import { requireUser, requirePermission } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { smylAdmin } from "../_shared/lana-linked.ts";
import {
  FACTURAPI_BASE, LIVE_KEY_RE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion,
  datosLegales, validarCsd, estadoOrganizacion, rfcCoincide, puedeActivarProduccion, leerLlave, mensajeCsd,
} from "../_shared/facturapi-core.mjs";

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
const USER_KEY = Deno.env.get("FACTURAPI_USER_KEY") || "";
const MAX_UPLOAD_BYTES = 200 * 1024;
const MAX_CSD_FAILS_PER_HOUR = 5;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Nunca se registra el cuerpo de las respuestas: pueden traer llaves.
async function fp(path: string, init: RequestInit = {}, key = USER_KEY): Promise<{ ok: boolean; status: number; body: Json | string | null }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}${path}`, {
      ...init, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(20000),
    });
    let body: Json | string | null = null;
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    return { ok: res.ok, status: res.status, body };
  } catch { return { ok: false, status: 0, body: null }; }
}

async function consultarOrganizacion(key: string): Promise<{ ok: true; org: { id: string; name: string } } | { ok: false; error: string; auth: boolean }> {
  const r = await fp("/organizations/me", {}, key);
  if (r.status === 401 || r.status === 403) return { ok: false, auth: true, error: "Facturapi rechazó la llave. Revisa que sea la llave secreta de pruebas de tu organización." };
  if (r.status === 0) return { ok: false, auth: false, error: "No se pudo contactar a Facturapi. Intenta de nuevo." };
  if (!r.ok) return { ok: false, auth: false, error: `Facturapi respondió ${r.status}. Intenta de nuevo en unos minutos.` };
  const org = leerOrganizacion(r.body);
  if (!org) return { ok: false, auth: false, error: "Facturapi respondió algo inesperado al consultar la organización." };
  return { ok: true, org };
}

async function evento(tenantId: string, actor: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_facturapi_connection_events").insert({ tenant_id: tenantId, actor_id: actor, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar:", error.message);
}

async function leerFila(tenantId: string) {
  const { data } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  return data;
}
// Actualiza si la fila existe e inserta si no. No se usa upsert: Postgres valida las restricciones de la fila propuesta
// (estado/llaves/producción) antes de resolver el conflicto, y una actualización parcial las violaría.
async function guardar(tenantId: string, actor: string, patch: Json) {
  const existing = await leerFila(tenantId);
  const q = existing
    ? admin.from("smyl_facturapi_connections").update({ ...patch, updated_by: actor }).eq("tenant_id", tenantId)
    : admin.from("smyl_facturapi_connections").insert({ tenant_id: tenantId, updated_by: actor, ...patch });
  const { data, error } = await q.select("*").single();
  if (error) { console.error("[facturapi] no se pudo guardar:", error.message); throw new Error("No se pudo guardar la conexión."); }
  return data;
}
async function emisor(tenantId: string) {
  const { data } = await admin.from("smyl_issuer_fiscal_profiles").select("*").eq("tenant_id", tenantId).maybeSingle();
  return data;
}

// Trae el estado real de la organización y lo guarda.
async function sincronizar(tenantId: string, actor: string, row: Json) {
  const r = await fp(`/organizations/${encodeURIComponent(row.organization_id)}`);
  if (!r.ok || typeof r.body !== "object" || !r.body) throw new Error("No se pudo consultar a Facturapi. Intenta de nuevo.");
  const st = estadoOrganizacion(r.body);
  const data = await guardar(tenantId, actor, {
    pending_steps: st.pending_steps, production_ready: st.production_ready, csd_valid_until: st.csd_valid_until, csd_serial: st.csd_serial,
    last_verified_at: new Date().toISOString(), last_error: null,
  });
  return { data, st };
}

async function llaveDeOrganizacion(orgId: string, ambiente: "test" | "live", crearSiFalta: boolean): Promise<string | null> {
  const re = ambiente === "live" ? LIVE_KEY_RE : TEST_KEY_RE;
  const got = await fp(`/organizations/${encodeURIComponent(orgId)}/apikeys/${ambiente}`);
  let key = got.ok ? leerLlave(got.body, re) : null;
  if (!key && crearSiFalta) {
    const made = await fp(`/organizations/${encodeURIComponent(orgId)}/apikeys/${ambiente}`, { method: "PUT" });
    key = made.ok ? leerLlave(made.body, re) : null;
  }
  return key;
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

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES) return json(CORS, 413, { error: "La solicitud es demasiado grande." });
  const esMultipart = (req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
  let body: Json = {}, form: FormData | null = null;
  try {
    if (esMultipart) { form = await req.formData(); body = { action: String(form.get("action") || "") }; }
    else body = await req.json();
  } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  const row = await leerFila(tenantId);

  if (action === "status") return json(CORS, 200, { connection: vistaConexion(row) });

  if (!MASTER) { console.error("[facturapi] falta FACTURAPI_ENCRYPTION_KEY"); return json(CORS, 503, { error: "La integración con Facturapi aún no está configurada en el servidor." }); }
  const platformActions = ["provision", "sync", "upload_csd", "enable_live", "disable_live"];
  if (platformActions.includes(action) && !USER_KEY) { console.error("[facturapi] falta FACTURAPI_USER_KEY"); return json(CORS, 503, { error: "La facturación automática aún no está configurada en el servidor." }); }

  try {
    // ── cuenta propia (avanzado), solo pruebas ──
    if (action === "connect") {
      if (row?.mode === "platform" && row?.organization_id) return json(CORS, 409, { error: "Esta clínica usa la cuenta de SMYL. Desconéctala primero si quieres usar tu propia cuenta." });
      const v = validarLlave(body.api_key);
      if (!v.ok) return json(CORS, 400, { error: v.error });
      const r = await consultarOrganizacion(v.key);
      if (!r.ok) { await evento(tenantId, actor, "connected", "failed", { reason: r.auth ? "rejected" : "unreachable" }); return json(CORS, r.auth ? 400 : 502, { error: r.error }); }
      const { ciphertext, iv } = await cifrar(MASTER, tenantId, v.key);
      const now = new Date().toISOString();
      const data = await guardar(tenantId, actor, {
        provider: "facturapi", mode: "own_key", environment: "test", organization_id: r.org.id, organization_name: r.org.name || null,
        secret_ciphertext: ciphertext, secret_iv: iv, key_fingerprint: await huella(v.key), status: "connected",
        connected_at: now, last_verified_at: now, last_error: null,
      });
      await evento(tenantId, actor, "connected", "success", { organization_id: r.org.id, mode: "own_key" });
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "verify") {
      if (!row || row.status === "disconnected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Facturapi no está conectado." });
      if (row.mode === "platform") {
        const { data } = await sincronizar(tenantId, actor, row);
        await evento(tenantId, actor, "verified", "success");
        return json(CORS, 200, { connection: vistaConexion(data) });
      }
      let key: string;
      try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
      catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
      const r = await consultarOrganizacion(key);
      const now = new Date().toISOString();
      const patch = r.ok
        ? { status: "connected", last_verified_at: now, last_error: null, organization_name: r.org.name || row.organization_name }
        : { status: r.auth ? "error" : row.status, last_error: r.error.slice(0, 500) };
      const data = await guardar(tenantId, actor, patch);
      await evento(tenantId, actor, "verified", r.ok ? "success" : "failed", r.ok ? {} : { reason: r.auth ? "rejected" : "unreachable" });
      return json(CORS, r.ok ? 200 : (r.auth ? 400 : 502), { connection: vistaConexion(data), ...(r.ok ? {} : { error: r.error }) });
    }

    // ── plataforma ──
    if (action === "provision") {
      if (row?.mode === "own_key" && row?.status === "connected") return json(CORS, 409, { error: "Ya conectaste tu propia cuenta de Facturapi. Desconéctala primero para usar la de SMYL." });
      const iss = await emisor(tenantId);
      if (!iss || iss.fiscal_status !== "reviewed") return json(CORS, 409, { error: "Primero completa y confirma los datos fiscales de la clínica." });
      const legal = datosLegales(iss);
      if (!legal) return json(CORS, 409, { error: "Faltan datos fiscales de la clínica (razón social, régimen o código postal)." });
      let orgId: string | null = row?.mode === "platform" ? row.organization_id : null;
      if (!orgId) {
        const created = await fp("/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: legal.name }) });
        const id = created.ok && created.body && typeof created.body === "object" ? (created.body as Json).id : null;
        if (typeof id !== "string") { await evento(tenantId, actor, "organization_created", "failed", { status: created.status }); return json(CORS, 502, { error: "Facturapi no pudo crear la organización. Intenta de nuevo." }); }
        orgId = id;
        // Se guarda de inmediato para que un reintento no duplique organizaciones.
        await guardar(tenantId, actor, { provider: "facturapi", mode: "platform", environment: "test", organization_id: orgId, organization_name: legal.name, status: "disconnected", secret_ciphertext: null, secret_iv: null, key_fingerprint: null });
        await evento(tenantId, actor, "organization_created", "success", { organization_id: orgId });
      }
      const put = await fp(`/organizations/${encodeURIComponent(orgId)}/legal`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legal) });
      if (!put.ok) return json(CORS, 502, { error: "Facturapi no aceptó los datos fiscales. Revisa razón social, régimen y código postal." });
      const testKey = await llaveDeOrganizacion(orgId, "test", true);
      if (!testKey) return json(CORS, 502, { error: "Facturapi no entregó la llave de pruebas. Intenta de nuevo." });
      const { ciphertext, iv } = await cifrar(MASTER, tenantId, testKey);
      const now = new Date().toISOString();
      await guardar(tenantId, actor, {
        mode: "platform", environment: "test", organization_id: orgId, organization_name: legal.name, secret_ciphertext: ciphertext, secret_iv: iv,
        key_fingerprint: await huella(testKey), status: "connected", connected_at: row?.connected_at || now, last_error: null,
      });
      const cur = await leerFila(tenantId);
      const { data } = await sincronizar(tenantId, actor, cur);
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "sync") {
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const { data } = await sincronizar(tenantId, actor, row);
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "upload_csd") {
      if (!form) return json(CORS, 400, { error: "Solicitud inválida." });
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const cer = form.get("cer"), key = form.get("key"), password = form.get("password");
      if (!(cer instanceof File) || !(key instanceof File) || typeof password !== "string") return json(CORS, 400, { error: "Sube el .cer, el .key y escribe la contraseña." });
      const v = validarCsd({ cer: { name: cer.name, size: cer.size }, key: { name: key.name, size: key.size }, password });
      if (!v.ok) return json(CORS, 400, { error: v.error });
      const desde = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("smyl_facturapi_connection_events").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("action", "csd_uploaded").eq("status", "failed").gte("created_at", desde);
      if ((count || 0) >= MAX_CSD_FAILS_PER_HOUR) return json(CORS, 429, { error: "Demasiados intentos con el certificado. Espera una hora e inténtalo de nuevo." });
      const iss = await emisor(tenantId);
      const out = new FormData();
      out.append("cer", new Blob([await cer.arrayBuffer()]), "certificado.cer");
      out.append("key", new Blob([await key.arrayBuffer()]), "llave.key");
      out.append("password", password);
      const put = await fp(`/organizations/${encodeURIComponent(row.organization_id)}/certificate`, { method: "PUT", body: out });
      if (!put.ok) {
        const code = put.body && typeof put.body === "object" ? String((put.body as Json).code || "") : "";
        await evento(tenantId, actor, "csd_uploaded", "failed", { code: code.slice(0, 60) });
        return json(CORS, put.status === 0 ? 502 : 400, { error: put.status === 0 ? "No se pudo contactar a Facturapi. Intenta de nuevo." : mensajeCsd(code) });
      }
      const { data, st } = await sincronizar(tenantId, actor, row);
      if (iss && !rfcCoincide(st.tax_id, iss.rfc)) {
        await fp(`/organizations/${encodeURIComponent(row.organization_id)}/certificate`, { method: "DELETE" });
        await evento(tenantId, actor, "csd_uploaded", "failed", { code: "rfc_mismatch" });
        await sincronizar(tenantId, actor, row).catch(() => null);
        return json(CORS, 409, { error: `El RFC del certificado (${st.tax_id || "desconocido"}) no coincide con el de la clínica (${iss.rfc}). Sube el CSD de la clínica o corrige sus datos fiscales.` });
      }
      await evento(tenantId, actor, "csd_uploaded", "success", { serial: st.csd_serial });
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "enable_live") {
      const perm = await requirePermission(auth, CORS, "finance.invoice");
      if (perm) return perm;
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const { data: fresh, st } = await sincronizar(tenantId, actor, row);
      const iss = await emisor(tenantId);
      const { data: pac } = await admin.from("smyl_cfdi_pac_readiness").select("fiscal_policy_reviewed_at").eq("tenant_id", tenantId).maybeSingle();
      const gate = puedeActivarProduccion({
        mode: fresh.mode, status: fresh.status, productionReady: fresh.production_ready, issuerReviewed: iss?.fiscal_status === "reviewed",
        policyReviewed: !!pac?.fiscal_policy_reviewed_at, confirmText: body.confirm_text,
      });
      if (!gate.ok) return json(CORS, 409, { error: gate.error, connection: vistaConexion(fresh) });
      if (!iss || !rfcCoincide(st.tax_id, iss.rfc)) return json(CORS, 409, { error: "El RFC del certificado no coincide con el de la clínica. Vuelve a subir el CSD correcto.", connection: vistaConexion(fresh) });
      const liveKey = await llaveDeOrganizacion(row.organization_id, "live", true);
      if (!liveKey) { await evento(tenantId, actor, "went_live", "failed", { reason: "no_live_key" }); return json(CORS, 502, { error: "Facturapi no entregó la llave de producción. Revisa los pasos pendientes de la organización." }); }
      const enc = await cifrar(MASTER, tenantId, liveKey);
      const now = new Date().toISOString();
      const data = await guardar(tenantId, actor, {
        environment: "live", live_secret_ciphertext: enc.ciphertext, live_secret_iv: enc.iv, live_key_fingerprint: await huella(liveKey),
        live_enabled_at: now, live_enabled_by: actor, last_error: null,
      });
      await evento(tenantId, actor, "went_live", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "disable_live") {
      const perm = await requirePermission(auth, CORS, "finance.invoice");
      if (perm) return perm;
      if (!row) return json(CORS, 409, { error: "Facturapi no está conectado." });
      const data = await guardar(tenantId, actor, { environment: "test", live_secret_ciphertext: null, live_secret_iv: null, live_key_fingerprint: null, live_enabled_at: null, live_enabled_by: null });
      await evento(tenantId, actor, "went_test", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }

    if (action === "disconnect") {
      // En plataforma se conserva la organización (y su CSD en Facturapi); solo se retiran las llaves de SMYL.
      const data = await guardar(tenantId, actor, {
        status: "disconnected", environment: "test", secret_ciphertext: null, secret_iv: null, key_fingerprint: null,
        live_secret_ciphertext: null, live_secret_iv: null, live_key_fingerprint: null, live_enabled_at: null, live_enabled_by: null,
        connected_at: null, last_verified_at: null, last_error: null,
        ...(row?.mode === "platform" ? {} : { organization_id: null, organization_name: null, pending_steps: [], production_ready: false, csd_valid_until: null, csd_serial: null }),
      });
      await evento(tenantId, actor, "disconnected", "success");
      return json(CORS, 200, { connection: vistaConexion(data) });
    }
  } catch (e) {
    console.error("[facturapi] error:", (e as Error)?.message);
    return json(CORS, 500, { error: (e as Error)?.message || "No se pudo completar la acción." });
  }

  return json(CORS, 400, { error: "Acción no válida." });
});
