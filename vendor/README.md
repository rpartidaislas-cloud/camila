# vendor/

Dependencias de terceros servidas desde el propio sitio (sin CDN externo en la ruta crítica del panel).

| Archivo | Origen | sha256 |
|---|---|---|
| supabase-js-2.117.3.js | `npm pack @supabase/supabase-js@2.117.3` → `dist/umd/supabase.js` (el mismo archivo que sirve `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3`) | d6a5c4414a5d4ce646d9c1de223aa7067d3ff664c15394ffeb7fcffc763354a3 |

Para actualizar: `npm pack @supabase/supabase-js@<versión>`, copiar `dist/umd/supabase.js` aquí con la versión en el nombre, actualizar esta tabla, `app.html`, `mobile/www/app.html` y `sw.js`.
