// Solicitud pública desde la ficha profesional de SMYL.
// Guarda el contacto como captación aislada y agrega una solicitud pendiente.
// Nunca crea/reutiliza pacientes ni confirma una cita por cuenta de la clínica.

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkLimitPorIpProspecto } from "../_shared/limits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function clean(value: unknown, max: number): string {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
function email(value: unknown): string {
  const out = clean(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : "";
}
function phone(value: unknown): string {
  return clean(value, 60).replace(/[^\d+()\-\s]/g, "");
}
function isoDate(value: unknown): string {
  const out = clean(value, 10);
  if (!out) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) return "";
  const parsed = new Date(out + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === out ? out : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return response(405, { error: "Método no permitido." });
  const limit = await checkLimitPorIpProspecto(req, CORS);
  if (!limit.allowed) return limit.response!;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(400, { error: "Solicitud inválida." }); }
  if (clean(body.website, 120)) return response(200, { ok: true }); // honeypot

  // El perfil público siempre muestra Turnstile. En producción no aceptamos
  // captaciones si el servidor quedó sin la clave de verificación.
  if (!TURNSTILE_SECRET) {
    console.error("[public-appointment-request] TURNSTILE_SECRET_KEY is missing");
    return response(503, { error: "La protección del formulario no está disponible. Intenta más tarde." });
  }
  {
    const token = clean(body.cf_turnstile_response, 2048);
    if (!token) return response(400, { error: "Completa el desafío de seguridad." });
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
    const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) form.set("remoteip", ip);
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body: form,
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!verify.success) return response(403, { error: "Verificación fallida. Recarga la página e intenta de nuevo." });
  }

  const slug = clean(body.profile_slug, 80).toLowerCase();
  const fullName = clean(body.name, 150);
  const mail = email(body.email);
  const mobile = phone(body.phone);
  const message = clean(body.message, 600);
  const serviceId = clean(body.service_id, 40);
  const branchId = clean(body.branch_id, 40);
  const requestedDateRaw = clean(body.requested_date, 10);
  const requestedDate = isoDate(requestedDateRaw);
  const periodRaw = clean(body.requested_period, 40).toLowerCase();
  const periodMap: Record<string, string> = {
    "": "any",
    "por la mañana": "morning",
    "por la tarde": "afternoon",
  };
  const contactRaw = clean(body.preferred_contact, 30).toLowerCase();
  const contactMap: Record<string, string> = {
    "": "any",
    "teléfono": "phone",
    "telefono": "phone",
    "whatsapp": "whatsapp",
    "correo": "email",
  };
  const preferredPeriod = periodMap[periodRaw];
  const preferredContact = contactMap[contactRaw];
  const privacyConsent = body.privacy_consent === true;
  if (!slug || fullName.length < 2) return response(400, { error: "Escribe tu nombre." });
  if (!mail && mobile.replace(/\D/g, "").length < 10) return response(400, { error: "Escribe un correo o teléfono válido." });
  if (!serviceId || !branchId) return response(400, { error: "Selecciona tratamiento y ubicación." });
  if (requestedDateRaw && !requestedDate) return response(400, { error: "La fecha preferida no es válida." });
  if (preferredPeriod === undefined) return response(400, { error: "El horario preferido no es válido." });
  if (preferredContact === undefined) return response(400, { error: "El medio de contacto no es válido." });
  if ((preferredContact === "phone" || preferredContact === "whatsapp") && mobile.replace(/\D/g, "").length < 10) {
    return response(400, { error: "Agrega un teléfono válido para ese medio de contacto." });
  }
  if (preferredContact === "email" && !mail) return response(400, { error: "Agrega un correo válido para ese medio de contacto." });
  if (!privacyConsent) return response(400, { error: "Autoriza el uso de tus datos para enviar la solicitud." });

  const { data: directory, error: directoryError } = await admin
    .from("smyl_professional_directory")
    .select("tenant_id,slug,services,locations")
    .eq("slug", slug)
    .maybeSingle();
  if (directoryError) {
    console.error("[public-appointment-request] directory", directoryError.message);
    return response(500, { error: "No pudimos abrir la agenda. Intenta de nuevo." });
  }
  if (!directory) return response(404, { error: "Este perfil no está disponible." });

  const services = Array.isArray(directory.services) ? directory.services : [];
  const locations = Array.isArray(directory.locations) ? directory.locations : [];
  if (!services.some((item: Record<string, unknown>) => String(item.id) === serviceId)) {
    return response(400, { error: "El tratamiento no pertenece a este perfil." });
  }
  if (!locations.some((item: Record<string, unknown>) => String(item.id) === branchId)) {
    return response(400, { error: "La ubicación no pertenece a este perfil." });
  }

  const { data: profile, error: profileError } = await admin
    .from("smyl_professional_profiles")
    .select("professional_id")
    .eq("tenant_id", directory.tenant_id)
    .eq("slug", slug)
    .eq("status", "published")
    .single();
  if (profileError || !profile) return response(404, { error: "Este perfil no está disponible." });

  const requestId = crypto.randomUUID();
  const intakeId = crypto.randomUUID();
  const inserted = await admin.rpc("smyl_create_public_appointment_intake", {
    p_request_id: requestId,
    p_intake_id: intakeId,
    p_tenant_id: directory.tenant_id,
    p_profile_slug: slug,
    p_professional_id: profile.professional_id,
    p_service_id: serviceId,
    p_branch_id: branchId,
    p_requested_date: requestedDate || null,
    p_requested_period: preferredPeriod,
    p_contact_name: fullName,
    p_email: mail,
    p_phone: mobile,
    p_preferred_contact: preferredContact,
    p_message: message,
    p_privacy_consent: privacyConsent,
    p_privacy_notice_version: "public-appointment-v1",
  });
  if (inserted.error) {
    console.error("[public-appointment-request] intake", inserted.error.message);
    return response(500, { error: "No pudimos enviar la solicitud. Intenta de nuevo." });
  }

  // Métrica del perfil: la solicitud ya quedó guardada, el evento es secundario.
  const metric = await admin.from("smyl_profile_events").insert({
    tenant_id: directory.tenant_id,
    professional_id: profile.professional_id,
    event_kind: "request_sent",
  });
  if (metric.error) console.error("[public-appointment-request] metric", metric.error.message);

  return response(200, {
    ok: true,
    request_id: inserted.data || requestId,
    message: "Tu solicitud fue enviada. La clínica confirmará disponibilidad contigo.",
  });
});
