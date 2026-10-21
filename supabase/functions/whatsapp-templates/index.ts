// Plantillas de WhatsApp desde SMYL: ver su estado en Meta y solicitarlas, todo a través de LANA.
//
// SMYL nunca habla con Meta ni guarda sus tokens: le pide a LANA (camila-api) que cree la plantilla
// con la cuenta de WhatsApp Business de la clínica y consulta cómo va. Por seguridad:
//  - Solo se pueden solicitar plantillas del catálogo revisado de SMYL, por su id. Nunca se acepta
//    texto libre del navegador, así que nadie puede mandar contenido arbitrario a Meta.
//  - Solo el propietario de la clínica puede solicitar (cada solicitud gasta cupo de revisión de
//    Meta y los rechazos repetidos pueden afectar la reputación de la cuenta).
//  - Cada plantilla se vuelve a validar con las reglas de Meta antes de enviarla.

import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { lanaRequest, smylAdmin } from "../_shared/lana-linked.ts";
import { TEMPLATES, LANGUAGE, validate } from "../_shared/whatsapp-template-catalog.mjs";
import { makeCors } from "../_shared/cors.ts";

function json(cors: Record<string, string>, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type Template = {
  id: string; category: string; body: string; footer: string;
  buttons: { type: string; text: string }[]; variables: { example: string }[];
};

async function isOwner(user: { id: string }, tenantId: string): Promise<boolean> {
  if (user.id === tenantId) return true;
  const { data } = await smylAdmin.from("camila_usuarios").select("rol,activo").eq("id", user.id).eq("tenant_id", tenantId).maybeSingle();
  return Boolean(data && data.activo !== false && data.rol === "dueño");
}

async function canRead(jwt: string, tenantId: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
  if (!anon) return false;
  const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data, error } = await client.rpc("smyl_has_permission", { p_tenant_id: tenantId, p_permission: "messages.read" });
  return !error && data === true;
}

// LANA exige saber quién consulta, incluso en lecturas.
function actorHeaders(user: { id: string; email?: string }, owner: boolean, idempotencyKey?: string): Headers {
  const name = text(user.email, 160).split("@")[0] || "Miembro del equipo";
  const headers = new Headers({
    "X-SMYL-Actor-Id": user.id,
    "X-SMYL-Actor-Role": owner ? "owner" : "staff",
    "X-SMYL-Actor-Name-Encoded": encodeURIComponent(name),
  });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return headers;
}

const REQUEST_ERRORS: Record<string, string> = {
  owner_required: "Solo el propietario de la clínica puede solicitar plantillas.",
  whatsapp_not_connected: "Conecta WhatsApp en tu panel de mensajería antes de solicitar plantillas.",
  template_rate_limited: "Ya se enviaron varias plantillas en la última hora. Espera un poco y vuelve a intentar.",
  template_name_taken: "Meta ya tiene una plantilla con ese nombre; si fue rechazada, hay que solicitar una versión nueva.",
  meta_unreachable: "Meta no respondió a tiempo. Intenta de nuevo en unos minutos.",
  meta_unavailable: "El servicio de mensajería no puede contactar a Meta en este momento.",
  template_in_progress: "Esta plantilla ya se está enviando a Meta. Espera un momento y actualiza.",
  template_not_recorded: "La plantilla se envió a Meta pero el servicio de mensajería no pudo registrarla. Vuelve a intentar para completarla.",
  template_lookup_failed: "El servicio de mensajería no pudo revisar la plantilla. Intenta de nuevo.",
};

Deno.serve(async (req) => {
  const CORS = makeCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "Método no permitido." });

  const auth = await requireUser(req, CORS);
  if (auth.response) return auth.response;
  if (!auth.user || !auth.tenantId) return json(CORS, 401, { error: "Se requiere una sesión profesional válida." });
  const tenantId = auth.tenantId;
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action, 30);

  const owner = await isOwner(auth.user, tenantId);
  if (!owner && !await canRead(jwt, tenantId)) return json(CORS, 403, { error: "Tu rol no permite consultar las plantillas.", code: "permission_denied" });

  if (action === "list") {
    try {
      const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates?status=all", { method: "GET", headers: actorHeaders(auth.user, owner) }, 15000);
      if (!remote.response.ok) return json(CORS, 502, { error: text(remote.body.error, 300) || "El servicio de mensajería no devolvió las plantillas.", code: "lana_error" });
      const list = Array.isArray(remote.body.templates) ? remote.body.templates as Record<string, unknown>[] : [];
      return json(CORS, 200, {
        can_request: owner,
        templates: list.map((item) => ({
          name: text(item.name, 200), language: text(item.language, 20), category: text(item.category, 20),
          status: text(item.status, 30), rejection_reason: text(item.rejection_reason, 500) || null,
        })).filter((item) => item.name),
      });
    } catch (error) {
      return json(CORS, 502, { error: error instanceof Error && /LANA todavía no está conectada/.test(error.message) ? "El servicio de mensajería todavía no está conectado." : "No pudimos consultar el servicio de mensajería.", code: "lana_unreachable" });
    }
  }

  if (action === "request") {
    if (!owner) return json(CORS, 403, { error: REQUEST_ERRORS.owner_required, code: "owner_required" });
    const id = text(body.template_id, 80);
    const template = (TEMPLATES as Template[]).find((item) => item.id === id);
    if (!template) return json(CORS, 400, { error: "Esa plantilla no está en el catálogo de SMYL.", code: "unknown_template" });
    const issues = validate(template);
    if (issues.length) return json(CORS, 500, { error: "La plantilla del catálogo no cumple las reglas de Meta.", code: "invalid_catalog_template" });
    try {
      const remote = await lanaRequest(tenantId, "/inbox/whatsapp/templates", {
        method: "POST",
        headers: actorHeaders(auth.user, true, crypto.randomUUID()),
        body: JSON.stringify({
          name: template.id, category: template.category, language: LANGUAGE.code, body: template.body,
          footer: template.footer || undefined, buttons: template.buttons.length ? template.buttons : undefined,
          examples: template.variables.map((variable) => variable.example),
        }),
      }, 25000);
      if (remote.response.ok) {
        const item = (remote.body.template || {}) as Record<string, unknown>;
        return json(CORS, 200, { ok: true, existing: remote.body.existing === true, status: text(item.status, 30) || "PENDING" });
      }
      const code = text(remote.body.code, 60);
      const message = REQUEST_ERRORS[code] || text(remote.body.error, 400) || "El servicio de mensajería no pudo enviar la plantilla.";
      return json(CORS, remote.response.status >= 400 && remote.response.status < 500 ? remote.response.status : 502, { error: message, code: code || "lana_error" });
    } catch (error) {
      return json(CORS, 502, { error: error instanceof Error && /LANA todavía no está conectada/.test(error.message) ? "El servicio de mensajería todavía no está conectado." : "No pudimos contactar al servicio de mensajería.", code: "lana_unreachable" });
    }
  }

  return json(CORS, 400, { error: "Acción no reconocida." });
});
