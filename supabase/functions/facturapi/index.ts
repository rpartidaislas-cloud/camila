// Conexión SMYL ↔ Facturapi.
//  · own_key (avanzado): la clínica trae su propia llave de pruebas (sk_test_…).
//  · platform: SMYL crea una organización de Facturapi por clínica con la User Secret Key de la plataforma
//    (FACTURAPI_USER_KEY), carga sus datos fiscales y su CSD, y la pasa a producción con una compuerta explícita.
// Las llaves se cifran aquí (AES-GCM, FACTURAPI_ENCRYPTION_KEY, tenant como dato autenticado) y nunca vuelven al navegador.
// El CSD y su contraseña viajan en memoria hacia Facturapi: no se guardan, no se registran. Timbrado y cancelación (stamp/reconcile/download/cancel/cancel_check/send_email): finance.invoice, con el borrador ya prevalidado.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, requirePermission } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { smylAdmin } from "../_shared/lana-linked.ts";
import {
  FACTURAPI_BASE, LIVE_KEY_RE, TEST_KEY_RE, validarLlave, huella, cifrar, descifrar, leerOrganizacion, vistaConexion,
  datosLegales, validarCsd, estadoOrganizacion, rfcCoincide, puedeActivarProduccion, leerLlave, mensajeCsd,
  SAT_CONSULTAS_RESPALDO, leerProductosSat, textoBusquedaSat, descripcionServicioSat, leerConsultasSat, unirCandidatosSat, leerSeleccionSat,
  SAT_CONSULTAS_SCHEMA, SAT_SELECCION_SCHEMA, SAT_SYSTEM_CONSULTAS, SAT_SYSTEM_SELECCION, SERVICIO_SCHEMA, SERVICIO_SYSTEM, leerServicioSugerido, sumarUso,
  FORMAS_PAGO, UUID_RE, construirFactura, mensajeFacturapi, clasificarRespuesta, leerFactura,
  parametrosCancelacion, estadoCancelacion, clasificarCancelacion, puedeCancelarEnProduccion, validarCorreo, enmascararCorreo, clasificarEnvio, descarga,
} from "../_shared/facturapi-core.mjs";
import { FISCAL_EXTRACT_MODEL, FISCAL_EXTRACT_MAX_TOKENS, FISCAL_EXTRACT_TIMEOUT_MS, topesDeEntorno, evaluarTopeFiscal, costoEstimadoUsd } from "../_shared/fiscal-core.mjs";
import { inicioDiaUTC, inicioMesUTC } from "../_shared/ai-quota.ts";

