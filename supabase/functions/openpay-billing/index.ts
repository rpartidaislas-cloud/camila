// Suscripciones de SMYL con Openpay — acciones del DUEÑO de la clínica (JWT obligatorio).
//   POST { action: "config" }                                  → datos públicos para tokenizar la tarjeta en el navegador
//   POST { action: "summary" }                                 → plan, estado, próximo cobro y tarjeta (marca + 4 dígitos)
//   POST { action: "subscribe", plan_key, periodo, token_id, device_session_id }
//   POST { action: "cancel" } | { action: "resume" }           → dejar de renovar / reactivar (acceso hasta el fin del periodo pagado)
//   POST { action: "change_card", token_id, device_session_id }
// La tarjeta nunca llega aquí: el navegador la convierte en `token_id` con openpay.js. El precio y el plan_id salen del servidor.
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { BillingError } from "../_shared/openpay-billing-core.mjs";
import { billing, openpayConfigured, OPENPAY_ENV, OPENPAY_MERCHANT_ID, OPENPAY_PUBLIC_KEY, billingAdmin } from "../_shared/openpay-runtime.ts";

const MAX_BODY = 4096;
const TOKEN_RE = /^[A-Za-z0-9_-]{6,80}$/;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

function json(cors: Record<string, string>, status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

Deno.serve(async (req) => {
  const cors = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(cors, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, cors);
  if (auth.response) return auth.response;
  const user = auth.user!;
  // La suscripción pertenece a la clínica: solo su dueño (id = tenant) puede contratarla o cambiarla.
  if (!auth.tenantId || user.id !== auth.tenantId) return json(cors, 403, { error: "Solo el dueño de la clínica puede gestionar la suscripción." });
  if (!openpayConfigured()) return json(cors, 503, { error: "El pago con tarjeta todavía no está activo. Escríbenos y lo activamos contigo." });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(cors, 413, { error: "Solicitud demasiado grande." });
  let body: Json = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json(cors, 400, { error: "Solicitud no válida." }); }
  const action = text(body.action, 30);
  const tenantId = auth.tenantId;

  try {
    if (action === "config") {
      return json(cors, 200, { merchant_id: OPENPAY_MERCHANT_ID, public_key: OPENPAY_PUBLIC_KEY, sandbox: OPENPAY_ENV !== "production" });
    }
    if (action === "summary") return json(cors, 200, await billing.summary(tenantId));

    if (action === "subscribe") {
      const tokenId = text(body.token_id, 80), deviceSessionId = text(body.device_session_id, 80);
      if (!TOKEN_RE.test(tokenId) || !TOKEN_RE.test(deviceSessionId)) return json(cors, 400, { error: "Faltan los datos de la tarjeta." });
      const { data: tenant } = await billingAdmin.from("camila_tenants").select("nombre").eq("id", tenantId).maybeSingle();
      const result = await billing.subscribe({
        tenantId, name: tenant?.nombre || "Clínica", email: user.email || "", planKey: body.plan_key, periodo: body.periodo, tokenId, deviceSessionId,
      });
      return json(cors, 200, result);
    }
    if (action === "cancel") return json(cors, 200, await billing.cancel(tenantId));
    if (action === "resume") return json(cors, 200, await billing.resume(tenantId));
    if (action === "change_card") {
      const tokenId = text(body.token_id, 80), deviceSessionId = text(body.device_session_id, 80);
      if (!TOKEN_RE.test(tokenId) || !TOKEN_RE.test(deviceSessionId)) return json(cors, 400, { error: "Faltan los datos de la tarjeta." });
      return json(cors, 200, await billing.changeCard({ tenantId, tokenId, deviceSessionId }));
    }
    return json(cors, 400, { error: "Acción no reconocida." });
  } catch (error) {
    if (error instanceof BillingError) return json(cors, error.http, { error: error.message, code: error.code });
    console.error("[openpay-billing]", (error as Error)?.message);
    return json(cors, 500, { error: "No se pudo completar la operación. Intenta de nuevo en unos minutos." });
  }
});
