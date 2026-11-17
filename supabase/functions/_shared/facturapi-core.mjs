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
