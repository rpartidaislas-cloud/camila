// Leer la Constancia de Situación Fiscal desde un archivo que el paciente mandó por el chat (sin Deno ni red).
// lana-inbox descarga el archivo del mensaje (validado contra la conversación del paciente) y lo pasa a fiscal-extract.
export const MAX_CHAT_FILE_BYTES = 4 * 1024 * 1024;

// El tipo se decide por los primeros bytes, no por lo que diga el remitente: solo PDF, PNG o JPG.
export function tipoPorFirma(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf"; // %PDF
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

// Solo https hacia nombres de dominio públicos: nunca IPs, localhost ni nombres internos.
export function urlDescargable(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return true;
}

export function bytesABase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Mensajes del chat que pueden ser una constancia: fotos y documentos disponibles.
export function esArchivoFiscal(message) {
  return Boolean(message) && message.deleted !== true && (message.media_type === "image" || message.media_type === "document") && Boolean(message.media_url);
}