const admin = smylAdmin;
const MASTER = Deno.env.get("FACTURAPI_ENCRYPTION_KEY") || "";
const USER_KEY = Deno.env.get("FACTURAPI_USER_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
// Timbrar en producción emite facturas reales. Apagado por defecto: se enciende con FACTURAPI_LIVE_STAMPING=1 tras una prueba controlada.
const LIVE_STAMPING = Deno.env.get("FACTURAPI_LIVE_STAMPING") === "1";
// Igual que el resto de SMYL: mientras no se active el cobro de consumibles, el consumo se mide (meter_only) sin bloquear.
const CONSUMABLES_ENFORCED = (Deno.env.get("SMYL_CONSUMABLES_ENFORCED") || "false") === "true";
// Cancelar en producción es una acción real ante el SAT: apagado por defecto, se enciende con FACTURAPI_LIVE_CANCELLATION=1 tras una prueba controlada.
const LIVE_CANCELLATION = Deno.env.get("FACTURAPI_LIVE_CANCELLATION") === "1";
const STAMP_TIMEOUT_MS = 40_000;
const RECONCILE_WAIT_MS = 2 * 60_000; // no se da por «no creada» una solicitud más reciente que esto
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 200 * 1024;
const MAX_CSD_FAILS_PER_HOUR = 5;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

const vista = (r: Json | null) => ({ ...vistaConexion(r), live_stamping: LIVE_STAMPING, live_cancellation: LIVE_CANCELLATION });
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

// ───────────── Timbrado (sandbox) ─────────────
async function eventoTimbre(tenantId: string, actorId: string, draftId: string, action: string, status: string, detail: Json = {}) {
  const { error } = await admin.from("smyl_cfdi_stamp_events").insert({ tenant_id: tenantId, actor_id: actorId, draft_id: draftId, action, status, detail });
  if (error) console.error("[facturapi] no se pudo auditar el timbrado:", error.message);
}
async function llaveDeTenant(tenantId: string): Promise<{ key: string; live: boolean } | { error: string; status: number }> {
  if (!MASTER) return { error: "La integración con Facturapi aún no está configurada en el servidor.", status: 503 };
  const { data: row } = await admin.from("smyl_facturapi_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!row || row.status !== "connected" || !row.secret_ciphertext) return { error: "Conecta Facturapi en Configuración → Cobros → Facturación antes de timbrar.", status: 409 };
  try {
    if (row.environment === "live") {
      // Timbrar en producción emite facturas reales: solo con el interruptor del servidor y la llave live guardada por la compuerta.
      if (!LIVE_STAMPING) return { error: "El timbrado en producción aún no está habilitado en el servidor. Vuelve a pruebas para timbrar en sandbox.", status: 409 };
      if (row.mode !== "platform" || !row.production_ready || !row.live_secret_ciphertext || !row.live_secret_iv) return { error: "La producción de esta clínica no está completa.", status: 409 };
      const key = await descifrar(MASTER, tenantId, row.live_secret_ciphertext, row.live_secret_iv);
      if (!LIVE_KEY_RE.test(key)) return { error: "La llave de producción guardada no es válida. Vuelve a activar producción.", status: 500 };
      return { key, live: true };
    }
    const key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv);
    if (!/^sk_test_/.test(key)) return { error: "Solo se timbra con una llave de pruebas (sk_test_…).", status: 409 };
    return { key, live: false };
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

// ───────────── Sugerencia de clave SAT con IA ─────────────
// Una llamada corta a Claude (modelo económico) con salida estructurada. Solo viaja el nombre, la categoría y la descripción del servicio.
async function llamarIA(aiKey: string, system: string, texto: string, schema: Json): Promise<{ ok: boolean; text: string; usage: Json | null; id: string | null; ms: number; stop: string | null; detail: string }> {
  const inicio = Date.now();
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(FISCAL_EXTRACT_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: FISCAL_EXTRACT_MODEL, max_tokens: FISCAL_EXTRACT_MAX_TOKENS, system,
        messages: [{ role: "user", content: [{ type: "text", text: texto }] }],
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      }),
    });
    const msg = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Tipo y mensaje del error de la API (describe el esquema o el límite; nunca lleva la llave ni el texto del servicio).
      const detail = `${resp.status} ${String(msg?.error?.type || "")}: ${String(msg?.error?.message || "").replace(/\s+/g, " ").slice(0, 240)}`.trim();
      console.error("[facturapi] la IA rechazó la solicitud:", detail);
      return { ok: false, text: "", usage: null, id: null, ms: Date.now() - inicio, stop: `api_${resp.status}`, detail };
    }
    const text = Array.isArray(msg.content) ? msg.content.filter((b: Json) => b?.type === "text").map((b: Json) => b.text).join("") : "";
    // «max_tokens» aquí significa que el razonamiento + la respuesta no cupieron: la respuesta llega cortada y no se puede leer.
    if (msg.stop_reason && msg.stop_reason !== "end_turn") console.error("[facturapi] la IA terminó con:", msg.stop_reason);
    return { ok: true, text, usage: msg.usage || null, id: msg.id || null, ms: Date.now() - inicio, stop: typeof msg.stop_reason === "string" ? msg.stop_reason : null, detail: "" };
  } catch { return { ok: false, text: "", usage: null, id: null, ms: Date.now() - inicio, stop: "error_de_red", detail: "No se pudo contactar a la IA (red o tiempo de espera)." }; }
}
// Se mide en el mismo registro y con el mismo tope que la lectura de constancias (feature «fiscal_extract»): no requiere migración.
async function medirIA(tenantId: string, r: { ok: boolean; usage: Json | null; id: string | null; ms: number; stop: string | null; detail?: string }) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenantId, feature: "fiscal_extract", model: FISCAL_EXTRACT_MODEL, request_id: r.id ? `sat:${r.id}`.slice(0, 120) : null, outcome: r.ok ? "ok" : "error",
    input_tokens: n(r.usage?.input_tokens), output_tokens: n(r.usage?.output_tokens), cache_read_tokens: n(r.usage?.cache_read_input_tokens),
    cache_write_tokens: n(r.usage?.cache_creation_input_tokens), duration_ms: n(r.ms), stop_reason: r.stop ? r.stop.slice(0, 40) : null, estimated_cost_usd: costoEstimadoUsd(FISCAL_EXTRACT_MODEL, r.usage),
  });
  if (error) console.error("[facturapi] no se pudo medir la IA:", error.message);
}

