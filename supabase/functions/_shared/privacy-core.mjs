// Permiso del paciente para que sus datos pasen por herramientas de IA de proveedores externos (finalidad 'ai_processing').
// Regla (LFPDPPP: los datos de salud son sensibles y requieren consentimiento EXPRESO): solo se usa la IA cuando el paciente
// la autorizó ('granted'). Sin decisión registrada ('unknown') o si la retiró ('revoked') no se manda nada a la IA.
// Si no se puede comprobar (error de base de datos) también se bloquea: ante la duda no se manda nada a un tercero.
export const MENSAJE_IA_NO_PERMITIDA = 'Este paciente no autorizó el uso de inteligencia artificial con sus datos. Captura o revisa esto manualmente.';
export const MENSAJE_IA_SIN_AUTORIZACION = 'Este paciente aún no autoriza el uso de inteligencia artificial. Registra su autorización en Privacidad (o pídele que firme el aviso) antes de usar la IA.';
export const MENSAJE_IA_NO_VERIFICABLE = 'No se pudo comprobar el permiso de IA del paciente. Inténtalo de nuevo en un momento.';

/** Convierte la respuesta de smyl_patient_privacy_state en una decisión: 'allowed' | 'missing' | 'revoked' | 'unavailable'. */
export function decidirIA(result) {
  if (!result || result.error) return 'unavailable';
  const state = result.data;
  if (state === 'granted') return 'allowed';
  if (state === 'revoked') return 'revoked';
  if (state === 'unknown') return 'missing';
  return 'unavailable';
}
