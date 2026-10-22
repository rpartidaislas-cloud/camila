# Cloudflare · Open Graph dinámico para el perfil público

`og-perfil-worker.js` se ejecuta delante de `app.smyldesign.ai/dentista.html`.
Cuando la URL trae `?perfil=<slug>`, consulta el perfil publicado en Supabase e
inyecta las etiquetas `og:*` / `twitter:*` en el HTML antes de devolverlo. Así,
al compartir el enlace por WhatsApp, Facebook o iMessage aparece la foto, el
nombre y la especialidad del dentista en vez de un cuadro vacío.

Si Supabase no responde o el perfil no existe, el Worker devuelve la página
original sin tocarla.

## Despliegue (una sola vez)

### Opción A — panel de Cloudflare (sin instalar nada)
1. Cloudflare → **Workers & Pages** → **Create** → **Create Worker**.
2. Nombre: `smyl-og-perfil`. Borra el código de ejemplo y pega el contenido de
   `og-perfil-worker.js`. **Deploy**.
3. En el Worker → **Settings → Variables and Secrets** agrega:
   - `SUPABASE_URL` = `https://rpxshsiwoxdbuevjjpfw.supabase.co`
   - `SUPABASE_ANON_KEY` = la clave pública del proyecto (la misma que usa
     `dentista.html`, empieza con `sb_publishable_`). Nunca la `service_role`.
   - `SITE_NAME` = `SMYL`
4. En el Worker → **Settings → Triggers → Routes → Add route**:
   - Route: `app.smyldesign.ai/dentista.html*`
   - Zone: `smyldesign.ai`
5. Comprueba con el depurador de Facebook (`developers.facebook.com/tools/debug/`)
   o pegando el enlace en un chat de WhatsApp contigo mismo.

### Opción B — Wrangler CLI
```bash
cd infra/cloudflare
npx wrangler secret put SUPABASE_ANON_KEY   # pega la clave pública
npx wrangler deploy
```

## Imagen por defecto
Si el dentista no tiene foto, el Worker usa `https://app.smyldesign.ai/og-default.png`.
Hay que subir ese archivo (1200×630, logo SMYL sobre fondo verde) a la raíz del
repo para que exista en GitHub Pages.

## Notas
- La caché de Cloudflare guarda la respuesta de Supabase 5 minutos
  (`OG_TTL_SECONDS`); un cambio de foto o headline tarda hasta eso en verse al
  compartir.
- El Worker solo lee la vista `smyl_professional_directory`, que ya es pública
  para `anon` y solo expone perfiles con `status = 'published'`.
