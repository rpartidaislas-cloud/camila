// Registra eventos anónimos de la ficha pública (vista, clic en WhatsApp,
// clic en "Solicitar cita", compartir). No guarda IP ni datos personales: el
// visitante se identifica con un hash diario que no se puede revertir.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const EVENTS_PER_HOUR = Number(Deno.env.get("PROFILE_EVENTS_HOURLY_LIMIT") || "60");
const KINDS = new Set(["view", "whatsapp_click", "cta_click", "share_click"]);
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function done(status = 204): Response {
  return new Response(null, { status, headers: CORS });
}
function ip(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "sin-ip";
}
async function visitorKey(req: Request): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const raw = `${ip(req)}|${req.headers.get("user-agent") || ""}|${day}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function host(value: string): string {
  try { return new URL(value).hostname.toLowerCase().slice(0, 120); } catch { return ""; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return done(405);

  // sendBeacon manda text/plain; se acepta cualquier cuerpo que sea JSON.
  let body: Record<string, unknown>;
  try { body = JSON.parse(await req.text()); } catch { return done(400); }
  const slug = String(body.profile_slug || "").trim().toLowerCase().slice(0, 80);
  const kind = String(body.event || "").trim().slice(0, 32);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !KINDS.has(kind)) return done(400);

  // Cubo propio por IP: no comparte el tope de simulaciones de prospecto.
  const rate = await admin.rpc("camila_anon_rate_check", {
    p_ip: "profile-event:" + ip(req), p_limite: EVENTS_PER_HOUR, p_ventana_seg: 3600,
  });
  if (rate.error) console.error("[public-profile-event] rate", rate.error.message);
  else if (!rate.data) return done(429);

  const { data: profile } = await admin
    .from("smyl_professional_profiles")
    .select("tenant_id,professional_id")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!profile) return done(204); // perfil inexistente o no publicado: silencio, sin pistas

  const referrer = host(String(body.referrer || req.headers.get("referer") || ""));
  const insert = await admin.from("smyl_profile_events").insert({
    tenant_id: profile.tenant_id,
    professional_id: profile.professional_id,
    event_kind: kind,
    visitor_key: await visitorKey(req),
    referrer_host: referrer,
  });
  if (insert.error) console.error("[public-profile-event] insert", insert.error.message);
  return done(204);
});
