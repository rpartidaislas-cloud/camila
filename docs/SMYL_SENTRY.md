# SMYL · Sentry (avisos de errores)

Sentry avisa cuando algo falla en el navegador de dentistas y pacientes, con el detalle técnico para
corregirlo. Está integrado **sin datos de pacientes** y **apagado hasta que se pega el DSN**.

## Qué cubre
- Pantallas: `app.html` (panel), `index.html`, `simulacion.html`, `simulacion-rapida.html`, `editor-v2.html`
  y la copia móvil en `mobile/www/` (etiqueta `platform: capacitor`).
- Errores de JavaScript no atrapados y promesas rechazadas, con su traza y las últimas acciones (clics, navegación,
  llamadas de red sin cuerpo ni parámetros).

## Qué NO cubre (todavía)
- Edge Functions de Supabase.
- Cierres nativos de la app Android/iOS.
- Congelamientos sin error (como el bucle de la ficha del paciente de noviembre): no lanzan excepción. Para eso
  haría falta un vigilante de "hilo bloqueado" (siguiente etapa posible).
- Pantalla pública `my-smyl*.html`: su CSP prohíbe conexiones externas a propósito.

## Activarlo (2 minutos)
1. En sentry.io crea un proyecto de tipo **Browser JavaScript** y copia el **DSN** (`https://…@o….ingest….sentry.io/…`).
   El DSN es público por diseño: sólo permite enviar eventos.
2. Pégalo en `smyl-sentry.js` → `CONFIG.dsn` (y copia el archivo a `mobile/www/`).
3. Sube la versión: `smyl-sentry.js?v=2` en las 5 pantallas y en `sw.js`, y agrega un sufijo a `CACHE_VERSION`.
4. Publica. En la consola del navegador (sesión iniciada) ejecuta `SmylSentry.test()`: debe aparecer
   "Prueba de Sentry desde SMYL" en Issues en menos de un minuto.
5. Alertas sugeridas en Sentry: aviso por correo a "nuevo issue" y a "issue que reaparece tras resolverse".

## Privacidad (clínica dental → datos de salud)
Antes de enviar, `scrubEvent()` limpia **todo** el evento:
- Se eliminan usuario, correo, nombre, IP, cookies y cabeceras. Sólo viaja un id opaco de usuario y etiquetas
  `clinic` (id de la clínica) y `role`.
- En cualquier texto se reemplazan correos, teléfonos, tokens/JWT, `Bearer …`, parámetros `token=…`, imágenes
  `data:` y `blob:`, y de toda URL se quita `?consulta` y `#fragmento` (los enlaces de pacientes llevan
  credenciales en el fragmento).
- Sin grabación de pantalla, sin trazas de rendimiento, sin migas de consola ni de lo escrito en campos.
- Se descartan `ResizeObserver loop`, `Script error.`, errores sin conexión; se deduplica la misma falla 60 s y hay
  un tope de 30 eventos por página abierta.
- Los UUID se conservan para poder localizar el caso en SMYL sin exponer a la persona.
- Al crear el proyecto elige la región de datos que corresponda a tu aviso de privacidad (EE. UU. o UE).

La librería está **incluida en el repo** (`vendor/sentry-browser-10.78.0.min.js`, MIT, build mínimo con esbuild:
solo manejadores globales, migas y transporte) para no depender de un CDN. Para actualizarla:
`npm i @sentry/browser@X esbuild`, empaquetar un `entry.js` que exporte lo mismo en `window.SmylSentryLib`.

## Uso desde el código
```js
SmylSentry.capture(error, { area: 'radiografia' }); // errores que se atrapan pero conviene conocer
SmylSentry.setContext({ userId, tenantId, role });   // ya lo llama app.html al iniciar sesión
```
