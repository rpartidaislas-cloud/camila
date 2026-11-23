// Reglas puras del envío automático del aviso de privacidad por WhatsApp (sin red ni base de datos, para poder probarlas).
export const NOTICE_TEMPLATE = 'aviso_privacidad_v1';
export const MAX_PER_RUN = 5;

const BAD_STATUS = /reject|rechaz|pending|pendiente|paused|disabled/i;

/** Nombre de pila para el saludo; si la ficha aún es «Por registrar…» o está vacía, un saludo neutro. */
export function firstNameOf(name) {
  const text = String(name == null ? '' : name).trim();
  if (!text || /^por registrar/i.test(text)) return 'paciente';
  return text.split(/\s+/)[0].slice(0, 40);
}

/** Id de la plantilla del aviso si LANA ya la tiene aprobada; null si no existe o no está aprobada. */
export function approvedTemplateId(templates) {
  const found = (Array.isArray(templates) ? templates : []).find((t) => t && String(t.name || '') === NOTICE_TEMPLATE && !BAD_STATUS.test(String(t.status || '')));
  return found && found.id ? String(found.id) : null;
}

export function noticeUrl(base, token) {
  return String(base || '').replace(/\/+$/, '') + '/aviso-firma.html?token=' + encodeURIComponent(token);
}

/** Variables de la plantilla, en el orden del catálogo: nombre, clínica, enlace. */
export function templateVariables(o) {
  return [firstNameOf(o.firstName), String(o.clinic || 'tu clínica').trim().slice(0, 80) || 'tu clínica', noticeUrl(o.base, o.token)].map((v) => v.slice(0, 1000));
}

export function idempotencyKey(tenantId, patientId) { return 'privacy-notice:' + tenantId + ':' + patientId; }
