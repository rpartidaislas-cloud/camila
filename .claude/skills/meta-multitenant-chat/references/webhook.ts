// Meta multi-tenant chat -- webhook Edge Function template.
// Deploy as e.g. supabase/functions/meta-webhook/index.ts
//
// Adapt: table/column names to match schema.sql as you adapted it, and
// generarRespuestaIA to call whatever AI provider the host project already
// uses (don't invent a second AI integration if one exists).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_TOKEN")!;        // permanent System User token -- shared by ALL tenants
const APP_SECRET = Deno.env.get("META_APP_SECRET")!;   // for webhook signature validation
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN")!;

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Validates X-Hub-Signature-256. Without this, anyone who learns your
// webhook URL can inject fake messages -- do not skip or defer this.
async function firmaValida(rawBody: string, firmaHeader: string | null): Promise<boolean> {
  if (!firmaHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}` === firmaHeader;
}

// The core of the multi-tenant pattern: look up which tenant owns this
// Meta-assigned account ID. Never resolve tenant any other way (not from
// message content, not from a client-supplied field).
async function resolverTenant(canal: string, externalId: string) {
  const { data } = await sb.from("meta_conexiones")
    .select("tenant_id").eq("canal", canal).eq("external_id", externalId).maybeSingle();
  return data?.tenant_id ?? null;
}

async function yaProcesado(messageId: string): Promise<boolean> {
  const { error } = await sb.from("mensajes_procesados").insert({ message_id: messageId });
  return !!error; // insert failed (PK collision) => already processed
}

async function obtenerOCrearConversacion(tenantId: string, canal: string, clienteId: string, clienteNombre: string | null) {
  const { data } = await sb.from("conversaciones")
    .upsert({ tenant_id: tenantId, canal, cliente_id: clienteId, cliente_nombre: clienteNombre }, { onConflict: "tenant_id,canal,cliente_id" })
    .select().single();
  return data;
}

async function guardarMensaje(tenantId: string, conversacionId: string, rol: string, contenido: string) {
  await sb.from("mensajes").insert({ tenant_id: tenantId, conversacion_id: conversacionId, rol, contenido });
}

async function actualizarUltimoMensaje(conversacionId: string, contenido: string, rol: string) {
  await sb.from("conversaciones").update({ ultimo_mensaje: contenido, ultimo_mensaje_rol: rol, ultimo_mensaje_at: new Date().toISOString() }).eq("id", conversacionId);
}

// STUB -- replace with a real call to the host project's AI provider.
// Must return the reply text, and should flag necesitaAsesor when the model
// determines a human needs to step in (don't make the human read every
// message to notice this -- have the model say so explicitly).
async function generarRespuestaIA(tenantId: string, historial: { rol: string; contenido: string }[], mensajeNuevo: string): Promise<{ texto: string; necesitaAsesor: boolean; resumen?: string }> {
  return { texto: "…", necesitaAsesor: false };
}

async function enviarMensajeSaliente(canal: string, externalId: string, clienteId: string, texto: string) {
  if (canal === "whatsapp") {
    await fetch(`https://graph.facebook.com/v21.0/${externalId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${META_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: clienteId, type: "text", text: { body: texto } }),
    });
  } else {
    // Messenger and Instagram share the same Send API shape.
    await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${META_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: clienteId }, message: { text: texto } }),
    });
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verification handshake -- Meta calls this once, when you configure the webhook.
  if (req.method === "GET") {
    if (url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  if (!(await firmaValida(rawBody, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }
  const payload = JSON.parse(rawBody);

  for (const entry of payload.entry || []) {
    // ── WhatsApp ──
    for (const change of entry.changes || []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const tenantId = await resolverTenant("whatsapp", phoneNumberId);
      if (!tenantId) continue; // nobody connected this number -- ignore silently, don't error

      for (const msg of value.messages || []) {
        if (await yaProcesado(msg.id)) continue; // Meta retry, already handled
        const clienteId = msg.from;
        const clienteNombre = value.contacts?.[0]?.profile?.name || null;
        const texto = msg.text?.body || "";
        const conv = await obtenerOCrearConversacion(tenantId, "whatsapp", clienteId, clienteNombre);
        await guardarMensaje(tenantId, conv.id, "user", texto);
        await actualizarUltimoMensaje(conv.id, texto, "user");

        if (conv.pausado) continue; // a human already took the thread -- AI stays quiet

        const { data: historialRows } = await sb.from("mensajes")
          .select("rol,contenido").eq("conversacion_id", conv.id).order("created_at", { ascending: false }).limit(20);
        const respuesta = await generarRespuestaIA(tenantId, (historialRows || []).reverse(), texto);

        if (respuesta.necesitaAsesor) {
          await sb.from("conversaciones").update({ necesita_asesor: true, resumen_asesor: respuesta.resumen || null }).eq("id", conv.id);
        }
        await enviarMensajeSaliente("whatsapp", phoneNumberId, clienteId, respuesta.texto);
        await guardarMensaje(tenantId, conv.id, "assistant", respuesta.texto);
        await actualizarUltimoMensaje(conv.id, respuesta.texto, "assistant");
      }
    }

    // ── Messenger / Instagram ──
    for (const messaging of entry.messaging || []) {
      const pageOrIgId = entry.id; // page_id or IG-scoped id, depending on the product
      const canal = payload.object === "instagram" ? "instagram" : "messenger";
      const tenantId = await resolverTenant(canal, pageOrIgId);
      if (!tenantId || !messaging.message?.text) continue;

      const clienteId = messaging.sender.id;
      const texto = messaging.message.text;
      const msgId = messaging.message.mid;
      if (await yaProcesado(msgId)) continue;

      const conv = await obtenerOCrearConversacion(tenantId, canal, clienteId, null);
      await guardarMensaje(tenantId, conv.id, "user", texto);
      await actualizarUltimoMensaje(conv.id, texto, "user");
      if (conv.pausado) continue;

      const { data: historialRows } = await sb.from("mensajes")
        .select("rol,contenido").eq("conversacion_id", conv.id).order("created_at", { ascending: false }).limit(20);
      const respuesta = await generarRespuestaIA(tenantId, (historialRows || []).reverse(), texto);

      if (respuesta.necesitaAsesor) {
        await sb.from("conversaciones").update({ necesita_asesor: true, resumen_asesor: respuesta.resumen || null }).eq("id", conv.id);
      }
      await enviarMensajeSaliente(canal, pageOrIgId, clienteId, respuesta.texto);
      await guardarMensaje(tenantId, conv.id, "assistant", respuesta.texto);
      await actualizarUltimoMensaje(conv.id, respuesta.texto, "assistant");
    }
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});
