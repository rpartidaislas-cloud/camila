// Candado de privacidad para las funciones que mandan datos de un paciente a una IA externa. La regla vive en privacy-core.mjs.
import { decidirIA, MENSAJE_IA_NO_PERMITIDA, MENSAJE_IA_NO_VERIFICABLE } from './privacy-core.mjs';

export type PermisoIA = 'allowed' | 'revoked' | 'unavailable';

// deno-lint-ignore no-explicit-any
export async function permisoIA(admin: any, tenantId: string, patientId: string): Promise<PermisoIA> {
  try {
    const result = await admin.rpc('smyl_patient_privacy_state', { p_tenant: tenantId, p_patient: patientId, p_purpose: 'ai_processing' });
    return decidirIA(result);
  } catch { return 'unavailable'; }
}

/** Respuesta lista para devolver cuando NO se puede usar IA con este paciente; null si se puede continuar. */
export function respuestaIAnegada(permiso: PermisoIA): { status: number; body: { error: string; code: string } } | null {
  if (permiso === 'allowed') return null;
  if (permiso === 'revoked') return { status: 403, body: { error: MENSAJE_IA_NO_PERMITIDA, code: 'patient_ai_not_allowed' } };
  return { status: 503, body: { error: MENSAJE_IA_NO_VERIFICABLE, code: 'patient_ai_unverifiable' } };
}
