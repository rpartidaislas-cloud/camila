export const SMYL_LANA_CONTRACT_VERSION = "1.6";

const ALLOWED_ROOTS = new Set([
  "attention",
  "channels",
  "context",
  "contract",
  "conversations",
  "inbox",
  "training",
]);

export function normalizeLanaPath(input) {
  const raw = String(input || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const rawPath = raw.split(/[?#]/, 1)[0];
  let rawSegments;
  try {
    rawSegments = rawPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error("Ruta LANA no permitida.");
  }
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Ruta LANA no permitida.");
  }

  const parsed = new URL(raw, "https://lana.invalid");
  if (parsed.origin !== "https://lana.invalid" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("Ruta LANA no permitida.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!segments.length) throw new Error("Ruta LANA no permitida.");
  if (!ALLOWED_ROOTS.has(segments[0])) throw new Error("Endpoint LANA no permitido.");

  return `${parsed.pathname}${parsed.search}`;
}

export function lanaContractHeaders() {
  return { "X-SMYL-LANA-Contract-Version": SMYL_LANA_CONTRACT_VERSION };
}

// ── Aislamiento de contexto SMYL ↔ LANA ─────────────────────────────────────────────────────────────
// SMYL usa el motor de chat de LANA, pero cada clínica debe vivir en SU PROPIO tenant de LANA, marcado como producto
// "smyl": así el asistente usa el contexto y las herramientas dentales, nunca el catálogo/pedidos/precios comerciales.
// LANA declara esa marca en `GET /contract` → `contract.product` (y `contract.tenant_id`).
export const SMYL_PRODUCT = "smyl";

// Interpreta la respuesta de /contract. Devuelve el producto y el id del tenant LANA, o null si LANA aún no los informa.
export function readLanaContract(body) {
  const contract = body && typeof body === "object" && body.contract && typeof body.contract === "object" ? body.contract : null;
  const product = contract && typeof contract.product === "string" ? contract.product.trim().toLowerCase().slice(0, 40) : null;
  const rawTenant = contract && typeof contract.tenant_id === "string" ? contract.tenant_id.trim().toLowerCase() : "";
  const lanaTenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rawTenant) ? rawTenant : null;
  return { product: product || null, lanaTenantId };
}

// Decide si un tenant de LANA puede vincularse a una clínica de SMYL.
//  - strict (código de enlace manual): exige que LANA confirme product === "smyl"; sin confirmación se rechaza.
//  - no strict (alta automática o verificación de un enlace ya existente): sólo se rechaza un producto distinto de "smyl";
//    si LANA aún no informa el producto, se acepta pero queda marcado como "sin verificar".
// Resultado: { ok, verified, code, message }
export function decideLanaLink(info, { strict }) {
  const product = info && info.product ? info.product : null;
  if (product === SMYL_PRODUCT) return { ok: true, verified: true, code: "", message: "" };
  if (product) {
    return { ok: false, verified: false, code: "wrong_product", message: "Este código pertenece a una cuenta comercial de LANA y no se puede usar en SMYL. Usa la activación automática." };
  }
  if (strict) {
    return { ok: false, verified: false, code: "product_unconfirmed", message: "LANA no confirmó que este código sea de una cuenta SMYL. Usa la activación automática o pide soporte." };
  }
  return { ok: true, verified: false, code: "", message: "" };
}
