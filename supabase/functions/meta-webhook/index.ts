// supabase/functions/meta-webhook/index.ts
//
// Recibe TODOS los mensajes entrantes de Meta (WhatsApp, Messenger,
// Instagram) -- Meta usa UNA sola URL de webhook por app; el payload trae
// `object` para decir de qué producto viene. Etapa 5 de infraestructura,
// fase 1 (una sola clínica conectada) -- ver docs/HANDOFF.md.
//
// Verificación GET: Meta llama esta URL una vez al configurar el webhook
// con ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... -- hay
// que responder el challenge tal cual, SOLO si el verify_token coincide
// con el secret que configuramos (META_WEBHOOK_VERIFY_TOKEN, tú lo
// inventas y lo pegas igual en el dashboard de Meta).
//
// Verificación POST: cada evento real viene firmado con el header
// X-Hub-Signature-256 (HMAC-SHA256 del body crudo con el App Secret) --
// sin validar esto, cualquiera que conociera esta URL podría mandar
// mensajes falsos y hacerlos aparecer como si vinieran de un paciente
// real. Se calcula sobre el body SIN parsear (Deno.serve entrega el
// stream una sola vez, por eso se lee como texto primero y se parsea
// después, nunca al revés).
//
// No probado en vivo -- necesita credenciales reales de Meta (número de
// prueba de WhatsApp como mínimo) para confirmar que el formato exacto de
// cada payload coincide con lo que Meta realmente manda.

import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") || "";

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function firmaValida(bodyRaw: string, firmaHeader: string | null): Promise<boolean> {
  if (!firmaHeader || !APP_SECRET) return false;
  const esperada = "sha256=" + (await hmacSha256Hex(APP_SECRET, bodyRaw));
  return timingSafeEqual(esperada, firmaHeader);
}

async function resolverCanal(canal: string, idExterno: string) {
  const { data } = await admin
    .from("camila_canales")
    .select("id, tenant_id")
    .eq("canal", canal)
    .eq("id_externo", idExterno)
    .eq("activo", true)
    .maybeSingle();
  return data;
}

async function upsertConversacion(
  tenantId: string,
  canalId: string,
  contactoId: string,
  nombreContacto: string | null,
  textoMsg: string
): Promise<string | null> {
  const { data: existente } = await admin
    .from("camila_conversaciones")
    .select("id, no_leidos")
    .eq("canal_id", canalId)
    .eq("contacto_id_externo", contactoId)
    .maybeSingle();

  if (existente) {
    await admin
      .from("camila_conversaciones")
      .update({
        no_leidos: (existente.no_leidos || 0) + 1,
        ultimo_mensaje_en: new Date().toISOString(),
        ultimo_mensaje_texto: textoMsg,
        ...(nombreContacto ? { nombre_contacto: nombreContacto } : {}),
      })
      .eq("id", existente.id);
    return existente.id;
  }

  const { data: nueva, error } = await admin
    .from("camila_conversaciones")
    .insert({
      tenant_id: tenantId,
      canal_id: canalId,
      contacto_id_externo: contactoId,
      nombre_contacto: nombreContacto,
      no_leidos: 1,
      ultimo_mensaje_en: new Date().toISOString(),
      ultimo_mensaje_texto: textoMsg,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[meta-webhook] error creando conversación:", error.message);
    return null;
  }
  return nueva?.id ?? null;
}

async function guardarMensaje(conversacionId: string, texto: string, idExternoMeta: string | null) {
  // idExternoMeta evita duplicar el mismo mensaje si Meta reintenta el
  // webhook (pasa si no respondemos 200 lo bastante rápido).
  if (idExternoMeta) {
    const { data: existe } = await admin
      .from("camila_mensajes")
      .select("id")
      .eq("id_externo_meta", idExternoMeta)
      .maybeSingle();
    if (existe) return;
  }
  await admin.from("camila_mensajes").insert({
    conversacion_id: conversacionId,
    direccion: "entrante",
    autor: "paciente",
    texto,
    id_externo_meta: idExternoMeta,
  });
}

async function procesarWhatsApp(entry: any) {
  for (const change of entry.changes || []) {
    const value = change.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    const canalRow = await resolverCanal("whatsapp", phoneNumberId);
    if (!canalRow) {
      console.warn("[meta-webhook] canal WhatsApp no registrado en camila_canales:", phoneNumberId);
      continue;
    }

    for (const msg of value.messages || []) {
      const contacto = (value.contacts || []).find((c: any) => c.wa_id === msg.from);
      const texto = msg.text?.body || (msg.type ? `[${msg.type}]` : "");
      const convId = await upsertConversacion(
        canalRow.tenant_id,
        canalRow.id,
        msg.from,
        contacto?.profile?.name || null,
        texto
      );
      if (convId) await guardarMensaje(convId, texto, msg.id);
    }
  }
}

async function procesarMessengerOInstagram(entry: any, canal: "messenger" | "instagram") {
  const pageOrIgId = entry.id;
  const canalRow = await resolverCanal(canal, pageOrIgId);
  if (!canalRow) {
    console.warn(`[meta-webhook] canal ${canal} no registrado en camila_canales:`, pageOrIgId);
    return;
  }

  for (const evt of entry.messaging || []) {
    // is_echo = un mensaje que TÚ mandaste (por la app u otra herramienta),
    // Meta también lo manda al webhook -- si no se filtra, un mensaje
    // saliente se guardaría también como si fuera entrante.
    if (!evt.message || evt.message.is_echo) continue;
    const texto = evt.message.text || "[adjunto]";
    const convId = await upsertConversacion(canalRow.tenant_id, canalRow.id, evt.sender.id, null, texto);
    if (convId) await guardarMensaje(convId, texto, evt.message.mid);
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && challenge && token === VERIFY_TOKEN && VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Verificación fallida", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Método no permitido", { status: 405 });
  }

  const bodyRaw = await req.text();
  if (!(await firmaValida(bodyRaw, req.headers.get("x-hub-signature-256")))) {
    console.warn("[meta-webhook] firma inválida -- evento descartado");
    return new Response("Firma inválida", { status: 403 });
  }

  let body: any;
  try {
    body = JSON.parse(bodyRaw);
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    for (const entry of body.entry || []) {
      if (body.object === "whatsapp_business_account") await procesarWhatsApp(entry);
      else if (body.object === "page") await procesarMessengerOInstagram(entry, "messenger");
      else if (body.object === "instagram") await procesarMessengerOInstagram(entry, "instagram");
    }
  } catch (e) {
    console.error("[meta-webhook] error procesando evento:", (e as Error).message);
    // Sigue respondiendo 200 aunque falle -- si respondemos error, Meta
    // reintenta el MISMO evento en bucle y puede terminar deshabilitando
    // el webhook por fallas repetidas. Mejor quedarnos con el log.
  }

  return new Response("ok", { status: 200 });
});
