const API_BASE = "https://www.facturapi.io/v2";

export function validateTestSecret(value) {
  const key = String(value || "").trim();
  if (!key.startsWith("sk_test_")) return { ok: false, error: "Usa únicamente una llave de ambiente Test (sk_test_)." };
  if (key.length < 24 || key.length > 256 || /\s/.test(key)) return { ok: false, error: "La llave Test no tiene un formato válido." };
  return { ok: true, value: key };
}

export function normalizeFacturapiPath(value) {
  const path = String(value || "");
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) {
    throw new Error("Ruta de Facturapi no permitida.");
  }
  return path;
}

export function organizationSummary(input) {
  const row = input && typeof input === "object" ? input : {};
  const id = String(row.id || "").trim();
  if (!id || id.length > 120) throw new Error("Facturapi no devolvió una organización válida.");
  return {
    id,
    name: String(row.name || row.legal_name || "Organización Facturapi").trim().slice(0, 180) || "Organización Facturapi",
  };
}

export function publicConnectionStatus(row, canManage = false) {
  if (!row) return { connected: false, status: "disconnected", environment: "test", can_manage: canManage };
  return {
    connected: row.status === "connected",
    status: row.status,
    environment: "test",
    organization_id: row.organization_id || null,
    organization_name: row.organization_name || null,
    key_fingerprint: row.key_fingerprint || null,
    connected_at: row.connected_at || null,
    last_verified_at: row.last_verified_at || null,
    last_error: row.last_error || null,
    can_manage: canManage,
  };
}

export { API_BASE };
