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
