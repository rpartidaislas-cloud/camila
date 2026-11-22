// supabase/functions/analizar-foto/index.ts
//
// Endpoint server-to-server llamado por LANA cuando un paciente envía una
// foto dental por WhatsApp/Instagram (vertical = salud).
//
// NO DIAGNOSTICA. No describe el estado dental, no sugiere tratamientos ni
// decide urgencias: eso lo hace un profesional de la clínica (COFEPRIS: un
// software que diagnostica es un dispositivo médico). Solo:
//   1. Comprueba que el paciente AUTORIZÓ el uso de IA (finalidad ai_processing,
//      consentimiento expreso; LFPDPPP). Sin autorización no se manda nada a la IA.
//   2. Revisa si la foto sirve para una simulación estética (se ven los dientes,
//      luz, enfoque). La IA solo elige de una lista cerrada; su texto no sale.
//   3. Si sirve, genera una simulación ILUSTRATIVA de sonrisa con GPT Image.
//   4. Avisa a LANA con mensajes fijos para el paciente y la marca
//      requiere_revision_profesional: true (la clínica debe revisar la foto).
//
// Auth entrante:  Authorization: Bearer <LANA_API_KEY>
// Auth saliente:  Authorization: Bearer <callback_secret>  (al notificar)
//
// Body de entrada (POST JSON):
//   { tenant_id, canal, sender_id, patient_id?, nombre_paciente?,
//     imagen_url, callback_url, callback_secret }
//   patient_id: paciente de SMYL ya vinculado a la conversación. Sin él no se usa IA.
//
// Body de notificación saliente (POST JSON a callback_url):
//   { tenant_id, canal, sender_id, nombre_paciente?,
//     estado: 'simulacion_lista' | 'foto_no_apta' | 'revision_profesional',
//     ia_usada, motivo?, foto_apta?, motivo_no_apta?,
//     mensaje_paciente, aviso_simulacion?, requiere_revision_profesional: true,
//     imagen_original_url, imagen_simulacion_url? }
//   En error: { tenant_id, canal, sender_id, error: true, error_message, mensaje_paciente,
//               requiere_revision_profesional: true }
//
// Responde 200 inmediatamente y procesa en background (EdgeRuntime.waitUntil).

import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual, isAllowedRemoteUrl, parseAllowedHostSuffixes, readBodyWithLimit } from "../_shared/request-safety.ts";
import { permisoIA } from "../_shared/privacy.ts";
import { MENSAJES_PACIENTE, AVISO_SIMULACION, MOTIVOS_NO_APTA, interpretarCalidad } from "./foto-core.mjs";

const LANA_API_KEY = Deno.env.get("LANA_API_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const OPENAI_IMAGE_MODEL =
  Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2-2026-04-21";
const ANALISIS_BUCKET = "camila-analisis";
// Hosts desde los que se acepta descargar la imagen y a los que se acepta devolver el callback:
// por defecto solo Supabase (el Storage y las funciones de LANA); más hosts con
// ANALIZAR_FOTO_ALLOWED_HOSTS (lista separada por comas).
const SUFIJOS_PERMITIDOS = parseAllowedHostSuffixes(Deno.env.get("ANALIZAR_FOTO_ALLOWED_HOSTS"));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Las simulaciones de pacientes se entregan con enlace firmado de 7 días, no con una URL pública permanente.
const SIMULACION_URL_SEGUNDOS = 7 * 24 * 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResp({ error: "Método no permitido" }, 405);

  // Autenticación: secreto compartido LANA → CAMILA
  const tokenEntrante = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!LANA_API_KEY || !constantTimeEqual(tokenEntrante, LANA_API_KEY)) {
    return jsonResp({ error: "No autorizado" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Body inválido (se esperaba JSON)" }, 400);
  }

  const { tenant_id, canal, sender_id, patient_id, nombre_paciente, imagen_url, callback_url, callback_secret } = body;

  if (!tenant_id || !canal || !sender_id || !imagen_url || !callback_url || !callback_secret) {
    return jsonResp({
      error: "Faltan campos requeridos: tenant_id, canal, sender_id, imagen_url, callback_url, callback_secret",
    }, 400);
  }

  // Esta función corre con service role y hace peticiones salientes con datos del body:
  // se valida todo antes de usarlo (ruta de Storage, hosts de descarga y de callback).
  if (typeof tenant_id !== "string" || !UUID_RE.test(tenant_id)) {
    return jsonResp({ error: "tenant_id inválido" }, 400);
  }
  if (typeof canal !== "string" || canal.length > 40 || typeof sender_id !== "string" || sender_id.length > 120) {
    return jsonResp({ error: "canal o sender_id inválido" }, 400);
  }
  if (patient_id != null && (typeof patient_id !== "string" || !UUID_RE.test(patient_id))) {
    return jsonResp({ error: "patient_id inválido" }, 400);
  }
  if (nombre_paciente != null && (typeof nombre_paciente !== "string" || nombre_paciente.length > 200)) {
    return jsonResp({ error: "nombre_paciente inválido" }, 400);
  }
  if (!isAllowedRemoteUrl(imagen_url, SUFIJOS_PERMITIDOS)) {
    return jsonResp({ error: "imagen_url no es una URL permitida" }, 400);
  }
  if (!isAllowedRemoteUrl(callback_url, SUFIJOS_PERMITIDOS)) {
    return jsonResp({ error: "callback_url no es una URL permitida" }, 400);
  }
  if (typeof callback_secret !== "string" || callback_secret.length > 500) {
    return jsonResp({ error: "callback_secret inválido" }, 400);
  }

  const job_id = crypto.randomUUID();
  console.log(`[analizar-foto] job_id=${job_id} tenant=${tenant_id} canal=${canal} sender=${sender_id}`);

  const tarea = procesarFotoDental({
    job_id, tenant_id, canal, sender_id,
    patient_id: patient_id || null,
    nombre_paciente: nombre_paciente || null,
    imagen_url,
    callback_url,
    callback_secret,
  });

  // EdgeRuntime.waitUntil mantiene viva la función hasta que termina el
  // procesamiento aunque la respuesta ya fue enviada.
  try {
    (globalThis as any).EdgeRuntime.waitUntil(tarea);
  } catch {
    tarea.catch((e: Error) => console.error("[analizar-foto] tarea de fondo:", e));
  }

  return jsonResp({ ok: true, job_id, message: "Procesando..." });
});

