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

// ── _shared/auth-membership.ts ──
const { decidirMembresia } = (() => {
// Decisión pura (sin red) sobre la membresía de quien llama a una Edge Function privada.
// Vive aparte de auth.ts para poder probarla sin Deno ni Supabase.
//
// `row` es la fila de camila_usuarios de la persona (o null si no tiene: el dueño de siempre
// es una cuenta cuyo id = tenant_id y puede no tener fila). Si la fila existe pero está
// desactivada, la persona ya no pertenece al equipo: no se le resuelve ninguna clínica
// (antes se ignoraba `activo` y un staff dado de baja seguía usando las funciones con el
// service role).
interface FilaMembresia {
  tenant_id?: string | null;
  activo?: boolean | null;
}

type DecisionMembresia = { tenantId: string } | { inactivo: true };

function decidirMembresia(row: FilaMembresia | null | undefined, userId: string): DecisionMembresia {
  if (row && row.activo === false) return { inactivo: true };
  if (row?.tenant_id) return { tenantId: row.tenant_id };
  return { tenantId: userId };
}

return { decidirMembresia };
})();

// ── _shared/auth.ts ──
const { requireUser, requirePermission } = (() => {
// Verificación obligatoria de sesión para Edge Functions privadas.
// Una publishable key identifica el proyecto, pero nunca autentica a una
// persona. Los flujos públicos deben usar funciones separadas con capacidades
// limitadas; nunca deben reutilizar este helper ni aceptar tenant_id del cliente.


// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY vienen inyectadas automáticamente
// en el entorno de toda Edge Function. `segment-teeth` usa nombres propios
// (SB_URL / SB_SERVICE_ROLE_KEY) porque el prefijo SUPABASE_ está reservado
// y no se puede definir a mano en Secrets, así que aceptamos ambos.
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';

const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

interface AuthResult {
  user: { id: string; email?: string } | null;
  // La clínica real de quien llama -- NO uses user.id para topes de gasto,
  // RPCs ni escrituras con tenant_id, usa siempre este campo. Para el dueño
  // coincide con user.id (de siempre); para staff invitado (etapa 4, ver
  // camila_team.sql/camila_usuarios) es la clínica de quien lo invitó.
  // Antes de esto, claude/index.ts y segment-teeth/index.ts usaban user.id
  // directo: camila_consumir_diagnostico nunca encontraba la fila de un
  // staff en camila_tenants (rechazo 402, "no se encontró tu clínica"), y
  // segment-teeth guardaba la segmentación con un tenant_id que no
  // pertenecía a ningún caso real -- se perdía en silencio. null si no hay
  // sesión.
  tenantId: string | null;
  response: Response | null; // si no es null, devuélvela tal cual y no sigas
}

// Mismo patrón que ya usa el cliente (cargarTenantConfig() en
// simulacion.html, continuarConUsuario() en app.html): resuelve si quien
// llama es staff antes de asumir que su propio auth.uid() es el tenant.
// Si la persona tiene fila en camila_usuarios pero está desactivada, ya no pertenece al equipo y no
// se le resuelve ninguna clínica (decidirMembresia, _shared/auth-membership.ts).
async function resolverMembresia(userId: string): Promise<DecisionMembresia> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id, activo')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return decidirMembresia(data, userId);
}

async function requireUser(req: Request, cors: Record<string, string>): Promise<AuthResult> {
  const deny = (msg: string) => ({
    user: null,
    tenantId: null,
    response: new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return deny('No autenticado: falta el header Authorization.');

  // Esta llamada corre ANTES de cualquier otro código de la función (incluido
  // el fetchConTimeout de claude/index.ts) -- si se queda colgada sin límite
  // de tiempo, la plataforma mata el proceso a medio camino sin headers de
  // CORS ("CORS error" en el navegador) y ningún timeout más adelante en el
  // código llega siquiera a ejecutarse. Se le pone su propio límite (8s,
  // suficiente para una llamada a la API de Auth de Supabase en condiciones
  // normales) para que, si falla, devuelva una respuesta real con CORS en
  // vez de dejar que la plataforma la corte a ciegas.
  let seTardo = false;
  const timeout = new Promise<{ data: null }>((resolve) => {
    setTimeout(() => { seTardo = true; resolve({ data: null }); }, 8000);
  });
  const { data } = await Promise.race([
    admin.auth.getUser(jwt).catch(() => ({ data: null })),
    timeout,
  ]);
  if (data?.user) {
    try {
      const membresia = await resolverMembresia(data.user.id);
      if ('inactivo' in membresia) {
        return {
          user: null,
          tenantId: null,
          response: new Response(JSON.stringify({ error: 'Tu acceso a esta clínica está desactivado. Pide al dueño que lo reactive.' }), {
            status: 403,
            headers: { ...cors, 'Content-Type': 'application/json' },
          }),
        };
      }
      return { user: { id: data.user.id, email: data.user.email }, tenantId: membresia.tenantId, response: null };
    } catch (error) {
      console.error('[auth] no se pudo resolver el tenant del usuario:', error instanceof Error ? error.message : 'error desconocido');
      return {
        user: null,
        tenantId: null,
        response: new Response(JSON.stringify({ error: 'No se pudo verificar el acceso a la clínica. Intenta de nuevo.' }), {
          status: 503,
          headers: { ...cors, 'Content-Type': 'application/json' },
        }),
      };
    }
  }

  if (seTardo) return deny('No se pudo verificar la sesión a tiempo (Supabase Auth no respondió). Intenta de nuevo.');

  return deny('No autenticado: la sesión no es válida o ya expiró.');
}

// Exige un permiso del modelo de roles de SMYL (smyl_member_roles / smyl_role_permissions) además de
// la sesión. El dueño (user.id === tenantId) siempre pasa; el staff solo si su rol activo tiene el
// permiso. Falla cerrado: si la consulta falla, se niega. Devuelve una Response para regresar tal
// cual, o null si se puede continuar.
async function requirePermission(
  auth: AuthResult,
  cors: Record<string, string>,
  permission: string,
): Promise<Response | null> {
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!auth.user || !auth.tenantId) return reply(401, 'Necesitas iniciar sesión.');
  if (auth.user.id === auth.tenantId) return null;
  const { data, error } = await admin.rpc('smyl_actor_has_permission_explicit', {
    p_actor: auth.user.id,
    p_tenant: auth.tenantId,
    p_permission: permission,
  });
  if (error) {
    console.error('[auth] no se pudo verificar el permiso:', error.message);
    return reply(503, 'No se pudo verificar tu permiso. Intenta de nuevo.');
  }
  if (data !== true) return reply(403, 'Tu rol no tiene permiso para esta acción.');
  return null;
}

return { requireUser, requirePermission };
})();

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
