// Permiso del paciente para que sus datos pasen por herramientas de IA de proveedores externos (finalidad 'ai_processing').
// Regla: SOLO se bloquea cuando el paciente lo negó o lo retiró ('revoked'). Un paciente sin decisión registrada ('unknown',
// el caso de todos los anteriores a esta función) sigue como hasta ahora, para no detener la clínica el día que se publique.
// Si no se puede comprobar (error de base de datos) se bloquea: ante la duda no se manda nada a un tercero.
export const MENSAJE_IA_NO_PERMITIDA = 'Este paciente no autorizó el uso de inteligencia artificial con sus datos. Captura o revisa esto manualmente.';
export const MENSAJE_IA_NO_VERIFICABLE = 'No se pudo comprobar el permiso de IA del paciente. Inténtalo de nuevo en un momento.';

/** Convierte la respuesta de smyl_patient_privacy_state en una decisión: 'allowed' | 'revoked' | 'unavailable'. */
export function decidirIA(result) {
  if (!result || result.error) return 'unavailable';
  const state = result.data;
  if (state === 'revoked') return 'revoked';
  if (state === 'granted' || state === 'unknown') return 'allowed';
  return 'unavailable';
}
