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
// `monto` (opcional) cobra solo una parte, por ejemplo el anticipo de una cotización: se reparte sobre los cargos en el mismo orden, sin pasar de
// lo que cada uno debe. Si `monto` es mayor que el saldo de esos cargos se rechaza (nunca se cobra de más).
export function planDeCobro(abiertos, { chargeIds = null, monto = null } = {}) {
  let filas = (abiertos || [])
    .filter((c) => !chargeIds || chargeIds.includes(c.charge_id))
    .map((c) => ({ charge_id: c.charge_id, concept: String(c.concept || ""), amount: redondear2(c.open_amount) }))
    .filter((c) => c.amount > 0);
  if (!filas.length) return { ok: false, error: "no_balance", mensaje: "El paciente no tiene saldo pendiente." };
  if (monto !== null && monto !== undefined) {
    const pedido = redondear2(monto);
    if (!Number.isFinite(pedido) || pedido <= 0) return { ok: false, error: "invalid_amount", mensaje: "El monto a cobrar no es válido." };
    const saldo = redondear2(filas.reduce((s, c) => s + c.amount, 0));
    if (pedido > saldo) return { ok: false, error: "amount_exceeds_balance", mensaje: `El monto no puede ser mayor que el saldo pendiente ($${saldo}).` };
    let resto = pedido;
    const repartido = [];
    for (const fila of filas) {
      if (resto <= 0) break;
      const parte = redondear2(Math.min(fila.amount, resto));
      if (parte > 0) repartido.push({ ...fila, amount: parte });
      resto = redondear2(resto - parte);
    }
    filas = repartido;
  }
  const total = redondear2(filas.reduce((s, c) => s + c.amount, 0));
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

// ── Alcance por sucursal de los enlaces de pago ──
// La función usa el cliente administrativo, así que NADA de la base limita por sucursal: se decide aquí con las mismas reglas de Finanzas
// (smyl_can_access_finance_patient / smyl_can_access_finance_branch, evaluadas con la sesión de quien llama).
// `permisos` = { paciente(branchId|null) -> Promise<boolean>, sucursal(branchId) -> Promise<boolean> }

// ¿Puede quien llama operar sobre este paciente y estos cargos? Revisa una vez por sucursal distinta (incluida «sin sucursal»).
export async function autorizarCargos(input) {
  const abiertos = input.abiertos || [], chargeIds = input.chargeIds || null, permisos = input.permisos;
  const incluidos = abiertos.filter((c) => !chargeIds || chargeIds.includes(c.charge_id));
  const ramas = [...new Set(incluidos.map((c) => (c.branch_id == null ? "" : String(c.branch_id))))];
  if (!ramas.length) ramas.push("");
  const denegadas = [];
  for (const rama of ramas) {
    if (!(await permisos.paciente(rama || null))) denegadas.push(rama || null);
  }
  return { ok: denegadas.length === 0, denegadas };
}

// ¿Puede quien llama ver/cancelar este enlace? Hay que poder ver al paciente Y la sucursal en que se creó el enlace.
export async function autorizarEnlace(input) {
  const link = input.link, permisos = input.permisos;
  if (!(await permisos.paciente(link.branch_id || null))) return false;
  return Boolean(link.branch_id) ? await permisos.sucursal(String(link.branch_id)) : true;
}

// De una lista de enlaces, solo los de sucursales que quien llama puede ver (para `list`).
export async function enlacesVisibles(input) {
  const out = [];
  const cache = new Map();
  for (const link of input.links || []) {
    const key = link.branch_id == null ? "" : String(link.branch_id);
    if (!cache.has(key)) cache.set(key, await autorizarEnlace({ link: { branch_id: link.branch_id }, permisos: input.permisos }));
    if (cache.get(key)) out.push(link);
  }
  return out;
}
