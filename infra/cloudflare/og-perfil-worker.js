// Cloudflare Worker · Open Graph dinámico para la ficha pública de SMYL.
//
// dentista.html es una página estática (GitHub Pages) que pinta el perfil con
// JavaScript. WhatsApp, Facebook e iMessage no ejecutan JS, así que al compartir
// el enlace mostraban un cuadro vacío. Este Worker se coloca delante de
// app.smyldesign.ai/dentista.html, lee el perfil publicado desde Supabase e
// inyecta las etiquetas <meta property="og:*"> en el HTML original.
//
// Variables (Settings → Variables del Worker):
//   SUPABASE_URL       https://rpxshsiwoxdbuevjjpfw.supabase.co
//   SUPABASE_ANON_KEY  clave pública (sb_publishable_…); nunca la service_role
//   SITE_NAME          SMYL (opcional)

const OG_TTL_SECONDS = 300;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadProfile(env, slug) {
  const url = `${env.SUPABASE_URL}/rest/v1/smyl_professional_directory` +
    `?slug=eq.${encodeURIComponent(slug)}&select=display_name,specialty,headline,photo_path,locations,treatment_focus&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    cf: { cacheTtl: OG_TTL_SECONDS, cacheEverything: true },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function buildTags(env, profile, pageUrl) {
  const site = env.SITE_NAME || "SMYL";
  const location = Array.isArray(profile.locations) && profile.locations[0]
    ? [profile.locations[0].name, profile.locations[0].city].filter(Boolean).join(" · ")
    : "";
  const title = `${profile.display_name} · ${profile.specialty || "Dentista"}`;
  const description = profile.headline ||
    `Conoce el perfil de ${profile.display_name}${location ? " en " + location : ""} y solicita una cita.`;
  const image = profile.photo_path
    ? `${env.SUPABASE_URL}/storage/v1/object/public/smyl-professional-public/${profile.photo_path}`
    : `${pageUrl.origin}/og-default.png`;
  const canonical = `${pageUrl.origin}${pageUrl.pathname}?perfil=${encodeURIComponent(pageUrl.searchParams.get("perfil"))}`;

  return [
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="${escapeHtml(site)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:locale" content="es_MX">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
  ].join("\n");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const slug = (url.searchParams.get("perfil") || "").trim().toLowerCase();
    const origin = await fetch(request);
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return origin;
    if (!(origin.headers.get("content-type") || "").includes("text/html")) return origin;

    let profile = null;
    try { profile = await loadProfile(env, slug); } catch (_) { /* la página sigue sirviéndose sin OG */ }
    if (!profile) return origin;

    const tags = buildTags(env, profile, url);
    const title = `${profile.display_name} · ${profile.specialty || "Dentista"} en ${env.SITE_NAME || "SMYL"}`;

    return new HTMLRewriter()
      .on("title", { element(el) { el.setInnerContent(title); } })
      .on('meta[property^="og:"], meta[name^="twitter:"]', { element(el) { el.remove(); } })
      .on("head", { element(el) { el.append(tags, { html: true }); } })
      .transform(origin);
  },
};
