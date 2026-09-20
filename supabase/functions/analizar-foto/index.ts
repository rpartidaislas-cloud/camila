import { createClient } from "npm:@supabase/supabase-js@2";
import { autorizarLana, enviarWebhookLana } from "../_shared/lana.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const GPT_MODEL = "gpt-4o-2024-11-20";

const SYSTEM_PROMPT = `Eres un asistente dental especializado. Analiza la imagen dental del paciente y devuelve únicamente el JSON solicitado.

- diagnostico: texto en español, máximo 3 párrafos, lenguaje claro para el paciente y limitado a lo realmente visible. No declares un diagnóstico definitivo ni sustituyas una consulta clínica.
- tratamientos_sugeridos: array de objetos con {nombre, descripcion, urgencia: "alta" | "media" | "baja"}.
- zona_afectada: descripción breve de los dientes o la zona visible.
- requiere_consulta_urgente: boolean.

Si la fotografía no permite valorar un dato, dilo expresamente. No inventes dientes, síntomas, antecedentes, radiografías ni hallazgos que la imagen no muestre.`;

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diagnostico", "tratamientos_sugeridos", "zona_afectada", "requiere_consulta_urgente"],
  properties: {
    diagnostico: { type: "string", minLength: 1, maxLength: 2400 },
    tratamientos_sugeridos: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "descripcion", "urgencia"],
        properties: {
          nombre: { type: "string", minLength: 1, maxLength: 120 },
          descripcion: { type: "string", minLength: 1, maxLength: 600 },
          urgencia: { type: "string", enum: ["alta", "media", "baja"] },
        },
      },
    },
    zona_afectada: { type: "string", minLength: 1, maxLength: 300 },
    requiere_consulta_urgente: { type: "boolean" },
  },
} as const;

interface EntradaAnalisis {
  tenant_id: string;
  cita_id: number | null;
  paciente_nombre: string;
  paciente_telefono: string;
  imagen_url: string;
  origen: "whatsapp" | "instagram";
}

interface AnalisisDental {
  diagnostico: string;
  tratamientos_sugeridos: Array<{ nombre: string; descripcion: string; urgencia: "alta" | "media" | "baja" }>;
  zona_afectada: string;
  requiere_consulta_urgente: boolean;
}

