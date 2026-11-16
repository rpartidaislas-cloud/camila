// Sugerir el TIPO de un archivo de la Nube con IA (foto, rayos X, documento, consentimiento u otro).
// Solo sugiere: no escribe nada. Recibe una copia reducida de la imagen (sin nombre ni datos del paciente) y devuelve
// {category, confidence, reason}; la persona confirma en pantalla. El modelo, el esquema y los topes los fija el servidor.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { inicioDiaUTC, inicioMesUTC } from "../_shared/ai-quota.ts";
import {
  CLOUD_CLASSIFY_MODEL, CLOUD_CLASSIFY_MAX_TOKENS, CLOUD_CLASSIFY_TIMEOUT_MS, CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, UUID_RE,
  topesDeEntorno, evaluarTopeClasificacion, imagenValida, leerSugerencia,
} from "../_shared/cloud-classify-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const MAX_BODY = 1_100_000;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const json = (cors: Record<string, string>, status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function medir(tenant: string, requestId: string | null, outcome: "ok" | "incomplete" | "error", usage: Json | null, ms: number, stop: unknown) {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const { error } = await admin.from("smyl_ai_usage_log").insert({
    tenant_id: tenant, feature: "cloud_classify", model: CLOUD_CLASSIFY_MODEL, request_id: requestId ? requestId.slice(0, 120) : null, outcome,
    input_tokens: n(usage?.input_tokens), output_tokens: n(usage?.output_tokens), cache_read_tokens: n(usage?.cache_read_input_tokens),
    cache_write_tokens: n(usage?.cache_creation_input_tokens), duration_ms: n(ms), stop_reason: typeof stop === "string" ? stop.slice(0, 40) : null,
    estimated_cost_usd: null,
  });
  if (error) console.error("[cloud-classify] no se pudo medir:", error.message);
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(CORS, 413, { error: "La imagen es demasiado grande." });
  let body: Json;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  if (typeof body.file_id !== "string" || !UUID_RE.test(body.file_id)) return json(CORS, 400, { error: "Archivo inválido." });
  if (!imagenValida(body.image_base64)) return json(CORS, 400, { error: "Envía una copia reducida en JPEG." });

  // Permiso y alcance: quien organiza la Nube y puede VER el archivo (la RLS decide por su sesión, no por el navegador).
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: puede } = await asUser.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "cloud.manage" });
  if (puede !== true) return json(CORS, 403, { error: "Tu rol no permite organizar los archivos de la Nube." });
  const { data: file } = await asUser.from("smyl_cloud_files").select("id, mime_type, status").eq("id", body.file_id).eq("tenant_id", tenantId).maybeSingle();
  if (!file || file.status !== "active") return json(CORS, 404, { error: "El archivo no existe o no tienes acceso." });
  if (!String(file.mime_type).startsWith("image/")) return json(CORS, 422, { error: "Solo se sugiere el tipo de imágenes." });

  const ahora = new Date();
  const [dia, mes] = await Promise.all(
    [inicioDiaUTC(ahora), inicioMesUTC(ahora)].map((desde) =>
      admin.from("smyl_ai_usage_log").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("feature", "cloud_classify").gte("created_at", desde)),
  );
  const tope = evaluarTopeClasificacion(dia.count || 0, mes.count || 0, topesDeEntorno(Deno.env));
  if (!tope.permitido) return json(CORS, 429, { error: tope.mensaje });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json(CORS, 503, { error: "La IA no está configurada todavía." });
  const inicio = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUD_CLASSIFY_TIMEOUT_MS);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: CLOUD_CLASSIFY_MODEL, max_tokens: CLOUD_CLASSIFY_MAX_TOKENS, system: CLASSIFY_SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image_base64 } },
          { type: "text", text: "Clasifica el tipo de esta imagen." },
        ] }],
        output_config: { format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
      }),
    }).finally(() => clearTimeout(timer));
    const message = await resp.json().catch(() => ({}));
    const duracion = Date.now() - inicio;
    if (!resp.ok) { await medir(tenantId, message?.id || null, "error", null, duracion, null); return json(CORS, 502, { error: "La IA no pudo analizar la imagen. Elige el tipo a mano." }); }
    const texto = Array.isArray(message.content) ? message.content.filter((b: Json) => b?.type === "text").map((b: Json) => b.text).join("") : "";
    const sugerencia = leerSugerencia(texto);
    await medir(tenantId, message.id || null, sugerencia ? "ok" : "incomplete", message.usage || null, duracion, message.stop_reason);
    if (!sugerencia) return json(CORS, 502, { error: "La IA no dio una respuesta clara. Elige el tipo a mano." });
    return json(CORS, 200, sugerencia);
  } catch (e) {
    await medir(tenantId, null, "error", null, Date.now() - inicio, null);
    return json(CORS, 502, { error: (e as Error)?.name === "AbortError" ? "La IA tardó demasiado. Intenta de nuevo." : "No se pudo contactar a la IA." });
  }
});
