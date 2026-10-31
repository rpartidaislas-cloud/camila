// Planes de suscripción: la ÚNICA fuente de verdad del plan es el Price ID configurado en el servidor.
// Antes, stripe-checkout aceptaba `priceId` y `planKey` del navegador y stripe-webhook caía a
// `session.metadata.plan_key` (también del navegador) cuando el precio no era uno de los tres: bastaba
// suscribirse a cualquier precio barato de la cuenta de Stripe con planKey="premium" para obtener ese plan.
// Funciones puras, sin Deno ni Stripe, para poder probarlas.

export const PLAN_LIMITES: Record<string, number> = { esencial: 15, profesional: 40, premium: 100 };

export interface PreciosPlanes {
  esencial?: string | null;
  profesional?: string | null;
  premium?: string | null;
}

// Plan que corresponde a un Price ID de Stripe, o null si no es uno de los configurados.
export function planKeyFromPriceId(priceId: string | null | undefined, prices: PreciosPlanes): string | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PLAN_LIMITES) as Array<keyof PreciosPlanes>) {
    const configurado = prices[plan];
    if (configurado && configurado === priceId) return plan;
  }
  return null;
}

export type ResolucionCheckout =
  | { planKey: string; priceId: string }
  | { error: 'plan_invalido' | 'plan_no_configurado' };

// Qué cobrar para el plan pedido por el cliente: el Price ID sale del servidor, nunca del cliente.
export function resolverPlanCheckout(planKey: unknown, prices: PreciosPlanes): ResolucionCheckout {
  if (typeof planKey !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN_LIMITES, planKey)) {
    return { error: 'plan_invalido' };
  }
  const priceId = prices[planKey as keyof PreciosPlanes];
  if (!priceId) return { error: 'plan_no_configurado' };
  return { planKey, priceId };
}