// Cuenta cada sugerencia en «Créditos de IA» (Consumo) con los tokens usados (suma de todas sus llamadas); si falla el registro, no se pierde la sugerencia.
async function registrarConsumo(tenantId: string, llamadas: Array<{ usage: Json | null; id: string | null }>, etiqueta: string, ok: boolean) {
  const uso = sumarUso(llamadas.map((l) => l.usage));
  const base = llamadas.map((l) => l.id).find(Boolean) || crypto.randomUUID();
  const { error } = await admin.rpc("smyl_consume", {
    p_tenant_id: tenantId, p_resource: "ai_credits", p_quantity_units: 1, p_idempotency_key: `${etiqueta}:${base}`,
    p_source_type: etiqueta, p_source_id: null, p_provider: "anthropic", p_provider_model: FISCAL_EXTRACT_MODEL,
    p_metadata: { token_usage: uso, estimated_cost_usd: costoEstimadoUsd(FISCAL_EXTRACT_MODEL, uso), outcome: ok ? "ok" : "error" },
    p_enforce: CONSUMABLES_ENFORCED,
  });
  if (error) console.error("[facturapi] no se pudo registrar el consumo de IA:", error.message);
}
// Antes de llamar a la IA: llave configurada, tope diario/mensual y, si el cobro de consumibles está activo, saldo de créditos. null = se puede continuar.
async function puedeUsarIA(tenantId: string, CORS: Record<string, string>): Promise<{ aiKey: string } | Response> {
  const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!aiKey) return json(CORS, 503, { error: "La IA no está configurada todavía. Captura los datos a mano." });
  const ahora = new Date();
  const [dia, mes] = await Promise.all(
    [inicioDiaUTC(ahora), inicioMesUTC(ahora)].map((desde) =>
      admin.from("smyl_ai_usage_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("feature", "fiscal_extract").gte("created_at", desde)),
  );
  const tope = evaluarTopeFiscal(dia.count || 0, mes.count || 0, topesDeEntorno(Deno.env));
  if (!tope.permitido) return json(CORS, 429, { error: tope.mensaje });
  if (CONSUMABLES_ENFORCED) {
    const { data: wallet } = await admin.from("smyl_wallets").select("balance_units").eq("tenant_id", tenantId).eq("resource", "ai_credits").maybeSingle();
    if (!wallet || Number(wallet.balance_units) < 1) return json(CORS, 402, { error: "No hay créditos de IA suficientes. Captura los datos a mano." });
  }
  return { aiKey };
}
// Claves del SAT: busca cada consulta en el catálogo oficial y la IA elige solo entre las claves reales encontradas.
async function sugerirClaveSat(tenantId: string, aiKey: string, key: string, texto: string, consultas: string[]) {
  // Cada búsqueda deja su resultado (código HTTP y cuántas claves) para poder explicar un resultado vacío.
  const diagnostico: Array<{ q: string; status: number; n: number }> = [];
  const buscar = async (q: string) => {
    const r = await fp(`/catalogs/products?q=${encodeURIComponent(q)}&limit=10`, {}, key);
    const lista = r.ok && r.body && typeof r.body === "object" ? leerProductosSat(r.body, 10) : [];
    diagnostico.push({ q, status: r.status, n: lista.length });
    return lista;
  };
  let candidatos = unirCandidatosSat(await Promise.all(consultas.map(buscar)));
  // Si las palabras de la IA no encontraron nada, se prueba con palabras generales del catálogo dental (así se llaman los servicios del SAT).
  if (!candidatos.length) candidatos = unirCandidatosSat(await Promise.all(SAT_CONSULTAS_RESPALDO.filter((q) => !consultas.includes(q)).map(buscar)));
  if (!candidatos.length) return { suggestions: [], candidates: [], queries: consultas, diagnostico, llamadas: [] as Array<{ usage: Json | null; id: string | null }> };
  const ia = await llamarIA(aiKey, SAT_SYSTEM_SELECCION, `${texto}\n\nClaves reales del catálogo:\n${candidatos.map((c) => `${c.key} — ${c.description}`).join("\n")}`, SAT_SELECCION_SCHEMA);
  await medirIA(tenantId, ia);
  return { suggestions: ia.ok ? leerSeleccionSat(ia.text, candidatos) : [], candidates: candidatos, queries: consultas, diagnostico, llamadas: [{ usage: ia.usage, id: ia.id }] };
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
  const key = llave.key, live = llave.live;
  const now = () => new Date().toISOString();
  const vista = async () => ((await admin.from("smyl_cfdi_drafts").select("*").eq("tenant_id", tenantId).eq("id", draftId).single()).data);

  if (body.action === "download") {
    if ((draft.status !== "issued" && draft.status !== "cancelled") || !draft.provider_invoice_id) return json(CORS, 409, { error: "Este comprobante aún no está timbrado." });
    const kind = typeof body.kind === "string" ? body.kind : "pdf";
    const d = descarga(kind);
    // El acuse solo existe cuando la cancelación fue aceptada.
    if (d.acuse && draft.status !== "cancelled") return json(CORS, 409, { error: "El acuse de cancelación estará disponible cuando el comprobante quede cancelado." });
    const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}/${d.path}`);
    if (!r.res || !r.res.ok) { await eventoTimbre(tenantId, actor, draftId, "download", "failed", { kind, status: r.status }); return json(CORS, 502, { error: "Facturapi no pudo entregar el archivo. Intenta de nuevo." }); }
    const bytes = new Uint8Array(await r.res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return json(CORS, 502, { error: "El archivo recibido no es válido." });
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await eventoTimbre(tenantId, actor, draftId, "download", "success", { kind });
    const folio = draft.invoice_series ? `${draft.invoice_series}-${draft.invoice_folio}` : String(draft.external_uuid || draft.id).slice(0, 8);
    return json(CORS, 200, { filename: `${d.acuse ? "Acuse-cancelacion" : "CFDI"}${live ? "" : "-sandbox"}-${folio}.${d.ext}`, media_type: d.mime, base64: btoa(bin) });
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


  // ── Envío por correo ──
  if (body.action === "send_email") {
    if (draft.status !== "issued" || !draft.provider_invoice_id) return json(CORS, 409, { error: "Solo un comprobante timbrado se puede enviar por correo." });
    // Destinatario: el que escribe la persona o, si no, el correo fiscal del paciente. Siempre uno solo y válido.
    const destino = validarCorreo(typeof body.email === "string" && body.email.trim() ? body.email : (draft.fiscal_snapshot || {}).email);
    if (!destino) return json(CORS, 400, { error: "Escribe un correo válido para enviar el comprobante." });
    // Freno contra doble clic: no se vuelve a enviar durante los siguientes 30 segundos.
    if (draft.last_emailed_at && Date.now() - new Date(draft.last_emailed_at).getTime() < 30_000) return json(CORS, 409, { error: "Ya se envió hace un momento. Espera unos segundos antes de reenviar." });
    const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: destino }) });
    const clase = clasificarEnvio(r.status, r.body);
    const masked = enmascararCorreo(destino);
    if (clase === "ok") {
      await admin.from("smyl_cfdi_drafts").update({ last_emailed_at: now(), last_emailed_to: masked, email_count: (draft.email_count || 0) + 1 }).eq("tenant_id", tenantId).eq("id", draftId);
      await eventoTimbre(tenantId, actor, draftId, "email", "success", { to: masked, live });
      return json(CORS, 200, { draft: await vista(), message: `Comprobante enviado a ${masked}.` });
    }
    if (clase === "rejected") {
      const msg = mensajeFacturapi(r.body, r.status);
      await eventoTimbre(tenantId, actor, draftId, "email", "failed", { to: masked, status: r.status });
      return json(CORS, 422, { error: `Facturapi no pudo enviar el correo: ${msg}` });
    }
    await eventoTimbre(tenantId, actor, draftId, "email", "pending", { to: masked, status: r.status });
    return json(CORS, 202, { draft: await vista(), message: "No se confirmó el envío (Facturapi no respondió a tiempo). Revisa con el paciente si lo recibió antes de reenviar." });
  }

  // ── Cancelación (sandbox) ──
  if (body.action === "cancel" || body.action === "cancel_check") {
    // En producción cancelar es real ante el SAT: interruptor del servidor + texto de confirmación (solo al enviar; verificar es solo lectura).
    if (live && body.action === "cancel") {
      const gate = puedeCancelarEnProduccion({ live, enabled: LIVE_CANCELLATION, confirmText: body.confirm_text });
      if (!gate.ok) return json(CORS, 409, { error: gate.error });
    }
    if (live && body.action === "cancel_check" && !LIVE_CANCELLATION) return json(CORS, 409, { error: "La cancelación en producción aún no está habilitada en el servidor." });
    if (draft.status === "cancelled") return json(CORS, 200, { draft, message: "Este comprobante ya está cancelado." });
    if (draft.status !== "issued" || !draft.provider_invoice_id) return json(CORS, 409, { error: "Solo un comprobante timbrado se puede cancelar." });
    const { data: plan } = await admin.from("smyl_cfdi_cancellation_plans").select("*").eq("tenant_id", tenantId).eq("draft_id", draftId).in("status", ["planned", "submitted"]).maybeSingle();
    if (!plan) return json(CORS, 409, { error: "Primero planea la cancelación (motivo y, si aplica, UUID sustituto)." });
    const aceptar = async (extra: Json = {}) => {
      await admin.from("smyl_cfdi_drafts").update({ status: "cancelled", cancellation_status: "accepted", cancelled_at: now(), ...extra }).eq("tenant_id", tenantId).eq("id", draftId).eq("status", "issued");
      await admin.from("smyl_cfdi_cancellation_plans").update({ status: "accepted", resolved_at: now(), provider_message: "" }).eq("tenant_id", tenantId).eq("id", plan.id);
    };
    const rechazar = async (msg: string) => {
      await admin.from("smyl_cfdi_cancellation_plans").update({ status: "rejected", resolved_at: now(), provider_message: msg.slice(0, 1000) }).eq("tenant_id", tenantId).eq("id", plan.id);
      await admin.from("smyl_cfdi_drafts").update({ cancellation_status: "rejected" }).eq("tenant_id", tenantId).eq("id", draftId);
    };
    const pendiente = async () => { await admin.from("smyl_cfdi_drafts").update({ cancellation_status: "pending" }).eq("tenant_id", tenantId).eq("id", draftId); };

    if (body.action === "cancel_check") {
      if (plan.status !== "submitted") return json(CORS, 409, { error: "Esta cancelación aún no se ha enviado a Facturapi." });
      const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}`);
      if (r.status === 0 || r.status >= 500 || !r.body) return json(CORS, 502, { error: "No se pudo consultar a Facturapi. Intenta de nuevo en un momento." });
      const estado = estadoCancelacion(r.body);
      if (estado === "accepted") { await aceptar(); await eventoTimbre(tenantId, actor, draftId, "cancel_check", "success", { estado }); return json(CORS, 200, { draft: await vista(), message: "El comprobante quedó cancelado." }); }
      if (estado === "pending") { await pendiente(); await eventoTimbre(tenantId, actor, draftId, "cancel_check", "pending", { estado }); return json(CORS, 200, { draft: await vista(), message: "Sigue esperando la aceptación del paciente." }); }
      if (estado === "rejected") { await rechazar("El paciente rechazó la cancelación o la solicitud expiró."); await eventoTimbre(tenantId, actor, draftId, "cancel_check", "failed", { estado }); return json(CORS, 200, { draft: await vista(), message: "La cancelación no procedió: el paciente la rechazó o expiró." }); }
      const antiguo = plan.submitted_at && Date.now() - new Date(plan.submitted_at).getTime() > RECONCILE_WAIT_MS;
      if (!antiguo) return json(CORS, 409, { error: "La solicitud es muy reciente. Espera un par de minutos y verifica de nuevo." });
      await rechazar("Facturapi no registró la solicitud de cancelación. Puedes planearla de nuevo.");
      await eventoTimbre(tenantId, actor, draftId, "cancel_check", "success", { estado: "none" });
      return json(CORS, 200, { draft: await vista(), message: "Facturapi no registró esa solicitud: puedes planear la cancelación de nuevo." });
    }

    // cancel
    if (plan.status !== "planned") return json(CORS, 409, { error: "La cancelación ya se envió. Usa «Verificar cancelación»." });
    const params = parametrosCancelacion(plan);
    if (!params.ok) return json(CORS, 422, { error: params.error });
    // Se reclama el plan (planned → submitted) antes de enviar: dos clics no cancelan dos veces.
    const { data: claimed } = await admin.from("smyl_cfdi_cancellation_plans").update({ status: "submitted", submitted_at: now(), provider_message: "" })
      .eq("tenant_id", tenantId).eq("id", plan.id).eq("status", "planned").select("id").maybeSingle();
    if (!claimed) return json(CORS, 409, { error: "Otra persona ya está enviando esta cancelación." });
    const r = await llamarFacturapi(key, `/invoices/${encodeURIComponent(draft.provider_invoice_id)}?${params.query}`, { method: "DELETE" });
    const clase = clasificarCancelacion(r.status, r.body);
    if (clase === "accepted") { await aceptar(); await eventoTimbre(tenantId, actor, draftId, "cancel", "success", { motive: plan.reason_code, live }); return json(CORS, 200, { draft: await vista(), message: live ? "Comprobante cancelado en producción." : "Comprobante cancelado en sandbox." }); }
    if (clase === "pending") {
      await pendiente(); await eventoTimbre(tenantId, actor, draftId, "cancel", "pending", { motive: plan.reason_code, live });
      return json(CORS, 202, { draft: await vista(), message: "La cancelación está pendiente: el paciente debe aceptarla. Usa «Verificar cancelación» más tarde." });
    }
    if (clase === "rejected") {
      const msg = mensajeFacturapi(r.body, r.status);
      await rechazar(msg); await eventoTimbre(tenantId, actor, draftId, "cancel", "failed", { status: r.status, motive: plan.reason_code, live });
      return json(CORS, 422, { error: `Facturapi no pudo cancelar el comprobante: ${msg}`, draft: await vista() });
    }
    const msg = "No se confirmó la cancelación (Facturapi no respondió a tiempo o pidió esperar). Usa «Verificar cancelación» antes de intentar de nuevo.";
    await admin.from("smyl_cfdi_cancellation_plans").update({ provider_message: msg }).eq("tenant_id", tenantId).eq("id", plan.id);
    await eventoTimbre(tenantId, actor, draftId, "cancel", "pending", { status: r.status, motive: plan.reason_code, live });
    return json(CORS, 202, { draft: await vista(), message: msg });
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
    return json(CORS, 200, { draft: await vista(), message: live ? "Comprobante timbrado en producción." : "Comprobante timbrado en sandbox (sin validez fiscal)." });
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

  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD_BYTES) return json(CORS, 413, { error: "La solicitud es demasiado grande." });
  const esMultipart = (req.headers.get("content-type") || "").toLowerCase().includes("multipart/form-data");
  let body: Json = {}, form: FormData | null = null;
  try {
    if (esMultipart) { form = await req.formData(); body = { action: String(form.get("action") || "") }; }
    else body = await req.json();
  } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const action = body.action;
  // Timbrado y cancelación (stamp/reconcile/download/cancel/cancel_check): finance.invoice. Conexión y plataforma: finance.manage.
  const esTimbrado = action === "stamp" || action === "reconcile" || action === "download" || action === "cancel" || action === "cancel_check" || action === "send_email";
  const denied = await requirePermission(auth, CORS, esTimbrado ? "finance.invoice" : "finance.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId as string, actor = (auth.user as { id: string }).id;
  if (esTimbrado) return await timbrado(req, CORS, tenantId, actor, body);

  const row = await leerFila(tenantId);

  if (action === "status") return json(CORS, 200, { connection: vista(row) });

  if (!MASTER) { console.error("[facturapi] falta FACTURAPI_ENCRYPTION_KEY"); return json(CORS, 503, { error: "La integración con Facturapi aún no está configurada en el servidor." }); }
  const platformActions = ["provision", "sync", "upload_csd", "enable_live", "disable_live"];
  if (platformActions.includes(action) && !USER_KEY) { console.error("[facturapi] falta FACTURAPI_USER_KEY"); return json(CORS, 503, { error: "La facturación automática aún no está configurada en el servidor." }); }

  try {
    // ── Buscar la ClaveProdServ de un servicio en el catálogo oficial del SAT (lo sirve Facturapi; no depende de producción) ──
    if (action === "search_sat_products") {
      if (!row || row.status !== "connected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Conecta Facturapi en Configuración → Facturación para buscar claves del SAT." });
      const q = textoBusquedaSat(body.q);
      if (!q) return json(CORS, 400, { error: "Escribe al menos 3 letras del servicio." });
      let key: string;
      try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
      catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
      const r = await fp(`/catalogs/products?q=${encodeURIComponent(q)}&limit=12`, {}, key);
      if (!r.ok || !r.body || typeof r.body !== "object") return json(CORS, 502, { error: "Facturapi no pudo buscar claves en este momento. Intenta de nuevo." });
      const results = leerProductosSat(r.body);
      return json(CORS, 200, { results, ...(results.length ? {} : { diagnostico: [{ q, status: r.status, n: 0 }] }) });
    }

    // ── La IA sugiere la ClaveProdServ: propone palabras de búsqueda, el catálogo oficial devuelve claves reales y solo se elige entre ellas ──
    if (action === "suggest_sat_product") {
      if (!row || row.status !== "connected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Conecta Facturapi en Configuración → Facturación para buscar claves del SAT." });
      const servicio = descripcionServicioSat(body);
      if (!servicio) return json(CORS, 400, { error: "Escribe primero el nombre del servicio." });
      const listo = await puedeUsarIA(tenantId, CORS);
      if (listo instanceof Response) return listo;
      let key: string;
      try { key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv); }
      catch { return json(CORS, 500, { error: "No se pudo leer la llave guardada. Vuelve a conectar Facturapi." }); }
      const texto = `Servicio: ${servicio.name}${servicio.category ? `\nCategoría: ${servicio.category}` : ""}${servicio.description ? `\nDescripción: ${servicio.description}` : ""}`;
      // 1) palabras de búsqueda; si la IA falla se busca con el nombre del servicio
      const ia1 = await llamarIA(listo.aiKey, SAT_SYSTEM_CONSULTAS, texto, SAT_CONSULTAS_SCHEMA);
      await medirIA(tenantId, ia1);
      let consultas = ia1.ok ? leerConsultasSat(ia1.text) : [];
      if (!consultas.length) consultas = [textoBusquedaSat(servicio.name)].filter(Boolean);
      const sat = await sugerirClaveSat(tenantId, listo.aiKey, key, texto, consultas);
      await registrarConsumo(tenantId, [{ usage: ia1.usage, id: ia1.id }, ...sat.llamadas], "sat_suggest", ia1.ok);
      return json(CORS, 200, { suggestions: sat.suggestions, candidates: sat.candidates, queries: sat.queries, diagnostico: sat.diagnostico });
    }

    // ── La IA sugiere el servicio completo (todo menos el precio): especialidad, alcance, cobro, duración, textos y clave SAT. Es una sugerencia que la persona revisa. ──
    if (action === "suggest_service") {
      const servicio = descripcionServicioSat(body);
      if (!servicio) return json(CORS, 400, { error: "Escribe primero el nombre del servicio." });
      const listo = await puedeUsarIA(tenantId, CORS);
      if (listo instanceof Response) return listo;
      const texto = `Nombre del servicio: ${servicio.name}`;
      const ia1 = await llamarIA(listo.aiKey, SERVICIO_SYSTEM, texto, SERVICIO_SCHEMA);
      await medirIA(tenantId, ia1);
      const campos = ia1.ok ? leerServicioSugerido(ia1.text) : null;
      if (!campos) { console.error("[facturapi] sugerencia de servicio ilegible; ia_ok:", ia1.ok, "stop:", ia1.stop, "respuesta_vacía:", !ia1.text); await registrarConsumo(tenantId, [{ usage: ia1.usage, id: ia1.id }], "service_suggest", false); return json(CORS, 502, { error: "La IA no dio una respuesta clara. Llena el servicio a mano.", detail: ia1.detail || (ia1.ok ? `La respuesta no tenía el formato esperado (terminó con: ${ia1.stop || "desconocido"}${ia1.text ? "" : ", vacía"}).` : "") }); }
      const { queries, ...fields } = campos;
      // Clave SAT: solo si Facturapi está conectado (el catálogo del SAT lo sirve Facturapi); si no, el resto de la sugerencia sigue valiendo.
      let sat: Json | null = null, llamadas: Array<{ usage: Json | null; id: string | null }> = [{ usage: ia1.usage, id: ia1.id }];
      if (row && row.status === "connected" && row.secret_ciphertext) {
        try {
          const key = await descifrar(MASTER, tenantId, row.secret_ciphertext, row.secret_iv);
          const r = await sugerirClaveSat(tenantId, listo.aiKey, key, `Servicio: ${servicio.name}${fields.description ? `\nDescripción: ${fields.description}` : ""}`, queries.length ? queries : [textoBusquedaSat(servicio.name)].filter(Boolean));
          sat = { suggestions: r.suggestions, candidates: r.candidates, queries: r.queries, diagnostico: r.diagnostico }; llamadas = [...llamadas, ...r.llamadas];
        } catch { sat = null; }
      }
      await registrarConsumo(tenantId, llamadas, "service_suggest", true);
      return json(CORS, 200, { fields, sat, sat_note: sat ? "" : "Conecta Facturapi en Configuración → Facturación para sugerir también la clave del SAT." });
    }

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
      return json(CORS, 200, { connection: vista(data) });
    }

    if (action === "verify") {
      if (!row || row.status === "disconnected" || !row.secret_ciphertext) return json(CORS, 409, { error: "Facturapi no está conectado." });
      if (row.mode === "platform") {
        const { data } = await sincronizar(tenantId, actor, row);
        await evento(tenantId, actor, "verified", "success");
        return json(CORS, 200, { connection: vista(data) });
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
      return json(CORS, r.ok ? 200 : (r.auth ? 400 : 502), { connection: vista(data), ...(r.ok ? {} : { error: r.error }) });
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
      return json(CORS, 200, { connection: vista(data) });
    }

    if (action === "sync") {
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const { data } = await sincronizar(tenantId, actor, row);
      return json(CORS, 200, { connection: vista(data) });
    }

    if (action === "upload_csd") {
      if (!form) return json(CORS, 400, { error: "Solicitud inválida." });
      if (!row || row.mode !== "platform" || !row.organization_id) return json(CORS, 409, { error: "Primero activa la facturación de la clínica." });
      const cer = form.get("cer"), key = form.get("key"), password = form.get("password");
      if (!(cer instanceof File) || !(key instanceof File) || typeof password !== "string") return json(CORS, 400, { error: "Sube el certificado y la llave privada, y escribe la contraseña." });
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
      return json(CORS, 200, { connection: vista(data) });
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
      if (!gate.ok) return json(CORS, 409, { error: gate.error, connection: vista(fresh) });
      if (!iss || !rfcCoincide(st.tax_id, iss.rfc)) return json(CORS, 409, { error: "El RFC del certificado no coincide con el de la clínica. Vuelve a subir el CSD correcto.", connection: vista(fresh) });
      const liveKey = await llaveDeOrganizacion(row.organization_id, "live", true);
      if (!liveKey) { await evento(tenantId, actor, "went_live", "failed", { reason: "no_live_key" }); return json(CORS, 502, { error: "Facturapi no entregó la llave de producción. Revisa los pasos pendientes de la organización." }); }
      const enc = await cifrar(MASTER, tenantId, liveKey);
      const now = new Date().toISOString();
      const data = await guardar(tenantId, actor, {
        environment: "live", live_secret_ciphertext: enc.ciphertext, live_secret_iv: enc.iv, live_key_fingerprint: await huella(liveKey),
        live_enabled_at: now, live_enabled_by: actor, last_error: null,
      });
      await evento(tenantId, actor, "went_live", "success");
      return json(CORS, 200, { connection: vista(data) });
    }

    if (action === "disable_live") {
      const perm = await requirePermission(auth, CORS, "finance.invoice");
      if (perm) return perm;
      if (!row) return json(CORS, 409, { error: "Facturapi no está conectado." });
      const data = await guardar(tenantId, actor, { environment: "test", live_secret_ciphertext: null, live_secret_iv: null, live_key_fingerprint: null, live_enabled_at: null, live_enabled_by: null });
      await evento(tenantId, actor, "went_test", "success");
      return json(CORS, 200, { connection: vista(data) });
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
      return json(CORS, 200, { connection: vista(data) });
    }
  } catch (e) {
    console.error("[facturapi] error:", (e as Error)?.message);
    return json(CORS, 500, { error: (e as Error)?.message || "No se pudo completar la acción." });
  }

  return json(CORS, 400, { error: "Acción no válida." });
});
