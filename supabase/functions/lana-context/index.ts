import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";
import { makeCors } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req, "GET, POST, PUT, OPTIONS");
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "PUT") return json(405, { error: "Método no permitido." });
  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canManage = auth.user.id === auth.tenantId;
  if ((req.method === "PUT" || req.method === "POST") && !canManage) {
    return json(403, { error: "Solo el dueño de la clínica puede modificar o probar el contexto de LANA." });
  }

  try {
    const isPreview = req.method === "POST";
    const remote = await lanaRequest(auth.tenantId, isPreview ? "/context/preview" : "/context", {
      method: req.method,
      body: req.method === "PUT" || req.method === "POST" ? JSON.stringify(await req.json()) : undefined,
    }, isPreview ? 30000 : 12000);
    if (!remote.response.ok) {
      return json(remote.response.status, { error: String(remote.body.error || (isPreview ? "LANA no pudo generar la prueba." : "LANA no pudo guardar el contexto.")) });
    }
    return json(200, { ...remote.body, can_manage: canManage });
  } catch (error) {
    console.error("[lana-context]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar el contexto con LANA." });
  }
});
