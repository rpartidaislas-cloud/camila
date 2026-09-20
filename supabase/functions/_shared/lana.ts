export interface ResultadoWebhookLana {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
}

const ESPERAS_REINTENTO_MS = [2000, 4000, 8000];

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function variablesLana(): { url: string; secret: string } {
  const url = (Deno.env.get("LANA_WEBHOOK_URL") || "").trim();
  const secret = (Deno.env.get("LANA_WEBHOOK_SECRET") || "").trim();
  if (!url || !secret) throw new Error("Faltan LANA_WEBHOOK_URL o LANA_WEBHOOK_SECRET.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("LANA_WEBHOOK_URL debe usar HTTPS.");
  return { url: parsed.toString(), secret };
}

export function autorizarLana(req: Request): boolean {
  const esperado = (Deno.env.get("LANA_WEBHOOK_SECRET") || "").trim();
  const recibido = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!esperado || !recibido || esperado.length !== recibido.length) return false;
  // Comparación de tiempo constante suficiente para secretos ASCII/UTF-8 cortos.
  const a = new TextEncoder().encode(esperado);
  const b = new TextEncoder().encode(recibido);
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

export async function enviarWebhookLana(payload: Record<string, unknown>): Promise<ResultadoWebhookLana> {
  const { url, secret } = variablesLana();
  let ultimoError = "";
  let ultimoStatus: number | undefined;

  // Un intento inicial y hasta tres reintentos: 2 s, 4 s y 8 s.
  for (let intento = 0; intento <= ESPERAS_REINTENTO_MS.length; intento += 1) {
    if (intento > 0) await esperar(ESPERAS_REINTENTO_MS[intento - 1]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${secret}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      ultimoStatus = respuesta.status;
      if (respuesta.ok) return { ok: true, attempts: intento + 1, status: respuesta.status };
      const detalle = (await respuesta.text().catch(() => "")).slice(0, 500);
      ultimoError = `LANA respondió ${respuesta.status}${detalle ? `: ${detalle}` : ""}`;
      // Un 4xx es definitivo: repetir credenciales o payload inválidos no ayuda.
      if (respuesta.status < 500) return { ok: false, attempts: intento + 1, status: respuesta.status, error: ultimoError };
    } catch (error) {
      ultimoError = error instanceof Error ? error.message : "Error de red enviando webhook.";
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, attempts: ESPERAS_REINTENTO_MS.length + 1, status: ultimoStatus, error: ultimoError };
}

