// supabase/functions/segment-teeth/index.ts
//
// VERSIÓN 9 -- GPT Image 2 reemplaza al SAM 3 generalista de Replicate.
// GPT produce una máscara binaria alineada con el recorte; esta función la
// convierte de forma determinista en componentes individuales, calcula cajas,
// conserva la notación FDI y publica exactamente el mismo contrato `masks` que
// ya consumen la simulación pública y el editor clínico.
//
// Uso:
//   { imageUrl, casoId, tenantId, target: "tooth" }  <- default, como antes
//   { imageUrl, casoId, tenantId, target: "gum" }    <- nuevo
//
// Para "gum" NO se asigna notación FDI (no aplica), solo se numeran por
// índice y se guardan en una columna separada (segmentacion_encia) para
// no pisar la segmentación de dientes ya guardada.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { checkAndConsumeLimit, checkAndConsumeLimitProspecto } from "../_shared/limits.ts";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import {
  calculateGptCanvas,
  calculateOutputSize,
  cropBitmapToSource,
  extractMaskComponents,
} from "./mask-utils.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_SEGMENTATION_MODEL =
  Deno.env.get("OPENAI_SEGMENTATION_MODEL") || "gpt-image-2-2026-04-21";
const configuredQuality = (Deno.env.get("OPENAI_SEGMENTATION_QUALITY") || "medium").toLowerCase();
const OPENAI_SEGMENTATION_QUALITY = ["low", "medium", "high"].includes(configuredQuality)
  ? configuredQuality
  : "medium";
const configuredTimeout = Number(Deno.env.get("OPENAI_SEGMENTATION_TIMEOUT_MS") || "120000");
const OPENAI_SEGMENTATION_TIMEOUT_MS = Number.isFinite(configuredTimeout)
  ? Math.max(30_000, Math.min(150_000, configuredTimeout))
  : 120_000;
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY las inyecta Supabase sola en toda
// Edge Function; SB_URL / SB_SERVICE_ROLE_KEY son secrets manuales que
// existían en el proyecto viejo (el prefijo SUPABASE_ está reservado y no se
// puede definir a mano). Este archivo leía SOLO los manuales, que nunca se
// configuraron en el proyecto "Smyl" -- createClient recibía cadenas vacías
// y reventaba con "supabaseUrl is required" en cada llamada. No se notó
// antes porque hasta hace poco nada del flujo normal llamaba a esta función;
// ahora la composición de la simulación la usa en cada caso.
// Mismo orden de preferencia que _shared/auth.ts y _shared/limits.ts.
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const STORAGE_BUCKET = "camila-masks";

const IOU_THRESHOLD = 0.3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-id",
};

type Target = "tooth" | "gum";

interface Candidate {
  bbox: [number, number, number, number];
  pixelCount: number;
  fileData: Uint8Array;
  contentType: "image/svg+xml";
  fileExtension: "svg";
}

interface RegionMask {
  index: number;
  bbox: [number, number, number, number];
  pixelCount: number;
  maskUrl: string;
  fdi: string | null;       // null siempre para "gum"
  parentFdi: string | null; // null siempre para "gum"
}

