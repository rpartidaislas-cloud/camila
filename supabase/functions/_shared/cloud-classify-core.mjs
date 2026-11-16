// Lógica pura de la sugerencia de tipo de archivo de la Nube (sin Deno ni red).
// La IA SOLO sugiere: no escribe nada. La persona confirma desde la pantalla y recién ahí se guarda el tipo.
export const CLOUD_CLASSIFY_MODEL = "claude-haiku-5-5";
export const CLOUD_CLASSIFY_MAX_TOKENS = 400;
export const CLOUD_CLASSIFY_TIMEOUT_MS = 30_000;
export const MAX_IMAGE_BASE64 = 900_000; // ~650 KB de JPEG reducido
export const TOPES_PREDETERMINADOS = { diario: 200, mensual: 3000 };
export const CATEGORIAS = ["photo", "xray", "document", "consent", "other"];
export const CONFIANZAS = ["high", "medium", "low"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "confidence", "reason"],
  properties: {
    category: { type: "string", enum: CATEGORIAS },
    confidence: { type: "string", enum: CONFIANZAS },
    reason: { type: "string", description: "Una frase corta que explique qué se ve, máximo 160 caracteres." },
  },
};

export const CLASSIFY_SYSTEM = [
  "Eres un asistente administrativo de una clínica dental. Clasifica el TIPO de un archivo de imagen para ordenarlo; no diagnostiques ni interpretes hallazgos.",
  "Tipos: photo (fotografía clínica: sonrisa, rostro o boca/intraoral), xray (radiografía: panorámica, periapical, aleta de mordida, cefalométrica o tomografía), document (documento o estudio escaneado o fotografiado), consent (formato de consentimiento o carta firmada), other (cualquier otra cosa).",
  "No recibes nombre del archivo ni datos de la persona. No intentes identificar a nadie. Si dudas entre dos tipos, elige el más probable y baja la confianza.",
  "Responde solo con el JSON del esquema.",
].join("\n");

export function topesDeEntorno(env) {
  const entero = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    diario: entero(env.get("CLOUD_CLASSIFY_DAILY_LIMIT"), TOPES_PREDETERMINADOS.diario),
    mensual: entero(env.get("CLOUD_CLASSIFY_MONTHLY_LIMIT"), TOPES_PREDETERMINADOS.mensual),
  };
}
export function evaluarTopeClasificacion(usoDiario, usoMensual, topes) {
  if (usoDiario >= topes.diario) return { permitido: false, mensaje: `Tu clínica llegó al límite diario de ${topes.diario} sugerencias de la IA. Podrás continuar mañana.` };
  if (usoMensual >= topes.mensual) return { permitido: false, mensaje: `Tu clínica llegó al límite mensual de ${topes.mensual} sugerencias de la IA.` };
  return { permitido: true };
}

// Acepta solo una imagen JPEG reducida en base64 puro (sin prefijo data:) y de tamaño acotado.
export function imagenValida(valor) {
  if (typeof valor !== "string" || valor.length < 100 || valor.length > MAX_IMAGE_BASE64) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor)) return false;
  return valor.startsWith("/9j/"); // firma JPEG (FF D8 FF)
}

// Valida y normaliza lo que devuelve el modelo; cualquier cosa fuera del contrato se descarta.
export function leerSugerencia(texto) {
  let datos;
  try { datos = JSON.parse(String(texto || "")); } catch { return null; }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return null;
  if (!CATEGORIAS.includes(datos.category) || !CONFIANZAS.includes(datos.confidence)) return null;
  const razon = typeof datos.reason === "string" ? datos.reason.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return { category: datos.category, confidence: datos.confidence, reason: razon };
}
