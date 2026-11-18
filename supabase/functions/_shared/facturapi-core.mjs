// Lógica pura de la conexión Facturapi (sin Deno ni red): validación de llave, cifrado y lectura de la organización.
// Solo sandbox: la llave debe ser de pruebas (sk_test_…). Las llaves live se rechazan.
export const FACTURAPI_BASE = "https://www.facturapi.io/v2";
export const TEST_KEY_RE = /^sk_test_[A-Za-z0-9_-]{16,200}$/;
const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Devuelve { ok:true, key } o { ok:false, error } con mensaje para la persona.
export function validarLlave(raw) {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) return { ok: false, error: "Pega la llave secreta de pruebas de Facturapi." };
  if (/^sk_live_/.test(key)) return { ok: false, error: "Esa es una llave de producción. Por ahora SMYL solo acepta la de pruebas (sk_test_…)." };
  if (/^sk_user_/.test(key)) return { ok: false, error: "Esa es una llave de usuario. Usa la llave secreta de pruebas de tu organización (sk_test_…)." };
  if (!TEST_KEY_RE.test(key)) return { ok: false, error: "La llave no tiene el formato de una llave secreta de pruebas (sk_test_…)." };
  return { ok: true, key };
}

export async function huella(key) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(key))).slice(0, 12).toUpperCase();
}

async function aesKey(masterB64) {
  let raw;
  try { raw = unb64(String(masterB64 || "")); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new Error("FACTURAPI_ENCRYPTION_KEY debe ser 32 bytes en base64.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// El tenant va como dato autenticado: un cifrado copiado a otra clínica no descifra.
export async function cifrar(masterB64, tenantId, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(tenantId) }, await aesKey(masterB64), enc.encode(texto));
  return { ciphertext: b64(ct), iv: b64(iv) };
}
export async function descifrar(masterB64, tenantId, ciphertext, iv) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(tenantId) }, await aesKey(masterB64), unb64(ciphertext));
  return dec.decode(pt);
}

// Lee la respuesta de GET /v2/organizations/me de forma tolerante.
export function leerOrganizacion(body) {
  const o = body && typeof body === "object" ? body : {};
  const id = typeof o.id === "string" ? o.id : "";
  const nombre = String((o.legal && o.legal.legal_name) || o.name || o.legal_name || "").slice(0, 180);
  if (id.length < 3 || id.length > 120) return null;
  return { id, name: nombre };
}

// Vista segura para el navegador: nunca incluye llave ni texto cifrado.
export function vistaConexion(row) {
  if (!row) return { status: "disconnected", environment: "test", mode: "platform", pending_steps: [], production_ready: false };
  return {
    status: row.status, environment: row.environment, mode: row.mode || "own_key", organization_name: row.organization_name || "",
    key_fingerprint: row.key_fingerprint || "", connected_at: row.connected_at, last_verified_at: row.last_verified_at, last_error: row.last_error || "",
    has_organization: !!row.organization_id, csd_valid_until: row.csd_valid_until || null, csd_serial: row.csd_serial || "",
    pending_steps: Array.isArray(row.pending_steps) ? row.pending_steps : [], production_ready: row.production_ready === true,
    live_enabled_at: row.live_enabled_at || null, live_key_fingerprint: row.live_key_fingerprint || "",
  };
}

// ── Modelo de plataforma: una organización de Facturapi por clínica ──
export const LIVE_KEY_RE = /^sk_live_[A-Za-z0-9_-]{16,200}$/;
export const CONFIRM_LIVE_TEXT = "FACTURAR EN PRODUCCION";
const RFC_RE = /^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

// Datos para PUT /organizations/{id}/legal. El RFC NO se envía: Facturapi lo toma del CSD.
export function datosLegales(issuer) {
  const i = issuer || {};
  const legal = String(i.legal_name || "").trim();
  if (legal.length < 2 || !/^\d{3}$/.test(String(i.fiscal_regime || "")) || !/^\d{5}$/.test(String(i.tax_postal_code || ""))) return null;
  return { name: legal.slice(0, 100), legal_name: legal.slice(0, 240), tax_system: String(i.fiscal_regime), address: { zip: String(i.tax_postal_code) } };
}

