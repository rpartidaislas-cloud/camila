// supabase/functions/meta-send/index.ts
//
// El dentista/staff responde desde la bandeja de Mensajes de app.html (aún
// sin construir, ver docs/HANDOFF.md etapa 5) -- esta función busca el
// canal/token correcto de la conversación y llama al endpoint de envío que
// corresponda en Meta (WhatsApp Cloud API / Messenger Send API / Instagram
// Messaging API -- las tres comparten casi el mismo formato de request vía
// Graph API, solo cambia el shape del body).
//
// No probado en vivo -- necesita credenciales reales de Meta.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const GRAPH_VERSION = "v21.0";

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function enviarWhatsApp(phoneNumberId: string, token: string, para: string, texto: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Error enviando WhatsApp");
  return data.messages?.[0]?.id ?? null;
}

async function enviarMessengerOInstagram(
  pageOrIgId: string,
  token: string,
  para: string,
  texto: string
): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageOrIgId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: para }, message: { text: texto } }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Error enviando mensaje");
  return data.message_id ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError(405, "Método no permitido.");

  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return jsonError(401, "Necesitas iniciar sesión.");

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Body inválido.");
  }
  const conversacionId = String(body?.conversacionId || "");
  const texto = String(body?.texto || "").trim();
  if (!conversacionId || !texto) return jsonError(400, "Falta conversacionId o texto.");

  // Confirma que la conversación pertenece a la clínica de quien llama --
  // requireUser ya resuelve el tenant real (dueño o staff), pero hay que
  // verificar la fila específica igual que el resto de las Edge Functions
  // hacen con camila_casos.
  const { data: conv, error: convErr } = await admin
    .from("camila_conversaciones")
    .select("id, tenant_id, contacto_id_externo, canal_id")
    .eq("id", conversacionId)
    .maybeSingle();
  if (convErr || !conv || conv.tenant_id !== tenantId) {
    return jsonError(403, "Esa conversación no pertenece a tu clínica.");
  }

  const { data: canalRow, error: canalErr } = await admin
    .from("camila_canales")
    .select("canal, id_externo, access_token")
    .eq("id", conv.canal_id)
    .maybeSingle();
  if (canalErr || !canalRow) return jsonError(500, "No se encontró el canal de esta conversación.");

  try {
    const idExternoMeta =
      canalRow.canal === "whatsapp"
        ? await enviarWhatsApp(canalRow.id_externo, canalRow.access_token, conv.contacto_id_externo, texto)
        : await enviarMessengerOInstagram(canalRow.id_externo, canalRow.access_token, conv.contacto_id_externo, texto);

    await admin.from("camila_mensajes").insert({
      conversacion_id: conversacionId,
      direccion: "saliente",
      autor: "staff",
      texto,
      id_externo_meta: idExternoMeta,
    });
    await admin
      .from("camila_conversaciones")
      .update({ ultimo_mensaje_en: new Date().toISOString(), ultimo_mensaje_texto: texto })
      .eq("id", conversacionId);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[meta-send] error:", (e as Error).message);
    return jsonError(500, "No se pudo enviar el mensaje: " + (e as Error).message);
  }
});