// ─────────────────────────────────────────────────────────────────────────────
// Procesamiento asíncrono
// ─────────────────────────────────────────────────────────────────────────────

async function procesarFotoDental(opts: {
  job_id: string;
  tenant_id: string;
  canal: string;
  sender_id: string;
  patient_id: string | null;
  nombre_paciente: string | null;
  imagen_url: string;
  callback_url: string;
  callback_secret: string;
}): Promise<void> {
  const { job_id, tenant_id, canal, sender_id, patient_id, nombre_paciente, imagen_url, callback_url, callback_secret } = opts;
  const base = { tenant_id, canal, sender_id, nombre_paciente: nombre_paciente || undefined, imagen_original_url: imagen_url, requiere_revision_profesional: true };

  try {
    // 1. Consentimiento expreso del paciente para usar IA. Sin paciente vinculado o sin autorización:
    //    no se descarga ni se manda nada a la IA; la clínica revisa la foto.
    const permiso = patient_id ? await permisoIA(admin, tenant_id, patient_id) : "missing";
    if (permiso !== "allowed") {
      const motivo = !patient_id ? "paciente_no_vinculado" : permiso === "revoked" ? "ia_no_autorizada" : permiso === "missing" ? "ia_sin_autorizacion" : "permiso_no_verificable";
      console.log(`[analizar-foto] job_id=${job_id} sin IA: ${motivo}`);
      await notificarCallback(callback_url, callback_secret, { ...base, estado: "revision_profesional", ia_usada: false, motivo, mensaje_paciente: MENSAJES_PACIENTE.revision });
      return;
    }

    // 2. Descargar la foto
    const imagenRes = await fetch(imagen_url, { redirect: "error" });
    if (!imagenRes.ok) {
      throw new Error(`No se pudo descargar la imagen: HTTP ${imagenRes.status}`);
    }
    const mimeType = (imagenRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    const imagenBytes = await readBodyWithLimit(imagenRes);
    const imagenBase64 = bytesABase64(imagenBytes);

    // 3. ¿La foto sirve para una simulación estética? (no es una valoración clínica)
    const calidad = await revisarCalidadFoto(imagenBase64, mimeType);
    if (!calidad.apta) {
      await notificarCallback(callback_url, callback_secret, { ...base, estado: "foto_no_apta", ia_usada: true, foto_apta: false, motivo_no_apta: calidad.motivo, mensaje_paciente: (MENSAJES_PACIENTE as Record<string, string>)[calidad.motivo] || MENSAJES_PACIENTE.otra });
      return;
    }

    // 4. Simulación ilustrativa (si falla, la clínica revisa la foto igualmente)
    let imagen_simulacion_url: string | null = null;
    try {
      imagen_simulacion_url = await generarSimulacion(imagenBase64, mimeType, job_id, tenant_id);
    } catch (e) {
      console.error(`[analizar-foto] job_id=${job_id} — simulación no disponible:`, e);
    }

    // Piloto comercial: registra un crédito IA por foto procesada. Si no
    // hay saldo aún, smyl_consume lo deja como meter_only y no interrumpe LANA.
    const { error: usageError } = await admin.rpc("smyl_consume", {
      p_tenant_id: tenant_id,
      p_resource: "ai_credits",
      p_quantity_units: 1,
      p_idempotency_key: `analizar-foto:${job_id}`,
      p_source_type: "analizar_foto",
      p_source_id: job_id,
      p_provider: "openai",
      p_provider_model: OPENAI_IMAGE_MODEL,
      p_metadata: { canal },
      p_enforce: false,
    });
    if (usageError) console.error(`[analizar-foto] job_id=${job_id} — medición pendiente:`, usageError.message);

    // 5. Notificar a LANA (sin ningún contenido clínico)
    await notificarCallback(callback_url, callback_secret, imagen_simulacion_url
      ? { ...base, estado: "simulacion_lista", ia_usada: true, foto_apta: true, mensaje_paciente: MENSAJES_PACIENTE.simulacion, aviso_simulacion: AVISO_SIMULACION, imagen_simulacion_url }
      : { ...base, estado: "revision_profesional", ia_usada: true, foto_apta: true, motivo: "simulacion_no_disponible", mensaje_paciente: MENSAJES_PACIENTE.revision });

    console.log(`[analizar-foto] job_id=${job_id} completado`);
  } catch (e) {
    console.error(`[analizar-foto] job_id=${job_id} error:`, e);
    // Callback de error para que LANA sepa que falló y pueda responder al paciente
    try {
      await notificarCallback(callback_url, callback_secret, {
        tenant_id, canal, sender_id,
        error: true,
        error_message: String(e).slice(0, 300),
        mensaje_paciente: MENSAJES_PACIENTE.revision,
        requiere_revision_profesional: true,
      });
    } catch (_e2) { /* ignorar si el callback mismo falla */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT-4o: ¿la foto sirve para una simulación estética? (NO es diagnóstico)
// ─────────────────────────────────────────────────────────────────────────────

async function revisarCalidadFoto(imagenBase64: string, mimeType: string): Promise<{ apta: boolean; motivo: string }> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");

  const instruccion = [
    "Revisa SOLO la calidad técnica de esta foto para hacer una simulación estética de sonrisa.",
    "NO evalúes la salud dental: no describas dientes, encías, caries, manchas, enfermedades, tratamientos ni urgencias.",
    "Responde ÚNICAMENTE JSON: {\"apta\": true|false, \"motivo\": uno de " + JSON.stringify(MOTIVOS_NO_APTA.concat(["ninguno"])) + "}.",
    "apta=true solo si se ve una sonrisa con los dientes superiores frontales, con luz y enfoque suficientes.",
  ].join(" ");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 60,
      store: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruccion },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imagenBase64}`, detail: "low" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`GPT-4o error (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return interpretarCalidad(data.choices?.[0]?.message?.content || "");
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT Image 2: simulación de sonrisa → sube a Supabase Storage
// ─────────────────────────────────────────────────────────────────────────────

async function generarSimulacion(
  imagenBase64: string,
  mimeType: string,
  jobId: string,
  tenantId: string,
): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) throw new Error("Supabase no configurado");

  const promptSimulacion = [
    "You are a dental smile simulation tool.",
    "Generate a photorealistic simulation showing natural veneers that improve the patient smile.",
    "Keep the patient's real features, lighting, background, and jaw structure exactly as they are.",
    "Only modify the visible upper teeth: whiten, align, and add natural-looking ceramic veneers.",
    "Do NOT alter skin, hair, lips, eyes, or any other part of the image.",
    "This is an illustrative cosmetic preview, not a clinical prediction.",
  ].join(" ");

  const formData = new FormData();
  formData.append(
    "image",
    new Blob([base64ABytes(imagenBase64)], { type: mimeType }),
    "dental.jpg",
  );
  formData.append("prompt", promptSimulacion);
  formData.append("model", OPENAI_IMAGE_MODEL);
  formData.append("size", "1024x1024");
  formData.append("quality", "medium");
  formData.append("n", "1");
  formData.append("response_format", "b64_json");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`GPT Image edits error (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("GPT Image no devolvió imagen en b64_json");

  const pngBytes = base64ABytes(b64);
  const path = `${tenantId}/${jobId}.png`;

  const uploadRes = await fetch(
    `${SB_URL}/storage/v1/object/${ANALISIS_BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SB_SERVICE_ROLE_KEY}`,
        "Content-Type": "image/png",
        "x-upsert": "true",
      },
      body: pngBytes,
    },
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => "");
    throw new Error(`Storage upload error (${uploadRes.status}): ${err.slice(0, 200)}`);
  }

  // Solo enlace firmado y con vencimiento (el bucket es privado). Nunca una URL pública.
  const firmada = await admin.storage.from(ANALISIS_BUCKET).createSignedUrl(path, SIMULACION_URL_SEGUNDOS);
  if (firmada.error || !firmada.data?.signedUrl) throw new Error("No se pudo firmar la simulación: " + (firmada.error?.message || "sin URL"));
  return firmada.data.signedUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback a LANA
// ─────────────────────────────────────────────────────────────────────────────

async function notificarCallback(url: string, secret: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Callback error (${res.status}): ${texto.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function bytesABase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

function base64ABytes(base64: string): Uint8Array {
  const limpio = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
