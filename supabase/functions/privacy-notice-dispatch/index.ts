// Aviso de privacidad automático por WhatsApp a pacientes nuevos (ver la migración 20261124200000).
// La llama el panel con la sesión de quien lo abre (patients.manage). Si la clínica lo tiene apagado, no hace nada.
// Para cada paciente nuevo con WhatsApp ligado: reserva el envío (uno solo por paciente), crea el enlace de firma con la sesión de
// quien llama, y lo manda por LANA con la plantilla aprobada «aviso_privacidad_v1». Si algo falla se libera la reserva y se reintenta
// en la siguiente apertura. Nunca manda texto libre ni sale de la plantilla aprobada.
import { createClient } from "npm:@supabase/supabase-js@2";
import { requirePermission, requireUser } from "../_shared/auth.ts";
import { makeCors } from "../_shared/cors.ts";
import { lanaRequest } from "../_shared/lana-linked.ts";
import { MAX_PER_RUN, approvedTemplateId, idempotencyKey, templateVariables } from "../_shared/privacy-dispatch-core.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SB_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
const APP_BASE = Deno.env.get("SMYL_APP_BASE_URL") || "https://app.smyldesign.ai";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function actorHeaders(tenantId: string, user: { id: string; email?: string }): Headers {
  const name = String(user.email || "").split("@")[0].slice(0, 160) || "Equipo";
  return new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": user.id === tenantId ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(name),
  });
}

async function templateId(tenantId: string, user: { id: string; email?: string }): Promise<string | null> {
  const list = await lanaRequest(tenantId, "/inbox/whatsapp/templates", { method: "GET", headers: actorHeaders(tenantId, user) }, 12000);
  return approvedTemplateId(list.body.templates);
}

Deno.serve(async (req: Request) => {
  const cors = makeCors(req);
  const json = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Método no permitido." });
  const auth = await requireUser(req, cors);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(401, { error: "Inicia sesión." });
  const denied = await requirePermission(auth, cors, "patients.manage");
  if (denied) return denied;
  const tenantId = auth.tenantId, user = auth.user;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo: se toma como dispatch */ }
  const action = String(body.action || "dispatch");

  try {
    const settings = await admin.from("smyl_privacy_settings").select("auto_send_notice").eq("tenant_id", tenantId).maybeSingle();
    if (settings.error) return json(503, { error: "No se pudo leer el ajuste." });
    const enabled = settings.data?.auto_send_notice === true;

    if (action === "status") {
      let ready = false, lanaOk = true;
      try { ready = (await templateId(tenantId, user)) !== null; } catch { lanaOk = false; }
      return json(200, { enabled, template_ready: ready, lana_available: lanaOk });
    }
    if (action !== "dispatch") return json(400, { error: "Acción no válida." });
    if (!enabled) return json(200, { enabled: false, sent: 0 });

    let tpl: string | null = null;
    try { tpl = await templateId(tenantId, user); } catch { return json(200, { enabled: true, sent: 0, reason: "lana_unavailable" }); }
    if (!tpl) return json(200, { enabled: true, sent: 0, reason: "template_not_approved" });

    const candidates = await admin.rpc("smyl_privacy_dispatch_candidates", { p_tenant: tenantId, p_limit: MAX_PER_RUN });
    if (candidates.error) return json(503, { error: "No se pudieron revisar los pacientes nuevos." });
    const rows = (candidates.data || []) as { patient_id: string; first_name: string | null; conversation_id: string }[];
    if (!rows.length) return json(200, { enabled: true, sent: 0, reason: "none" });

    const clinic = await admin.from("camila_tenants").select("nombre").eq("id", tenantId).maybeSingle();
    const clinicName = String(clinic.data?.nombre || "").trim() || "tu clínica";
    const asUser = createClient(SB_URL, SB_ANON_KEY, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    let sent = 0, failed = 0;
    for (const row of rows) {
      const claim = await admin.rpc("smyl_privacy_dispatch_claim", { p_tenant: tenantId, p_patient: row.patient_id });
      if (claim.error || claim.data !== true) continue;
      let ok = false;
      try {
        const link = await asUser.rpc("smyl_create_consent_link", { p_patient_id: row.patient_id });
        const token = String(link.data || "");
        if (link.error || !/^[0-9a-f]{64}$/.test(token)) throw new Error("link");
        const headers = actorHeaders(tenantId, user);
        headers.set("Idempotency-Key", idempotencyKey(tenantId, row.patient_id));
        const remote = await lanaRequest(tenantId, `/inbox/conversations/${row.conversation_id}/scheduled`, {
          method: "POST", headers,
          body: JSON.stringify({ type: "template", send_at: new Date(Date.now() + 60_000).toISOString(), template_id: tpl,
            template_variables: templateVariables({ firstName: row.first_name, clinic: clinicName, base: APP_BASE, token }) }),
        }, 15000);
        ok = remote.response.ok;
      } catch (error) {
        console.warn("[privacy-notice-dispatch]", error instanceof Error ? error.message : "error");
      }
      await admin.rpc("smyl_privacy_dispatch_finish", { p_tenant: tenantId, p_patient: row.patient_id, p_ok: ok });
      if (ok) sent++; else failed++;
    }
    return json(200, { enabled: true, sent, failed });
  } catch {
    return json(503, { error: "No se pudo completar el envío. Se reintentará más tarde." });
  }
});
