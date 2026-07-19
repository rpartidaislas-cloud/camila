// supabase/functions/segment-teeth/index.ts
//
// VERSIÓN 8 -- ajusta la clasificación diente-principal-vs-fragmento para
// que ya no dependa de un número fijo de píxeles (PRIMARY_PIXEL_THRESHOLD),
// que no se adaptaba a fotos con dientes más chicos/grandes en pantalla, y
// corrige filtrarBlobsFusionados para que el ruido de fragmentos chiquitos
// ya no baje la mediana de ancho y termine descartando dientes completos
// por "parecer" demasiado anchos en la comparación.
//
// (Resto sin cambios respecto a VERSIÓN 7: soporte para segmentar ENCÍA
// además de dientes, reutilizando la misma función con el parámetro target.)
//
// Confirmado en Replicate (09-jul-2026): prompt "gum" con threshold 0.2
// detecta 9 regiones -- la encía sale fragmentada en "islas" (los dientes
// la interrumpen visualmente), NO es un error, es esperado.
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
import { ZipReader, BlobReader, Uint8ArrayWriter } from "https://deno.land/x/zipjs@v2.7.32/index.js";
import { decode as decodePng } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") || "";
const SB_URL = Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const STORAGE_BUCKET = "camila-masks";

const MODEL_VERSION =
  "d73db077226443ba4fafd34e233b3626b552eac2a433f90c7c32a9ac89bd9e72";

const IOU_THRESHOLD = 0.3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Target = "tooth" | "gum";

interface Candidate {
  bbox: [number, number, number, number];
  pixelCount: number;
  fileData: Uint8Array;
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
  return target === "gum" ? "gum" : "teeth";
}

async function callReplicate(imageUrl: string, target: Target): Promise<string> {
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: MODEL_VERSION,
      input: {
        image: imageUrl,
        prompt: promptParaTarget(target),
        threshold: 0.08,
        mask_only: true,
        return_zip: true,
        save_overlay: false,
      },
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Replicate create error: ${createRes.status} ${await createRes.text()}`);
  }

  let prediction = await createRes.json();
  const pollUrl = prediction.urls?.get;
  let attempts = 0;

  while (
    prediction.status !== "succeeded" &&
    prediction.status !== "failed" &&
    prediction.status !== "canceled" &&
    attempts < 30
  ) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });
    prediction = await pollRes.json();
    attempts++;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Segmentación falló o tardó demasiado: ${prediction.status}`);
  }

  return prediction.output as string;
}

function computeBbox(width: number, height: number, bitmap: Uint8Array) {
  let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (bitmap[idx] > 128) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (count === 0) return { bbox: [0, 0, 0, 0] as [number, number, number, number], pixelCount: 0 };
  return { bbox: [minX, minY, maxX - minX, maxY - minY] as [number, number, number, number], pixelCount: count };
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

async function decodeAllMasks(zipUrl: string): Promise<Candidate[]> {
  const zipRes = await fetch(zipUrl);
  const zipBlob = await zipRes.blob();
  const zipReader = new ZipReader(new BlobReader(zipBlob));
  const entries = await zipReader.getEntries();

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    if (!entry.filename.toLowerCase().endsWith(".png")) continue;
    if (!entry.getData) continue;
    const fileData = await entry.getData(new Uint8ArrayWriter());
    const image = await decodePng(fileData);
    const { bbox, pixelCount } = computeBbox(image.width, image.height, image.bitmap);
    if (pixelCount < 50) continue;
    candidates.push({ bbox, pixelCount, fileData });
  }
  await zipReader.close();
  return candidates;
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
  taggedMasks: { bbox: [number, number, number, number]; pixelCount: number; fileData: Uint8Array; fdi: string | null; parentFdi: string | null }[],
  supabase: ReturnType<typeof createClient>,
  casoId: string,
  target: Target
): Promise<RegionMask[]> {
  const folder = casoId || `sin-caso-${Date.now()}`;
  const prefix = target === "gum" ? "gum_mask" : "mask";
  const masks: RegionMask[] = [];

  for (let i = 0; i < taggedMasks.length; i++) {
    const cand = taggedMasks[i];
    const path = `${folder}/${prefix}_${i}.png`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, cand.fileData, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error(`Error subiendo ${path}:`, uploadError);
      continue;
    }

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

    masks.push({
      index: i,
      bbox: cand.bbox,
      pixelCount: cand.pixelCount,
      maskUrl: publicUrlData.publicUrl,
      fdi: cand.fdi,
      parentFdi: cand.parentFdi,
    });
  }

  return masks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Esta función gasta créditos de Replicate y escribe en camila_casos con el
  // service role (que se salta RLS). Sin esta verificación aceptaba cualquier
  // POST sin credenciales.
  const { user, response: authError } = await requireUser(req, corsHeaders);
  if (authError) return authError;

  try {
    const { imageUrl, casoId, target: targetRaw } = await req.json();
    const target: Target = targetRaw === "gum" ? "gum" : "tooth";

    // El tenant_id sale de la sesión, NO del body. Antes venía en el JSON y se
    // usaba tal cual en el .eq("tenant_id", ...) de abajo: como el cliente es
    // service role y no respeta RLS, mandar el tenantId de otro dentista
    // sobrescribía la segmentación de SU caso.
    const tenantId = user!.id;

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl es requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
    const zipUrl = await callReplicate(imageUrl, target);

    const allCandidates = await decodeAllMasks(zipUrl);
    const survivors = applyNMS(allCandidates);
    const survivorsFiltrados = target === "tooth" ? filtrarBlobsFusionados(survivors) : survivors;
    const tagged = target === "gum" ? tagAsGum(survivorsFiltrados) : assignFdiNotation(survivorsFiltrados);
    const masks = await uploadAll(tagged, supabase, casoId, target);

    if (casoId && tenantId) {
      const columnaDestino = target === "gum" ? "segmentacion_encia" : "segmentacion";
      const { error: dbError } = await supabase
        .from("camila_casos")
        .update({
          [columnaDestino]: { masks, generatedAt: new Date().toISOString() },
        })
        .eq("id", casoId)
        .eq("tenant_id", tenantId);

      if (dbError) console.error(`Error guardando segmentación (${target}):`, dbError);
    }

    return new Response(
      JSON.stringify({
        target,
        masks,
        count: masks.length,
        totalDetectedBeforeNMS: allCandidates.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), stack: (err as Error).stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
