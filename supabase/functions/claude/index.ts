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
const OPENAI_IMAGE_QUALITY =
  Deno.env.get("OPENAI_IMAGE_QUALITY")?.trim().toLowerCase() === "medium"
    ? "medium"
    : "high";
const OPENAI_IMAGE_TIMEOUT_MS = Math.min(
  85000,
  Math.max(30000, Number.parseInt(Deno.env.get("OPENAI_IMAGE_TIMEOUT_MS") || "75000", 10) || 75000),
);

function base64ABytes(base64: string): Uint8Array {
  const limpio = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  const binario = atob(limpio);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function dimensionesPng(bytes: Uint8Array): { width: number; height: number; hasAlpha: boolean } | null {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 26 || !firma.every((valor, indice) => bytes[indice] === valor)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = bytes[25];
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 };
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
  const simulationContract = typeof body?.contractVersion === "string"
    ? body.contractVersion.trim().slice(0, 32)
    : "legacy";
  const isMeasuredMaskOnlyContract = simulationContract === "v101" || simulationContract === "v102" || simulationContract === "v103";
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

  // v102/v103 son contratos cerrados: una sola fotografía PNG, máscara alfa
  // y geometría numérica de seis carillas. Si producción no está configurada
  // para GPT Image 2 o falta la máscara, se rechaza antes de descontar cuota.
  if (body?.action === "generate_image" && (simulationContract === "v102" || simulationContract === "v103")) {
    if (imageProvider !== "openai") {
      return new Response(JSON.stringify({ error: `El contrato ${simulationContract} requiere GPT Image 2; el proveedor de producción no está configurado.` }), {
        status: 503, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (!body?.editMaskBase64 || body?.mimeType !== "image/png" || body?.editMaskMimeType !== "image/png") {
      return new Response(JSON.stringify({ error: `El contrato ${simulationContract} requiere imagen PNG y máscara alfa PNG.` }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
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
      const {
        imageBase64,
        mimeType = "image/jpeg",
        prompt = "Mejora la sonrisa dental con carillas naturales",
        guideImageBase64 = "",
        guideMimeType = "image/png",
        editMaskBase64 = "",
        editMaskMimeType = "image/png",
      } = body;
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 requerido" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 400
        });
      }
      marca("después de leer imageBase64 del body");

      if (imageProvider === "openai") {
        const KEY = Deno.env.get("OPENAI_API_KEY")!;
        const imageBytes = base64ABytes(imageBase64);
        let editMaskBytes: Uint8Array | null = null;
        let guideImageBytes: Uint8Array | null = null;
        if (editMaskBase64) {
          editMaskBytes = base64ABytes(editMaskBase64);
          const imagePng = dimensionesPng(imageBytes);
          const maskPng = dimensionesPng(editMaskBytes);
          if (!imagePng || !maskPng || mimeType !== "image/png" || editMaskMimeType !== "image/png") {
            return new Response(JSON.stringify({ error: "La imagen y la máscara de edición deben ser PNG." }), {
              status: 400, headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
          if (imagePng.width !== maskPng.width || imagePng.height !== maskPng.height || !maskPng.hasAlpha) {
            return new Response(JSON.stringify({ error: "La máscara debe tener canal alfa y las mismas dimensiones que la imagen." }), {
              status: 400, headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
        }
        if (guideImageBase64 && !isMeasuredMaskOnlyContract) {
          guideImageBytes = base64ABytes(guideImageBase64);
          const imagePng = dimensionesPng(imageBytes);
          const guidePng = dimensionesPng(guideImageBytes);
          if (!imagePng || !guidePng || mimeType !== "image/png" || guideMimeType !== "image/png") {
            return new Response(JSON.stringify({ error: "La imagen y el plano geométrico deben ser PNG." }), {
              status: 400, headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
          if (imagePng.width !== guidePng.width || imagePng.height !== guidePng.height) {
            return new Response(JSON.stringify({ error: "El plano geométrico debe tener las mismas dimensiones que la imagen." }), {
              status: 400, headers: { ...CORS, "Content-Type": "application/json" },
            });
          }
        }
        const promptOpenAI = isMeasuredMaskOnlyContract
          ? (simulationContract === "v103"
            ? "V103 CROWN-ONLY DENTAL EDIT. The patient smile crop is the ONE AND ONLY visual reference; no second image or visual blueprint exists. Edit only the visible crowns of the six maxillary anterior veneers 13-12-11-21-22-23 inside the transparent alpha mask. The mask contains no gingiva: preserve all pink tissue and lips exactly as photographed. Follow the six numeric crown envelopes tooth by tooth. Preserve every unmasked pixel and every unlisted tooth. Never introduce outlines, diagrams, colored seams, rectangular patches, cut-out borders, labels or technical marks. " + prompt
            : simulationContract === "v102"
              ? "V102 CONTROLLED DENTAL EDIT. The patient smile crop is the ONE AND ONLY visual reference; no second image or visual blueprint exists. Edit only the six maxillary anterior veneers 13-12-11-21-22-23 inside the transparent alpha mask. Follow the six numeric crown envelopes in the prompt tooth by tooth. Preserve every unmasked pixel and every unlisted tooth. Never introduce outlines, diagrams, colored seams, cut-out borders, labels or technical marks. " + prompt
              : "INPUT IMAGE 1 is the only visual reference: the patient smile crop. The transparent edit mask is the absolute treatment boundary. Tooth-by-tooth geometry is provided only as numeric/text instructions in the prompt; there is no visual blueprint to copy. Render natural ceramic anatomy inside the editable area and never introduce outlines, diagrams, colored seams, cut-out borders or technical marks. " + prompt)
          : guideImageBase64
            ? "INPUT IMAGE 1 is the patient smile crop to edit. INPUT IMAGE 2 is an abstract black-background GEOMETRIC VENEER BLUEPRINT for maxillary teeth 13-12-11-21-22-23 only. Its six separate pale silhouettes define the intended crown hierarchy, individual widths, heights and incisal curve. Transfer only that geometry to the corresponding real teeth in IMAGE 1. The blueprint is not a photograph, material sample, segmentation mask or visible overlay. Never render its black background, gray fill, white outlines, control marks, colors, labels or diagram appearance. Use the original photograph for all texture, lighting, tissue and identity information. " + prompt
            : prompt;
        const form = new FormData();
        form.append("model", OPENAI_IMAGE_MODEL);
        form.append("image[]", new Blob([imageBytes], { type: mimeType }), mimeType === "image/png" ? "patient-smile.png" : "patient-smile.jpg");
        if (editMaskBytes) {
          form.append("mask", new Blob([editMaskBytes], { type: editMaskMimeType }), "treatment-mask.png");
        }
        if (guideImageBytes && !isMeasuredMaskOnlyContract) {
          form.append("image[]", new Blob([guideImageBytes], { type: guideMimeType }), "veneer-blueprint.png");
        }
        form.append("prompt", promptOpenAI);
        // Los acercamientos dentales son ediciones de detalle y anatomía fina.
        // Calidad alta es el valor de producción; `medium` queda disponible
        // como rollback server-side sin publicar una nueva app.
        form.append("quality", OPENAI_IMAGE_QUALITY);
        form.append("size", "auto");
        form.append("output_format", "jpeg");
        form.append("output_compression", "90");
        // Sin streaming, la conexión entre Supabase y OpenAI puede permanecer
        // completamente ociosa durante más de 30 s y algún intermediario la
        // reinicia antes de que termine la imagen. Las imágenes parciales
        // mantienen viva esa conexión; sólo se conserva y entrega la final.
        form.append("stream", "true");
        form.append("partial_images", "3");

        console.log(JSON.stringify({
          event: "image_generation_attempt",
          requestId,
          requestReason,
          provider: "openai",
          model: OPENAI_IMAGE_MODEL,
          quality: OPENAI_IMAGE_QUALITY,
          contract: simulationContract,
          guideMode: isMeasuredMaskOnlyContract ? "numeric-geometry-only" : (guideImageBytes ? "visual-blueprint" : "none"),
          attempt: 1,
        }));

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);
          let providerRequestId: string | null = null;
          let generatedBase64 = "";
          let usage: any = null;
          let partialCount = 0;
          let timeoutTransferidoAlStream = false;

          try {
            const resp = await fetch("https://api.openai.com/v1/images/edits", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${KEY}`,
                "Accept": "text/event-stream",
                // Permite a soporte de OpenAI localizar la solicitud incluso
                // si la red se corta antes de recibir su x-request-id.
                "X-Client-Request-Id": requestId,
              },
              body: form,
              signal: controller.signal,
            });
            marca(`después de recibir headers de OpenAI (status ${resp.status})`);
            providerRequestId = resp.headers.get("x-request-id");

            if (!resp.ok) {
              const raw = await resp.text();
              let data: any = null;
              try { data = JSON.parse(raw); } catch { /* respuesta no JSON */ }
              console.warn("OpenAI image edit error:", data?.error?.message || raw || resp.status);
              return new Response(JSON.stringify({
                error: data?.error?.message || "OpenAI no pudo generar la imagen.",
                requestId,
                providerRequestId,
              }), { status: resp.status, headers: { ...CORS, "Content-Type": "application/json" } });
            }

            const contentType = resp.headers.get("content-type") || "";
            if (
              (body?.responseMode === "stream" || body?.responseMode === "binary") &&
              contentType.toLowerCase().includes("text/event-stream") &&
              resp.body
            ) {
              const entregarComoJpeg = body?.responseMode === "binary";
              const upstreamReader = resp.body.getReader();
              const encoder = new TextEncoder();
              const downstream = new ReadableStream<Uint8Array>({
                start(output) {
                  let cerrado = false;
                  let completado = false;

                  const enviar = (tipo: string, payload: Record<string, unknown>) => {
                    if (cerrado) return;
                    const json = JSON.stringify({ type: tipo, ...payload });
                    if (!entregarComoJpeg) {
                      output.enqueue(encoder.encode(`event: ${tipo}\ndata: ${json}\n\n`));
                      return;
                    }
                    // JPEG permite comentarios COM entre SOI y los datos de la
                    // imagen. Safari recibe estos bytes como actividad real,
                    // pero el archivo final sigue siendo un JPEG estándar.
                    const comentario = encoder.encode(json);
                    const largo = Math.min(65533, comentario.byteLength) + 2;
                    const segmento = new Uint8Array(largo + 2);
                    segmento[0] = 0xff;
                    segmento[1] = 0xfe;
                    segmento[2] = (largo >> 8) & 0xff;
                    segmento[3] = largo & 0xff;
                    segmento.set(comentario.subarray(0, largo - 2), 4);
                    output.enqueue(segmento);
                  };

                  if (entregarComoJpeg) output.enqueue(new Uint8Array([0xff, 0xd8]));

                  enviar("image_generation.started", {
                    requestId,
                    provider: "openai",
                    model: OPENAI_IMAGE_MODEL,
                    quality: OPENAI_IMAGE_QUALITY,
                  });

                  const transfer = (async () => {
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let cantidadParciales = 0;

                    const procesarBloqueStream = (bloque: string) => {
                      const dataText = bloque
                        .split(/\r?\n/)
                        .filter((linea) => linea.startsWith("data:"))
                        .map((linea) => linea.slice(5).trimStart())
                        .join("\n");
                      if (!dataText || dataText === "[DONE]") return;

                      let evento: any;
                      try { evento = JSON.parse(dataText); } catch {
                        console.warn("Evento SSE de OpenAI inválido; se omitió.");
                        return;
                      }

                      if (evento?.type === "image_edit.partial_image") {
                        cantidadParciales += 1;
                        const elapsedMs = Math.round(performance.now() - imageStartedAt);
                        const partialImageIndex = evento?.partial_image_index ?? cantidadParciales - 1;
                        console.log(JSON.stringify({
                          event: "image_generation_stream_progress",
                          requestId,
                          partialImageIndex,
                          partialCount: cantidadParciales,
                          elapsedMs,
                        }));
                        // El avance mantiene viva la conexión móvil. La imagen
                        // parcial no se reenvía: sólo viaja el JPEG final.
                        enviar("image_generation.progress", {
                          requestId,
                          partialImageIndex,
                          partialCount: cantidadParciales,
                          elapsedMs,
                        });
                        return;
                      }

                      if (evento?.type === "image_edit.completed") {
                        const finalBase64 = evento?.b64_json || "";
                        if (!finalBase64) return;
                        const elapsedMs = Math.round(performance.now() - imageStartedAt);
                        const finalUsage = evento?.usage || null;
                        const generation = {
                          requestId,
                          reason: requestReason,
                          provider: "openai",
                          model: OPENAI_IMAGE_MODEL,
                          quality: OPENAI_IMAGE_QUALITY,
                          attempts: 1,
                          attemptLimit: 1,
                          partialCount: cantidadParciales,
                          elapsedMs,
                          usage: finalUsage,
                          providerRequestId,
                          contract: simulationContract,
                        };
                        console.log(JSON.stringify({
                          event: "image_generation_success",
                          requestId,
                          requestReason,
                          provider: "openai",
                          model: OPENAI_IMAGE_MODEL,
                          quality: OPENAI_IMAGE_QUALITY,
                          attempts: 1,
                          partialCount: cantidadParciales,
                          elapsedMs,
                          usage: finalUsage,
                          providerRequestId,
                        }));
                        console.log(JSON.stringify({
                          event: "image_delivery_stream",
                          requestId,
                          estimatedBytes: Math.floor(finalBase64.length * 3 / 4),
                        }));
                        if (entregarComoJpeg) {
                          const finalBytes = base64ABytes(finalBase64);
                          if (finalBytes[0] !== 0xff || finalBytes[1] !== 0xd8) {
                            throw new Error("OpenAI devolvió bytes sin cabecera JPEG.");
                          }
                          // SOI ya se envió antes de los comentarios keepalive.
                          output.enqueue(finalBytes.subarray(2));
                        } else {
                          enviar("image_generation.completed", {
                            requestId,
                            imageBase64: finalBase64,
                            mimeType: "image/jpeg",
                            source: "openai",
                            model: OPENAI_IMAGE_MODEL,
                            generation,
                          });
                        }
                        completado = true;
                      }
                    };

                    while (true) {
                      const { value, done } = await upstreamReader.read();
                      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
                      let separador: RegExpExecArray | null;
                      while ((separador = /\r?\n\r?\n/.exec(buffer)) !== null) {
                        const bloque = buffer.slice(0, separador.index);
                        buffer = buffer.slice(separador.index + separador[0].length);
                        procesarBloqueStream(bloque);
                      }
                      if (done) break;
                    }
                    if (buffer.trim()) procesarBloqueStream(buffer);
                    if (!completado) throw new Error("OpenAI terminó el stream sin una imagen final.");
                  })().catch((e: any) => {
                    console.warn("OpenAI image stream excepción:", e?.message || e);
                    try {
                      enviar("image_generation.error", {
                        requestId,
                        status: e?.name === "AbortError" ? 504 : 502,
                        error: e?.name === "AbortError"
                          ? "OpenAI tardó más del límite de la simulación."
                          : "El servicio de imagen no terminó la respuesta.",
                      });
                    } catch { /* el cliente ya cerró la conexión */ }
                  }).finally(() => {
                    clearTimeout(timeoutId);
                    cerrado = true;
                    try { output.close(); } catch { /* conexión ya cerrada */ }
                  });

                  // Supabase puede retirar un worker que parece ocioso después
                  // de devolver Response. Se vincula toda la transferencia al
                  // ciclo de vida oficial de la Edge Function.
                  EdgeRuntime.waitUntil(transfer);
                },
                cancel() {
                  clearTimeout(timeoutId);
                  try { upstreamReader.cancel("cliente desconectado"); } catch { /* ya cerrado */ }
                },
              });

              timeoutTransferidoAlStream = true;
              return new Response(downstream, {
                headers: {
                  ...CORS,
                  "Cache-Control": "no-cache, no-store",
                  "Content-Type": entregarComoJpeg ? "image/jpeg" : "text/event-stream; charset=utf-8",
                  "X-Accel-Buffering": "no",
                  "Access-Control-Expose-Headers": "x-smyl-request-id, x-smyl-provider, x-smyl-model, x-smyl-quality, x-smyl-contract, x-smyl-provider-request-id",
                  "X-SMYL-Request-Id": requestId,
                  "X-SMYL-Provider": "openai",
                  "X-SMYL-Model": OPENAI_IMAGE_MODEL,
                  "X-SMYL-Quality": OPENAI_IMAGE_QUALITY,
                  "X-SMYL-Contract": simulationContract,
                  "X-SMYL-Provider-Request-Id": providerRequestId || "",
                },
              });
            }

            if (!contentType.toLowerCase().includes("text/event-stream")) {
              // Compatibilidad defensiva si el proveedor ignora `stream`.
              const data = await resp.json();
              generatedBase64 = data?.data?.[0]?.b64_json || "";
              usage = data?.usage || null;
            } else if (resp.body) {
              const reader = resp.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              const procesarBloque = (bloque: string) => {
                const dataText = bloque
                  .split(/\r?\n/)
                  .filter((linea) => linea.startsWith("data:"))
                  .map((linea) => linea.slice(5).trimStart())
                  .join("\n");
                if (!dataText || dataText === "[DONE]") return;

                let evento: any;
                try { evento = JSON.parse(dataText); } catch {
                  console.warn("Evento SSE de OpenAI inválido; se omitió.");
                  return;
                }

                if (evento?.type === "image_edit.partial_image") {
                  partialCount += 1;
                  console.log(JSON.stringify({
                    event: "image_generation_stream_progress",
                    requestId,
                    partialImageIndex: evento?.partial_image_index ?? partialCount - 1,
                    partialCount,
                    elapsedMs: Math.round(performance.now() - imageStartedAt),
                  }));
                } else if (evento?.type === "image_edit.completed") {
                  generatedBase64 = evento?.b64_json || "";
                  usage = evento?.usage || null;
                }
              };

              while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

                let separador: RegExpExecArray | null;
                while ((separador = /\r?\n\r?\n/.exec(buffer)) !== null) {
                  const bloque = buffer.slice(0, separador.index);
                  buffer = buffer.slice(separador.index + separador[0].length);
                  procesarBloque(bloque);
                }

                if (done) break;
              }
              if (buffer.trim()) procesarBloque(buffer);
            }
          } finally {
            if (!timeoutTransferidoAlStream) clearTimeout(timeoutId);
          }

          if (!generatedBase64) {
            return new Response(JSON.stringify({
              error: "OpenAI respondió sin una imagen.", requestId, providerRequestId,
            }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
          }

          const elapsedMs = Math.round(performance.now() - imageStartedAt);
          console.log(JSON.stringify({
            event: "image_generation_success",
            requestId,
            requestReason,
            provider: "openai",
            model: OPENAI_IMAGE_MODEL,
            quality: OPENAI_IMAGE_QUALITY,
            attempts: 1,
            partialCount,
            elapsedMs,
            usage,
            providerRequestId,
          }));
          const generation = {
            requestId,
            reason: requestReason,
            provider: "openai",
            model: OPENAI_IMAGE_MODEL,
            quality: OPENAI_IMAGE_QUALITY,
            attempts: 1,
            attemptLimit: 1,
            elapsedMs,
            usage,
            providerRequestId,
            contract: simulationContract,
          };

          // El JSON con b64_json aumenta el JPEG cerca de 33 % y obliga a
          // Safari/iOS a mantener simultáneamente el texto, el objeto parseado
          // y la imagen. El cliente actual pide binario para recibir el JPEG
          // directamente; el modo JSON se conserva para versiones antiguas.
          if (body?.responseMode === "binary") {
            const generatedBytes = base64ABytes(generatedBase64);
            console.log(JSON.stringify({
              event: "image_delivery_binary",
              requestId,
              bytes: generatedBytes.byteLength,
            }));
            return new Response(generatedBytes, {
              headers: {
                ...CORS,
                "Access-Control-Expose-Headers": "x-smyl-request-id, x-smyl-provider, x-smyl-model, x-smyl-quality, x-smyl-contract, x-smyl-elapsed-ms, x-smyl-provider-request-id",
                "Cache-Control": "no-store",
                "Content-Type": "image/jpeg",
                "X-SMYL-Request-Id": requestId,
                "X-SMYL-Provider": "openai",
                "X-SMYL-Model": OPENAI_IMAGE_MODEL,
                "X-SMYL-Quality": OPENAI_IMAGE_QUALITY,
                "X-SMYL-Contract": simulationContract,
                "X-SMYL-Elapsed-Ms": String(elapsedMs),
                "X-SMYL-Provider-Request-Id": providerRequestId || "",
              },
            });
          }
          return new Response(JSON.stringify({
            imageBase64: generatedBase64,
            mimeType: "image/jpeg",
            source: "openai",
            model: OPENAI_IMAGE_MODEL,
            generation,
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
          const geminiGuideEnabled = Boolean(guideImageBase64) && !isMeasuredMaskOnlyContract;
          if (geminiGuideEnabled) {
            inputParts.push({ inline_data: { mime_type: guideMimeType, data: guideImageBase64 } });
          }
          inputParts.push({ text: geminiGuideEnabled
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
              contract: simulationContract,
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
