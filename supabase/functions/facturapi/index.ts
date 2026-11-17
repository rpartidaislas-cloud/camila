// Conexión SMYL ↔ Facturapi (SOLO sandbox): guardar, verificar y desconectar la llave de pruebas de cada clínica.
// La llave se cifra aquí (AES-GCM, secreto FACTURAPI_ENCRYPTION_KEY) y nunca vuelve al navegador.
// Conexión (status/connect/verify/disconnect): requiere finance.manage.
// Timbrado SOLO sandbox (stamp/reconcile/download): requiere finance.invoice y que el borrador ya haya pasado la prevalidación local.
// No cancela nada: eso es una etapa posterior.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, requirePermission } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { smylAdmin } from "../_shared/lana-linked.ts";
import {
  FACTURAPI_BASE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion,
  FORMAS_PAGO, UUID_RE, construirFactura, mensajeFacturapi, clasificarRespuesta, leerFactura,
} from "../_shared/facturapi-core.mjs";

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const STAMP_TIMEOUT_MS = 40_000;
const RECONCILE_WAIT_MS = 2 * 60_000; // no se da por «no creada» una solicitud más reciente que esto
const MAX_FILE_BYTES = 5 * 1024 * 1024;
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

// ───────────── Timbrado (sandbox) ─────────────
async function eventoTimbre(tenantId: string, actorId: string, draftId: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_cfdi_stamp_events").insert({ tenant_id: tenantId, actor_id: actorId, draft_id: draftId, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar el timbrado:", error.message);
}
async function llaveDeTenant(tenantId: string): Promise<{ key: string } | { error: string; status: number }> {
  if (!MASTER) return { error: "La integración con Facturapi aún no está configurada en el servidor.", status: 503 };
  const { data: row } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!row || row.status !== "connected" || !row.secret_ciphertext) return { error: "Conecta Facturapi (sandbox) en Cobros → Facturación antes de timbrar.", status: 409 };
  try {
    const key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv);
    if (!/^sk_test_/.test(key)) return { error: "Solo se timbra con una llave de pruebas (sk_test_…).", status: 409 };
    return { key };
  } catch { return { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi.", status: 500 }; }
}
async function llamarFacturapi(key: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: Json | null; res: Response | null }> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(STAMP_TIMEOUT_MS) });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("json") ? await res.clone().json().catch(() => null) : null;
    return { status: res.status, body, res };
  } catch { return { status: 0, body: null, res: null }; }
}