function responder(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esUuidV4(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function validarEntrada(body: Record<string, unknown>): EntradaAnalisis {
  const tenantId = String(body.tenant_id || "").trim();
  const nombre = String(body.paciente_nombre || "").trim();
  const telefono = String(body.paciente_telefono || "").trim();
  const imagenUrl = String(body.imagen_url || "").trim();
  const origen = String(body.origen || "").trim().toLowerCase();
  if (!esUuidV4(tenantId)) throw new Error("tenant_id debe ser un UUID v4 válido.");
  if (!nombre || nombre.length > 160) throw new Error("paciente_nombre es obligatorio y admite máximo 160 caracteres.");
  if (!/^\+[1-9]\d{7,14}$/.test(telefono)) throw new Error("paciente_telefono debe usar formato E.164.");
  if (origen !== "whatsapp" && origen !== "instagram") throw new Error("origen debe ser whatsapp o instagram.");
  let parsed: URL;
  try { parsed = new URL(imagenUrl); } catch { throw new Error("imagen_url no es una URL válida."); }
  if (parsed.protocol !== "https:") throw new Error("imagen_url debe usar HTTPS.");
  let citaId: number | null = null;
  if (body.cita_id !== null && body.cita_id !== undefined && body.cita_id !== "") {
    const raw = typeof body.cita_id === "number" ? body.cita_id : Number(String(body.cita_id));
    if (!Number.isSafeInteger(raw) || raw <= 0) throw new Error("cita_id debe ser null o un entero positivo seguro.");
    citaId = raw;
  }
  return { tenant_id: tenantId, cita_id: citaId, paciente_nombre: nombre, paciente_telefono: telefono, imagen_url: parsed.toString(), origen };
}

function ipPrivada(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h === "::1" || h === "0.0.0.0") return true;
  const p = h.split(".").map(Number);
  if (p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:");
}

async function validarDestinoPublico(url: URL): Promise<void> {
  if (url.protocol !== "https:" || ipPrivada(url.hostname)) throw new Error("La URL de imagen no apunta a un destino público permitido.");
  // Reduce SSRF por DNS hacia redes privadas. Si el runtime no permite DNS,
  // el fetch aún queda limitado a HTTPS y bloquea hosts/IP literales privados.
  try {
    const ips = await Deno.resolveDns(url.hostname, "A");
    if (ips.some(ipPrivada)) throw new Error("La URL de imagen resolvió a una red privada.");
  } catch (error) {
    if (error instanceof Error && /red privada/.test(error.message)) throw error;
  }
}

async function descargarImagen(urlInicial: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let url = new URL(urlInicial);
  for (let redireccion = 0; redireccion <= 3; redireccion += 1) {
    await validarDestinoPublico(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let respuesta: Response;
    try {
      respuesta = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "image/jpeg,image/png,image/webp" } });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(respuesta.status)) {
      const location = respuesta.headers.get("location");
      if (!location || redireccion === 3) throw new Error("La imagen excedió el límite de redirecciones.");
      url = new URL(location, url);
      continue;
    }
    if (!respuesta.ok || !respuesta.body) throw new Error(`No se pudo descargar la imagen (${respuesta.status}).`);
    const mimeType = (respuesta.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error("imagen_url no devolvió JPEG, PNG o WebP.");
    const largo = Number(respuesta.headers.get("content-length") || 0);
    if (largo > MAX_IMAGE_BYTES) throw new Error("La imagen excede 8 MB.");
    const lector = respuesta.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await lector.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) { await lector.cancel(); throw new Error("La imagen excede 8 MB."); }
      partes.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const parte of partes) { bytes.set(parte, offset); offset += parte.length; }
    if (!bytes.length) throw new Error("La imagen descargada está vacía.");
    return { bytes, mimeType };
  }
  throw new Error("No se pudo descargar la imagen.");
}

function bytesABase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  }
  return btoa(binario);
}

function extraerTextoRespuesta(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const contenido = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const parte of contenido) if (parte.type === "output_text" && typeof parte.text === "string") return parte.text;
  }
  return "";
}

async function analizarConGpt4o(imagen: { bytes: Uint8Array; mimeType: string }): Promise<{ analysis: AnalisisDental; responseId: string }> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada.");
  const respuesta = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GPT_MODEL,
      store: false,
      instructions: SYSTEM_PROMPT,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Analiza esta fotografía dental. Limítate a hallazgos visibles y responde con el esquema solicitado." },
          { type: "input_image", image_url: `data:${imagen.mimeType};base64,${bytesABase64(imagen.bytes)}`, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "analisis_dental", strict: true, schema: ANALYSIS_SCHEMA } },
      max_output_tokens: 1400,
      temperature: 0.2,
    }),
  });
  const data = await respuesta.json().catch(() => ({})) as Record<string, unknown>;
  if (!respuesta.ok) {
    const detalle = typeof (data.error as Record<string, unknown> | undefined)?.message === "string"
      ? String((data.error as Record<string, unknown>).message) : `OpenAI respondió ${respuesta.status}.`;
    throw new Error(detalle);
  }
  const texto = extraerTextoRespuesta(data);
  if (!texto) throw new Error("OpenAI no devolvió el análisis estructurado.");
  const analysis = JSON.parse(texto) as AnalisisDental;
  if (!analysis.diagnostico || !Array.isArray(analysis.tratamientos_sugeridos) || !analysis.zona_afectada || typeof analysis.requiere_consulta_urgente !== "boolean") {
    throw new Error("La respuesta de OpenAI no cumple el esquema dental.");
  }
  return { analysis, responseId: String(data.id || "") };
}

