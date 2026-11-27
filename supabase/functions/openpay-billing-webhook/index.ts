// Aviso de pagos de Openpay para las suscripciones de SMYL (servidor a servidor, SIN JWT: despliégala con la verificación de JWT apagada).
//
// Openpay no firma sus avisos: se autentican con el usuario y la contraseña (HTTP Basic) que se definen al dar de alta el webhook
// (OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD). Aun así NO se confía en el contenido: solo identifica a la clínica y se reconsulta la API.
// Alta del webhook en Openpay: URL = https://<proyecto>.supabase.co/functions/v1/openpay-billing-webhook, eventos:
//   charge.succeeded, charge.failed, subscription.charge.failed (y los de suscripción que ofrezca el panel).
// Al registrarlo Openpay manda un evento `verification` con un código: queda en los registros de la función y en smyl_billing_events.
import { basicValido } from "../_shared/openpay-plans.mjs";
import { billing, billingAdmin, OPENPAY_ENV } from "../_shared/openpay-runtime.ts";

const USER = Deno.env.get("OPENPAY_WEBHOOK_USER") || "";
const PASSWORD = Deno.env.get("OPENPAY_WEBHOOK_PASSWORD") || "";
const MAX_BODY = 16384;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!basicValido(req.headers.get("authorization"), USER, PASSWORD)) return reply(401, { error: "unauthorized" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "too_large" });
  // deno-lint-ignore no-explicit-any
  let event: Record<string, any> = {};
  try { event = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }

  try {
    if (event.type === "verification") {
      const code = String(event.verification_code || "").slice(0, 40);
      console.log("[openpay-billing-webhook] código de verificación:", code);
      if (code) await billingAdmin.from("smyl_billing_events").upsert({ event_key: "verification:" + code, environment: OPENPAY_ENV, event_type: "verification" }, { onConflict: "event_key,environment", ignoreDuplicates: true });
      return reply(200, { ok: true });
    }
    return reply(200, await billing.handleWebhook(event));
  } catch (error) {
    // 500 → Openpay reintenta el aviso más tarde.
    console.error("[openpay-billing-webhook]", (error as Error)?.message);
    return reply(500, { error: "No se pudo procesar el aviso." });
  }
});