async function timbrado(req: Request, CORS: Record<string, string>, tenantId: string, actor: string, body: Json): Promise<Response> {
  const draftId = typeof body.draft_id === "string" && UUID_RE.test(body.draft_id) ? body.draft_id : "";
  if (!draftId) return json(CORS, 400, { error: "Borrador inválido." });
  // El borrador se lee con la sesión de la persona: la RLS aplica su alcance (paciente/sucursal), no el navegador.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: draft } = await asUser.from("smyl_cfdi_drafts").select("*").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  if (!draft) return json(CORS, 404, { error: "No encontramos ese borrador o no tienes acceso." });
  const llave = await llaveDeTenant(tenantId);
  if ("error" in llave) return json(CORS, llave.status, { error: llave.error });
  const key = llave.key;
  const now = () => new Date().toISOString();
  const vista = async () => ((await admin.from("smyl_cfdi_drafts").select("*").eq("tenant_id", tenantId).eq("id", draftId).single()).data);

  if (body.action === "download") {
    if (draft.status !== "issued" || !draft.provider_invoice_id) return json(CORS, 409, { error: "Este comprobante aún no está timbrado." });
    const kind = body.kind === "xml" ? "xml" : "pdf";
    const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}/${kind}`);
    if (!r.res || !r.res.ok) { await eventoTimbre(tenantId, actor, draftId, "download", "failed", { kind, status: r.status }); return json(CORS, 502, { error: "Facturapi no pudo entregar el archivo. Intenta de nuevo." }); }
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return json(CORS, 502, { error: "El archivo recibido no es válido." });
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await eventoTimbre(tenantId, actor, draftId, "download", "success", { kind });
    const folio = draft.invoice_series ? `${draft.invoice_series}-${draft.invoice_folio}` : String(draft.external_uuid || draft.id).slice(0, 8);
    return json(CORS, 200, { filename: `CFDI-sandbox-${folio}.${kind}`, media_type: kind === "pdf" ? "application/pdf" : "application/xml", base64: btoa(bin) });
  }

  if (body.action === "reconcile") {
    if (draft.status === "issued") return json(CORS, 200, { draft, message: "Este comprobante ya está timbrado." });
    if (draft.status !== "submitted") return json(CORS, 409, { error: "Este borrador no tiene un timbrado pendiente de verificar." });
    const r = await llamarFacturapi(key, `/invoices?external_id=${encodeURIComponent(draftId)}&limit=1`);
    if (r.status === 0 || r.status >= 500 || !r.body) return json(CORS, 502, { error: "No se pudo consultar a Facturapi. Intenta de nuevo en un momento." });
    const found = leerFactura(Array.isArray(r.body.data) ? r.body.data[0] : null);
    if (found && found.uuid) {
      await admin.from("smyl_cfdi_drafts").update({ status: "issued", external_uuid: found.uuid, provider_invoice_id: found.id, invoice_series: found.series || null, invoice_folio: found.folio, stamped_at: now(), provider_message: "" })
        .eq("tenant_id", tenantId).eq("id", draftId).eq("status", "submitted");
      await eventoTimbre(tenantId, actor, draftId, "reconcile", "success", { found: true });
      return json(CORS, 200, { draft: await vista(), message: "El comprobante sí se había timbrado. Ya quedó registrado." });
    }
    const antiguo = draft.stamp_requested_at && Date.now() - new Date(draft.stamp_requested_at).getTime() > RECONCILE_WAIT_MS;
    if (!antiguo) return json(CORS, 409, { error: "La solicitud es muy reciente. Espera un par de minutos y verifica de nuevo." });
    await admin.from("smyl_cfdi_drafts").update({ status: "rejected", provider_message: "Facturapi no recibió la solicitud. Puedes intentar timbrar de nuevo." }).eq("tenant_id", tenantId).eq("id", draftId).eq("status", "submitted");
    await eventoTimbre(tenantId, actor, draftId, "reconcile", "success", { found: false });
    return json(CORS, 200, { draft: await vista(), message: "Facturapi no recibió esa solicitud: ya puedes intentar de nuevo." });
  }

  // stamp
  if (draft.status === "issued") return json(CORS, 409, { error: "Este comprobante ya está timbrado." });
  if (draft.status === "submitted") return json(CORS, 409, { error: "Ya hay un timbrado en proceso. Usa «Verificar estado»." });
  if (draft.status !== "draft" && draft.status !== "rejected") return json(CORS, 409, { error: "Este borrador no se puede timbrar." });
  if (draft.sandbox_status !== "passed") return json(CORS, 409, { error: "Primero pasa la prevalidación del borrador." });
  const formaPago = typeof body.payment_form === "string" ? body.payment_form : "";
  if (!FORMAS_PAGO[formaPago as keyof typeof FORMAS_PAGO]) return json(CORS, 400, { error: "Elige la forma de pago real del cobro." });
  // IVA de cada concepto: sale del snapshot del servicio que se guardó en el cargo (no de lo que mande el navegador).
  const ids = (Array.isArray(draft.concepts_snapshot) ? draft.concepts_snapshot : []).map((c: Json) => c.charge_id).filter((v: unknown) => typeof v === "string" && UUID_RE.test(v as string));
  const { data: cargos } = ids.length ? await admin.from("smyl_finance_charges").select("id, service_snapshot").eq("tenant_id", tenantId).in("id", ids) : { data: [] };
  const impuestos: Json = {};
  for (const c of cargos || []) impuestos[c.id] = { tax_treatment: c.service_snapshot?.tax_treatment, tax_rate: c.service_snapshot?.tax_rate };
  const armado = construirFactura(draft, impuestos, formaPago);
  if (!armado.ok) return json(CORS, 422, { error: armado.errors[0], errors: armado.errors });

  // Se «reclama» el borrador antes de llamar a Facturapi: dos clics o dos personas no pueden timbrar al mismo tiempo.
  const { data: claimed } = await admin.from("smyl_cfdi_drafts").update({
    status: "submitted", provider: "facturapi", payment_form: formaPago, stamp_attempts: (draft.stamp_attempts || 0) + 1, stamp_requested_at: now(), provider_message: "",
  }).eq("tenant_id", tenantId).eq("id", draftId).in("status", ["draft", "rejected"]).select("id").maybeSingle();
  if (!claimed) return json(CORS, 409, { error: "Otra persona ya está timbrando este borrador." });

  const r = await llamarFacturapi(key, "/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(armado.payload) });
  const clase = clasificarRespuesta(r.status, r.body);
  if (clase === "ok") {
    const f = leerFactura(r.body)!;
    const difiere = f.total !== null && Math.round(f.total * 100) !== Math.round(armado.total * 100);
    await admin.from("smyl_cfdi_drafts").update({
      status: "issued", external_uuid: f.uuid, provider_invoice_id: f.id, invoice_series: f.series || null, invoice_folio: f.folio, stamped_at: now(),
      provider_message: difiere ? "Aviso: el total que devolvió Facturapi difiere del cobro. Revísalo antes de entregar el comprobante." : "",
    }).eq("tenant_id", tenantId).eq("id", draftId);
    await eventoTimbre(tenantId, actor, draftId, "stamp", "success", { total_differs: difiere });
    return json(CORS, 200, { draft: await vista(), message: "Comprobante timbrado en sandbox (sin validez fiscal)." });
  }
  if (clase === "rejected") {
    const msg = mensajeFacturapi(r.body, r.status);
    await admin.from("smyl_cfdi_drafts").update({ status: "rejected", provider_message: msg.slice(0, 1000) }).eq("tenant_id", tenantId).eq("id", draftId);
    await eventoTimbre(tenantId, actor, draftId, "stamp", "failed", { status: r.status });
    return json(CORS, 422, { error: `Facturapi rechazó el comprobante: ${msg}`, draft: await vista() });
  }
  const msg = "No se confirmó el timbrado (Facturapi no respondió a tiempo o pidió esperar). Usa «Verificar estado» antes de intentar de nuevo.";
  await admin.from("smyl_cfdi_drafts").update({ provider_message: msg }).eq("tenant_id", tenantId).eq("id", draftId);
  await eventoTimbre(tenantId, actor, draftId, "stamp", "pending", { status: r.status });
  return json(CORS, 202, { draft: await vista(), message: msg });
}

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  let body: Json;
  try { body = await req.json(); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  const esTimbrado = action === "stamp" || action === "reconcile" || action === "download";
  const denied = await requirePermission(auth, CORS, esTimbrado ? "finance.invoice" : "finance.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId as string, actor = (auth.user as { id: string }).id;
  if (esTimbrado) return await timbrado(req, CORS, tenantId, actor, body);
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
