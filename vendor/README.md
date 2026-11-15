# vendor/

Dependencias de terceros servidas desde el propio sitio (sin CDN externo en la ruta crítica del panel).

| Archivo | Origen | sha256 |
|---|---|---|
| supabase-js-2.117.3.js | `npm pack @supabase/supabase-js@2.117.3` → `dist/umd/supabase.js` (el mismo archivo que sirve `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3`) | 26d61f6e39d9e60887afc0662a3be43b76e25dfdc8ae2ff84da4ba48d4334f2f |
| qrcode-generator-1.4.4.js | `npm pack qrcode-generator@1.4.4` → `qrcode.js` (MIT, Kazuhiko Arase). Dibuja el QR de MILA en el celular. | 18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780 |

Para actualizar: `npm pack @supabase/supabase-js@<versión>`, copiar `dist/umd/supabase.js` aquí con la versión en el nombre, actualizar esta tabla, `app.html`, `mobile/www/app.html` y `sw.js`.
