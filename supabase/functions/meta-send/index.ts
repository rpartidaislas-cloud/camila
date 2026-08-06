// supabase/functions/meta-send/index.ts
//
// El dentista/staff responde desde la bandeja de Mensajes de app.html (aún
// sin construir, ver docs/HANDOFF.md etapa 5) -- esta función busca el
// canal correcto de la conversación y llama al endpoint de envío que
// corresponda en Meta (WhatsApp Cloud API / Messenger Send API / Instagram
// Messaging API -- las tres comparten casi el mismo formato de request vía
// Graph API, solo cambia el shape del body).
//
// Arquitectura MULTI-TENANT (decisión del usuario 2026-08-06, mismo
// patrón que su otro producto "LANA"): un solo token de un System User
// "Tech Provider" (META_TOKEN, Secret compartido) firma las llamadas para
// TODAS las clínicas -- camila_canales solo guarda el id_externo
// (phone_number_id/page_id/ig_business_id) de cada una, nunca un token por
// fila. Si algún día se agrega Embedded Signup para que cada dentista
// conecte su propia cuenta, esto no cambia -- solo cambia CÓMO se llena
// camila_canales (autoservicio en vez de INSERT manual).
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

// Token PERMANENTE del System User -- el mismo para todas las clínicas.
// NUNCA se guarda en camila_canales ni se manda al cliente.
const META_TOKEN = Deno.env.get("META_TOKEN") || "";

const GRAPH_VERSION = "v21.0";

function jsonError(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function enviarWhatsApp(phoneNumberId: string, para: string, texto: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || "Error enviando WhatsApp");
  return data.messages?.[0]?.id ?? null;
}

async function enviarMessengerOInstagram(pageOrIgId: string, para: string, texto: string): Promise<string | null> {
  const resp = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pageOrIgId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_TOKEN}` },
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
    .select("canal, id_externo")
    .eq("id", conv.canal_id)
    .maybeSingle();
  if (canalErr || !canalRow) return jsonError(500, "No se encontró el canal de esta conversación.");

  try {
    const idExternoMeta =
      canalRow.canal === "whatsapp"
        ? await enviarWhatsApp(canalRow.id_externo, conv.contacto_id_externo, texto)
        : await enviarMessengerOInstagram(canalRow.id_externo, conv.contacto_id_externo, texto);

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
