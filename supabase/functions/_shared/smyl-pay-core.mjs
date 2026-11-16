// Lógica pura del cobro en línea de SMYL (sin Deno ni red): token, firma del aviso de LANA, plan de aplicación y vista pública.
export const MONTO_MINIMO = 10;
export const MONTO_MAXIMO = 500000;
export const VIGENCIA_MINUTOS = 3 * 24 * 60;
export const TOLERANCIA_FIRMA_SEG = 300;
export const TOKEN_RE = /^[a-f0-9]{64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const redondear2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function aleatorioHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}
export async function sha256Hex(texto) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(texto))));
}
export async function hmacHex(secreto, mensaje) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secreto)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(String(mensaje))));
}

// Aviso LANA -> SMYL: firma = "sha256=" + HMAC(secreto, `${timestamp}.${cuerpo}`), timestamp en segundos y reciente.
export async function firmaValida(secreto, timestamp, cuerpo, firma, { ahoraSeg = Math.floor(Date.now() / 1000) } = {}) {
  const ts = Number(timestamp);
  if (!secreto || !Number.isFinite(ts) || Math.abs(ahoraSeg - ts) > TOLERANCIA_FIRMA_SEG) return false;
  const esperada = "sha256=" + (await hmacHex(secreto, `${timestamp}.${cuerpo}`));
  if (typeof firma !== "string" || firma.length !== esperada.length) return false;
  let d = 0;
  for (let i = 0; i < esperada.length; i++) d |= esperada.charCodeAt(i) ^ firma.charCodeAt(i);
  return d === 0;
}

// Reparte el pago sobre los cargos abiertos (ya ordenados) y devuelve lo que cubre. `chargeIds` limita a esos cargos.
export function planDeCobro(abiertos, { chargeIds = null } = {}) {
  const filas = (abiertos || [])
    .filter((c) => !chargeIds || chargeIds.includes(c.charge_id))
    .map((c) => ({ charge_id: c.charge_id, concept: String(c.concept || ""), amount: redondear2(c.open_amount) }))
    .filter((c) => c.amount > 0);
  const total = redondear2(filas.reduce((s, c) => s + c.amount, 0));
  if (!filas.length) return { ok: false, error: "no_balance", mensaje: "El paciente no tiene saldo pendiente." };
  if (total < MONTO_MINIMO) return { ok: false, error: "amount_too_low", mensaje: `El monto mínimo para cobrar en línea es $${MONTO_MINIMO}.` };
  if (total > MONTO_MAXIMO) return { ok: false, error: "amount_too_high", mensaje: `El monto máximo por enlace es $${MONTO_MAXIMO}.` };
  return { ok: true, total, allocations: filas };
}

export function conceptoDelEnlace(allocations, clinica) {
  const n = allocations.length;
  const base = n === 1 ? allocations[0].concept : `${n} conceptos`;
  return `${clinica || "SMYL"} · ${base}`.slice(0, 240);
}

export function primerNombre(nombre) {
  return String(nombre || "").trim().split(/\s+/)[0] || "";
}

// Lo único que ve quien abre el enlace: nunca ids internos, hash, secreto ni datos de otros pacientes.
export function vistaPublicaEnlace(link, { clinica, paciente, recibo } = {}, ahora = Date.now()) {
  const vencido = link.status === "pending" && new Date(link.expires_at).getTime() <= ahora;
  return {
    status: vencido ? "expired" : link.status,
    clinic: clinica || "",
    patient: primerNombre(paciente),
    amount: Number(link.amount),
    currency: "MXN",
    lines: (link.allocations || []).map((a) => ({ concept: String(a.concept || ""), amount: Number(a.amount) })),
    expires_at: link.expires_at,
    paid_at: link.paid_at || null,
    method: link.method || null,
    receipt_folio: recibo ? String(recibo).padStart(6, "0") : null,
  };
}
