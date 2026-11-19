// Lógica pura de «compartir propuesta con el paciente» (sin Deno ni red): secciones, snapshot congelado, vigencia y consentimiento.
export const VIGENCIA_DIAS_DEFECTO = 15;
export const VIGENCIA_DIAS_MAX = 30;
export const HISTORIAL_MAX = 1200;
export const PAGO_NOTA_MAX = 500;
export const INTERES_NOTA_MAX = 300;
export const CONSENT_VERSION = "v1";
// Texto exacto que el paciente acepta; su hash queda guardado junto con la fecha.
export const CONSENT_TEXT =
  "Acepto este plan de tratamiento como punto de partida para agendar mi valoración, y autorizo a la clínica a usar mis fotografías y simulaciones de esta propuesta para atenderme. Entiendo que la simulación es orientativa y no garantiza resultados.";

const limpio = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

// Solo viaja lo que el doctor marca. Todo apagado por defecto salvo plan y precios (que no es opcional).
export function normalizarSecciones(input) {
  const s = input && typeof input === "object" ? input : {};
  return { odontogram: s.odontogram === true, photos: s.photos === true, history: s.history === true };
}

export function normalizarComparticion(body) {
  const b = body && typeof body === "object" ? body : {};
  const secciones = normalizarSecciones(b.sections);
  const historial = secciones.history ? limpio(b.history_summary, HISTORIAL_MAX) : "";
  if (secciones.history && historial.length < 10) return { ok: false, campo: "history_summary", error: "Escribe el resumen de historial que quieres compartir (mínimo 10 caracteres)." };
  let dias = b.expires_days === undefined ? VIGENCIA_DIAS_DEFECTO : Number(b.expires_days);
  if (!Number.isInteger(dias) || dias < 1 || dias > VIGENCIA_DIAS_MAX) return { ok: false, campo: "expires_days", error: `La vigencia debe ser de 1 a ${VIGENCIA_DIAS_MAX} días.` };
  return { ok: true, valor: { sections: { ...secciones, history: secciones.history }, history_summary: historial, payment_note: limpio(b.payment_note, PAGO_NOTA_MAX), expires_days: dias } };
}

// Copia congelada y mínima de la propuesta aprobada. Lo editado después no cambia lo ya enviado.
export function construirSnapshot(propuesta, { secciones, sede = null, nombrePaciente = "" } = {}) {
  const doc = JSON.parse(JSON.stringify(propuesta.document || {}));
  if (!secciones.photos) doc.photos = null;
  const primerNombre = String(nombrePaciente || propuesta.patient_name || "").trim().split(/\s+/)[0] || "";
  return {
    id: propuesta.id,
    revision: propuesta.revision,
    plan_revision: propuesta.plan_revision,
    document: doc,
    patient_name: primerNombre,
    clinic_name: propuesta.clinic_name || "",
    professional_name: propuesta.professional_name || "",
    branch_label: sede ? sede.label : "",
    branch_detail: sede ? sede.detail : "",
  };
}

export function detalleSede(b) {
  if (!b) return null;
  const direccion = [b.address_line, b.city, b.state].filter(Boolean).join(", ");
  return { label: b.name || "", detail: [direccion, b.phone ? "Tel. " + b.phone : ""].filter(Boolean).join(" · ") };
}

export function estadoEnlace(share, ahora = Date.now()) {
  if (share.status === "revoked") return "revoked";
  if (new Date(share.expires_at).getTime() <= ahora) return "expired";
  return share.accepted_at ? "accepted" : "active";
}

// Lo que ve el paciente. Nunca ids internos ni el hash.
export function vistaPaciente(share, assets, ahora = Date.now()) {
  return {
    status: estadoEnlace(share, ahora),
    row: share.snapshot,
    assets: assets || {},
    sections: share.sections,
    history_summary: share.sections && share.sections.history ? share.history_summary : "",
    payment_note: share.payment_note || "",
    expires_at: share.expires_at,
    interested: !!share.interested_at,
    accepted_at: share.accepted_at || null,
    consent_text: CONSENT_TEXT,
    consent_version: CONSENT_VERSION,
  };
}

export function limpiarNotaInteres(v) { return limpio(v, INTERES_NOTA_MAX); }
