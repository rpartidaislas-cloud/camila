// Supabase Edge Function: crea una Stripe Checkout Session de suscripción
// para el tenant autenticado y regresa la URL a la que el navegador debe
// redirigir. No usa el service role para nada delicado: solo para leer/
// escribir su propia fila en camila_tenants una vez identificado por el JWT.
//
// Secrets requeridos (Project Settings → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY        sk_test_... / sk_live_...
//   SUPABASE_URL             (ya viene inyectada automáticamente)
//   SUPABASE_SERVICE_ROLE_KEY (ya viene inyectada automáticamente)
//   APP_URL                  https://<tu-usuario>.github.io/camila  (o el dominio final)
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeCors } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { resolverPlanCheckout } from '../_shared/stripe-plans.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const APP_URL = Deno.env.get('APP_URL') || 'https://gfogifozhhbzxhcbecgf.supabase.co';

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const auth = await requireUser(req, CORS);
    if (auth.response) return auth.response;
    const authUser = auth.user!;
    // La suscripción pertenece a la clínica: solo el dueño (cuenta cuyo id = tenant) puede contratarla.
    if (authUser.id !== auth.tenantId) {
      return new Response(JSON.stringify({ error: 'Solo el dueño de la clínica puede gestionar la suscripción.' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* body vacío: se rechaza abajo */ }
    // El Price ID NUNCA viene del navegador: se resuelve en el servidor a partir del plan pedido
    // (si el cliente manda `priceId`, se ignora).
    const plan = resolverPlanCheckout(body?.planKey, {
      esencial: Deno.env.get('STRIPE_PRICE_ESENCIAL'),
      profesional: Deno.env.get('STRIPE_PRICE_PROFESIONAL'),
      premium: Deno.env.get('STRIPE_PRICE_PREMIUM'),
    });
    if ('error' in plan) {
      const sinConfigurar = plan.error === 'plan_no_configurado';
      return new Response(JSON.stringify({ error: sinConfigurar ? 'Este plan todavía no está disponible para contratar.' : 'Plan inválido.' }), {
        status: sinConfigurar ? 503 : 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const { planKey, priceId } = plan;

    const { data: tenant } = await supabaseAdmin.from('camila_tenants').select('*').eq('id', authUser.id).single();

    let customerId = tenant?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: authUser.email,
        metadata: { tenant_id: authUser.id },
      });
      customerId = customer.id;
      await supabaseAdmin.from('camila_tenants').update({ stripe_customer_id: customerId }).eq('id', authUser.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: authUser.id,
      metadata: { tenant_id: authUser.id, plan_key: planKey },
      subscription_data: { metadata: { tenant_id: authUser.id, plan_key: planKey } },
      success_url: `${APP_URL}/app.html?checkout=success`,
      cancel_url: `${APP_URL}/app.html?checkout=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[stripe-checkout] error:', e);
    return new Response(JSON.stringify({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
});
