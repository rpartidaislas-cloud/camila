// Utilidades de seguridad para Edge Functions que reciben URLs o secretos del exterior.

// Comparación de secretos en tiempo (casi) constante: no se corta en el primer byte distinto.
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  // La longitud sí se compara, pero se recorre siempre el máximo para no filtrar dónde difieren.
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Sufijos de host permitidos para descargar imágenes o llamar callbacks. Por defecto solo
// Supabase (Storage y Edge Functions); se pueden añadir hosts con una lista separada por comas.
export function parseAllowedHostSuffixes(extra: string | null | undefined): string[] {
  const base = [".supabase.co"];
  const more = String(extra || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))
    .map((s) => (s.startsWith(".") ? s : "." + s));
  return Array.from(new Set([...base, ...more]));
}

// Solo https, sin credenciales, puerto estándar, nombre de host (no IP ni localhost) y dentro de la
// lista permitida. Evita que una función con service role haga peticiones a hosts internos (SSRF).
export function isAllowedRemoteUrl(raw: unknown, suffixes: string[]): boolean {
  if (typeof raw !== "string" || raw.length > 4096) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  return suffixes.some((s) => host.endsWith(s) || host === s.slice(1));
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/i;

// Una imagen de entrada puede venir como data URL de imagen o como https permitido.
export function isAllowedImageSource(raw: unknown, suffixes: string[], maxDataChars = 34_000_000): boolean {
  if (typeof raw !== "string") return false;
  if (raw.startsWith("data:")) return raw.length <= maxDataChars && DATA_IMAGE_RE.test(raw);
  return isAllowedRemoteUrl(raw, suffixes);
}

export const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;

// Lee una respuesta con tope de tamaño (Content-Length y bytes reales) para no cargar archivos enormes.
export async function readBodyWithLimit(res: Response, maxBytes = MAX_REMOTE_IMAGE_BYTES): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("La imagen es demasiado grande.");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("La imagen es demasiado grande.");
  return buf;
}
