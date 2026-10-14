// SMYL · Invitaciones de reseña y lectura pública.
// Los pacientes nunca escriben directamente en tablas ni reciben IDs clínicos.

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkLimitPorIpProspecto } from "../_shared/limits.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function response(status: number, body: Record<string, unknown>, cache = "no-store") {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache } });
}
function clean(value: unknown, max: number) {
  return String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.has("perfil")) {
    const slug = clean(url.searchParams.get("perfil"), 80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return response(400, { error: "Perfil no válido." });
    const profile = await admin.from("smyl_professional_profiles").select("tenant_id,professional_id")
      .eq("slug", slug).eq("status", "published").maybeSingle();
    if (profile.error) return response(500, { error: "No pudimos cargar las reseñas." });
    if (!profile.data) return response(404, { error: "Perfil no disponible." });
    const rows = await admin.from("smyl_patient_reviews")
      .select("rating,body,public_name,published_at")
      .eq("tenant_id", profile.data.tenant_id).eq("professional_id", profile.data.professional_id)
      .eq("status", "published").order("published_at", { ascending: false }).limit(6);
    if (rows.error) return response(500, { error: "No pudimos cargar las reseñas." });
    const summary = await admin.rpc("smyl_public_review_summary", {
      p_tenant_id: profile.data.tenant_id, p_professional_id: profile.data.professional_id,
    });
    if (summary.error) return response(500, { error: "No pudimos cargar las reseñas." });
    const reviews = rows.data || [];
    const totals = Array.isArray(summary.data) ? summary.data[0] : summary.data;
    return response(200, { average: Number(totals?.average_rating || 0), count: Number(totals?.review_count || 0), reviews }, "public, max-age=120, s-maxage=120");
  }

  if (req.method === "GET") {
    const token = clean(url.searchParams.get("token"), 128);
    if (!/^[0-9a-f]{64}$/.test(token)) return response(400, { error: "Enlace no válido." });
    const tokenHash = await sha256(token);
    const invitation = await admin.from("smyl_review_invitations")
      .select("professional_id,appointment_id,expires_at,used_at,revoked_at")
      .eq("token_hash", tokenHash).maybeSingle();
    if (invitation.error) return response(500, { error: "No pudimos validar el enlace." });
    if (!invitation.data || invitation.data.revoked_at || new Date(invitation.data.expires_at) <= new Date()) {
      return response(404, { error: "Este enlace venció o ya no está disponible." });
    }
    const professional = await admin.from("smyl_professionals").select("display_name,specialty")
      .eq("id", invitation.data.professional_id).single();
    const appointment = await admin.from("smyl_appointments").select("starts_at,status")
      .eq("id", invitation.data.appointment_id).single();
    if (professional.error || appointment.error || appointment.data.status !== "completed") {
      return response(404, { error: "Este enlace ya no está disponible." });
    }
    return response(200, {
      available: !invitation.data.used_at,
      submitted: Boolean(invitation.data.used_at),
      professional_name: professional.data.display_name,
      specialty: professional.data.specialty,
      visit_date: appointment.data.starts_at,
      expires_at: invitation.data.expires_at,
    });
  }

  if (req.method === "POST") {
    const limit = await checkLimitPorIpProspecto(req, CORS);
    if (!limit.allowed) return limit.response!;
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return response(400, { error: "Solicitud inválida." }); }
    if (clean(body.website, 100)) return response(200, { ok: true });
    const token = clean(body.token, 128);
    const rating = Number(body.rating);
    const text = clean(body.body, 1000);
    const nameStyle = clean(body.name_style, 20);
    if (!/^[0-9a-f]{64}$/.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 20) {
      return response(400, { error: "Completa tu calificación y comentario." });
    }
    const submitted = await admin.rpc("smyl_submit_patient_review", {
      p_token_hash: await sha256(token), p_rating: rating, p_body: text, p_name_style: nameStyle,
    });
    if (submitted.error) {
      const unavailable = /enlace|disponible|duplicate|unique|23505|P0002/i.test(submitted.error.message);
      return response(unavailable ? 409 : 400, { error: unavailable ? "Este enlace ya fue utilizado o venció." : "Revisa la información de tu reseña." });
    }
    return response(200, { ok: true, message: "Gracias. La clínica revisará tu reseña antes de publicarla." });
  }

  return response(405, { error: "Método no permitido." });
});
