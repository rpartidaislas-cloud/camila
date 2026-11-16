// Lógica pura de los enlaces de la Nube (sin Deno ni red): token, código, vigencia, estado y vista pública.
export const DIAS_PERMITIDOS = [1, 7, 30];
export const DIAS_POR_DEFECTO = 7;
export const MAX_INTENTOS_CODIGO = 5;
export const MAX_ENLACES_ACTIVOS_POR_ARCHIVO = 10;
export const TOKEN_RE = /^[a-f0-9]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CODIGO_RE = /^[0-9]{6}$/;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

export function aleatorioHex(bytes) { return hex(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function sha256Hex(texto) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(texto)))); }

// Código de 6 dígitos sin sesgo de módulo (rechazo de valores altos).
export function codigoAleatorio() {
  const limite = 4294967296 - (4294967296 % 1000000);
  for (;;) {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    if (n < limite) return String(n % 1000000).padStart(6, "0");
  }
}
export const hashDeCodigo = (sal, codigo) => sha256Hex(`${sal}:${codigo}`);
export function diasValidos(valor) {
  const n = Number(valor);
  return DIAS_PERMITIDOS.includes(n) ? n : null;
}
export function venceEn(dias, ahora = Date.now()) { return new Date(ahora + dias * 86400000).toISOString(); }

// 'active' | 'expired' | 'revoked' | 'locked' (bloqueado por demasiados códigos incorrectos).
export function estadoDelEnlace(enlace, ahora = Date.now()) {
  if (!enlace) return "missing";
  if (enlace.revoked_at) return "revoked";
  if (Date.parse(enlace.expires_at) <= ahora) return "expired";
  if ((enlace.failed_attempts || 0) >= MAX_INTENTOS_CODIGO) return "locked";
  return "active";
}
// Un enlace caducado, revocado o bloqueado se ve igual que uno que no existe: no se revela nada.
export const enlaceDisponible = (enlace, ahora) => estadoDelEnlace(enlace, ahora) === "active";

export function vistaPublica({ nombre, mime, size, clinica, url, expires_at }) {
  return { name: nombre, mime_type: mime, size_bytes: size, clinic: clinica || "", url, expires_at };
}
