import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";
import { makeCors } from "../_shared/cors.ts";

function actionPath(method: string, action: unknown): string | null {
  if (method === "GET") return action === "versions" ? "/training/versions" : "/training";
  if (method === "PUT") return action === "draft" ? "/training/draft" : null;
  if (method === "POST" && ["validate", "publish", "restore", "preview"].includes(String(action))) {
    return `/training/${String(action)}`;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const CORS = { ...makeCors(req, "GET, POST, PUT, OPTIONS"), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key" };
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!['GET', 'POST', 'PUT'].includes(req.method)) return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canManage = auth.user.id === auth.tenantId;
  if (req.method !== "GET" && !canManage) {
    return json(403, { error: "Solo el dueño de la clínica puede modificar, publicar o probar la capacitación." });
  }

  try {
    let body: Record<string, unknown> = {};
    let action: unknown = new URL(req.url).searchParams.get("action") || "training";
    if (req.method !== "GET") {
      body = await req.json().catch(() => ({})) as Record<string, unknown>;
      action = body.action;
    }
    const path = actionPath(req.method, action);
    if (!path) return json(400, { error: "Acción de capacitación no reconocida." });

    const headers = new Headers({ "X-SMYL-Actor-Id": auth.user.id });
    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const forwardedBody = req.method === "GET" ? undefined : JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "action")));
    const remote = await lanaRequest(auth.tenantId, path, {
      method: req.method,
      headers,
      body: forwardedBody,
    }, action === "preview" ? 30000 : 12000);
    if (!remote.response.ok) {
      return json(remote.response.status, {
        ...remote.body,
        error: String(remote.body.error || "LANA no pudo completar la operación de capacitación."),
      });
    }
    return json(200, { ...remote.body, can_manage: canManage });
  } catch (error) {
    console.error("[lana-training]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo sincronizar la capacitación con LANA." });
  }
});
