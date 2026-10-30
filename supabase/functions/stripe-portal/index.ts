// Supabase Edge Function: abre el Billing Portal hosteado por Stripe para
// que la doctora cambie de plan, actualice su tarjeta o cancele por su
// cuenta, sin que tengamos que construir esa UI nosotros.
//
// Mismos secrets que stripe-checkout (STRIPE_SECRET_KEY, APP_URL).
import Stripe from 'npm:stripe@17';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeCors } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';

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
    // El portal de facturación es de la clínica: solo su dueño puede abrirlo.
    if (authUser.id !== auth.tenantId) {
      return new Response(JSON.stringify({ error: 'Solo el dueño de la clínica puede gestionar la suscripción.' }), { status: 403, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const { data: tenant } = await supabaseAdmin.from('camila_tenants').select('stripe_customer_id').eq('id', authUser.id).single();
    if (!tenant?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: 'Todavía no tienes una suscripción activa.' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${APP_URL}/app.html`,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[stripe-portal] error:', e);
    return new Response(JSON.stringify({ error: 'No se pudo abrir el portal de facturación. Intenta de nuevo.' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
});
