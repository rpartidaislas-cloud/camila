// Estado comercial seguro de un checkout (etapa 8). Valida sesión, resuelve el
// tenant en servidor y delega en la RPC smyl_consumables_checkout_status, que
// sólo devuelve filas del tenant del usuario con permiso comercial. La
// redirección de éxito nunca acredita; aquí sólo se lee lo que el webhook dejó.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const MAX_BODY_BYTES = 512;

function json(cors: Record<string, string>, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
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
  const ref = body.checkout_id;
  if (typeof ref !== "string" || !/^chk_[a-f0-9]{32}$/.test(ref)) {
    return json(CORS, 404, { error: "No encontramos esa compra." });
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await asUser.rpc("smyl_consumables_checkout_status", { p_public_ref: ref });
  if (error) {
    console.error("[smyl-consumables-checkout-status]", error.code, error.message);
    return json(CORS, 500, { error: "No pudimos consultar el estado." });
  }
  // Misma respuesta para "no existe" y "no es tuyo": no se puede enumerar.
  if (!data || typeof data !== "object") return json(CORS, 404, { error: "No encontramos esa compra." });

  const row = data as Record<string, unknown>;
  return json(CORS, 200, {
    status: row.status,
    credited_resource: row.credited_resource ?? null,
    credited_units: row.credited_units ?? null,
    confirmed_at: row.confirmed_at ?? null,
  });
});
