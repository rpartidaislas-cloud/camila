import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function uuid(value: unknown): string | null {
  const candidate = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

// Compatibilidad para clientes que todavía tengan en caché handoff v3/v4.
// Toda la autorización y resolución se ejecuta en lana-inbox, que valida el
// alcance de la conversación antes de mostrar candidatos o crear un caso.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  const input = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!input) return json(400, { error: "Body JSON inválido." });
  const action = String(input.action || "preview");
  const conversationId = uuid(input.conversation_id);
  if (!conversationId) return json(400, { error: "La conversación de LANA no es válida." });
  if (!["preview", "confirm"].includes(action)) return json(400, { error: "Acción no reconocida." });

  const authorization = req.headers.get("authorization") || "";
  const apiKey = req.headers.get("apikey") || SB_ANON_KEY;
  if (!SB_URL || !authorization || !apiKey) return json(503, { error: "El servicio de pacientes no está disponible." });
  const headers = new Headers({
    Authorization: authorization,
    apikey: apiKey,
    "Content-Type": "application/json",
    "Idempotency-Key": req.headers.get("Idempotency-Key") || crypto.randomUUID(),
  });
  const response = await fetch(`${SB_URL}/functions/v1/lana-inbox`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: action === "preview" ? "patient_link_preview" : "patient_link_confirm",
      conversation_id: conversationId,
      patient_id: input.patient_id || null,
    }),
  });
  const body = await response.json().catch(() => ({ error: "El servicio devolvió una respuesta inválida." }));
  return json(response.status, body as Record<string, unknown>);
});
