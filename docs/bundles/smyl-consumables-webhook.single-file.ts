// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/smyl-consumables-webhook/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";



// ── smyl-consumables-webhook/index.ts ──
// Webhook de Stripe para compras consumibles (etapa 8). Endpoint propio, con su
// propio secreto de firma; nunca mezclado con stripe-webhook (suscripción).
//
// Stripe Dashboard → Developers → Webhooks → Add endpoint:
//   https://<proyecto>.supabase.co/functions/v1/smyl-consumables-webhook
// Eventos: checkout.session.completed, checkout.session.async_payment_succeeded,
//          checkout.session.async_payment_failed, checkout.session.expired,
//          charge.refunded
// Secret: STRIPE_CONSUMABLES_WEBHOOK_SECRET (whsec_…, distinto del de suscripción).
//
// Toda la acreditación ocurre en una RPC transaccional; este handler sólo
// verifica la firma, filtra eventos y pasa identificadores e importes.

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);
const ALLOWED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
]);

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function text(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "method" });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const secret = Deno.env.get("STRIPE_CONSUMABLES_WEBHOOK_SECRET") || "";
  if (!stripeKey || !secret) {
    console.error("[smyl-consumables-webhook] secretos ausentes");
    return reply(503, { error: "not_configured" });
  }

  const signature = req.headers.get("stripe-signature") || "";
  const payload = await req.text(); // cuerpo crudo, sin parsear antes de verificar
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    console.warn("[smyl-consumables-webhook] firma inválida:", error instanceof Error ? error.message : "error");
    return reply(400, { error: "signature" });
  }
  if (!ALLOWED_EVENTS.has(event.type)) return reply(200, { received: true, ignored: event.type });

  try {
    let result: { data: unknown; error: { message: string } | null };
    if (event.type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      // Sólo nuestras sesiones de consumibles; las de suscripción siguen en stripe-webhook.
      if (session.metadata?.smyl_kind !== "consumable") return reply(200, { received: true, ignored: "not_consumable" });
      const metaCheckout = isUuid(session.metadata?.smyl_checkout_id) ? session.metadata!.smyl_checkout_id : null;
      const metaTenant = isUuid(session.metadata?.smyl_tenant_id) ? session.metadata!.smyl_tenant_id : null;
      const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

      const paid = (event.type === "checkout.session.completed" && session.payment_status === "paid")
        || event.type === "checkout.session.async_payment_succeeded";
      if (paid) {
        result = await admin.rpc("smyl_consumables_confirm_payment", {
          p_provider: "stripe",
          p_provider_event_id: text(event.id, 120),
          p_event_type: text(event.type, 80),
          p_provider_checkout_id: text(session.id, 120),
          p_provider_payment_id: paymentIntent ? text(paymentIntent, 120) : null,
          p_amount_minor: session.amount_total ?? null,
          p_currency: text(session.currency, 8),
          p_metadata_checkout_id: metaCheckout,
          p_metadata_tenant_id: metaTenant,
        });
      } else if (event.type === "checkout.session.completed") {
        // Pago diferido (OXXO/SPEI): sigue pendiente hasta async_payment_succeeded.
        return reply(200, { received: true, pending: true });
      } else {
        result = await admin.rpc("smyl_consumables_mark_closed", {
          p_provider: "stripe",
          p_provider_event_id: text(event.id, 120),
          p_event_type: text(event.type, 80),
          p_provider_checkout_id: text(session.id, 120),
          p_new_status: event.type === "checkout.session.expired" ? "expired" : "failed",
          p_reason: event.type === "checkout.session.expired" ? "Sesión de pago vencida" : "Pago asíncrono fallido",
        });
      }
    } else {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
      if (!paymentIntent) return reply(200, { received: true, ignored: "no_payment_intent" });
      result = await admin.rpc("smyl_consumables_refund", {
        p_provider: "stripe",
        p_provider_event_id: text(event.id, 120),
        p_event_type: text(event.type, 80),
        p_provider_payment_id: text(paymentIntent, 120),
        p_amount_refunded_minor: charge.amount_refunded ?? 0,
        p_currency: text(charge.currency, 8),
      });
    }

    if (result.error) {
      console.error("[smyl-consumables-webhook] rpc", event.type, result.error.message);
      return reply(500, { error: "processing" }); // Stripe reintenta
    }
    const outcome = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>).outcome : null;
    console.log(JSON.stringify({ event: "consumable_webhook", type: event.type, id: event.id, outcome }));
    return reply(200, { received: true, outcome });
  } catch (error) {
    console.error("[smyl-consumables-webhook]", error instanceof Error ? error.message : error);
    return reply(500, { error: "processing" });
  }
});