// Archivos del CSD recibidos del navegador. `cer` y `key` son { name, size }.
export function validarCsd({ cer, key, password } = {}) {
  const ok = (f, ext) => f && typeof f.name === "string" && f.name.toLowerCase().endsWith(ext) && Number.isFinite(f.size) && f.size >= 200 && f.size <= 65536;
  if (!ok(cer, ".cer")) return { ok: false, error: "Sube el archivo del certificado (termina en .cer)." };
  if (!ok(key, ".key")) return { ok: false, error: "Sube el archivo de la llave privada (termina en .key)." };
  if (typeof password !== "string" || password.length < 1 || password.length > 200) return { ok: false, error: "Escribe la contraseña de tu llave privada." };
  return { ok: true };
}

// Estado de la organización según GET /organizations/{id}.
export function estadoOrganizacion(org) {
  const o = org && typeof org === "object" ? org : {};
  const steps = Array.isArray(o.pending_steps) ? o.pending_steps.filter((s) => s && typeof s.type === "string").map((s) => ({ type: s.type.slice(0, 40), description: String(s.description || "").slice(0, 200) })) : [];
  const cert = o.certificate && typeof o.certificate === "object" ? o.certificate : {};
  return {
    production_ready: o.is_production_ready === true && steps.length === 0,
    pending_steps: steps,
    has_certificate: cert.has_certificate === true,
    csd_valid_until: typeof cert.expires_at === "string" ? cert.expires_at : null,
    csd_serial: typeof cert.serial_number === "string" ? cert.serial_number.slice(0, 80) : null,
    tax_id: o.legal && typeof o.legal.tax_id === "string" ? o.legal.tax_id.toUpperCase() : "",
    name: String((o.legal && (o.legal.legal_name || o.legal.name)) || "").slice(0, 180),
  };
}

// El RFC del certificado debe ser el de la clínica; si no, se rechaza el CSD.
export function rfcCoincide(rfcCertificado, rfcClinica) {
  const a = String(rfcCertificado || "").toUpperCase(), b = String(rfcClinica || "").toUpperCase();
  return RFC_RE.test(a) && a === b;
}

// Compuerta de producción: todo debe cumplirse en el servidor.
export function puedeActivarProduccion({ mode, status, productionReady, issuerReviewed, policyReviewed, confirmText } = {}) {
  if (mode !== "platform") return { ok: false, error: "La producción se activa solo con la cuenta de plataforma de SMYL." };
  if (status !== "connected") return { ok: false, error: "Primero activa la facturación de la clínica." };
  if (!issuerReviewed) return { ok: false, error: "Faltan los datos fiscales revisados de la clínica." };
  if (!policyReviewed) return { ok: false, error: "Falta la confirmación de tu contador." };
  if (!productionReady) return { ok: false, error: "Facturapi aún no marca la organización lista para producción. Revisa los pasos pendientes." };
  if (String(confirmText || "").trim().toUpperCase() !== CONFIRM_LIVE_TEXT) return { ok: false, error: `Para confirmar escribe: ${CONFIRM_LIVE_TEXT}` };
  return { ok: true };
}

// La forma de la respuesta de llaves de Facturapi varía (texto, lista de textos o de objetos): se lee de forma defensiva.
export function leerLlave(body, re) {
  const dig = (x) => {
    if (typeof x === "string") return re.test(x.trim()) ? x.trim() : null;
    if (Array.isArray(x)) { for (const i of x) { const k = dig(i); if (k) return k; } return null; }
    if (x && typeof x === "object") { for (const k of ["secret_key", "key", "value", "secret", "api_key", "data"]) { const r = dig(x[k]); if (r) return r; } }
    return null;
  };
  return dig(body);
}

// Mensajes claros para los errores más comunes de la API.
export function mensajeCsd(code) {
  switch (code) {
    case "certificate_files_invalid": return "El certificado o la llave privada no son válidos. Revisa que sean los archivos de tu CSD (no la e.firma) y que la contraseña sea la de la llave.";
    case "certificate_files_required": return "Sube los dos archivos: el .cer y el .key.";
    case "certificate_expired": return "Tu certificado ya venció. Genera uno nuevo en el SAT.";
    default: return "Facturapi no aceptó el certificado. Revisa los archivos y la contraseña.";
  }
}

