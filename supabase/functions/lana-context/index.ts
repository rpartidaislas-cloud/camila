import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
};
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "PUT") return json(405, { error: "Método no permitido." });
  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canManage = auth.user.id === auth.tenantId;
  if (req.method === "PUT" && !canManage) return json(403, { error: "Solo el dueño de la clínica puede cambiar el contexto de LANA." });

  try {
    const remote = await lanaRequest(auth.tenantId, "/context", {
      method: req.method,
      body: req.method === "PUT" ? JSON.stringify(await req.json()) : undefined,
    });
    if (!remote.response.ok) return json(remote.response.status, { error: String(remote.body.error || "LANA no pudo guardar el contexto.") });
    return json(200, { ...remote.body, can_manage: canManage });
  } catch (error) {
    console.error("[lana-context]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar el contexto con LANA." });
  }
});

