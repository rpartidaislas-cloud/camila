import { requireUser } from "../_shared/auth.ts";
import { lanaRequest, smylAdmin } from "../_shared/lana-linked.ts";
import { makeCors } from "../_shared/cors.ts";

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function safeIso(value: unknown): string {
  const text = String(value || "");
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : "";
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req, "GET, POST, OPTIONS");
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });
  const canResolve = auth.user.id === auth.tenantId;

  try {
    if (req.method === "POST") {
      if (!canResolve) return json(403, { error: "Solo el dueño de la clínica puede cerrar una solicitud de atención desde SMYL." });
      let input: Record<string, unknown>;
      try { input = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
      if (input.action !== "resolve") return json(400, { error: "Acción no reconocida." });
      const conversationId = uuid(input.conversation_id);
      if (!conversationId) return json(400, { error: "La conversación de LANA no es válida." });
      const remote = await lanaRequest(auth.tenantId, `/attention/${conversationId}/resolve`, { method: "POST", body: "{}" });
      if (!remote.response.ok) return json(remote.response.status === 404 ? 404 : 502, {
        error: String(remote.body.error || "LANA no pudo cerrar esta solicitud de atención."),
      });
      return json(200, { ok: true, conversation_id: conversationId, resolved: true });
    }

    const remote = await lanaRequest(auth.tenantId, "/attention?limit=40");
    if (!remote.response.ok) return json(502, { error: String(remote.body.error || "LANA no pudo consultar la atención pendiente.") });
    const remoteItems = Array.isArray(remote.body.items) ? remote.body.items as Array<Record<string, unknown>> : [];
    const ids = remoteItems.map((item) => uuid(item.id)).filter((id): id is string => Boolean(id));
    const links = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data, error } = await smylAdmin.from("camila_lana_handoffs")
        .select("lana_conversation_id,patient_id,case_id,created_at")
        .eq("tenant_id", auth.tenantId)
        .in("lana_conversation_id", ids);
      if (error) throw error;
      for (const link of data || []) links.set(String(link.lana_conversation_id), link as Record<string, unknown>);
    }

    const items = remoteItems.flatMap((item) => {
      const id = uuid(item.id);
      if (!id) return [];
      const type = item.attention_type === "patient_replied" ? "patient_replied" : "human_requested";
      const channel = ["whatsapp", "messenger", "instagram"].includes(String(item.channel)) ? String(item.channel) : "lana";
      const link = links.get(id);
      return [{
        id,
        channel,
        contact_name: String(item.contact_name || "Paciente de LANA").trim().slice(0, 150) || "Paciente de LANA",
        attention_type: type,
        reason: type === "human_requested" ? "LANA solicita intervención humana" : "El paciente respondió durante la atención humana",
        waiting_since: safeIso(item.waiting_since),
        unread_count: Math.max(0, Math.min(99, Number(item.unread_count) || 0)),
        paused: item.paused === true,
        lana_url: `https://app.get-lana.com/admin.html?tab=chats&chat=${encodeURIComponent(id)}`,
        linked: link ? {
          patient_id: String(link.patient_id || ""),
          case_id: String(link.case_id || ""),
          created_at: safeIso(link.created_at),
        } : null,
      }];
    });
    return json(200, {
      ok: true,
      total: Math.max(items.length, Number(remote.body.total) || 0),
      items,
      can_resolve: canResolve,
      privacy: "metadata_only",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("[lana-attention]", message || error);
    if (/no está conectada|requiere atención/i.test(message)) return json(409, { error: "Conecta o verifica LANA para consultar la bandeja clínica." });
    return json(500, { error: "No se pudo consultar la bandeja clínica de LANA." });
  }
});
