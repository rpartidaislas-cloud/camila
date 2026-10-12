import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const SMYL_PUBLIC_APP_URL = Deno.env.get("SMYL_PUBLIC_APP_URL") || "https://rpartidaislas-cloud.github.io/camila/app.html";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function channel(value: unknown): "whatsapp" | "messenger" | "instagram" | null {
  return value === "whatsapp" || value === "messenger" || value === "instagram" ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canManage = auth.user.id === auth.tenantId;

  try {
    if (req.method === "GET") {
      const remote = await lanaRequest(auth.tenantId, "/channels", { method: "GET" });
      if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudieron consultar los canales.") });
      return json(200, { ...remote.body, can_manage: canManage });
    }

    if (!canManage) return json(403, { error: "Solo el dueño de la clínica puede conectar canales." });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action !== "setup") return json(400, { error: "Acción no reconocida." });
    const selected = channel(body.channel);
    if (!selected) return json(400, { error: "Canal no soportado." });
    const returnOrigin = new URL(SMYL_PUBLIC_APP_URL).origin;
    if (new URL(SMYL_PUBLIC_APP_URL).protocol !== "https:") {
      return json(500, { error: "SMYL_PUBLIC_APP_URL debe usar HTTPS." });
    }
    const remote = await lanaRequest(auth.tenantId, `/channels/${selected}/setup-session`, {
      method: "POST",
      body: JSON.stringify({ return_origin: returnOrigin }),
    });
    if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "No se pudo iniciar la conexión del canal.") });
    return json(200, { ...remote.body, can_manage: true });
  } catch (error) {
    console.error("[lana-channels]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo completar la operación de canales." });
  }
});
