// Análisis de radiografías con Claude (revisión asistida; nunca diagnóstico automático).
//
// El modelo, el esfuerzo y el esquema de salida los fija el SERVIDOR: el navegador solo manda el prompt y la
// imagen. Así un cliente no puede pedir otro modelo, y la respuesta llega siempre con el formato exacto que
// valida la app (se acabaron los "null" escritos como texto).
//
// Cada análisis deja una fila en smyl_ai_usage_log con los tokens reales que informa Anthropic y un costo
// estimado. No se guarda la imagen ni el texto de la respuesta.

export const RADIOGRAPH_ACTION = "analyze_dental_radiograph_v1";
export const RADIOGRAPH_MODEL = "claude-opus-5-5";
// Opus 5.5 usa "medium" por defecto. Se sube a "high" cuando la medición confirme que cabe en el tiempo de espera.
export const RADIOGRAPH_EFFORT = "medium";
export const RADIOGRAPH_MAX_TOKENS = 12000;
export const RADIOGRAPH_TIMEOUT_MS = 100_000;

// Dólares por millón de tokens (entrada, salida, lectura de caché, escritura de caché). Solo para estimar.
const PRICES_USD_PER_MTOK: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
};

export const RADIOGRAPH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "quality", "qualityNote", "observations", "limitations"],
  properties: {
    schema: { type: "integer", enum: [1] },
    quality: { type: "string", enum: ["usable", "limited", "unusable"] },
    qualityNote: { type: "string", description: "Límite de la imagen, máximo 400 caracteres." },
    observations: {
      type: "array",
      description: "Máximo 12 observaciones por comprobar; vacío si la imagen no es utilizable.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "tooth", "observation", "evidence", "x", "y"],
        properties: {
          id: { type: "string", pattern: "^r([1-9]|1[0-2])$" },
          category: { type: "string", enum: ["density", "contour", "restoration", "support", "development", "other"] },
          tooth: { anyOf: [{ type: "string", pattern: "^[1-4][1-8]$" }, { type: "null" }] },
          observation: { type: "string", description: "Descripción prudente, máximo 500 caracteres." },
          evidence: { type: "string", description: "Zona visible donde comprobar, máximo 300 caracteres." },
          x: { anyOf: [{ type: "number" }, { type: "null" }] },
          y: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
      },
    },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

export function estimateCostUsd(model: string, usage: AnthropicUsage | null | undefined): number | null {
  const price = PRICES_USD_PER_MTOK[model];
  if (!price || !usage) return null;
  const [input, output, cacheRead, cacheWrite] = price;
  const cost = ((count(usage.input_tokens) ?? 0) * input + (count(usage.output_tokens) ?? 0) * output +
    (count(usage.cache_read_input_tokens) ?? 0) * cacheRead + (count(usage.cache_creation_input_tokens) ?? 0) * cacheWrite) / 1_000_000;
  return Math.round(cost * 100000) / 100000;
}

export interface UsageRow {
  tenant_id: string;
  feature: "radiograph_analysis";
  model: string;
  request_id: string | null;
  outcome: "ok" | "incomplete" | "error";
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  duration_ms: number | null;
  stop_reason: string | null;
  estimated_cost_usd: number | null;
}

export function usageRow(opts: {
  tenantId: string;
  requestId: string | null;
  outcome: UsageRow["outcome"];
  usage: AnthropicUsage | null | undefined;
  durationMs: number;
  stopReason: unknown;
}): UsageRow {
  const u = opts.usage || null;
  return {
    tenant_id: opts.tenantId,
    feature: "radiograph_analysis",
    model: RADIOGRAPH_MODEL,
    request_id: opts.requestId ? opts.requestId.slice(0, 120) : null,
    outcome: opts.outcome,
    input_tokens: count(u?.input_tokens),
    output_tokens: count(u?.output_tokens),
    cache_read_tokens: count(u?.cache_read_input_tokens),
    cache_write_tokens: count(u?.cache_creation_input_tokens),
    duration_ms: count(opts.durationMs),
    stop_reason: typeof opts.stopReason === "string" ? opts.stopReason.slice(0, 40) : null,
    estimated_cost_usd: estimateCostUsd(RADIOGRAPH_MODEL, u),
  };
}

// La app solo lee bloques de texto: se quitan los de razonamiento antes de responder al navegador.
export function textOnly(message: any): any {
  if (!message || !Array.isArray(message.content)) return message;
  return { ...message, content: message.content.filter((block: any) => block?.type === "text") };
}
