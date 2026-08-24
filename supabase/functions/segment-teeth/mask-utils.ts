export interface MaskComponent {
  bbox: [number, number, number, number];
  pixelCount: number;
  fileData: Uint8Array;
  contentType: "image/svg+xml";
  fileExtension: "svg";
}

export interface OutputSize {
  width: number;
  height: number;
  value: string;
}

const MIN_OUTPUT_PIXELS = 655_360;
const MAX_OUTPUT_PIXELS = 8_294_400;
const MAX_OUTPUT_EDGE = 3_840;

function multipleOf16(value: number): number {
  return Math.max(16, Math.ceil(value / 16) * 16);
}

// GPT Image 2 admite tamaños flexibles, pero exige múltiplos de 16, un
// mínimo de píxeles y una relación máxima 3:1. La app ya manda un recorte de
// sonrisa; sólo se escala el lienzo de salida, nunca se recorta ni deforma.
export function calculateOutputSize(sourceWidth: number, sourceHeight: number): OutputSize {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Dimensiones de imagen inválidas.");
  }
  const ratio = sourceWidth / sourceHeight;
  if (ratio > 3 || ratio < 1 / 3) {
    throw new Error("El recorte dental excede la relación 3:1 admitida por GPT Image.");
  }

  let scale = Math.max(1, Math.sqrt(MIN_OUTPUT_PIXELS / (sourceWidth * sourceHeight)));
  let width = multipleOf16(sourceWidth * scale);
  let height = multipleOf16(sourceHeight * scale);

  if (width > MAX_OUTPUT_EDGE || height > MAX_OUTPUT_EDGE || width * height > MAX_OUTPUT_PIXELS) {
    scale = Math.min(
      MAX_OUTPUT_EDGE / sourceWidth,
      MAX_OUTPUT_EDGE / sourceHeight,
      Math.sqrt(MAX_OUTPUT_PIXELS / (sourceWidth * sourceHeight)),
    );
    width = Math.max(16, Math.floor(sourceWidth * scale / 16) * 16);
    height = Math.max(16, Math.floor(sourceHeight * scale / 16) * 16);
  }

  return { width, height, value: `${width}x${height}` };
}

function componentSvg(width: number, height: number, pixels: number[]): Uint8Array {
  pixels.sort((a, b) => a - b);
  let path = "";
  let cursor = 0;
  while (cursor < pixels.length) {
    const first = pixels[cursor];
    const y = Math.floor(first / width);
    const startX = first - y * width;
    let endX = startX;
    cursor++;
    while (cursor < pixels.length) {
      const next = pixels[cursor];
      const nextY = Math.floor(next / width);
      const nextX = next - nextY * width;
      if (nextY !== y || nextX !== endX + 1) break;
      endX = nextX;
      cursor++;
    }
    const runWidth = endX - startX + 1;
    path += `M${startX} ${y}h${runWidth}v1h-${runWidth}z`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">` +
    `<path fill="#fff" d="${path}"/></svg>`;
  return new TextEncoder().encode(svg);
}

function isForeground(bitmap: Uint8Array, offset: number): boolean {
  const red = bitmap[offset];
  const green = bitmap[offset + 1];
  const blue = bitmap[offset + 2];
  const alpha = bitmap[offset + 3];
  if (alpha < 72) return false;
  const minimum = Math.min(red, green, blue);
  const maximum = Math.max(red, green, blue);
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
  // El prompt pide blanco puro sobre negro. Esta tolerancia conserva el
  // antialias de los bordes, pero excluye fondos, sombras y colores espurios.
  return luminance >= 150 && minimum >= 118 && maximum - minimum <= 90;
}

export function extractMaskComponents(
  width: number,
  height: number,
  bitmap: Uint8Array,
  sourceWidth = width,
  sourceHeight = height,
): MaskComponent[] {
  if (bitmap.byteLength !== width * height * 4) {
    throw new Error("La máscara GPT tiene un tamaño de bitmap inválido.");
  }

  const foreground = new Uint8Array(width * height);
  let foregroundCount = 0;
  for (let index = 0; index < foreground.length; index++) {
    if (!isForeground(bitmap, index * 4)) continue;
    foreground[index] = 1;
    foregroundCount++;
  }

  const coverage = foregroundCount / foreground.length;
  if (coverage < 0.0004 || coverage > 0.24) {
    throw new Error("GPT devolvió una máscara dental con cobertura inválida.");
  }

  const visited = new Uint8Array(foreground.length);
  const queue = new Int32Array(foreground.length);
  const minimumArea = Math.max(40, Math.round(foreground.length * 0.000035));
  const rawComponents: Array<{ pixels: number[]; bbox: [number, number, number, number] }> = [];

  for (let seed = 0; seed < foreground.length; seed++) {
    if (!foreground[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    const pixels: number[] = [];
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const current = queue[head++];
      pixels.push(current);
      const y = Math.floor(current / width);
      const x = current - y * width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const left = current - 1;
      const right = current + 1;
      const up = current - width;
      const down = current + width;
      if (x > 0 && foreground[left] && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (x + 1 < width && foreground[right] && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0 && foreground[up] && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      if (y + 1 < height && foreground[down] && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
    }

    if (pixels.length < minimumArea) continue;
    rawComponents.push({ pixels, bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1] });
  }

  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  return rawComponents
    .sort((a, b) => b.pixels.length - a.pixels.length)
    .slice(0, 64)
    .map((component) => ({
      bbox: [
        component.bbox[0] * scaleX,
        component.bbox[1] * scaleY,
        component.bbox[2] * scaleX,
        component.bbox[3] * scaleY,
      ] as [number, number, number, number],
      pixelCount: component.pixels.length,
      fileData: componentSvg(width, height, component.pixels),
      contentType: "image/svg+xml" as const,
      fileExtension: "svg" as const,
    }));
}