// ───────────── Timbrado (SOLO sandbox) ─────────────
// Todo lo de abajo es lógica pura: arma el comprobante a partir del borrador ya prevalidado, clasifica la respuesta de Facturapi
// y valida la factura que regresa. El CFDI siempre sale con la llave de pruebas (sk_test_…), sin validez fiscal.
export const FORMAS_PAGO = {
  "01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia electrónica de fondos", "04": "Tarjeta de crédito", "28": "Tarjeta de débito",
};
// Forma de pago SAT sugerida según cómo se cobró en SMYL. «Otro» no se adivina: la persona la elige.
export function formaPagoSugerida(method) {
  return { cash: "01", check: "02", transfer: "03", card: "04" }[String(method || "")] || "";
}
const UNIDADES = { E48: "Unidad de servicio", H87: "Pieza", ACT: "Actividad", EA: "Elemento", KGM: "Kilogramo", LTR: "Litro", XBX: "Caja" };
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cents = (n) => Math.round(Number(n) * 100);
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

// draft: fila de smyl_cfdi_drafts. impuestos: { [charge_id]: { tax_treatment, tax_rate } } (viene del snapshot del servicio de cada cargo).
// Devuelve { ok:true, payload } o { ok:false, errors:[texto] }; nunca lanza.
export function construirFactura(draft, impuestos, formaPago) {
  const errors = [];
  const fs = (draft && draft.fiscal_snapshot) || {};
  const issuer = (draft && draft.issuer_snapshot) || {};
  const concepts = Array.isArray(draft && draft.concepts_snapshot) ? draft.concepts_snapshot : [];
  if (!FORMAS_PAGO[formaPago]) errors.push("Elige la forma de pago real del cobro (efectivo, transferencia, tarjeta…).");
  if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(fs.rfc || "")) || ["XAXX010101000", "XEXX010101000"].includes(String(fs.rfc))) errors.push("El RFC del paciente no es válido para facturarle (no se admite el RFC genérico).");
  if (String(fs.legal_name || "").trim().length < 2) errors.push("Falta el nombre fiscal del paciente.");
  if (!/^\d{3}$/.test(String(fs.fiscal_regime || ""))) errors.push("Falta el régimen fiscal del paciente.");
  if (!/^\d{5}$/.test(String(fs.tax_postal_code || ""))) errors.push("Falta el código postal fiscal del paciente.");
  if (!/^[A-Z]\d{2}$/.test(String(fs.cfdi_use || ""))) errors.push("Falta el uso del CFDI.");
  if (fs.currency && fs.currency !== "MXN") errors.push("Por ahora solo se factura en pesos mexicanos.");
  if (!concepts.length) errors.push("El borrador no tiene conceptos.");
  const items = [];
  let total = 0;
  concepts.forEach((c, i) => {
    const name = String(c.description || "").trim() || `concepto ${i + 1}`;
    const qty = num(c.quantity), unit = num(c.unit_value), disc = num(c.discount || 0), tax = num(c.tax || 0), amount = num(c.amount);
    if (![qty, unit, disc, tax, amount].every(Number.isFinite) || qty <= 0 || unit < 0 || disc < 0 || tax < 0) { errors.push(`Los importes de «${name}» no son válidos.`); return; }
    if (!/^\d{8}$/.test(String(c.product_service_code || ""))) { errors.push(`«${name}» no tiene ClaveProdServ.`); return; }
    if (!/^[A-Z0-9]{1,8}$/.test(String(c.unit_code || ""))) { errors.push(`«${name}» no tiene ClaveUnidad.`); return; }
    const info = (impuestos && impuestos[c.charge_id]) || {};
    const base = cents(qty * unit) - cents(disc);
    let taxability, taxes, expectedTax;
    if (info.tax_treatment === "exempt") { taxability = "02"; taxes = [{ type: "IVA", rate: 0, factor: "Exento" }]; expectedTax = 0; }
    else if (info.tax_treatment === "non_object") { taxability = "01"; taxes = []; expectedTax = 0; }
    else if (info.tax_treatment === "rate" && Number.isFinite(num(info.tax_rate)) && num(info.tax_rate) > 0) {
      taxability = "02"; taxes = [{ type: "IVA", rate: num(info.tax_rate), factor: "Tasa" }]; expectedTax = Math.round(base * num(info.tax_rate));
    } else { errors.push(`Revisa el tratamiento de IVA del servicio «${name}» en el catálogo (exento, tasa o no objeto).`); return; }
    if (base <= 0) { errors.push(`El descuento de «${name}» es mayor que su importe.`); return; }
    if (cents(tax) !== expectedTax) { errors.push(`El IVA de «${name}» no coincide con el que calcula el SAT. Corrige el cargo.`); return; }
    if (cents(amount) !== base + expectedTax) { errors.push(`El total de «${name}» no coincide con sus importes.`); return; }
    total += cents(amount);
    const item = {
      quantity: qty,
      product: {
        description: name.slice(0, 1000), product_key: String(c.product_service_code), unit_key: String(c.unit_code), unit_name: UNIDADES[c.unit_code] || "Unidad",
        price: unit, tax_included: false, taxability, taxes,
      },
    };
    if (disc > 0) item.discount = disc;
    items.push(item);
  });
  if (!errors.length && total !== cents(fs.amount)) errors.push("El total de los conceptos no coincide con el pago.");
  if (errors.length) return { ok: false, errors };
  const customer = { legal_name: String(fs.legal_name).trim(), tax_id: fs.rfc, tax_system: String(fs.fiscal_regime), address: { zip: String(fs.tax_postal_code) } };
  if (fs.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(fs.email))) customer.email = String(fs.email);
  const payload = {
    type: "I", customer, use: fs.cfdi_use, payment_form: formaPago, payment_method: "PUE", currency: "MXN", export: "01", items,
    external_id: draft.id, idempotency_key: draft.idempotency_key,
  };
  if (/^[A-Z0-9-]{1,10}$/.test(String(issuer.invoice_series || ""))) payload.series = issuer.invoice_series;
  return { ok: true, payload, total: total / 100 };
}