function promptParaTarget(target: Target): string {
  if (target === "gum") {
    return [
      "Create a pixel-aligned binary semantic segmentation mask of the visible gingiva in the supplied dental photograph.",
      "Keep exactly the same canvas, crop, scale, perspective and position as the input.",
      "Black padding may surround the photograph; keep that padding pure black and never segment it.",
      "Output pure white (#FFFFFF) only where visible pink gingival tissue exists and pure black (#000000) everywhere else.",
      "Exclude teeth, lips, tongue, skin, shadows, instruments and background.",
      "Use flat solid fills: no texture, gradients, antialias haze, outlines, labels, symbols or explanatory text.",
    ].join(" ");
  }
  return [
    "Create a pixel-aligned binary instance-style segmentation mask of every visible human tooth in the supplied dental photograph.",
    "If the image contains two side-by-side panels, preserve both panels exactly and segment each panel independently without moving or merging them across the center seam.",
    "Keep exactly the same canvas, crop, scale, perspective and tooth positions as the input.",
    "Black padding may surround the photograph; keep that padding pure black and never segment it.",
    "Output pure white (#FFFFFF) only on visible dental crown/enamel surfaces and pure black (#000000) everywhere else.",
    "Exclude gingiva, lips, tongue, skin, oral cavity, shadows, braces, instruments and background.",
    "Keep each visible tooth as an individually separated white component with a narrow black interproximal boundary at real tooth contacts.",
    "Do not invent, enlarge, straighten or reshape any tooth. Do not create a smile design.",
    "Use flat solid fills: no texture, gradients, colored regions, outlines, labels, symbols or explanatory text.",
  ].join(" ");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadSourceImage(imageUrl: string) {
  let bytes: Uint8Array;
  let mimeType = "image/jpeg";
  const dataMatch = imageUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s);
  if (dataMatch) {
    mimeType = dataMatch[1] || mimeType;
    bytes = base64ToBytes(dataMatch[2]);
  } else {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`No se pudo leer la imagen dental (${response.status}).`);
    mimeType = (response.headers.get("content-type") || mimeType).split(";")[0];
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  if (!mimeType.startsWith("image/") || !bytes.byteLength) {
    throw new Error("La entrada de segmentación no es una imagen válida.");
  }
  const decoded = await decodeImage(bytes);
  return { bytes, mimeType, width: decoded.width, height: decoded.height, decoded };
}

interface GptMaskResult {
  bytes: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  sourceX: number;
  sourceY: number;
  padded: boolean;
  usage: unknown;
  providerRequestId: string | null;
  partialCount: number;
}

