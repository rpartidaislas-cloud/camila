# vendor/

Dependencias de terceros servidas desde el propio sitio (sin CDN externo en la ruta crítica del panel).

| Archivo | Origen | sha256 |
|---|---|---|
| supabase-js-2.117.3.js | `npm pack @supabase/supabase-js@2.117.3` → `dist/umd/supabase.js` (el mismo archivo que sirve `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3`) | 26d61f6e39d9e60887afc0662a3be43b76e25dfdc8ae2ff84da4ba48d4334f2f |
| qrcode-generator-1.4.4.js | `npm pack qrcode-generator@1.4.4` → `qrcode.js` (MIT, Kazuhiko Arase). Dibuja el QR de MILA en el celular. | 18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780 |
| pdfjs-6.5.438/pdf.min.mjs | `pdfjs-dist@6.5.438`, distribución `legacy/build` de Mozilla PDF.js (Apache-2.0). | 522ad2c83bc8a0010e7f0cc60d0892b77c8d2bf2c9702dc12288311d94270f42 |
| pdfjs-6.5.438/pdf.worker.min.mjs | Mismo paquete y distribución. Los mapas de caracteres, fuentes, perfiles de color y códecs conservan sus licencias en esta carpeta. | b4c8353ded0d88d2e2009574a29eb4e0c3ff7e942ecdf51ef5f71566a9667f31 |
| pdf-lib-1.17.1.min.mjs | `pdf-lib@1.17.1`, `dist/pdf-lib.esm.min.js` (MIT). Se carga al crear una copia PDF anotada. | 72c052d97b4d5d9fa6cdbdcb7ad709f03d4ddb1122390cb3afeba4d88651d969 |

El lector de adjuntos carga la distribución `legacy` y su worker de la misma versión. Mozilla indica compatibilidad mayoritaria en Safari 18 o posterior y soporte en Chrome 125 o posterior. El visor limita cada lienzo a 4096 píxeles por lado y 8 megapíxeles para moderar el uso de memoria al ampliar. [Compatibilidad de Mozilla PDF.js](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported)

Para actualizar: `npm pack @supabase/supabase-js@<versión>`, copiar `dist/umd/supabase.js` aquí con la versión en el nombre, actualizar esta tabla, `app.html`, `mobile/www/app.html` y `sw.js`.