// Mensaje de error de Facturapi para la persona (corto, sin datos del paciente ni de la llave).
export function mensajeFacturapi(body, status) {
  const o = body && typeof body === "object" ? body : {};
  const text = String(o.message || o.error || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (text) return text;
  return status ? `Facturapi respondió ${status}.` : "Facturapi no respondió.";
}
// ok = timbrado confirmado; rejected = Facturapi lo rechazó y NO existe factura (se puede corregir y reintentar);
// unknown = no sabemos si se creó (red, 5xx, 409 de idempotencia): hay que verificar antes de reintentar.
export function clasificarRespuesta(status, body) {
  const factura = leerFactura(body);
  if ((status === 200 || status === 201) && factura && factura.uuid) return "ok";
  if (status === 200 || status === 201) return "unknown";
  if (status === 409 || status === 408 || status === 425 || status === 429 || status >= 500 || !status) return "unknown";
  return status >= 400 ? "rejected" : "unknown";
}
// Lee solo lo necesario de la factura de Facturapi; descarta lo que no cumple el formato.
export function leerFactura(body) {
  const o = body && typeof body === "object" ? body : null;
  if (!o || typeof o.id !== "string" || o.id.length < 3 || o.id.length > 120) return null;
  const folio = Number(o.folio_number);
  return {
    id: o.id,
    uuid: typeof o.uuid === "string" && UUID_RE.test(o.uuid) ? o.uuid.toLowerCase() : "",
    status: typeof o.status === "string" ? o.status.slice(0, 20) : "",
    series: typeof o.series === "string" && /^[A-Za-z0-9-]{0,25}$/.test(o.series) ? o.series : "",
    folio: Number.isInteger(folio) && folio > 0 && folio < 2_000_000_000 ? folio : null,
    total: Number.isFinite(Number(o.total)) ? Number(o.total) : null,
  };
}

// ───────────── Cancelación (SOLO sandbox) ─────────────
export const MOTIVOS_CANCELACION = { "01": "Comprobante emitido con errores con relación", "02": "Comprobante emitido con errores sin relación", "03": "No se llevó a cabo la operación", "04": "Operación nominativa relacionada en una factura global" };
// plan: fila de smyl_cfdi_cancellation_plans. Devuelve { ok:true, query:"motive=02" } o { ok:false, error }.
export function parametrosCancelacion(plan) {
  const motive = String((plan && plan.reason_code) || "");
  if (!MOTIVOS_CANCELACION[motive]) return { ok: false, error: "El motivo de cancelación no es válido." };
  const sust = plan.replacement_uuid ? String(plan.replacement_uuid).toLowerCase() : "";
  if (motive === "01") {
    if (!UUID_RE.test(sust)) return { ok: false, error: "El motivo 01 requiere el UUID del comprobante que sustituye al cancelado." };
    return { ok: true, query: `motive=01&substitution=${encodeURIComponent(sust)}` };
  }
  if (sust) return { ok: false, error: "Solo el motivo 01 lleva UUID sustituto." };
  return { ok: true, query: `motive=${motive}` };
}
const ESTADOS_CANCELACION = ["none", "pending", "accepted", "rejected", "expired"];
// Lee el estado de cancelación de una factura de Facturapi (respuesta de cancelar o de consultar).
// accepted = ya cancelada; pending = espera la aceptación del receptor; rejected = el receptor la rechazó o expiró;
// none = no hay solicitud registrada (o la factura sigue vigente sin solicitud).
export function estadoCancelacion(body) {
  const o = body && typeof body === "object" ? body : null;
  if (!o) return null;
  const cs = ESTADOS_CANCELACION.includes(o.cancellation_status) ? o.cancellation_status : "none";
  if (o.status === "canceled" || cs === "accepted") return "accepted";
  if (cs === "pending") return "pending";
  if (cs === "rejected" || cs === "expired") return "rejected";
  return o.status === "valid" ? "none" : null;
}
// Respuesta al DELETE: accepted | pending | rejected (Facturapi dijo que no) | unknown (red, 5xx, 409…: verificar antes de reintentar).
export function clasificarCancelacion(status, body) {
  if (status === 200 || status === 201) {
    const e = estadoCancelacion(body);
    return e === "accepted" || e === "pending" ? e : e === "rejected" ? "rejected" : "unknown";
  }
  if (status === 409 || status === 408 || status === 425 || status === 429 || status >= 500 || !status) return "unknown";
  return status >= 400 ? "rejected" : "unknown";
}

// ───────────── Envío por correo ─────────────
const CORREO_RE = /^[^\s@,;<>()]{1,64}@[^\s@,;<>()]{1,190}\.[^\s@,;<>()]{2,}$/;
// Un solo correo, en minúsculas y sin espacios; "" si no es válido (nunca varias direcciones: se envía a la persona indicada).
export function validarCorreo(value) {
  const e = String(value || "").trim().toLowerCase();
  return e.length <= 254 && CORREO_RE.test(e) ? e : "";
}
// «juan.perez@gmail.com» → «j***@gmail.com»: para mostrar y registrar sin guardar la dirección completa en la bitácora.
export function enmascararCorreo(email) {
  const e = validarCorreo(email);
  if (!e) return "";
  const [local, dominio] = e.split("@");
  return `${local[0]}***@${dominio}`;
}
// ok = Facturapi confirmó el envío; rejected = no se envió (dirección o límite); unknown = no sabemos (red/5xx): no reenviar a ciegas.
export function clasificarEnvio(status, body) {
  if (status === 200 && body && body.ok === true) return "ok";
  if (status === 200 || status === 408 || status >= 500 || !status) return "unknown";
  return status >= 400 ? "rejected" : "unknown";
}

// ───────────── Descargas (comprobante y acuse de cancelación) ─────────────
// El acuse (PDF/XML) solo existe cuando el SAT aceptó la cancelación.
export const DESCARGAS = {
  pdf: { path: "pdf", ext: "pdf", mime: "application/pdf", acuse: false },
  xml: { path: "xml", ext: "xml", mime: "application/xml", acuse: false },
  acuse_pdf: { path: "cancellation_receipt/pdf", ext: "pdf", mime: "application/pdf", acuse: true },
  acuse_xml: { path: "cancellation_receipt/xml", ext: "xml", mime: "application/xml", acuse: true },
};
export function descarga(kind) {
  return Object.prototype.hasOwnProperty.call(DESCARGAS, kind) ? DESCARGAS[kind] : DESCARGAS.pdf;
}
