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
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const APP_URL = Deno.env.get('APP_URL') || 'https://gfogifozhhbzxhcbecgf.supabase.co';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const authUser = userData.user;

    const { priceId, planKey } = await req.json();
    if (!priceId || !planKey) {
      return new Response(JSON.stringify({ error: 'Falta priceId o planKey' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[stripe-checkout] error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Error interno' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
