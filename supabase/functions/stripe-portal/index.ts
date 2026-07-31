// Supabase Edge Function: abre el Billing Portal hosteado por Stripe para
// que la doctora cambie de plan, actualice su tarjeta o cancele por su
// cuenta, sin que tengamos que construir esa UI nosotros.
//
// Mismos secrets que stripe-checkout (STRIPE_SECRET_KEY, APP_URL).
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

    const { data: tenant } = await supabaseAdmin.from('camila_tenants').select('stripe_customer_id').eq('id', authUser.id).single();
    if (!tenant?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'Todavía no tienes una suscripción activa.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${APP_URL}/app.html`,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[stripe-portal] error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Error interno' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