async function procesarEnSegundoPlano(id: string, entrada: EntradaAnalisis): Promise<void> {
  try {
    await admin.from("smyl_analisis_fotos").update({ estado: "procesando", updated_at: new Date().toISOString() }).eq("id", id);
    const imagen = await descargarImagen(entrada.imagen_url);
    const { analysis, responseId } = await analizarConGpt4o(imagen);
    const completado = new Date().toISOString();
    const { error: updateError } = await admin.from("smyl_analisis_fotos").update({
      diagnostico: analysis.diagnostico,
      tratamientos_sugeridos: analysis.tratamientos_sugeridos,
      zona_afectada: analysis.zona_afectada,
      requiere_consulta_urgente: analysis.requiere_consulta_urgente,
      imagen_simulacion_url: null,
      estado: "completado",
      gpt_model: GPT_MODEL,
      gpt_response_id: responseId || null,
      procesado_at: completado,
      updated_at: completado,
      webhook_estado: "enviando",
    }).eq("id", id);
    if (updateError) throw new Error(`No se pudo guardar el análisis: ${updateError.message}`);

    const payload = {
      evento: "analisis_completado",
      tenant_id: entrada.tenant_id,
      cita_id: entrada.cita_id,
      simulacion_id: id,
      imagen_original_url: entrada.imagen_url,
      imagen_simulacion_url: null,
      diagnostico: analysis.diagnostico,
      tratamientos_sugeridos: analysis.tratamientos_sugeridos,
      zona_afectada: analysis.zona_afectada,
      requiere_consulta_urgente: analysis.requiere_consulta_urgente,
      timestamp: completado,
    };
    const webhook = await enviarWebhookLana(payload);
    await admin.from("smyl_analisis_fotos").update({
      webhook_estado: webhook.ok ? "enviado" : "error",
      webhook_intentos: webhook.attempts,
      webhook_ultimo_error: webhook.ok ? null : webhook.error,
      webhook_enviado_at: webhook.ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido procesando la imagen.";
    console.error("[analizar-foto]", id, mensaje);
    // Si GPT o la descarga fallan, NO se llama al webhook de completado.
    await admin.from("smyl_analisis_fotos").update({
      estado: "error",
      error_procesamiento: mensaje.slice(0, 1200),
      webhook_estado: "pendiente",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder(405, { error: "Método no permitido." });
  if (!autorizarLana(req)) return responder(401, { error: "No autorizado." });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return responder(400, { error: "Body JSON inválido." }); }
  let entrada: EntradaAnalisis;
  try { entrada = validarEntrada(body); } catch (error) {
    return responder(400, { error: error instanceof Error ? error.message : "Payload inválido." });
  }

  const { data: tenant } = await admin.from("camila_tenants").select("id,activo").eq("id", entrada.tenant_id).maybeSingle();
  if (!tenant || !tenant.activo) return responder(404, { error: "tenant_id no pertenece a una clínica SMYL activa." });

  const idempotencyKey = (req.headers.get("Idempotency-Key") || "").trim().slice(0, 160) || null;
  if (idempotencyKey) {
    const { data: existente } = await admin.from("smyl_analisis_fotos").select("id").eq("tenant_id", entrada.tenant_id).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existente?.id) return responder(200, { recibido: true, simulacion_id: existente.id, duplicado: true });
  }

  const id = crypto.randomUUID();
  const { error: insertError } = await admin.from("smyl_analisis_fotos").insert({
    id,
    tenant_id: entrada.tenant_id,
    cita_id: entrada.cita_id,
    paciente_nombre: entrada.paciente_nombre,
    paciente_telefono: entrada.paciente_telefono,
    origen: entrada.origen,
    imagen_original_url: entrada.imagen_url,
    idempotency_key: idempotencyKey,
    estado: "pendiente",
  });
  if (insertError) return responder(500, { error: "No se pudo reservar el análisis." });

  EdgeRuntime.waitUntil(procesarEnSegundoPlano(id, entrada));
  return responder(200, { recibido: true, simulacion_id: id });
});

