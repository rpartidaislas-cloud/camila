// editor-integration.js
//
// Se integra en camila-editor.html / camila-editor.jsx.
// Reemplaza el overlay GLOBAL (que tiñe toda la imagen) por overlays
// recortados a la máscara real de cada diente.

// 1. Llamar a la Edge Function después de que Gemini genere la simulación
async function segmentarDientes(imageUrl, casoId, tenantId) {
  const res = await fetch(
    "https://gfogifozhhbzxhcbecgf.supabase.co/functions/v1/segment-teeth",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl, casoId, tenantId }),
    }
  );
  if (!res.ok) throw new Error("Error al segmentar dientes");
  const { masks } = await res.json();
  return masks; // [{ index, label, bbox, maskUrl, score }, ...]
}

// 2. Precargar cada máscara PNG como ImageBitmap para poder usarla como clip
async function precargarMascaras(masks) {
  const cargadas = await Promise.all(
    masks.map(async (m) => {
      const resp = await fetch(m.maskUrl);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob);
      return { ...m, bitmap };
    })
  );
  return cargadas;
}

// 3. Dibujar la imagen base + aplicar el filtro SOLO dentro de la máscara
//    del diente seleccionado (o de todos, si estás en un slider "global").
function renderConMascara(ctx, baseImage, maskBitmap, filterCss, bbox) {
  const [x, y, w, h] = bbox;

  ctx.save();

  // Crear un canvas temporal para la máscara (blanco = diente, negro = resto)
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = ctx.canvas.width;
  maskCanvas.height = ctx.canvas.height;
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.drawImage(maskBitmap, 0, 0, maskCanvas.width, maskCanvas.height);

  // Usar la máscara como recorte: solo se pinta donde la máscara es opaca
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(baseImage, 0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0);

  ctx.globalCompositeOperation = "source-over";
  ctx.filter = filterCss; // ej: "brightness(1.2) saturate(1.1)"
  ctx.drawImage(baseImage, x, y, w, h, x, y, w, h);

  ctx.restore();
}

// 4. Ejemplo de uso completo: aplicar "brillo" solo al diente 11 (índice 3
//    tras ordenar de izquierda a derecha, ajusta según tu mapeo FDI real)
async function aplicarBrilloADiente(canvasEl, baseImageEl, masks, toothIndex, brilloValor) {
  const ctx = canvasEl.getContext("2d");
  const diente = masks.find((m) => m.index === toothIndex);
  if (!diente) return;

  const filterCss = `brightness(${0.6 + (brilloValor / 100) * 0.9})`;
  renderConMascara(ctx, baseImageEl, diente.bitmap, filterCss, diente.bbox);
}

// Notas importantes para cuando lo conectemos al editor real:
// - Este approach permite editar CADA diente por separado (color, brillo,
//   opalescencia) sin afectar a los dientes vecinos -- esto es la Fase 2
//   de la estrategia que platicamos.
// - Para warping/cambio de forma (Fase 3), se toma el mismo bbox + máscara
//   pero en vez de "filter", se hace una transformación de malla (requiere
//   librería de warping, ej. glfx.js).
// - Todavía falta mapear "index" (orden espacial) a notación dental real
//   (11, 12, 13...) -- eso se puede resolver con una regla simple: contar
//   de centro hacia afuera una vez que el usuario confirme cuál es la línea
//   media, o pidiéndole a Claude Vision que etiquete cada bbox con su pieza.

export { segmentarDientes, precargarMascaras, renderConMascara, aplicarBrilloADiente };