async function callOpenAIMask(
  imageUrl: string,
  target: Target,
  requestId: string,
  onProgress: (payload: Record<string, unknown>) => void,
): Promise<GptMaskResult> {
  const source = await loadSourceImage(imageUrl);
  const canvas = calculateGptCanvas(source.width, source.height);
  let inputBytes = source.bytes;
  let inputMimeType = source.mimeType;
  if (canvas.padded) {
    const paddedImage = new Image(canvas.width, canvas.height);
    paddedImage.fill(0x000000ff);
    paddedImage.composite(source.decoded, canvas.sourceX, canvas.sourceY);
    inputBytes = await paddedImage.encode(1);
    inputMimeType = "image/png";
  }
  const outputSize = calculateOutputSize(canvas.width, canvas.height);
  const form = new FormData();
  form.append("model", OPENAI_SEGMENTATION_MODEL);
  form.append(
    "image[]",
    new Blob([inputBytes], { type: inputMimeType }),
    inputMimeType === "image/png" ? "dental-input.png" : "dental-input.jpg",
  );
  form.append("prompt", promptParaTarget(target));
  form.append("quality", OPENAI_SEGMENTATION_QUALITY);
  form.append("size", outputSize.value);
  form.append("output_format", "png");
  form.append("background", "opaque");
  form.append("stream", "true");
  form.append("partial_images", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_SEGMENTATION_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        Accept: "text/event-stream",
        "X-Client-Request-Id": requestId,
      },
      body: form,
      signal: controller.signal,
    });
    const providerRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw;
      try { detail = JSON.parse(raw)?.error?.message || raw; } catch { /* respuesta no JSON */ }
      throw new Error(`OpenAI segmentation error ${response.status}: ${detail || "sin detalle"}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    let finalBase64 = "";
    let usage: unknown = null;
    let partialCount = 0;

    if (!contentType.includes("text/event-stream")) {
      const data = await response.json();
      finalBase64 = data?.data?.[0]?.b64_json || "";
      usage = data?.usage || null;
    } else if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const processBlock = (block: string) => {
        const dataText = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!dataText || dataText === "[DONE]") return;
        let event: any;
        try { event = JSON.parse(dataText); } catch { return; }
        if (event?.type === "image_edit.partial_image") {
          partialCount++;
          onProgress({
            event: "gpt_segmentation_progress",
            requestId,
            partialCount,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        } else if (event?.type === "image_edit.completed") {
          finalBase64 = event?.b64_json || finalBase64;
          usage = event?.usage || usage;
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let separator: RegExpExecArray | null;
        while ((separator = /\r?\n\r?\n/.exec(buffer)) !== null) {
          const block = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          processBlock(block);
        }
        if (done) break;
      }
      if (buffer.trim()) processBlock(buffer);
    }

    if (!finalBase64) throw new Error("OpenAI terminó la segmentación sin entregar una máscara final.");
    const bytes = base64ToBytes(finalBase64);
    const decoded = await decodeImage(bytes);
    console.log(JSON.stringify({
      event: "gpt_segmentation_success",
      requestId,
      target,
      model: OPENAI_SEGMENTATION_MODEL,
      quality: OPENAI_SEGMENTATION_QUALITY,
      sourceSize: `${source.width}x${source.height}`,
      inputCanvas: `${canvas.width}x${canvas.height}`,
      padded: canvas.padded,
      outputSize: `${decoded.width}x${decoded.height}`,
      partialCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      usage,
      providerRequestId,
    }));
    return {
      bytes,
      maskWidth: decoded.width,
      maskHeight: decoded.height,
      sourceWidth: source.width,
      sourceHeight: source.height,
      inputWidth: canvas.width,
      inputHeight: canvas.height,
      sourceX: canvas.sourceX,
      sourceY: canvas.sourceY,
      padded: canvas.padded,
      usage,
      providerRequestId,
      partialCount,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function computeIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const interX1 = Math.max(ax, bx), interY1 = Math.max(ay, by);
  const interX2 = Math.min(ax + aw, bx + bw), interY2 = Math.min(ay + ah, by + bh);
  const interW = Math.max(0, interX2 - interX1), interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;
  const unionArea = aw * ah + bw * bh - interArea;
  return unionArea === 0 ? 0 : interArea / unionArea;
}

// Nota: para "gum" esto casi no elimina nada -- las 9 islas de encía
// normalmente no se traslapan entre sí (son regiones separadas por los
// dientes), así que sobreviven todas. Es seguro reutilizar la misma
// función para ambos casos.
function applyNMS(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.pixelCount - a.pixelCount);
  const kept: Candidate[] = [];
  for (const cand of sorted) {
    if (!kept.some((k) => computeIoU(cand.bbox, k.bbox) > IOU_THRESHOLD)) kept.push(cand);
  }
  return kept;
}

// Descarta detecciones que probablemente son VARIOS dientes fusionados en
// una sola caja (el modelo a veces no separa bien dientes muy juntos).
// Se detecta comparando el ancho contra la mediana de los demás -- un
// diente real no debería ser 2x+ más ancho que el resto. SOLO aplica a
// "tooth" -- la encía es naturalmente irregular y grande, no se filtra.
//
// AJUSTE v8: la mediana de ancho se calcula SOLO entre candidatos de
// tamaño "normal" (por encima de la mediana de píxeles), no entre TODOS.
// Antes, cuando había muchos fragmentos chiquitos de ruido, esos bajaban
// la mediana de ancho artificialmente y terminaban descartando dientes
// completos y normales por "parecer" demasiado anchos en la comparación.
function filtrarBlobsFusionados(candidates: Candidate[]): Candidate[] {
  if (candidates.length < 3) return candidates; // muy pocos datos para juzgar

  const pixelCounts = candidates.map((c) => c.pixelCount).sort((a, b) => a - b);
  const medianaPixeles = pixelCounts[Math.floor(pixelCounts.length / 2)];
  const referencia = candidates.filter((c) => c.pixelCount >= medianaPixeles);
  const anchosReferencia = referencia.map((c) => c.bbox[2]).sort((a, b) => a - b);
  if (anchosReferencia.length < 2) return candidates;

  const medianaAncho = anchosReferencia[Math.floor(anchosReferencia.length / 2)];
  const LIMITE = 2.2; // qué tanto más ancho que la mediana se tolera

  return candidates.filter((c) => c.bbox[2] <= medianaAncho * LIMITE);
}

// --- Mapeo FDI: SOLO se aplica cuando target === "tooth" ---
function assignFdiNotation(survivors: Candidate[]) {
  const width = Math.max(...survivors.map((m) => m.bbox[0] + m.bbox[2])) + 20;
  const midlineX = width / 2;

  const withCenters = survivors.map((m) => ({
    ...m,
    cx: m.bbox[0] + m.bbox[2] / 2,
    cy: m.bbox[1] + m.bbox[3] / 2,
    fdi: null as string | null,
    parentFdi: null as string | null,
  }));

  const sortedByY = [...withCenters].sort((a, b) => a.cy - b.cy);
  let maxGap = 0, splitAt = 0;
  for (let i = 1; i < sortedByY.length; i++) {
    const gap = sortedByY[i].cy - sortedByY[i - 1].cy;
    if (gap > maxGap) { maxGap = gap; splitAt = i; }
  }
  const upperRow = sortedByY.slice(0, splitAt);
  const lowerRow = sortedByY.slice(splitAt);

  // AJUSTE v8: antes se usaba un umbral FIJO (PRIMARY_PIXEL_THRESHOLD =
  // 450px) para decidir "diente principal" vs "fragmento" -- no se
  // adaptaba a fotos donde los dientes salen más chicos o más grandes en
  // píxeles (según el encuadre/distancia), así que dientes completos y
  // reales podían quedar mal clasificados como fragmentos. Ahora el
  // umbral es RELATIVO al tamaño típico de blob en ESTA fila de ESTA foto.
  function numberRow(row: typeof withCenters, quadRight: number, quadLeft: number) {
    const pixelCounts = row.map((m) => m.pixelCount).sort((a, b) => a - b);
    const medianaFila = pixelCounts.length ? pixelCounts[Math.floor(pixelCounts.length / 2)] : 0;
    const umbralPrimario = Math.max(80, medianaFila * 0.4);

    const primary = row.filter((m) => m.pixelCount >= umbralPrimario);
    const fragments = row.filter((m) => m.pixelCount < umbralPrimario);

    const right = primary.filter((m) => m.cx < midlineX).sort((a, b) => (midlineX - a.cx) - (midlineX - b.cx));
    const left = primary.filter((m) => m.cx >= midlineX).sort((a, b) => (a.cx - midlineX) - (b.cx - midlineX));

    right.forEach((m, i) => (m.fdi = `${quadRight}${i + 1}`));
    left.forEach((m, i) => (m.fdi = `${quadLeft}${i + 1}`));

    fragments.forEach((f) => {
      let nearest: typeof primary[0] | null = null;
      let minDist = Infinity;
      primary.forEach((p) => {
        const d = Math.hypot(f.cx - p.cx, f.cy - p.cy);
        if (d < minDist) { minDist = d; nearest = p; }
      });
      f.parentFdi = nearest ? (nearest as any).fdi : null;
    });

    return [...primary, ...fragments];
  }

  const upperResult = numberRow(upperRow, 1, 2);
  const lowerResult = numberRow(lowerRow, 4, 3);

  return [...upperResult, ...lowerResult];
}

// Para "gum" no hay FDI -- solo se ordenan de izquierda a derecha y se
// numeran por índice, sin la lógica de dientes/fragmentos.
function tagAsGum(survivors: Candidate[]) {
  const sorted = [...survivors].sort((a, b) => a.bbox[0] - b.bbox[0]);
  return sorted.map((m) => ({ ...m, fdi: null as string | null, parentFdi: null as string | null }));
}

async function uploadAll(
  taggedMasks: Array<Candidate & { fdi: string | null; parentFdi: string | null }>,
  supabase: ReturnType<typeof createClient>,
  casoId: string,
  target: Target
): Promise<RegionMask[]> {
  const folder = casoId || `sin-caso-${Date.now()}`;
  const prefix = target === "gum" ? "gum_mask" : "mask";
  const masks: RegionMask[] = [];

  for (let i = 0; i < taggedMasks.length; i++) {
    const cand = taggedMasks[i];
    const path = `${folder}/${prefix}_${i}.${cand.fileExtension}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, cand.fileData, { contentType: cand.contentType, upsert: true });

    if (uploadError) {
      console.error(`Error subiendo ${path}:`, uploadError);
      continue;
    }

    // El bucket es privado -- esta función corre con el service role (se
    // salta RLS), así que puede firmar la URL aunque el cliente que la
    // recibe no tenga permiso directo sobre el objeto.
    const { data: signedUrlData, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (signError) {
      console.error(`Error firmando ${path}:`, signError);
      continue;
    }

    masks.push({
      index: i,
      bbox: cand.bbox,
      pixelCount: cand.pixelCount,
      maskUrl: signedUrlData.signedUrl,
      fdi: cand.fdi,
      parentFdi: cand.parentFdi,
    });
  }

  return masks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Falta de configuración, no del usuario: sin esto el fallo salía como
  // "supabaseUrl is required" o como un error crudo del proveedor a media
  // simulación, imposible de diagnosticar desde el celular de la doctora.
  const faltantes: string[] = [];
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) faltantes.push("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
  if (!OPENAI_API_KEY) faltantes.push("OPENAI_API_KEY");
  if (faltantes.length) {
    console.error("[segment-teeth] faltan secrets:", faltantes.join(", "));
    return new Response(
      JSON.stringify({ error: "La segmentación no está configurada en el servidor (falta " + faltantes.join(" y ") + "). Avisa a soporte." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Esta función gasta créditos de GPT Image y escribe en camila_casos con el
  // service role (que se salta RLS). Sin esta verificación aceptaba cualquier
  // POST sin credenciales.
  const { user, tenantId: tenantIdSesion, response: authError } = await requireUser(req, corsHeaders);
  if (authError) return authError;

  // Tope de gasto server-side -- ver _shared/limits.ts. GPT Image también
  // cuesta dinero real por llamada, igual que la generación principal en
  // claude/index.ts. tenantIdSesion viene resuelto por requireUser()
  // (distingue dueño de staff, ver _shared/auth.ts) -- NUNCA usar
  // user?.id directo aquí, un staff tiene su propio auth.uid(), distinto
  // al id de su clínica.
  const tenantHeaderProspecto = user ? null : req.headers.get("x-tenant-id");
  const { allowed, response: limitError } = tenantHeaderProspecto
    ? await checkAndConsumeLimitProspecto(req, tenantHeaderProspecto, corsHeaders)
    : await checkAndConsumeLimit(req, tenantIdSesion, corsHeaders);
  if (!allowed) return limitError!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "El cuerpo de segmentación no es JSON válido." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { imageUrl, casoId, tenantId: tenantIdBody, target: targetRaw } = body || {};
  const target: Target = targetRaw === "gum" ? "gum" : "tooth";
  if (!imageUrl) {
    return new Response(JSON.stringify({ error: "imageUrl es requerido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // requireUser ya garantiza que hay una sesión real llegados a este punto.
  // tenantIdSesion mantiene unidos los casos creados por dueño y staff.
  const tenantId = tenantIdSesion || tenantIdBody || null;
  const requestId = typeof body?.requestId === "string" && body.requestId.trim()
    ? body.requestId.trim().slice(0, 120)
    : crypto.randomUUID();
  const encoder = new TextEncoder();
  let clienteCerro = false;

  const responseStream = new ReadableStream<Uint8Array>({
    start(output) {
      // El espacio inicial y los keepalives posteriores son JSON válido como
      // whitespace. resp.json()/JSON.parse siguen funcionando, pero Safari ya
      // no mantiene una conexión completamente ociosa mientras GPT procesa.
      output.enqueue(encoder.encode(" \n"));
      const heartbeat = setInterval(() => {
        if (!clienteCerro) {
          try { output.enqueue(encoder.encode(" \n")); } catch { /* conexión cerrada */ }
        }
      }, 8_000);

      const work = (async () => {
        try {
          console.log(JSON.stringify({
            event: "gpt_segmentation_attempt",
            requestId,
            target,
            model: OPENAI_SEGMENTATION_MODEL,
            quality: OPENAI_SEGMENTATION_QUALITY,
          }));
          const gptMask = await callOpenAIMask(imageUrl, target, requestId, (progress) => {
            console.log(JSON.stringify(progress));
            if (!clienteCerro) {
              try { output.enqueue(encoder.encode(" \n")); } catch { /* conexión cerrada */ }
            }
          });
          const decodedMask = await decodeImage(gptMask.bytes);
          const sourceMask = cropBitmapToSource(
            gptMask.maskWidth,
            gptMask.maskHeight,
            decodedMask.bitmap,
            gptMask.inputWidth,
            gptMask.inputHeight,
            gptMask.sourceX,
            gptMask.sourceY,
            gptMask.sourceWidth,
            gptMask.sourceHeight,
          );
          const allCandidates = extractMaskComponents(
            sourceMask.width,
            sourceMask.height,
            sourceMask.bitmap,
            gptMask.sourceWidth,
            gptMask.sourceHeight,
          ) as Candidate[];
          if (!allCandidates.length) {
            throw new Error("GPT no separó ningún componente dental utilizable.");
          }

          const survivors = applyNMS(allCandidates);
          const survivorsFiltrados = target === "tooth" ? filtrarBlobsFusionados(survivors) : survivors;
          if (!survivorsFiltrados.length) {
            throw new Error("GPT no dejó componentes dentales válidos después del control geométrico.");
          }
          const tagged = target === "gum" ? tagAsGum(survivorsFiltrados) : assignFdiNotation(survivorsFiltrados);
          const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
          const masks = await uploadAll(tagged, supabase, casoId, target);
          if (masks.length !== tagged.length) {
            throw new Error("No fue posible publicar todas las máscaras dentales generadas.");
          }

          if (casoId && tenantId) {
            const columnaDestino = target === "gum" ? "segmentacion_encia" : "segmentacion";
            const { error: dbError } = await supabase
              .from("camila_casos")
              .update({
                [columnaDestino]: {
                  masks,
                  generatedAt: new Date().toISOString(),
                  provider: "openai",
                  model: OPENAI_SEGMENTATION_MODEL,
                },
              })
              .eq("id", casoId)
              .eq("tenant_id", tenantId);
            if (dbError) console.error(`Error guardando segmentación (${target}):`, dbError);
          }

          const payload = {
            requestId,
            target,
            masks,
            count: masks.length,
            totalDetectedBeforeNMS: allCandidates.length,
            provider: "openai",
            model: OPENAI_SEGMENTATION_MODEL,
            quality: OPENAI_SEGMENTATION_QUALITY,
            providerRequestId: gptMask.providerRequestId,
          };
          console.log(JSON.stringify({
            event: "gpt_segmentation_delivery",
            requestId,
            target,
            count: masks.length,
            totalDetectedBeforeNMS: allCandidates.length,
          }));
          if (!clienteCerro) output.enqueue(encoder.encode(JSON.stringify(payload)));
        } catch (err) {
          console.error(`[segment-teeth] ${requestId} error procesando la segmentación GPT:`, err);
          const message = (err as Error)?.name === "AbortError"
            ? "La segmentación dental con GPT tardó más del límite permitido."
            : "La segmentación dental con GPT no produjo una máscara utilizable. Intenta nuevamente sin repetir tus fotografías.";
          if (!clienteCerro) {
            try {
              output.enqueue(encoder.encode(JSON.stringify({
                error: message,
                errorCode: "GPT_SEGMENTATION_FAILED",
                requestId,
              })));
            } catch { /* conexión cerrada */ }
          }
        } finally {
          clearInterval(heartbeat);
          if (!clienteCerro) {
            try { output.close(); } catch { /* conexión cerrada */ }
          }
        }
      })();

      (globalThis as any).EdgeRuntime?.waitUntil?.(work);
    },
    cancel() {
      clienteCerro = true;
    },
  });

  return new Response(responseStream, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Access-Control-Expose-Headers": "x-smyl-request-id, x-smyl-provider, x-smyl-model",
      "X-SMYL-Request-Id": requestId,
      "X-SMYL-Provider": "openai",
      "X-SMYL-Model": OPENAI_SEGMENTATION_MODEL,
    },
  });
});
