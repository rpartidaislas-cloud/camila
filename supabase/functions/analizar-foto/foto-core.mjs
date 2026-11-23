// Lógica pura de analizar-foto (sin red), para poder probarla con node --test.
// Ningún texto escrito por la IA llega al paciente: solo se usan estos mensajes fijos.

export const MOTIVOS_NO_APTA = ['no_se_ven_dientes', 'borrosa', 'oscura', 'muy_lejos', 'otra'];

export const MENSAJES_PACIENTE = Object.freeze({
  revision: 'Recibimos tu foto. Un profesional de la clínica la revisará y te contactará para orientarte. Si tienes dolor fuerte, sangrado o un golpe, llama a la clínica o acude a urgencias.',
  simulacion: 'Te compartimos una simulación ilustrativa de cómo podría verse tu sonrisa. No es un diagnóstico ni garantiza resultados: un profesional de la clínica revisará tu caso en consulta.',
  no_se_ven_dientes: 'No alcanzamos a ver tus dientes en la foto. ¿Nos mandas otra sonriendo de frente, mostrando los dientes de arriba?',
  borrosa: 'La foto salió un poco borrosa. ¿Nos mandas otra con el celular firme y sonriendo de frente?',
  oscura: 'La foto quedó oscura. ¿Nos mandas otra con buena luz, de preferencia cerca de una ventana?',
  muy_lejos: 'La foto está muy lejos. ¿Nos mandas otra más de cerca, sonriendo de frente?',
  otra: 'No pudimos usar esta foto. ¿Nos mandas otra sonriendo de frente, con buena luz?',
});

export const AVISO_SIMULACION = 'Imagen generada con inteligencia artificial. Es ilustrativa: no es un diagnóstico, no sustituye la valoración de un profesional y no garantiza resultados.';

/** Convierte la respuesta del modelo en { apta, motivo } usando solo valores de la lista cerrada. */
export function interpretarCalidad(texto) {
  let parsed = null;
  try { parsed = JSON.parse(String(texto || '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return { apta: false, motivo: 'otra' };
  if (parsed.apta === true) return { apta: true, motivo: 'ninguno' };
  const motivo = MOTIVOS_NO_APTA.includes(parsed.motivo) ? parsed.motivo : 'otra';
  return { apta: false, motivo };
}
