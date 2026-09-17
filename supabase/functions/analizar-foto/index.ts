// supabase/functions/analizar-foto/index.ts
//
// Endpoint server-to-server llamado por LANA cuando un paciente envía una
// foto dental por WhatsApp/Instagram (vertical = salud).
//
// Recibe la URL de la imagen + datos del paciente, genera diagnóstico con
// GPT-4o Vision y simulación de sonrisa con GPT Image 2, sube la simulación
// al bucket "camila-analisis", y notifica de vuelta a LANA vía callback_url.
//
// Auth entrante:  Authorization: Bearer <LANA_API_KEY>
// Auth saliente:  Authorization: Bearer <callback_secret>  (al notificar)
//
// Body de entrada (POST JSON):
//   { tenant_id, canal, sender_id, nombre_paciente?,
//     imagen_url, callback_url, callback_secret }
//
// Body de notificación saliente (POST JSON a callback_url):
//   { tenant_id, canal, sender_id, nombre_paciente?,
//     diagnostico, tratamientos_sugeridos, zona_afectada, requiere_urgente,
//     imagen_original_url, imagen_simulacion_url? }
//   En error: { tenant_id, canal, sender_id, error: true, error_message }
//
// Responde 200 inmediatamente y procesa en background (EdgeRuntime.waitUntil).

const LANA_API_KEY = Deno.env.get("LANA_API_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_IMAGE_MODEL =
  Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2-2026-04-21";
const ANALISIS_BUCKET = "camila-analisis";

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
  if (!LANA_API_KEY || tokenEntrante !== LANA_API_KEY) {
    return jsonResp({ error: "No autorizado" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Body inválido (se esperaba JSON)" }, 400);
  }

  const { tenant_id, canal, sender_id, nombre_paciente, imagen_url, callback_url, callback_secret } = body;

  if (!tenant_id || !canal || !sender_id || !imagen_url || !callback_url || !callback_secret) {
    return jsonResp({
      error: "Faltan campos requeridos: tenant_id, canal, sender_id, imagen_url, callback_url, callback_secret",
    }, 400);
  }

  const job_id = crypto.randomUUID();
  console.log(`[analizar-foto] job_id=${job_id} tenant=${tenant_id} canal=${canal} sender=${sender_id}`);

  const tarea = procesarFotoDental({
    job_id, tenant_id, canal, sender_id,
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
  nombre_paciente: string | null;
  imagen_url: string;
  callback_url: string;
  callback_secret: string;
}): Promise<void> {
  const { job_id, tenant_id, canal, sender_id, nombre_paciente, imagen_url, callback_url, callback_secret } = opts;

  try {
    // 1. Descargar la imagen dental
    const imagenRes = await fetch(imagen_url);
    if (!imagenRes.ok) {
      throw new Error(`No se pudo descargar la imagen: HTTP ${imagenRes.status}`);
    }
    const mimeType = (imagenRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    const imagenBytes = new Uint8Array(await imagenRes.arrayBuffer());
    const imagenBase64 = bytesABase64(imagenBytes);

    // 2. Diagnóstico con GPT-4o Vision
    const diagnostico = await diagnosticarFoto(imagenBase64, mimeType);

    // 3. Simulación de sonrisa (se intenta; si falla no bloquea el callback)
    let imagen_simulacion_url: string | null = null;
    try {
      imagen_simulacion_url = await generarSimulacion(imagenBase64, mimeType, job_id, tenant_id);
    } catch (e) {
      console.error(`[analizar-foto] job_id=${job_id} — simulación no disponible:`, e);
    }

    // 4. Notificar a LANA
    await notificarCallback(callback_url, callback_secret, {
      tenant_id, canal, sender_id,
      nombre_paciente: nombre_paciente || undefined,
      diagnostico: diagnostico.diagnostico,
      tratamientos_sugeridos: diagnostico.tratamientos_sugeridos,
      zona_afectada: diagnostico.zona_afectada,
      requiere_urgente: diagnostico.requiere_urgente,
      imagen_original_url: imagen_url,
      imagen_simulacion_url: imagen_simulacion_url || undefined,
    });

    console.log(`[analizar-foto] job_id=${job_id} completado`);
  } catch (e) {
    console.error(`[analizar-foto] job_id=${job_id} error:`, e);
    // Callback de error para que LANA sepa que falló y pueda responder al paciente
    try {
      await notificarCallback(callback_url, callback_secret, {
        tenant_id, canal, sender_id,
        error: true,
        error_message: String(e),
      });
    } catch (_e2) { /* ignorar si el callback mismo falla */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT-4o Vision: diagnóstico estructurado
// ─────────────────────────────────────────────────────────────────────────────

interface DiagnosticoResult {
  diagnostico: string;
  tratamientos_sugeridos: string[];
  zona_afectada: string;
  requiere_urgente: boolean;
}

async function diagnosticarFoto(imagenBase64: string, mimeType: string): Promise<DiagnosticoResult> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY no configurada");

  const instruccion = [
    "Eres un asistente dental. Analiza esta fotografía dental y devuelve ÚNICAMENTE JSON válido con el siguiente esquema exacto:",
    '{"diagnostico":"descripción clínica breve del estado dental observado (máx. 200 caracteres)",',
    '"tratamientos_sugeridos":["tratamiento1","tratamiento2"],',
    '"zona_afectada":"descripción de la zona (ej: incisivos superiores, molares inferiores)",',
    '"requiere_urgente":false}',
    "Si la imagen no muestra claramente la dentadura, escribe diagnostico: 'Foto no analizable — no se distingue la dentadura' y deja los arreglos vacíos.",
    "Responde SOLO con el JSON, sin markdown ni texto adicional.",
  ].join(" ");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruccion },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imagenBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`GPT-4o Vision error (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const texto = data.choices?.[0]?.message?.content || "";

  try {
    const limpio = texto.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(limpio);
    return {
      diagnostico: String(parsed.diagnostico || "Sin diagnóstico disponible").slice(0, 500),
      tratamientos_sugeridos: Array.isArray(parsed.tratamientos_sugeridos)
        ? parsed.tratamientos_sugeridos.map(String).slice(0, 10)
        : [],
      zona_afectada: String(parsed.zona_afectada || "").slice(0, 200),
      requiere_urgente: Boolean(parsed.requiere_urgente),
    };
  } catch {
    return {
      diagnostico: texto.slice(0, 500) || "No se pudo generar diagnóstico.",
      tratamientos_sugeridos: [],
      zona_afectada: "",
      requiere_urgente: false,
    };
  }
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
    "The result must look like a real dental before/after photo.",
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

  return `${SB_URL}/storage/v1/object/public/${ANALISIS_BUCKET}/${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback a LANA
// ─────────────────────────────────────────────────────────────────────────────

async function notificarCallback(url: string, secret: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
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
