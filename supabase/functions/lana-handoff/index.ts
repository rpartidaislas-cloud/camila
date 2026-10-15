import { requireUser } from "../_shared/auth.ts";
import { lanaRequest, smylAdmin } from "../_shared/lana-linked.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function uuid(value: unknown): string | null {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function normalizedPhone(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Se requiere una sesión profesional válida." });

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json(400, { error: "Body JSON inválido." }); }
  const action = String(input.action || "preview");
  const conversationId = uuid(input.conversation_id);
  if (!conversationId) return json(400, { error: "La conversación de LANA no es válida." });

  try {
    const remote = await lanaRequest(auth.tenantId, `/conversations/${conversationId}`);
    if (remote.response.status === 404) return json(404, { error: "La conversación no pertenece a la cuenta LANA conectada." });
    if (!remote.response.ok) return json(502, { error: String(remote.body.error || "LANA no pudo abrir esta conversación.") });
    const conversation = remote.body.conversacion as Record<string, unknown>;
    if (!conversation) return json(502, { error: "LANA devolvió una respuesta inesperada." });

    const { data: existing } = await smylAdmin.from("camila_lana_handoffs")
      .select("patient_id,case_id,lana_channel,created_at")
      .eq("tenant_id", auth.tenantId)
      .eq("lana_conversation_id", conversationId)
      .maybeSingle();

    const safeConversation = {
      id: conversationId,
      channel: String(conversation.canal || ""),
      name: String(conversation.nombre || "Paciente de LANA").slice(0, 150),
      email: String(conversation.email || "").slice(0, 254),
      phone: String(conversation.telefono || "").slice(0, 60),
      lana_url: String(conversation.lana_url || "https://app.get-lana.com/admin.html?tab=chats"),
    };

    if (action === "preview") {
      const { data: patients } = await smylAdmin.from("camila_pacientes")
        .select("id,nombre,apellido,email,telefono")
        .eq("tenant_id", auth.tenantId)
        .limit(1000);
      const email = safeConversation.email.trim().toLowerCase();
      const phone = normalizedPhone(safeConversation.phone);
      const candidates = (patients || []).filter((patient: Record<string, unknown>) =>
        (email && String(patient.email || "").trim().toLowerCase() === email)
        || (phone.length === 10 && normalizedPhone(patient.telefono) === phone)
      ).slice(0, 5).map((patient: Record<string, unknown>) => ({
        id: patient.id,
        name: `${patient.nombre || ""} ${patient.apellido || ""}`.trim(),
        email: patient.email || "",
        phone: patient.telefono || "",
      }));
      return json(200, { ok: true, conversation: safeConversation, existing_link: existing || null, candidates });
    }

    if (action !== "confirm") return json(400, { error: "Acción no reconocida." });
    const selectedPatientId = input.patient_id ? uuid(input.patient_id) : null;
    if (input.patient_id && !selectedPatientId) return json(400, { error: "El expediente elegido no es válido." });
    const { data, error } = await smylAdmin.rpc("camila_confirmar_lana_handoff", {
      p_tenant_id: auth.tenantId,
      p_actor_id: auth.user.id,
      p_lana_conversation_id: conversationId,
      p_lana_channel: safeConversation.channel,
      p_nombre: safeConversation.name,
      p_email: safeConversation.email,
      p_telefono: safeConversation.phone,
      p_patient_id: selectedPatientId,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return json(200, { ok: true, conversation: safeConversation, link: result });
  } catch (error) {
    console.error("[lana-handoff]", error instanceof Error ? error.message : error);
    return json(500, { error: "No se pudo preparar el expediente desde LANA." });
  }
});

