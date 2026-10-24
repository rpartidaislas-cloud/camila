// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/smyl-consumables-checkout/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/auth.ts ──
const { requireUser } = (() => {
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
async function resolverTenantId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('camila_usuarios')
    .select('tenant_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data?.tenant_id) return data.tenant_id;
  return userId;
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
      const tenantId = await resolverTenantId(data.user.id);
      return { user: { id: data.user.id, email: data.user.email }, tenantId, response: null };
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

return { requireUser };
})();

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

// ── smyl-consumables-checkout/index.ts ──
// Compra de paquetes consumibles (etapa 8): crea o recupera la sesión interna
// por clave idempotente y abre un Stripe Checkout en modo pago usando sólo el
// snapshot del servidor. Nunca acredita saldo: eso lo hace el webhook firmado.
//
// Secrets: STRIPE_SECRET_KEY (ya existe), APP_URL (origen HTTPS permitido para
// las URLs de regreso; ver ALLOWED_RETURN_HOSTS).

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const ALLOWED_RETURN_HOSTS = new Set(["app.smyldesign.ai", "rpartidaislas-cloud.github.io", "localhost"]);
const CHECKOUT_TTL_MINUTES = 30;
const MAX_BODY_BYTES = 2048;
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function json(cors: Record<string, string>, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function isProductId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}
function publicRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "chk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function returnOrigin(): string | null {
  const raw = Deno.env.get("APP_URL") || "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    if (!ALLOWED_RETURN_HOSTS.has(url.hostname)) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const { user, tenantId, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;
  if (!user || !tenantId) return json(CORS, 401, { error: "Sesión requerida." });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(CORS, 413, { error: "Solicitud demasiado grande." });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return json(CORS, 400, { error: "Solicitud inválida." }); }
  const productId = body.product_id;
  const idempotencyKey = body.idempotency_key;
  if (!isProductId(productId) || !isUuid(idempotencyKey)) {
    return json(CORS, 400, { error: "Paquete o clave de compra inválidos." });
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const can = await asUser.rpc("smyl_consumables_can_purchase", { p_tenant_id: tenantId });
  if (can.error || can.data !== true) return json(CORS, 403, { error: "Tu rol no permite comprar paquetes." });

  const base = returnOrigin();
  if (!base) {
    console.error("[smyl-consumables-checkout] APP_URL ausente o fuera de la lista permitida");
    return json(CORS, 503, { error: "La compra no está disponible por ahora." });
  }
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!stripeKey) return json(CORS, 503, { error: "La compra no está disponible por ahora." });

  const begun = await admin.rpc("smyl_consumables_checkout_begin", {
    p_tenant_id: tenantId, p_requested_by: user.id, p_product_id: productId,
    p_idempotency_key: idempotencyKey, p_public_ref: publicRef(),
  });
  if (begun.error) {
    const code = String(begun.error.code || "");
    if (code === "P0002") return json(CORS, 409, { error: "Este paquete no está disponible para compra." });
    if (code === "23505") return json(CORS, 409, { error: "La clave de compra ya se usó con otro paquete." });
    console.error("[smyl-consumables-checkout] begin", code, begun.error.message);
    return json(CORS, 500, { error: "No pudimos preparar la compra." });
  }
  const session = begun.data as Record<string, any>;

  if (["completed", "refunded", "failed", "expired"].includes(session.status)) {
    return json(CORS, 409, { error: "Esta compra ya terminó.", status: session.status, checkout_id: session.public_ref });
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    // Reintento con la misma clave y checkout ya abierto: devolver la misma URL.
    if (session.status === "pending" && session.provider_checkout_id) {
      const existing = await stripe.checkout.sessions.retrieve(session.provider_checkout_id);
      if (existing.status === "open" && existing.url) {
        return json(CORS, 200, { checkout_url: existing.url, checkout_id: session.public_ref });
      }
      if (existing.status === "complete") {
        return json(CORS, 409, { error: "El pago ya fue enviado; esperando confirmación.", status: "pending", checkout_id: session.public_ref });
      }
      return json(CORS, 409, { error: "La sesión de pago venció. Inicia una compra nueva.", status: "expired", checkout_id: session.public_ref });
    }

    const { data: product } = await admin.from("smyl_consumable_products").select("nombre").eq("id", productId).maybeSingle();
    const { data: tenant } = await admin.from("camila_tenants").select("stripe_customer_id").eq("id", tenantId).maybeSingle();
    const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MINUTES * 60;
    const metadata = { smyl_checkout_id: session.id, smyl_tenant_id: tenantId, smyl_product_id: productId, smyl_kind: "consumable" };

    const created = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: session.id,
      ...(tenant?.stripe_customer_id ? { customer: tenant.stripe_customer_id } : { customer_email: user.email || undefined }),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(session.currency).toLowerCase(),
          unit_amount: Number(session.price_minor),
          product_data: { name: product?.nombre || "Paquete SMYL", metadata: { smyl_product_id: productId } },
        },
      }],
      metadata,
      payment_intent_data: { metadata },
      expires_at: expiresAt,
      success_url: `${base}/consumos.html?checkout=success&checkout_id=${session.public_ref}`,
      cancel_url: `${base}/consumos.html?checkout=cancel&checkout_id=${session.public_ref}`,
    }, { idempotencyKey: `smyl-consumable-${session.id}` });

    const attached = await admin.rpc("smyl_consumables_checkout_attach", {
      p_checkout_id: session.id, p_provider_checkout_id: created.id,
      p_expires_at: new Date(expiresAt * 1000).toISOString(),
    });
    if (attached.error) {
      console.error("[smyl-consumables-checkout] attach", attached.error.message);
      try { await stripe.checkout.sessions.expire(created.id); } catch { /* ya vencida o pagada */ }
      return json(CORS, 500, { error: "No pudimos registrar la sesión de pago." });
    }
    if (!created.url || !created.url.startsWith("https://")) {
      return json(CORS, 502, { error: "El proveedor no devolvió una URL segura." });
    }
    console.log(JSON.stringify({ event: "consumable_checkout_created", checkout: session.id, tenant: tenantId, product: productId }));
    return json(CORS, 200, { checkout_url: created.url, checkout_id: session.public_ref });
  } catch (error) {
    console.error("[smyl-consumables-checkout] stripe", error instanceof Error ? error.message : error);
    return json(CORS, 502, { error: "El proveedor de pago no respondió. Intenta de nuevo." });
  }
});
