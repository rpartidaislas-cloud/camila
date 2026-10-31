// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/stripe-webhook/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/stripe-plans.ts ──
const { PLAN_LIMITES, planKeyFromPriceId, resolverPlanCheckout } = (() => {
// Planes de suscripción: la ÚNICA fuente de verdad del plan es el Price ID configurado en el servidor.
// Antes, stripe-checkout aceptaba `priceId` y `planKey` del navegador y stripe-webhook caía a
// `session.metadata.plan_key` (también del navegador) cuando el precio no era uno de los tres: bastaba
// suscribirse a cualquier precio barato de la cuenta de Stripe con planKey="premium" para obtener ese plan.
// Funciones puras, sin Deno ni Stripe, para poder probarlas.

const PLAN_LIMITES: Record<string, number> = { esencial: 15, profesional: 40, premium: 100 };

interface PreciosPlanes {
  esencial?: string | null;
  profesional?: string | null;
  premium?: string | null;
}

// Plan que corresponde a un Price ID de Stripe, o null si no es uno de los configurados.
function planKeyFromPriceId(priceId: string | null | undefined, prices: PreciosPlanes): string | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PLAN_LIMITES) as Array<keyof PreciosPlanes>) {
    const configurado = prices[plan];
    if (configurado && configurado === priceId) return plan;
  }
  return null;
}

type ResolucionCheckout =
  | { planKey: string; priceId: string }
  | { error: 'plan_invalido' | 'plan_no_configurado' };

// Qué cobrar para el plan pedido por el cliente: el Price ID sale del servidor, nunca del cliente.
function resolverPlanCheckout(planKey: unknown, prices: PreciosPlanes): ResolucionCheckout {
  if (typeof planKey !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN_LIMITES, planKey)) {
    return { error: 'plan_invalido' };
  }
  const priceId = prices[planKey as keyof PreciosPlanes];
  if (!priceId) return { error: 'plan_no_configurado' };
  return { planKey, priceId };
}

return { PLAN_LIMITES, planKeyFromPriceId, resolverPlanCheckout };
})();

// ── stripe-webhook/index.ts ──
// Supabase Edge Function: recibe los webhooks de Stripe y mantiene
// camila_tenants sincronizado con el estado real de la suscripción.
//
// En Stripe Dashboard → Developers → Webhooks, apunta el endpoint a:
//   https://<tu-proyecto>.supabase.co/functions/v1/stripe-webhook
// y selecciona los eventos: checkout.session.completed,
// invoice.payment_succeeded, customer.subscription.deleted,
// customer.subscription.updated
//
// Secrets requeridos (además de los de stripe-checkout):
//   STRIPE_WEBHOOK_SECRET     whsec_...
//   STRIPE_PRICE_ESENCIAL     price_...  (Price ID del plan Esencial)
//   STRIPE_PRICE_PROFESIONAL  price_...
//   STRIPE_PRICE_PREMIUM      price_...

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const LIMITES = PLAN_LIMITES;

// El plan sale SOLO del Price ID configurado en el servidor (_shared/stripe-plans.ts). Un precio que no
// sea uno de los tres no cambia el plan: antes caía a metadata.plan_key (que viene del navegador).
function planDelPrecio(priceId: string): string | null {
  return planKeyFromPriceId(priceId, {
    esencial: Deno.env.get('STRIPE_PRICE_ESENCIAL'),
    profesional: Deno.env.get('STRIPE_PRICE_PROFESIONAL'),
    premium: Deno.env.get('STRIPE_PRICE_PREMIUM'),
  });
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (e) {
    console.error('[stripe-webhook] firma inválida:', e.message);
    return new Response('Firma inválida', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id || session.metadata?.tenant_id;
        if (!tenantId || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0]?.price?.id;
        const planKey = priceId ? planDelPrecio(priceId) : null;

        const update: Record<string, unknown> = {
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscription.id,
          activo: true,
          vence_en: new Date(subscription.current_period_end * 1000).toISOString(),
        };
        if (planKey) {
          update.plan = planKey;
          update.limite_diagnosticos = LIMITES[planKey];
          update.diagnosticos_usados = 0;
        } else {
          // Precio que no corresponde a un plan configurado: se registra la suscripción pero NO se cambia el plan.
          console.error('[stripe-webhook] Price ID desconocido; el plan no se modificó:', priceId);
        }
        await supabaseAdmin.from('camila_tenants').update(update).eq('id', tenantId);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const tenantId = subscription.metadata?.tenant_id;
        if (!tenantId) break;

        // Renovación de periodo: se resetea el contador de diagnósticos usados.
        await supabaseAdmin.from('camila_tenants').update({
          activo: true,
          diagnosticos_usados: 0,
          vence_en: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq('id', tenantId);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;
        if (!tenantId) break;
        const priceId = subscription.items.data[0]?.price?.id;
        const planKey = priceId && planDelPrecio(priceId);
        const update: Record<string, unknown> = {
          vence_en: new Date(subscription.current_period_end * 1000).toISOString(),
          activo: subscription.status === 'active' || subscription.status === 'trialing',
        };
        if (planKey) {
          update.plan = planKey;
          update.limite_diagnosticos = LIMITES[planKey];
        }
        await supabaseAdmin.from('camila_tenants').update(update).eq('id', tenantId);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = subscription.metadata?.tenant_id;
        if (!tenantId) break;
        await supabaseAdmin.from('camila_tenants').update({ activo: false }).eq('id', tenantId);
        break;
      }
    }

    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[stripe-webhook] error procesando evento:', e);
    return new Response(JSON.stringify({ error: 'Error procesando el evento' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
