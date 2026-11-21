// Cobro en línea de saldos de pacientes con OpenPay a través de LANA (pasarela general `pagos_solicitudes`).
//
// SMYL es dueño de la deuda y del recibo; LANA solo cobra con la cuenta OpenPay de la clínica. Esta función:
//   - Personal (JWT + finance.manage):  create | list | cancel   -> crea el enlace con el saldo calculado AQUÍ, nunca el del navegador.
//   - Público  (token opaco):           view                     -> lo que ve el paciente en pagar.html (sin datos internos).
//   - Servidor (HMAC de LANA):          POST …/callback          -> aviso de pago. Se confirma SIEMPRE con GET a LANA antes de registrar.
// El pago se registra una sola vez con smyl_post_online_payment (idempotente por enlace) y emite el recibo interno.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { lanaRequest, smylAdmin as admin } from "../_shared/lana-linked.ts";
import {
  UUID_RE, TOKEN_RE, VIGENCIA_MINUTOS, aleatorioHex, sha256Hex, firmaValida, planDeCobro, conceptoDelEnlace, vistaPublicaEnlace,
} from "../_shared/smyl-pay-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const APP_ORIGIN = "https://app.smyldesign.ai";
const PAGAR_URL = `${APP_ORIGIN}/pagar.html`;
const CALLBACK_URL = `${SB_URL}/functions/v1/smyl-pay/callback`;
const MAX_BODY = 8192;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

function json(cors: Record<string, string>, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Consulta la solicitud en LANA y, si está pagada y coincide, registra el pago en SMYL. Devuelve el enlace actualizado.
async function conciliar(link: Json): Promise<Json> {
  if (link.status === "paid" || !link.lana_request_id) return link;
  try {
    const { response, body } = await lanaRequest(link.tenant_id, `/payments/requests/${link.lana_request_id}`, { method: "GET" }, 8000);
    const req = (body as Json).request as Json | undefined;
    if (!response.ok || !req || req.status !== "paid") return link;
    // Misma solicitud y mismo monto que SMYL fijó; cualquier diferencia no se registra.
    if (req.reference !== link.id || Math.round(Number(req.amount) * 100) !== Math.round(Number(link.amount) * 100)) return link;
    const metodo = req.method === "spei" ? "transfer" : "card";
    const { data, error } = await admin.rpc("smyl_post_online_payment", {
      p_link_id: link.id, p_lana_charge_id: String(req.openpay_charge_id || ""), p_method: metodo, p_paid_at: req.paid_at || new Date().toISOString(),
    });
    if (error) { console.error("[smyl-pay] no se pudo registrar el pago:", error.message); return link; }
    return (Array.isArray(data) ? data[0] : data) || link;
  } catch (e) {
    console.error("[smyl-pay] conciliación fallida:", (e as Error)?.message);
    return link;
  }
}

// Cancela la solicitud en LANA. Solo cuenta como cancelada si LANA lo confirma (o ya no la conoce): si no, el paciente aún podría pagarla.
async function cancelarEnLana(tenantId: string, link: Json): Promise<boolean> {
  if (!link.lana_request_id) return true;
  try {
    const { response } = await lanaRequest(tenantId, `/payments/requests/${link.lana_request_id}/cancel`, { method: "POST", body: "{}" }, 8000);
    return response.ok || response.status === 404;
  } catch (_) { return false; }
}

async function enlacePorToken(token: unknown): Promise<Json | null> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
  const { data } = await admin.from("smyl_payment_links").select("*").eq("token_hash", await sha256Hex(token)).maybeSingle();
  return data || null;
}

