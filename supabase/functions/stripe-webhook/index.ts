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
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const LIMITES: Record<string, number> = { esencial: 15, profesional: 40, premium: 100 };

function planKeyFromPriceId(priceId: string): string | null {
  if (priceId === Deno.env.get('STRIPE_PRICE_ESENCIAL')) return 'esencial';
  if (priceId === Deno.env.get('STRIPE_PRICE_PROFESIONAL')) return 'profesional';
  if (priceId === Deno.env.get('STRIPE_PRICE_PREMIUM')) return 'premium';
  return null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (e) {
    console.error('[stripe-webhook] firma inválida:', e.message);
    return new Response(`Webhook signature error: ${e.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id || session.metadata?.tenant_id;
        if (!tenantId || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0]?.price?.id;
        const planKey = (priceId && planKeyFromPriceId(priceId)) || session.metadata?.plan_key || 'profesional';

        await supabaseAdmin.from('camila_tenants').update({
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscription.id,
          plan: planKey,
          limite_diagnosticos: LIMITES[planKey] || 40,
          diagnosticos_usados: 0,
          activo: true,
          vence_en: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq('id', tenantId);
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
        const planKey = priceId && planKeyFromPriceId(priceId);
        const update: Record<string, unknown> = {
          vence_en: new Date(subscription.current_period_end * 1000).toISOString(),
          activo: subscription.status === 'active' || subscription.status === 'trialing',
        };
        if (planKey) {
          update.plan = planKey;
          update.limite_diagnosticos = LIMITES[planKey] || 40;
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
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
