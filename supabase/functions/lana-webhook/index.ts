import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { enviarWebhookLana } from "../_shared/lana.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  // requireUser conserva un fallback anónimo para funciones históricas; esta
  // integración nunca lo acepta porque expone datos de una cita concreta.
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
  const simulacionId = String(body.simulacion_id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(simulacionId)) {
    return json(400, { error: "simulacion_id inválido." });
  }

  const { data: caso, error: casoError } = await admin.from("camila_casos")
    .select("id,tenant_id,lana_cita_id,lana_origen,simulacion_url,notas_doctor")
    .eq("id", simulacionId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();
  if (casoError) return json(500, { error: "No se pudo consultar la simulación." });
  if (!caso) return json(404, { error: "No se encontró la simulación en esta clínica." });
  if (caso.lana_origen !== "lana" || !caso.lana_cita_id) return json(409, { error: "La simulación no está asociada a una cita de LANA." });

  const urlSolicitada = String(body.url_resultado || "").trim();
  let urlResultado: string;
  try {
    const parsed = new URL(urlSolicitada);
    const origenPeticion = new URL(req.headers.get("Origin") || "");
    // El enlace que LANA guardará debe pertenecer a la misma aplicación
    // web que originó la petición. Así un usuario autenticado no puede usar
    // esta función para introducir en LANA una URL externa controlada por él.
    if (parsed.protocol !== "https:" || origenPeticion.protocol !== "https:" || parsed.origin !== origenPeticion.origin) {
      throw new Error();
    }
    urlResultado = parsed.toString();
  } catch {
    return json(400, { error: "url_resultado debe ser HTTPS y pertenecer al origen de SMYL." });
  }
  const imagen = typeof caso.simulacion_url === "string" && /^https:\/\//i.test(caso.simulacion_url)
    ? caso.simulacion_url : null;
  const timestamp = new Date().toISOString();
  const payload = {
    evento: "simulacion_guardada",
    tenant_id: auth.tenantId,
    cita_id: Number(caso.lana_cita_id),
    simulacion_id: caso.id,
    url_resultado: urlResultado,
    url_imagen: imagen,
    notas: caso.notas_doctor || undefined,
    timestamp,
  };

  const resultado = await enviarWebhookLana(payload);
  await admin.from("camila_casos").update({
    lana_webhook_estado: resultado.ok ? "enviado" : "error",
    lana_webhook_intentos: resultado.attempts,
    lana_webhook_ultimo_error: resultado.ok ? null : resultado.error,
    lana_webhook_enviado_at: resultado.ok ? timestamp : null,
  }).eq("id", caso.id).eq("tenant_id", auth.tenantId);

  if (!resultado.ok) return json(502, { error: "LANA no confirmó el webhook.", attempts: resultado.attempts });
  return json(200, { ok: true, attempts: resultado.attempts });
});