async function datosPublicos(link: Json) {
  const [{ data: t }, { data: p }, { data: r }] = await Promise.all([
    admin.from("camila_tenants").select("nombre").eq("id", link.tenant_id).maybeSingle(),
    admin.from("camila_pacientes").select("nombre").eq("tenant_id", link.tenant_id).eq("id", link.patient_id).maybeSingle(),
    link.payment_id
      ? admin.from("smyl_finance_receipts").select("folio").eq("tenant_id", link.tenant_id).eq("payment_id", link.payment_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return { clinica: t?.nombre || "", paciente: p?.nombre || "", recibo: r?.folio || null };
}

async function manejarCallback(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({}, 413, { error: "too_large" });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json({}, 400, { error: "invalid_json" }); }
  if (typeof body.request_id !== "string" || !UUID_RE.test(body.request_id)) return json({}, 400, { error: "invalid_request" });
  const { data: link } = await admin.from("smyl_payment_links").select("*").eq("lana_request_id", body.request_id).maybeSingle();
  if (!link) return json({}, 401, { error: "bad_signature" }); // misma respuesta que una firma inválida: no revela qué solicitudes existen
  const ok = await firmaValida(link.callback_secret, req.headers.get("X-LANA-Timestamp"), raw, req.headers.get("X-LANA-Signature"));
  if (!ok) return json({}, 401, { error: "bad_signature" });
  // El cuerpo del aviso es solo una pista: lo que cuenta es lo que LANA confirma por GET.
  const actualizado = await conciliar(link);
  if (actualizado.status !== "paid") return json({}, 409, { error: "not_confirmed" });
  return json({}, 200, { ok: true });
}

const OPENPAY_ERROR_HUMANO: Record<string, string> = {
  invalid_credentials: "Openpay rechazó las llaves. En modo pruebas usa las del panel sandbox de Openpay.",
  openpay_unavailable: "No se pudo verificar con Openpay. Inténtalo de nuevo en un momento.",
};

// Marca en SMYL si la clínica cobra en línea (muestra u oculta «Enlace de pago»). No toca otras llaves de config.
async function marcarPagoEnLinea(tenantId: string, activo: boolean) {
  const { data } = await admin.from("camila_tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = data?.config && typeof data.config === "object" && !Array.isArray(data.config) ? data.config as Json : {};
  if (config.pago_en_linea === activo) return;
  await admin.from("camila_tenants").update({ config: { ...config, pago_en_linea: activo } }).eq("id", tenantId);
}

async function accionesOpenpay(body: Json, tenantId: string, userId: string, CORS: Record<string, string>): Promise<Response> {
  const esDueno = userId === tenantId;
  let path = "/payments/openpay";
  let init: RequestInit = { method: "GET" };
  if (body.action === "openpay_status") {
    // lectura: quien puede cobrar
  } else if (!esDueno) {
    return json(CORS, 403, { error: "Solo el dueño de la clínica puede conectar o cambiar Openpay." });
  } else if (body.action === "openpay_connect") {
    const campos = ["merchant_id", "public_key", "private_key"];
    if (campos.some((c) => typeof body[c] !== "string" || !(body[c] as string).trim() || (body[c] as string).length > 200)) {
      return json(CORS, 400, { error: "Escribe el ID de comercio, la llave pública y la llave privada." });
    }
    path = "/payments/openpay/credentials";
    init = { method: "PUT", body: JSON.stringify({ merchant_id: body.merchant_id, public_key: body.public_key, private_key: body.private_key }) };
  } else if (body.action === "openpay_methods") {
    const cambios: Json = {};
    for (const k of ["active", "card", "spei"]) if (typeof body[k] === "boolean") cambios[k] = body[k];
    if (!Object.keys(cambios).length) return json(CORS, 400, { error: "No hay cambios." });
    path = "/payments/openpay/methods";
    init = { method: "PUT", body: JSON.stringify(cambios) };
  } else if (body.action === "openpay_disconnect") {
    path = "/payments/openpay/disconnect";
    init = { method: "POST", body: "{}" };
  } else {
    return json(CORS, 400, { error: "Acción no válida." });
  }
  try {
    const { response, body: lana } = await lanaRequest(tenantId, path, init, 15000);
    const datos = lana as Json;
    if (!response.ok) {
      const code = String(datos.error_code || "");
      const msg = OPENPAY_ERROR_HUMANO[code] || (typeof datos.error === "string" ? datos.error : "El servidor de pagos no pudo completar la operación.");
      return json(CORS, response.status >= 400 && response.status < 500 ? response.status : 502, { error: msg, error_code: code || "lana_error" });
    }
    const openpay = (datos.openpay || {}) as Json;
    if (body.action !== "openpay_status") await marcarPagoEnLinea(tenantId, !!openpay.connected && !!openpay.active);
    return json(CORS, 200, { openpay, owner: esDueno });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return json(CORS, 409, { error: /LANA todav/.test(msg) ? "Conecta primero los canales de mensajería de la clínica; el cobro en línea usa esa misma conexión." : "No se pudo contactar al servidor de pagos.", error_code: "lana_unavailable" });
  }
}

async function accionesPersonal(req: Request, body: Json, CORS: Record<string, string>): Promise<Response> {
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: permitido } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "finance.manage" });
  if (permitido !== true) return json(CORS, 403, { error: "Tu rol no permite cobrar." });

  // Openpay de la clínica (task-id smyl-openpay-config): SMYL no tiene acceso al panel de LANA, así que la clínica conecta su
  // cuenta Openpay a su tenant de LANA desde aquí. Consultar: quien puede cobrar. Conectar, métodos y desconectar: solo el dueño.
  // Las llaves solo pasan hacia LANA (que las verifica con Openpay); nunca se guardan en SMYL ni vuelven al navegador.
  if (typeof body.action === "string" && body.action.startsWith("openpay_")) return await accionesOpenpay(body, tenantId, user.id, CORS);

  const patientId = body.patient_id;
  if (typeof patientId !== "string" || !UUID_RE.test(patientId)) return json(CORS, 400, { error: "Paciente inválido." });

  if (body.action === "list") {
    const { data } = await admin.from("smyl_payment_links")
      .select("id, amount, status, expires_at, paid_at, method, created_at, allocations, lana_request_id, tenant_id")
      .eq("tenant_id", tenantId).eq("patient_id", patientId).order("created_at", { ascending: false }).limit(10);
    const filas = await Promise.all((data || []).map((l: Json) => l.status === "pending" ? conciliar(l) : Promise.resolve(l)));
    return json(CORS, 200, {
      links: filas.map((l: Json) => ({ id: l.id, amount: Number(l.amount), status: vistaPublicaEnlace(l).status, expires_at: l.expires_at, paid_at: l.paid_at, method: l.method, created_at: l.created_at })),
    });
  }

  if (body.action === "cancel") {
    const id = body.link_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json(CORS, 400, { error: "Enlace inválido." });
    const { data: link } = await admin.from("smyl_payment_links").select("*").eq("tenant_id", tenantId).eq("id", id).maybeSingle();
    if (!link) return json(CORS, 404, { error: "Enlace no encontrado." });
    const actual = await conciliar(link); // si ya se pagó, no se cancela
    if (actual.status === "paid") return json(CORS, 409, { error: "El enlace ya fue pagado.", status: "paid" });
    if (!(await cancelarEnLana(tenantId, link))) return json(CORS, 502, { error: "No se pudo cancelar el enlace en LANA. Inténtalo de nuevo; mientras tanto el paciente aún podría pagarlo." });
    await admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
    return json(CORS, 200, { ok: true });
  }

  if (body.action !== "create") return json(CORS, 400, { error: "Acción no válida." });

  const chargeIds = Array.isArray(body.charge_ids) && body.charge_ids.length
    ? body.charge_ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x as string)).slice(0, 50) : null;
  const { data: abiertos, error: errAbiertos } = await admin.rpc("smyl_open_charges_for_link", { p_tenant: tenantId, p_patient: patientId, p_charge_ids: chargeIds });
  if (errAbiertos) return json(CORS, 500, { error: "No se pudo calcular el saldo." });
  const plan = planDeCobro(abiertos || [], { chargeIds });
  if (!plan.ok) return json(CORS, 422, { error: plan.mensaje, error_code: plan.error });

  const [{ data: paciente }, { data: clinica }] = await Promise.all([
    admin.from("camila_pacientes").select("nombre, apellido, email, telefono").eq("tenant_id", tenantId).eq("id", patientId).maybeSingle(),
    admin.from("camila_tenants").select("nombre").eq("id", tenantId).maybeSingle(),
  ]);
  if (!paciente) return json(CORS, 404, { error: "Paciente no encontrado." });

  let branchId = (abiertos || []).find((c: Json) => c.branch_id)?.branch_id as string | undefined;
  if (!branchId) {
    const { data: sucursal } = await admin.from("smyl_branches").select("id").eq("tenant_id", tenantId)
      .order("is_default", { ascending: false }).order("created_at", { ascending: true }).limit(1).maybeSingle();
    branchId = sucursal?.id;
  }
  if (!branchId) return json(CORS, 422, { error: "Crea una sucursal antes de cobrar en línea." });

  // Un enlace vigente por paciente: los anteriores se cancelan (si ya se pagaron se registran y se avisa).
  const { data: previos } = await admin.from("smyl_payment_links").select("*").eq("tenant_id", tenantId).eq("patient_id", patientId).eq("status", "pending");
  for (const previo of previos || []) {
    const actual = await conciliar(previo);
    if (actual.status === "paid") continue;
    if (!(await cancelarEnLana(tenantId, previo))) return json(CORS, 409, { error: "No se pudo cancelar el enlace anterior en LANA. Inténtalo de nuevo.", error_code: "previous_link_not_cancelled" });
    await admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", previo.id).eq("status", "pending");
  }

  const token = aleatorioHex(32);
  const callbackSecret = aleatorioHex(32);
  const expiresAt = new Date(Date.now() + VIGENCIA_MINUTOS * 60_000).toISOString();
  const { data: link, error: errLink } = await admin.from("smyl_payment_links").insert({
    tenant_id: tenantId, patient_id: patientId, branch_id: branchId, token_hash: await sha256Hex(token), callback_secret: callbackSecret,
    amount: plan.total, allocations: plan.allocations, expires_at: expiresAt, created_by: user.id,
  }).select("id").single();
  if (errLink?.code === "23505") return json(CORS, 409, { error: "Ya se está generando un enlace para este paciente. Inténtalo de nuevo en un momento.", error_code: "link_in_progress" });
  if (errLink || !link) return json(CORS, 500, { error: "No se pudo crear el enlace." });

  const marcarFallido = () => admin.from("smyl_payment_links").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", link.id);
  try {
    const { response, body: lana } = await lanaRequest(tenantId, "/payments/requests", {
      method: "POST",
      body: JSON.stringify({
        reference: link.id, concept: conceptoDelEnlace(plan.allocations, clinica?.nombre), amount: plan.total,
        token_hash: await sha256Hex(token), return_url: PAGAR_URL, callback_url: CALLBACK_URL, callback_secret: callbackSecret,
        expires_in_minutes: VIGENCIA_MINUTOS,
        customer: { name: `${paciente.nombre} ${paciente.apellido || ""}`.trim(), email: paciente.email || "", phone: paciente.telefono || "" },
      }),
    }, 15000);
    const requestId = (lana as Json).request?.id;
    if (!response.ok || !requestId) {
      await marcarFallido();
      const code = (lana as Json).error_code;
      const msg = code === "openpay_not_available"
        ? "Esta clínica aún no tiene OpenPay conectado y activo en LANA."
        : "LANA no pudo crear la solicitud de pago.";
      return json(CORS, response.status === 409 ? 409 : 502, { error: msg, error_code: code || "lana_error" });
    }
    await admin.from("smyl_payment_links").update({ lana_request_id: requestId, updated_at: new Date().toISOString() }).eq("id", link.id);
  } catch (e) {
    await marcarFallido();
    const msg = (e as Error)?.message || "";
    return json(CORS, 409, { error: /LANA todav/.test(msg) ? msg : "No se pudo contactar a LANA.", error_code: "lana_unavailable" });
  }
  return json(CORS, 200, { link_id: link.id, url: `${PAGAR_URL}#t=${token}`, amount: plan.total, expires_at: expiresAt });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/callback")) {
    if (req.method !== "POST") return json({}, 405, { error: "method_not_allowed" });
    return await manejarCallback(req);
  }
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "Solicitud demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }

  if (body.action === "view") {
    const link = await enlacePorToken(body.token);
    if (!link) return json(CORS, 404, { error: "Este enlace no existe o ya no está disponible." });
    const actual = await conciliar(link);
    return json(CORS, 200, vistaPublicaEnlace(actual, await datosPublicos(actual)));
  }
  return await accionesPersonal(req, body, CORS);
});
