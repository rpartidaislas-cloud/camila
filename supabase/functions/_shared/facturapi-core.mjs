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
  if (!row) return { status: "disconnected", environment: "test" };
  return {
    status: row.status, environment: row.environment, organization_name: row.organization_name || "",
    key_fingerprint: row.key_fingerprint || "", connected_at: row.connected_at, last_verified_at: row.last_verified_at, last_error: row.last_error || "",
  };
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
