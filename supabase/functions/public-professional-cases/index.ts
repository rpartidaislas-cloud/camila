// Galería pública segura de casos profesionales SMYL.
// Sólo devuelve casos aprobados y URLs de lectura que caducan en 10 minutos.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

function reply(status: number, body: Record<string, unknown>, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return reply(405, { error: "Método no permitido." });
  const slug = String(new URL(req.url).searchParams.get("perfil") || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    return reply(400, { error: "Perfil no válido." });
  }

  const profile = await admin.from("smyl_professional_profiles")
    .select("tenant_id,professional_id")
    .eq("slug", slug).eq("status", "published").maybeSingle();
  if (profile.error) {
    console.error("[public-professional-cases] profile", profile.error.message);
    return reply(500, { error: "No pudimos abrir los casos." });
  }
  if (!profile.data) return reply(404, { error: "Perfil no disponible." });

  const rows = await admin.from("smyl_professional_cases")
    .select("title,treatment_label,summary,before_path,after_path,published_at")
    .eq("tenant_id", profile.data.tenant_id)
    .eq("professional_id", profile.data.professional_id)
    .eq("status", "published")
    .order("published_at", { ascending: false }).limit(12);
  if (rows.error) {
    console.error("[public-professional-cases] cases", rows.error.message);
    return reply(500, { error: "No pudimos abrir los casos." });
  }

  const safeCases = await Promise.all((rows.data || []).map(async (item) => {
    const signed = await admin.storage.from("smyl-professional-cases")
      .createSignedUrls([item.before_path, item.after_path], 600);
    if (signed.error || !signed.data || signed.data.some((x) => !x.signedUrl)) {
      console.error("[public-professional-cases] sign", signed.error?.message || "URL incompleta");
      return null;
    }
    return {
      title: item.title,
      treatment: item.treatment_label,
      summary: item.summary,
      before_url: signed.data[0].signedUrl,
      after_url: signed.data[1].signedUrl,
      published_at: item.published_at,
    };
  }));

  return reply(200, { cases: safeCases.filter(Boolean) }, "public, max-age=120, s-maxage=120");
});
