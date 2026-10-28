// Inspección de una radiografía 2D sin decodificarla: tipo real por firma binaria, dimensiones
// desde la cabecera (PNG IHDR / JPEG SOFn) y orientación EXIF. No usa librerías ni Deno: se
// ejecuta igual en pruebas de Node. Las "pistas" (chunk PNG tEXt `smyl.sim`) sólo las lee el
// proveedor simulado; un proveedor real las ignora.

export interface ImageProbe {
  mime: 'image/jpeg' | 'image/png' | null;
  width: number | null;
  height: number | null;
  orientation: number; // EXIF 1..8; 1 = normal; 0 = desconocida
  hints: string[];
  reason: string | null; // motivo de rechazo, o null si la cabecera es coherente
}

const td = new TextDecoder();
const u16 = (b: Uint8Array, i: number, le: boolean) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
const u32 = (b: Uint8Array, i: number, le: boolean) =>
  le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

export function detectRadiographMime(b: Uint8Array): 'image/jpeg' | 'image/png' | null {
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9) return 'image/jpeg';
  if (b.length >= 20 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    && td.decode(b.slice(-8, -4)) === 'IEND') return 'image/png';
  return null;
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const MAX_HINTS = 8, MAX_HINT_LENGTH = 48;
const bad = (mime: 'image/jpeg' | 'image/png', reason: string): ImageProbe => ({ mime, width: null, height: null, orientation: 0, hints: [], reason });

function probePng(b: Uint8Array): ImageProbe {
  const hints: string[] = [];
  let width: number | null = null, height: number | null = null;
  let i = 8, first = true, ended = false;
  while (i + 12 <= b.length) {
    const len = u32(b, i, false);
    const type = td.decode(b.slice(i + 4, i + 8));
    const start = i + 8;
    if (start + len + 4 > b.length) return bad('image/png', 'La estructura PNG está truncada.');
    if (first && (type !== 'IHDR' || len !== 13)) return bad('image/png', 'El primer bloque PNG debe ser un IHDR válido.');
    if (type === 'IHDR') {
      if (!first) return bad('image/png', 'El PNG tiene más de una cabecera.');
      if (crc32(b, i + 4, start + len) !== u32(b, start + len, false)) return bad('image/png', 'La cabecera PNG está dañada.');
      width = u32(b, start, false); height = u32(b, start + 4, false);
    }
    first = false;
    if (type === 'tEXt') {
      const text = td.decode(b.slice(start, start + len));
      const sep = text.indexOf('\0');
      if (sep > 0 && text.slice(0, sep) === 'smyl.sim') hints.push(...text.slice(sep + 1).split(',').map((h) => h.trim()).filter((h) => h && h.length <= MAX_HINT_LENGTH).slice(0, MAX_HINTS));
    }
    if (type === 'IEND') { ended = true; break; }
    i = start + len + 4; // + CRC
  }
  if (!ended) return bad('image/png', 'El PNG no termina correctamente.');
  if (width === null || height === null || width < 1 || height < 1) return bad('image/png', 'La cabecera PNG no declara dimensiones.');
  return { mime: 'image/png', width, height, orientation: 1, hints: hints.slice(0, MAX_HINTS), reason: null };
}

function exifOrientation(app1: Uint8Array): number {
  // app1 empieza en "Exif\0\0" seguido de la cabecera TIFF.
  if (app1.length < 14 || td.decode(app1.slice(0, 4)) !== 'Exif') return 0;
  const t = app1.slice(6);
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 0;
  if (u16(t, 2, le) !== 0x2a) return 0;
  const ifd = u32(t, 4, le);
  if (ifd + 2 > t.length) return 0;
  const n = u16(t, ifd, le);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (u16(t, e, le) === 0x0112) { const v = u16(t, e + 8, le); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 1;
}

function probeJpeg(b: Uint8Array): ImageProbe {
  let width: number | null = null, height: number | null = null, orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // bytes de relleno 0xFF antes de un marcador
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break; // EOI o inicio de scan: ya no hay cabeceras
    const len = u16(b, i + 2, false);
    if (len < 2 || i + 2 + len > b.length) break;
    const seg = b.slice(i + 4, i + 2 + len);
    if (marker === 0xe1) { const o = exifOrientation(seg); if (o) orientation = o; }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (width !== null) return bad('image/jpeg', 'El JPEG declara más de un cuadro.');
      if (seg.length >= 5) { height = u16(seg, 1, false); width = u16(seg, 3, false); }
    }
    i += 2 + len;
  }
  if (width === null || height === null || width < 1 || height < 1) return bad('image/jpeg', 'La cabecera JPEG no declara dimensiones.');
  return { mime: 'image/jpeg', width, height, orientation, hints: [], reason: null };
}

export function probeRadiograph(bytes: Uint8Array): ImageProbe {
  const mime = detectRadiographMime(bytes);
  if (mime === 'image/png') return probePng(bytes);
  if (mime === 'image/jpeg') return probeJpeg(bytes);
  return { mime: null, width: null, height: null, orientation: 0, hints: [], reason: 'El formato real no está permitido.' };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest).map((x) => x.toString(16).padStart(2, '0')).join('');
}
