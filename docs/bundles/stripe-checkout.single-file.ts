// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/stripe-checkout/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/cors.ts ──
const { makeCors, corsPublic, corsHeaders } = (() => {
// Orígenes autorizados para funciones privadas (autenticadas).
// Las funciones públicas (webhooks, portales de paciente) usan corsPublic o "*" directamente.
const ALLOWED_ORIGINS = new Set([
  'https://app.smyldesign.ai',
  'https://rpartidaislas-cloud.github.io',
]);

// Para funciones privadas: refleja el origen si está en la lista; si no, bloquea con el origen
// principal. Siempre incluye Vary:Origin para que las cachés no reutilicen respuestas entre orígenes.
function makeCors(req: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.smyldesign.ai',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': methods,
    'Vary': 'Origin',
  };
}

// Para endpoints públicos que legítimamente necesitan "*" (portales de paciente, formularios públicos).
const corsPublic: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Alias de compatibilidad hacia atrás (stripe-checkout, stripe-portal).
const corsHeaders = corsPublic;

return { makeCors, corsPublic, corsHeaders };
})();

// ── stripe-checkout/index.ts ──
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
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(jwt);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    const authUser = userData.user;

    const { priceId, planKey } = await req.json();
    if (!priceId || !planKey) {
      return new Response(JSON.stringify({ error: 'Falta priceId o planKey' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
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

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[stripe-checkout] error:', e);
    return new Response(JSON.stringify({ error: e.message || 'Error interno' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
});
