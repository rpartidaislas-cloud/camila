// Tope de análisis de IA por clínica (auditoría del panel admin, 2026-11-06): sin esto, una sesión (o un script con una
// sesión robada) podía lanzar análisis de radiografía sin límite y la factura de Anthropic la pagaba SMYL.
// Los límites son generosos para uso clínico normal y se ajustan con variables de entorno sin publicar código.

export interface TopesIA {
  diario: number;
  mensual: number;
}

export const TOPES_RADIOGRAFIA_PREDETERMINADOS: TopesIA = { diario: 60, mensual: 600 };

function entero(valor: string | undefined, predeterminado: number): number {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n > 0 ? n : predeterminado;
}

export function leerTopesRadiografia(env: { get(name: string): string | undefined }): TopesIA {
  return {
    diario: entero(env.get("RADIOGRAPH_DAILY_LIMIT"), TOPES_RADIOGRAFIA_PREDETERMINADOS.diario),
    mensual: entero(env.get("RADIOGRAPH_MONTHLY_LIMIT"), TOPES_RADIOGRAFIA_PREDETERMINADOS.mensual),
  };
}

export type ResultadoTope = { permitido: true } | { permitido: false; periodo: "diario" | "mensual"; mensaje: string };

export function evaluarTope(usoDiario: number, usoMensual: number, topes: TopesIA): ResultadoTope {
  if (usoDiario >= topes.diario) {
    return { permitido: false, periodo: "diario", mensaje: `Tu clínica llegó al límite diario de ${topes.diario} análisis de radiografía. Podrás continuar mañana o pedir que se amplíe el límite.` };
  }
  if (usoMensual >= topes.mensual) {
    return { permitido: false, periodo: "mensual", mensaje: `Tu clínica llegó al límite mensual de ${topes.mensual} análisis de radiografía. Pide que se amplíe el límite para continuar.` };
  }
  return { permitido: true };
}

// Inicio del día/mes en UTC (suficiente para un tope de costo; no es una regla clínica).
export function inicioDiaUTC(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString();
}
export function inicioMesUTC(ahora: Date): string {
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString();
}
