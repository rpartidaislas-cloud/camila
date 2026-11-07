# vendor/

Dependencias de terceros servidas desde el propio sitio (sin CDN externo en la ruta crítica del panel).

| Archivo | Origen | sha256 |
|---|---|---|
| supabase-js-2.117.3.js | `npm pack @supabase/supabase-js@2.117.3` → `dist/umd/supabase.js` (el mismo archivo que sirve `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3`) | 26d61f6e39d9e60887afc0662a3be43b76e25dfdc8ae2ff84da4ba48d4334f2f |

Para actualizar: `npm pack @supabase/supabase-js@<versión>`, copiar `dist/umd/supabase.js` aquí con la versión en el nombre, actualizar esta tabla, `app.html`, `mobile/www/app.html` y `sw.js`.
