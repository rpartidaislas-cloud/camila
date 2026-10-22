// Solicitud pública desde la ficha profesional de SMYL.
// Crea o reutiliza al paciente y agrega una solicitud pendiente; nunca
// confirma una cita ni elige un horario clínico por cuenta de la clínica.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return response(405, { error: "Método no permitido." });
  const limit = await checkLimitPorIpProspecto(req, CORS);
  if (!limit.allowed) return limit.response!;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response(400, { error: "Solicitud inválida." }); }
  if (clean(body.website, 120)) return response(200, { ok: true }); // honeypot

  // Cloudflare Turnstile — solo activo cuando TURNSTILE_SECRET_KEY está configurado.
  // Fail-open intencionalmente: si el secret no está, el endpoint sigue funcionando
  // para no romper clínicas que aún no lo han configurado.
  if (TURNSTILE_SECRET) {
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
  const message = clean(body.message, 1200);
  const serviceId = clean(body.service_id, 40);
  const branchId = clean(body.branch_id, 40);
  const requestedStart = clean(body.requested_start, 40);
  if (!slug || fullName.length < 2) return response(400, { error: "Escribe tu nombre." });
  if (!mail && mobile.replace(/\D/g, "").length < 10) return response(400, { error: "Escribe un correo o teléfono válido." });
  if (!serviceId || !branchId) return response(400, { error: "Selecciona tratamiento y ubicación." });

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

  let patient: { id: string } | null = null;
  if (mail) {
    const found = await admin.from("camila_pacientes").select("id")
      .eq("tenant_id", directory.tenant_id).ilike("email", mail).limit(1).maybeSingle();
    patient = found.data;
  }
  if (!patient && mobile.replace(/\D/g, "").length >= 10) {
    const found = await admin.from("camila_pacientes").select("id")
      .eq("tenant_id", directory.tenant_id).eq("telefono", mobile).limit(1).maybeSingle();
    patient = found.data;
  }
  if (!patient) {
    const parts = fullName.split(/\s+/);
    const created = await admin.from("camila_pacientes").insert({
      tenant_id: directory.tenant_id,
      nombre: parts.shift() || fullName,
      apellido: parts.join(" "),
      email: mail,
      telefono: mobile,
      notas: "Contacto creado desde ficha profesional pública de SMYL.",
    }).select("id").single();
    if (created.error) {
      console.error("[public-appointment-request] patient", created.error.message);
      return response(500, { error: "No pudimos registrar tus datos. Intenta de nuevo." });
    }
    patient = created.data;
  }

  let preferred: string | null = null;
  if (requestedStart) {
    const parsed = new Date(requestedStart);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) preferred = parsed.toISOString();
  }
  const inserted = await admin.from("smyl_appointment_requests").insert({
    tenant_id: directory.tenant_id,
    patient_id: patient!.id,
    service_id: serviceId,
    professional_id: profile.professional_id,
    preferred_branch_id: branchId,
    requested_start: preferred,
    source: "patient_portal",
    patient_message: message,
    status: "pending",
  }).select("id").single();
  if (inserted.error) {
    console.error("[public-appointment-request] request", inserted.error.message);
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
    request_id: inserted.data.id,
    message: "Tu solicitud fue enviada. La clínica confirmará disponibilidad contigo.",
  });
});
