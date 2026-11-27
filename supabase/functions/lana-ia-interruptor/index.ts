// Interruptor de la IA de la clínica (task-id smyl-ia-interruptor). Puente hacia `GET/PUT /ia/interruptor` de camila-api (LANA).
//   GET  → estado (cualquier persona de la clínica) + can_manage + quién puede cambiarlo
//   PUT  → { apagada, motivo?, desde?, hasta?, no_contestar_viejos? } solo el dueño o un administrador de la clínica
// El mismo interruptor apaga las respuestas automáticas de WhatsApp, Messenger e Instagram (corren en LANA) y el asistente del perfil
// público (`public-profile-assistant`, que lo consulta). No apaga la IA interna del personal ni los avisos transaccionales.
import { requireUser } from "../_shared/auth.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";
import { makeCors } from "../_shared/cors.ts";
import { rolInterruptorDe } from "../_shared/ia-interruptor-clinica.ts";

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req, "GET, PUT, OPTIONS");
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "PUT") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  try {
    const rol = await rolInterruptorDe(auth.user.id, auth.tenantId);
    const actor = new Headers({
      "X-SMYL-Actor-Id": auth.user.id,
      "X-SMYL-Actor-Role": rol || "staff",
      "X-SMYL-Actor-Name-Encoded": encodeURIComponent((auth.user.email || "").split("@")[0] || "Miembro del equipo"),
    });
    if (req.method === "GET") {
      const remote = await lanaRequest(auth.tenantId, "/ia/interruptor", { method: "GET", headers: actor });
      if (!remote.response.ok) return json(remote.response.status === 404 ? 404 : 502, { error: String(remote.body.error || "No se pudo consultar el estado de la IA.") });
      return json(200, { ...remote.body, can_manage: rol !== null });
    }
    if (!rol) return json(403, { error: "Solo el dueño o un administrador de la clínica puede apagar o encender la IA." });
    const body = await req.json().catch(() => null);
    const remote = await lanaRequest(auth.tenantId, "/ia/interruptor", { method: "PUT", headers: actor, body: JSON.stringify(body ?? {}) });
    if (!remote.response.ok) return json(remote.response.status === 400 ? 400 : 502, { error: String(remote.body.error || "No se pudo cambiar el interruptor de la IA.") });
    return json(200, { ...remote.body, can_manage: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.startsWith("LANA todavía no está conectada")) return json(409, { error: "Conecta los canales de mensajería para usar este interruptor.", code: "lana_no_conectada" });
    console.error("[lana-ia-interruptor]", msg || error);
    return json(500, { error: "No se pudo completar la operación." });
  }
});
