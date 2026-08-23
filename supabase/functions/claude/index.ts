import { requireUser } from "../_shared/auth.ts";
import {
  checkAndConsumeLimit,
  checkAndConsumeLimitProspecto,
  checkLimitSinConsumir,
  checkLimitPorIpProspecto,
} from "../_shared/limits.ts";

const CORS = {
  // x-tenant-id lo manda simulacion.html en modo prospecto (ver
  // headersEdgeIA). Sin declararlo aquí, el navegador corta la llamada en
  // el preflight de CORS y el paciente ve un "problema de conexión" que no
  // tiene nada que ver con su conexión.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Modelos Gemini para generación de imagen (en orden de preferencia) --
// vuelta atrás desde gpt-image-1 (OpenAI): Gemini termina cómodamente
// dentro del límite de tiempo de la Edge Function; gpt-image-1 no.
const GEMINI_IMAGE_MODELS = [
  { name: "gemini-2.5-flash-image", modalities: ["TEXT", "IMAGE"] },
  { name: "gemini-3.1-flash-image", modalities: ["TEXT", "IMAGE"] },
  { name: "gemini-3-pro-image",     modalities: ["TEXT", "IMAGE"] },
];

// Una acción del usuario debe equivaler, por defecto, a un solo intento de
// generación cobrado por el proveedor. Se puede elevar temporalmente a 2 o 3
// desde Secrets si la disponibilidad lo exige, pero nunca de forma accidental.
const GEMINI_IMAGE_MAX_ATTEMPTS = Math.min(
  GEMINI_IMAGE_MODELS.length,
  Math.max(1, Number.parseInt(Deno.env.get("GEMINI_IMAGE_MAX_ATTEMPTS") || "1", 10) || 1),
);

type ImageProvider = "gemini" | "openai";

// El proveedor predeterminado se decide exclusivamente en el servidor. El
// navegador no necesita conocer esta configuración y nunca recibe la clave.
// Cambiar el Secret a `gemini` permite un rollback inmediato sin modificar el
// frontend ni volver a desplegar GitHub Pages.
const DEFAULT_IMAGE_PROVIDER: ImageProvider =
  Deno.env.get("SMYL_IMAGE_PROVIDER")?.trim().toLowerCase() === "openai"
    ? "openai"
    : "gemini";

// La bandera experimental se conserva para comparaciones A/B autenticadas
// cuando Gemini sea el proveedor predeterminado. No existe fallback automático
// entre proveedores: una acción del usuario equivale a una sola llamada pagada.
const OPENAI_IMAGE_EXPERIMENT_ENABLED =
  Deno.env.get("OPENAI_IMAGE_EXPERIMENT_ENABLED") === "true";
const OPENAI_IMAGE_MODEL =
  Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2-2026-04-21";
const OPENAI_IMAGE_TIMEOUT_MS = Math.min(
  55000,
  Math.max(15000, Number.parseInt(Deno.env.get("OPENAI_IMAGE_TIMEOUT_MS") || "45000", 10) || 45000),
);

function base64ABytes(base64: string): Uint8Array {
  const limpio = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// La plataforma de Supabase mata la función si se pasa de su propio límite
// de tiempo -- cuando eso pasa, el navegador ve la conexión cortada a medio
// camino SIN los headers de CORS (porque el proceso murió antes de poder
// responder nada), y lo reporta como "CORS error" en vez de un error claro.
// Para que eso no vuelva a pasar, cada llamada externa (Anthropic, Gemini)
// se corta ANTES de ese límite, desde nuestro propio código, para siempre
// devolver una respuesta real (con sus headers) en vez de dejar que la
// plataforma mate el proceso a medias.
async function fetchConTimeout(url: string, opciones: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opciones, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req: Request) => {
  // Diagnóstico: esta es la PRIMERA línea de todo el código, antes de
  // revisar la sesión o leer el body. Si ni esto aparece en los logs de una
  // invocación real (POST), la función está muriendo por el tamaño del
  // paquete que le llega (memoria), antes de que nuestro código corra --
  // no es un problema de lógica ni de tiempo de CPU dentro del código.
  const t0 = performance.now();
  const marca = (etiqueta: string) => console.log(`[t] ${etiqueta}: ${(performance.now() - t0).toFixed(0)}ms`);
  console.log(`[t] inicio -- método: ${req.method}, content-length: ${req.headers.get("content-length") || "?"}`);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Esta función gasta dinero real (Anthropic y Gemini). Sin esta verificación
  // respondía a un POST a pelo, sin ningún header, desde cualquier lado.
  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  marca("después de requireUser");

  // Modo prospecto (simulacion.html?clinica=<id>, sin sesión): el tenant_id
  // viaja en un header en vez de la sesión.
  const tenantHeaderProspecto = user ? null : req.headers.get("x-tenant-id");
  // Tenant efectivo: de la sesión (requireUser ya distingue dueño de staff,
  // NUNCA user.id directo) o del header en modo prospecto.
  const tenantEfectivo = tenantHeaderProspecto || tenantId;

  let body: any;
  try {
    body = await req.json();
    marca("después de req.json()");
  } catch {
    return new Response(JSON.stringify({ error: "Body inválido." }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const requestId = typeof body?.requestId === "string" && body.requestId.trim()
    ? body.requestId.trim().slice(0, 120)
    : crypto.randomUUID();
  const requestReason = typeof body?.requestReason === "string"
    ? body.requestReason.slice(0, 80)
    : (body?.action || "analysis");
  const requestedImageProvider: ImageProvider | null =
    body?.imageProvider === "openai" || body?.imageProvider === "gemini"
      ? body.imageProvider
      : null;
  let imageProvider: ImageProvider = DEFAULT_IMAGE_PROVIDER;

  // Sólo una sesión profesional puede sobrescribir el proveedor del servidor.
  // Esto conserva el harness A/B sin permitir que un cliente público fuerce
  // una ruta distinta. La configuración predeterminada sí aplica por igual al
  // profesional y al prospecto, bajo los mismos topes server-side existentes.
  if (requestedImageProvider && user) {
    if (
      requestedImageProvider === "openai" &&
      DEFAULT_IMAGE_PROVIDER !== "openai" &&
      !OPENAI_IMAGE_EXPERIMENT_ENABLED
    ) {
      return new Response(JSON.stringify({ error: "La prueba OpenAI no está habilitada." }), {
        status: 403, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    imageProvider = requestedImageProvider;
  } else if (requestedImageProvider && requestedImageProvider !== DEFAULT_IMAGE_PROVIDER) {
    return new Response(JSON.stringify({ error: "La selección de proveedor requiere una sesión profesional." }), {
      status: 403, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (body?.action === "generate_image") {
    console.log(JSON.stringify({
      event: "image_provider_selected",
      requestId,
      defaultProvider: DEFAULT_IMAGE_PROVIDER,
      requestedProvider: requestedImageProvider,
      effectiveProvider: imageProvider,
      authenticatedOverride: Boolean(user && requestedImageProvider),
    }));
  }

  // La validación ocurre ANTES de consumir el límite del plan para que una
  // configuración incompleta nunca cobre un intento.
  if (body?.action === "generate_image" && imageProvider === "openai") {
    if (!Deno.env.get("OPENAI_API_KEY")) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY no configurada en Supabase Secrets" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  }

  // Tope de gasto server-side -- ver _shared/limits.ts.
  //
  // SOLO la generación de imagen descuenta del plan. Una sola simulación
  // hace 4+ llamadas a esta función (validar encuadre, analizar
  // proporciones, analizar fotos para el diagnóstico, generar la imagen) y
  // las llamadas de análisis pueden reintentarse ante fallos transitorios,
  // pero la generación de imagen requiere una nueva acción del usuario. Si
  // todas descontaran, un plan de 40 "diagnósticos"
  // daría ~10 simulaciones reales, y darle a "Reintentar" cerca del límite
  // consumiría MÁS cupo, que es justo lo contrario de lo que el dentista
  // espera. Las llamadas de análisis igual se verifican (clínica real,
  // activa, con cupo disponible) y siguen sujetas al tope por IP en modo
  // anónimo/prospecto -- simplemente no incrementan el contador.
  const esGeneracionImagen = body?.action === "generate_image";
  let limitCheck;
  if (esGeneracionImagen) {
    limitCheck = tenantHeaderProspecto
      ? await checkAndConsumeLimitProspecto(req, tenantHeaderProspecto, CORS)
      : await checkAndConsumeLimit(req, tenantEfectivo, CORS);
  } else if (tenantHeaderProspecto) {
    // Prospecto, llamada de análisis: no descuenta del plan, pero sí cuenta
    // contra el tope por IP -- si no, se podrían spamear análisis (que
    // cuestan Anthropic) usando el link público de una clínica sin tocar
    // nunca su contador.
    const porIp = await checkLimitPorIpProspecto(req, CORS);
    limitCheck = porIp.allowed ? await checkLimitSinConsumir(tenantEfectivo, CORS) : porIp;
  } else if (!user) {
    // Anónimo puro (sin sesión y sin link de clínica): el tope estricto por
    // IP aplica a TODAS sus llamadas, igual que antes de este cambio.
    limitCheck = await checkAndConsumeLimit(req, null, CORS);
  } else {
    limitCheck = await checkLimitSinConsumir(tenantEfectivo, CORS);
  }
  if (!limitCheck.allowed) return limitCheck.response!;
  marca("después del chequeo de límite");

  try {
    console.log("Llamada de:", user?.id, "-- tenant:", tenantEfectivo, "-- descuenta:", esGeneracionImagen, "-- request:", requestId);
    console.log("Body keys:", Object.keys(body).join(", "));

    // ── GENERAR IMAGEN (GEMINI CONTROL / OPENAI EXPERIMENTAL) ───────────────
    // El prompt (construido en simulacion.html/revision-clinica.html) es el
    // MISMO que se afinó para que funcionara bien con gpt-image-1 -- no se
    // toca, Gemini lo recibe tal cual como el resto del contenido.
    if (body.action === "generate_image") {
      const imageStartedAt = performance.now();
      const { imageBase64, mimeType = "image/jpeg", prompt = "Mejora la sonrisa dental con carillas naturales", guideImageBase64 = "", guideMimeType = "image/png" } = body;
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 requerido" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 400
        });
      }
      marca("después de leer imageBase64 del body");

      if (imageProvider === "openai") {
        const KEY = Deno.env.get("OPENAI_API_KEY")!;
        const promptOpenAI = guideImageBase64
          ? "INPUT IMAGE 1 is the patient smile crop to edit. INPUT IMAGE 2 is a geometric incisal-edge control map only. Follow its curve and labeled target points, but never render any map color, line, dot, label or black background. " + prompt
          : prompt;
        const form = new FormData();
        form.append("model", OPENAI_IMAGE_MODEL);
        form.append("image[]", new Blob([base64ABytes(imageBase64)], { type: mimeType }), "patient-smile.jpg");
        if (guideImageBase64) {
          form.append("image[]", new Blob([base64ABytes(guideImageBase64)], { type: guideMimeType }), "incisal-guide.png");
        }
        form.append("prompt", promptOpenAI);
        form.append("quality", "medium");
        form.append("size", "auto");
        form.append("output_format", "jpeg");
        form.append("output_compression", "90");

        console.log(JSON.stringify({
          event: "image_generation_attempt",
          requestId,
          requestReason,
          provider: "openai",
          model: OPENAI_IMAGE_MODEL,
          attempt: 1,
        }));

        try {
          const resp = await fetchConTimeout("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { "Authorization": `Bearer ${KEY}` },
            body: form,
          }, OPENAI_IMAGE_TIMEOUT_MS);
          marca(`después de recibir respuesta de OpenAI (status ${resp.status})`);
          const providerRequestId = resp.headers.get("x-request-id");
          const data = await resp.json();
          if (!resp.ok) {
            console.warn("OpenAI image edit error:", data?.error?.message || resp.status);
            return new Response(JSON.stringify({
              error: data?.error?.message || "OpenAI no pudo generar la imagen.",
              requestId,
              providerRequestId,
            }), { status: resp.status, headers: { ...CORS, "Content-Type": "application/json" } });
          }

          const generatedBase64 = data?.data?.[0]?.b64_json;
          if (!generatedBase64) {
            return new Response(JSON.stringify({
              error: "OpenAI respondió sin una imagen.", requestId, providerRequestId,
            }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
          }

          const elapsedMs = Math.round(performance.now() - imageStartedAt);
          const usage = data?.usage || null;
          console.log(JSON.stringify({
            event: "image_generation_success",
            requestId,
            requestReason,
            provider: "openai",
            model: OPENAI_IMAGE_MODEL,
            attempts: 1,
            elapsedMs,
            usage,
            providerRequestId,
          }));
          return new Response(JSON.stringify({
            imageBase64: generatedBase64,
            mimeType: "image/jpeg",
            source: "openai",
            model: OPENAI_IMAGE_MODEL,
            generation: {
              requestId,
              reason: requestReason,
              provider: "openai",
              model: OPENAI_IMAGE_MODEL,
              attempts: 1,
              attemptLimit: 1,
              elapsedMs,
              usage,
              providerRequestId,
            },
          }), { headers: { ...CORS, "Content-Type": "application/json" } });
        } catch (e: any) {
          const timeout = e?.name === "AbortError";
          console.warn("OpenAI image edit excepción:", e?.message || e);
          return new Response(JSON.stringify({
            error: timeout
              ? "OpenAI tardó más del límite experimental. No se realizó un segundo intento."
              : "No se pudo completar la prueba con OpenAI.",
            requestId,
          }), { status: timeout ? 504 : 502, headers: { ...CORS, "Content-Type": "application/json" } });
        }
      }

      const KEY = Deno.env.get("GEMINI_API_KEY");
      if (!KEY) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY no configurada en Supabase Secrets" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 500
        });
      }

      // Por defecto sólo se usa el primer modelo: no existen cobros ocultos
      // por reintentos automáticos. Si GEMINI_IMAGE_MAX_ATTEMPTS se configura
      // explícitamente por encima de 1, los modelos alternativos se prueban en
      // orden. Cada intento se corta a los 30s.
      let providerAttempts = 0;
      for (const model of GEMINI_IMAGE_MODELS.slice(0, GEMINI_IMAGE_MAX_ATTEMPTS)) {
        providerAttempts++;
        console.log(JSON.stringify({
          event: "image_generation_attempt",
          requestId,
          requestReason,
          provider: "gemini",
          model: model.name,
          attempt: providerAttempts,
        }));
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${KEY}`;
          const inputParts: any[] = [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ];
          if (guideImageBase64) {
            inputParts.push({ inline_data: { mime_type: guideMimeType, data: guideImageBase64 } });
          }
          inputParts.push({ text: guideImageBase64
            ? "INPUT IMAGE 1 is the patient smile crop to edit. INPUT IMAGE 2 is a geometric incisal-edge control map only. Follow its curve and labeled target points, but never render any map color, line, dot, label or black background. " + prompt
            : prompt });
          const gBody = {
            contents: [{
              parts: inputParts
            }],
            generationConfig: {
              responseModalities: model.modalities,
              temperature: 1,
            }
          };

          const resp = await fetchConTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gBody)
          }, 30000);
          marca(`después de recibir respuesta de Gemini ${model.name} (status ${resp.status})`);
          const data = await resp.json();

          if (!resp.ok) {
            console.warn(`Gemini ${model.name} error:`, data.error?.message);
            continue;
          }

          const parts = data.candidates?.[0]?.content?.parts ?? [];
          const imgPart = parts.find((p: any) => p.inlineData);
          if (!imgPart) {
            console.warn(`Gemini ${model.name}: sin imagen en respuesta`);
            continue;
          }

          const elapsedMs = Math.round(performance.now() - imageStartedAt);
          const usage = data.usageMetadata || null;
          console.log(JSON.stringify({
            event: "image_generation_success",
            requestId,
            requestReason,
            provider: "gemini",
            model: model.name,
            attempts: providerAttempts,
            elapsedMs,
            usage,
          }));
          return new Response(JSON.stringify({
            imageBase64: imgPart.inlineData.data,
            mimeType: imgPart.inlineData.mimeType || "image/png",
            source: "gemini",
            model: model.name,
            generation: {
              requestId,
              reason: requestReason,
              provider: "gemini",
              model: model.name,
              attempts: providerAttempts,
              attemptLimit: GEMINI_IMAGE_MAX_ATTEMPTS,
              elapsedMs,
              usage,
            },
          }), { headers: { ...CORS, "Content-Type": "application/json" } });

        } catch (e: any) {
          console.warn(`Gemini ${model.name} excepción:`, e.message);
          continue;
        }
      }

      return new Response(JSON.stringify({
        error: "Gemini no pudo generar la imagen. Revisa los logs.",
        requestId,
      }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 });
    }

    // ── CLAUDE / ANTHROPIC ─────────────────────────────────────────────────
    const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!CLAUDE_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
        headers: { ...CORS, "Content-Type": "application/json" }, status: 500
      });
    }

    let anthropicBody: any;
    if (body.messages) {
      anthropicBody = {
        model: body.model || "claude-opus-4-5",
        max_tokens: body.max_tokens || 4096,
        messages: body.messages,
      };
      if (body.system) anthropicBody.system = body.system;
    } else {
      const { systemPrompt, userMessage, imageBase64: imgB64, imageMimeType } = body;
      const msgText = (typeof userMessage === "string" && userMessage.trim())
        ? userMessage : "Analiza esta imagen clínica dental.";
      const messages = imgB64
        ? [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: imageMimeType || "image/jpeg", data: imgB64 } },
            { type: "text", text: msgText }
          ]}]
        : [{ role: "user", content: msgText }];
      anthropicBody = {
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: systemPrompt || "Eres un asistente dental especializado.",
        messages,
      };
    }

    console.log("Claude — modelo:", anthropicBody.model);
    const cuerpoSerializado = JSON.stringify(anthropicBody);
    marca(`después de serializar el body para Anthropic (${(cuerpoSerializado.length / 1024).toFixed(0)}KB)`);
    const cResp = await fetchConTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: cuerpoSerializado,
    }, 90000);
    marca("después de recibir respuesta de Anthropic (fetch)");
    const cData = await cResp.json();
    marca("después de parsear la respuesta de Anthropic");
    if (!cResp.ok) {
      console.error("Claude error:", JSON.stringify(cData));
      return new Response(JSON.stringify({ error: cData.error?.message || "Claude error" }), {
        headers: { ...CORS, "Content-Type": "application/json" }, status: 500
      });
    }
    return new Response(JSON.stringify(cData), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    // AbortError = lo cortó fetchConTimeout porque Anthropic no respondió a
    // tiempo (Gemini ya maneja sus propios timeouts/reintentos arriba, sin
    // llegar hasta acá) -- se distingue para que el mensaje sea claro en vez
    // de un genérico "AbortError" o "signal is aborted".
    const esTimeout = e?.name === "AbortError";
    console.error("Excepción:", e.message);
    return new Response(JSON.stringify({
      error: esTimeout ? "Claude no respondió a tiempo. Intenta de nuevo." : e.message
    }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
