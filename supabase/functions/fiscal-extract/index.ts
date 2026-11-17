// Leer la Constancia de Situación Fiscal de un paciente con IA para llenar sus datos de facturación.
// Solo SUGIERE: no escribe nada en la base ni guarda el archivo. La persona revisa y guarda desde la pantalla.
// Requiere el permiso finance.manage (el mismo que ya edita los datos fiscales).
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { inicioDiaUTC, inicioMesUTC } from "../_shared/ai-quota.ts";
import {
  FISCAL_EXTRACT_MODEL, FISCAL_EXTRACT_MAX_TOKENS, FISCAL_EXTRACT_TIMEOUT_MS, FISCAL_SCHEMA, FISCAL_SYSTEM,
  topesDeEntorno, evaluarTopeFiscal, archivoValido, leerConstancia,
} from "../_shared/fiscal-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const MAX_BODY = 6_300_000;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function medir(tenant: string, requestId: string | null, outcome: "ok" | "incomplete" | "error", usage: Json | null, ms: number, stop: unknown) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenant, feature: "fiscal_extract", model: FISCAL_EXTRACT_MODEL, request_id: requestId ? requestId.slice(0, 120) : null, outcome,
    input_tokens: n(usage?.input_tokens), output_tokens: n(usage?.output_tokens), cache_read_tokens: n(usage?.cache_read_input_tokens),
    cache_write_tokens: n(usage?.cache_creation_input_tokens), duration_ms: n(ms), stop_reason: typeof stop === "string" ? stop.slice(0, 40) : null,
    estimated_cost_usd: null,
  });
  if (error) console.error("[fiscal-extract] no se pudo medir:", error.message);
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "El archivo es demasiado grande. Usa uno de máximo 4 MB." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  if (!archivoValido(body.file_base64, body.media_type)) return json(CORS, 400, { error: "Sube la constancia como PDF, JPG o PNG de máximo 4 MB." });

  // Permiso: lo decide la sesión de la persona, no el navegador.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: puede } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "finance.manage" });
  if (puede !== true) return json(CORS, 403, { error: "Tu rol no permite editar los datos fiscales." });

  const ahora = new Date();
  const [dia, mes] = await Promise.all(
    [inicioDiaUTC(ahora), inicioMesUTC(ahora)].map((desde) =>
      admin.from("smyl_ai_usage_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("feature", "fiscal_extract").gte("created_at", desde)),
  );
  const tope = evaluarTopeFiscal(dia.count || 0, mes.count || 0, topesDeEntorno(Deno.env));
  if (!tope.permitido) return json(CORS, 429, { error: tope.mensaje });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(CORS, 503, { error: "La IA no está configurada todavía. Captura los datos a mano." });
  const inicio = Date.now();
  const esPdf = body.media_type === "application/pdf";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FISCAL_EXTRACT_TIMEOUT_MS);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: FISCAL_EXTRACT_MODEL, max_tokens: FISCAL_EXTRACT_MAX_TOKENS, system: FISCAL_SYSTEM,
        messages: [{ role: "user", content: [
          { type: esPdf ? "document" : "image", source: { type: "base64", media_type: body.media_type, data: body.file_base64 } },
          { type: "text", text: "Copia los datos fiscales de esta constancia." },
        ] }],
        output_config: { format: { type: "json_schema", schema: FISCAL_SCHEMA } },
      }),
    }).finally(() => clearTimeout(timer));
    const message = await resp.json().catch(() => ({}));
    const duracion = Date.now() - inicio;
    if (!resp.ok) { await medir(tenantId, message?.id || null, "error", null, duracion, null); return json(CORS, 502, { error: "La IA no pudo leer el archivo. Captura los datos a mano." }); }
    const texto = Array.isArray(message.content) ? message.content.filter((b: Json) => b?.type === "text").map((b: Json) => b.text).join("") : "";
    const sugerencia = leerConstancia(texto);
    await medir(tenantId, message.id || null, sugerencia ? "ok" : "incomplete", message.usage || null, duracion, message.stop_reason);
    if (!sugerencia) return json(CORS, 502, { error: "La IA no dio una respuesta clara. Captura los datos a mano." });
    return json(CORS, 200, sugerencia);
  } catch (e) {
    await medir(tenantId, null, "error", null, Date.now() - inicio, null);
    return json(CORS, 502, { error: (e as Error)?.name === "AbortError" ? "La IA tardó demasiado. Intenta de nuevo." : "No se pudo contactar a la IA." });
  }
});
