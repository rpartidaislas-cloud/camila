# Bitácora compartida — SMYL

Este archivo es la memoria compartida entre Codex (diseño/frontend) y Claude
Code (arquitectura/backend/infra). Ninguno de los dos agentes recuerda lo que
hizo el otro entre sesiones — así que antes de tocar algo, lee la entrada más
reciente que mencione ese archivo, y al terminar deja tu propia entrada.

Formato de cada entrada: fecha, agente, qué se tocó, qué debe saber el otro.
Las entradas más nuevas van arriba.

---

## 2026-07-30 (4) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- **Límite de plan (`limite_diagnosticos`/`diagnosticos_usados`) no se
  aplicaba en el flujo principal.** Solo `app.html` (su propia herramienta
  de análisis, aparte del flujo de simulación) lo hacía cumplir.
  `simulacion.html` — el que de verdad genera con Claude + OpenAI en cada
  foto, el gasto real de IA — no chequeaba ni incrementaba nada. Se agregó:
  `cargarTenantConfig()` ahora también trae `plan/limite_diagnosticos/
  diagnosticos_usados/activo`; `processPhotos()` bloquea con alert si ya se
  agotó el límite (antes de generar, no después); `registrarDiagnosticoUsado()`
  incrementa el contador tras una generación exitosa.
- **Esto sigue siendo enforcement del lado del cliente**, igual que en
  `app.html` — no hay nada en el Edge Function `claude` que verifique el
  límite server-side. Alguien que llame al Edge Function directamente
  (con una sesión válida, ya no se puede sin login) podría saltárselo. No
  agregué el enforcement server-side porque implica una decisión
  de producto que no me correspondía tomar sola (¿qué cuenta como "un
  diagnóstico"? ¿la simulación completa de un caso, o cada foto/vista
  generada por separado? `simulacion.html` genera hasta 6 fotos por caso).
  Queda pendiente si se quiere cerrar del todo antes de lanzar cobros reales.

### Auditoría de Stripe (sin tocar código, solo lectura)

`stripe-checkout`/`stripe-portal`/`stripe-webhook` están bien escritos
(verifican firma, no exponen secrets), pero el cobro real está
deliberadamente sin terminar: `STRIPE_PRICE_IDS` en `app.html` están vacíos
a propósito (ya hay un aviso puesto: "Falta terminar de configurar el
cobro"). Antes de activarlo de verdad falta, como mínimo:
- Precios reales de Stripe (decisión de negocio, no técnica).
- Confirmar que `stripe-checkout`/`stripe-portal` estén desplegadas con ese
  nombre exacto (la última vez que pude ver el proyecto real antes de que
  el conector se desconectara, solo vi `checkout` y `stripe-webhook`
  desplegadas, no `stripe-checkout`/`stripe-portal` — sin confirmar 100%,
  el conector se cayó a media revisión).
- `stripe-webhook` tenía `verify_jwt: true` a nivel de plataforma de
  Supabase -- Stripe no manda un JWT de Supabase en sus webhooks, así que
  es probable que Supabase rechace los eventos antes de que la función los
  procese. Hay que desactivar esa verificación para ese endpoint específico.
- `APP_URL` (usado para success/cancel/return de Stripe) tiene un valor por
  defecto que no es ningún dominio real del proyecto -- hay que configurar
  el secret real.

---

## 2026-07-30 (3) — Claude Code

**Tocado:** `simulacion.html`, `supabase/functions/claude/index.ts`,
`supabase/functions/segment-teeth/index.ts`,
`supabase/functions/_shared/auth.ts`, `supabase/migrations/camila_tenants.sql`,
base de datos del proyecto Supabase "Smyl".

Se resolvieron los 2 pendientes que había dejado abiertos en la entrada
anterior:

1. **`camila_tenants` no existía** — se recreó (migración
   `supabase/migrations/camila_tenants.sql`, ya aplicada en vivo) con el
   esquema exacto que `simulacion.html`/`index.html`/`app.html` ya
   asumían: `id` (= auth.uid() del dentista), `nombre`, `email`, `plan`,
   `limite_diagnosticos`, `diagnosticos_usados`, `activo`, `vence_en`,
   `config` (jsonb), más `stripe_customer_id`/`stripe_subscription_id` que
   `stripe_billing.sql` ya asumía. RLS: cada dentista solo ve/edita su
   propia fila. También corregí `cargarTenantConfig()` en simulacion.html,
   que le mandaba el anon key en vez del token de sesión (con RLS activo,
   nunca iba a poder leer nada así).
   - **`camila_precios` sigue sin existir, a propósito no la toqué**: el
     único lugar que la lee (`loadPrecios()` en simulacion.html) no manda
     `tenant_id` en el query y ya cae de forma segura a `PRECIOS_DEFAULT` si
     falla — pero el editor de precios en `app.html` (`guardarPrecios()`)
     solo guarda en `localStorage`, nunca en Supabase. O sea que aunque
     recreara la tabla, nunca se llenaría con nada real: la función de
     "precios por clínica" está a medio construir entre estos dos archivos
     y no coinciden en el diseño. Esto necesita una decisión de producto
     (¿precios son por tenant? ¿cómo se sincronizan?) antes de tocar
     código — no lo inventé por mi cuenta.
2. **Acceso anónimo a los Edge Functions que gastan dinero real** —
   `_shared/auth.ts` (`requireUser`) aceptaba explícitamente la publishable
   key sin sesión como fallback ("por pedido explícito" según el comentario
   viejo). Se revirtió: ahora cualquier llamada sin una sesión válida se
   rechaza con 401. Afecta a `claude` (Anthropic + OpenAI) y `segment-teeth`
   (Replicate) — las dos únicas funciones que importan este archivo
   compartido. Ya desplegadas (`claude` v18, `segment-teeth` v13).

**Si Codex ve errores 401 en algún flujo que antes "funcionaba sin login"**:
es esperado, era el hueco de seguridad que se cerró. Si hace falta un modo
de acceso sin cuenta para algo específico (demo pública, por ejemplo), debe
diseñarse aparte (token de un solo uso con alcance limitado), no reabriendo
el fallback anónimo genérico.

---

## 2026-07-30 (2) — Claude Code

**Tocado:** `simulacion.html`, `revision-clinica.html`,
`supabase/functions/segment-teeth/index.ts`, `mobile/www/*.html`, base de
datos y Storage del proyecto Supabase "Smyl" (rpxshsiwoxdbuevjjpfw).

Se cerró el hallazgo de seguridad de la entrada anterior — confirmado en
vivo y arreglado, no solo documentado:

1. **`camila_casos` (RLS)** — tenía políticas `qual: true` para `anon`
   (SELECT/INSERT/UPDATE) más una política extra `camila_casos_abierto_temporal`
   con acceso total para `anon` y `authenticated`. Cualquiera con la
   publishable key (visible en el código fuente del cliente) podía leer o
   escribir cualquier caso de cualquier clínica. Se reemplazaron por
   políticas que exigen `tenant_id = auth.uid()::text`, solo para
   `authenticated` — coincide con lo que el resto del código ya asumía
   (`app.html`, `revision-clinica.html` ya filtran así, solo la política
   real no lo exigía).
2. **Buckets `camila-fotos` y `camila-masks`** — estaban marcados `public =
   true` (fotos/simulaciones de pacientes reales accesibles sin login, sin
   expiración, con URLs semi-predecibles). Ahora `public = false`. Existía
   una política `camila_fotos_insert_own_folder` que en teoría ya exigía que
   la carpeta raíz = `auth.uid()`, pero el código subía a `casoId/...` (no
   `tenantId/casoId/...`), así que nunca cuadraba y alguien había dejado
   `storage_camila_abierto_temporal` (anon+authenticated, acceso total)
   como parche. Se corrigió la causa raíz:
   - `simulacion.html` (`subirResultadoAStorage`) y `revision-clinica.html`
     (`generarSimulacionIA`, `subirFotoLocal`) ahora suben a
     `{tenantId}/{casoId}/...` y piden una URL FIRMADA (`firmarUrlStorage()`,
     ~1 año de expiración) en vez de construir `/object/public/...` a mano.
   - `segment-teeth/index.ts` ahora usa `createSignedUrl()` en vez de
     `getPublicUrl()` para las máscaras (corre con service role, no le
     afecta RLS). Ya desplegado (v12).
   - Storage RLS: política de SELECT/UPDATE nueva para `camila-fotos`
     (misma condición de carpeta). `camila-masks` no tiene políticas para
     `authenticated` a propósito — solo la Edge Function (service role) la
     toca.

**Si Codex toca `subirResultadoAStorage`, `subirFotoLocal`,
`generarSimulacionIA`, o cualquier lugar que construya una URL de Storage a
mano (`/object/public/...`)**: ya no funciona así, el bucket es privado.
Usar `firmarUrlStorage(path)` (existe en ambos archivos) en vez de armar la
URL directamente.

**Efecto secundario esperado:** `revision-clinica.html` tenía un modo
"login opcional" (si no hay sesión, caía a la publishable key). Ese modo ya
no puede leer/escribir `camila_casos` ni Storage sin sesión real —
requerirá login siempre que no venga de una sesión ya iniciada en
`simulacion.html`/`app.html` (incluida vía localStorage compartido, que es
el caso normal). Es un cambio de comportamiento intencional, no un bug.

**Pendiente, NO resuelto, decisión del usuario:**
- `supabase/functions/_shared/auth.ts` (`requireUser`) acepta explícitamente
  la publishable key sin sesión como fallback ("por pedido explícito").
  Esto significa que cualquiera con la URL puede seguir gastando créditos
  reales de Anthropic/OpenAI/Replicate llamando a los Edge Functions
  directamente, aunque ya no pueda guardar el resultado en la base de datos.
  No se tocó porque fue una decisión explícita anterior del usuario y afecta
  costos — necesita su confirmación antes de revertirlo.
- Tablas `camila_tenants` y `camila_precios` (usadas por
  `simulacion.html`/`app.html` para registro de clínica, branding y
  precios) **no existen** en la base de datos real. Registro de clínica
  nueva y refresco de precios/marca probablemente fallan en silencio ahora
  mismo. No se tocó — es un problema funcional aparte, no de seguridad.
- Otros hallazgos de `get_advisors` (no relacionados a SMYL, pertenecen a
  otro proyecto/negocio que comparte cuenta de Supabase): `landing_catalogo`
  sin RLS, y varias tablas con RLS activo pero sin políticas
  (`creditos_usuarios`, `historial_uso`, `programas`, `registros`). Fuera de
  alcance, no tocado.

---

## 2026-07-30 (1) — Claude Code

**Tocado:** `simulacion.html`, `revision-clinica.html`, `mobile/www/*.html`

- Arreglado: "Ajustar alineación" no se guardaba — el modo pantalla completa
  usaba `object-fit:contain` y la vista normal `object-fit:cover`, así que
  el ajuste se veía movido al salir. Ahora ambos modos usan el mismo
  `object-fit`/`object-position`. Si Codex toca CSS de `.ba-wrap`,
  `.ba-fullscreen`, `.ba-base img` o `.ba-over img`, cuidado con reintroducir
  ese mismo mismatch.
- Reforzado el prompt de generación de IA (en ambos archivos) para evitar
  que tonos VITA oscuros cambien el color/iluminación del resto de la foto.
- Creado este archivo y `AGENTS.md` — reparto de trabajo: Codex = diseño/
  frontend, Claude = todo lo demás (backend, Supabase, IA, seguridad, móvil).

**Pendiente / en curso:** auditoría de seguridad de Supabase (RLS, Storage
público) — ver hallazgos abajo, no confirmados aún contra la base de datos
real porque el conector de Supabase no está habilitado en esta sesión.

### Hallazgo de seguridad (evidencia en código, no confirmado en vivo)

El bucket `camila-fotos` se usa con URLs `/storage/v1/object/public/...`
(ver `subirResultadoAStorage()` en simulacion.html y el equivalente en
revision-clinica.html) — esto implica que el bucket está configurado como
**público**: cualquiera con el link puede ver la foto sin autenticarse, sin
expiración. Esto incluye simulaciones generadas de pacientes reales.
Recomendación: mover a bucket privado + URLs firmadas con expiración. No se
ha tocado el código todavía porque cambia el contrato de cómo
`revision-clinica.html` consume esas URLs — requiere coordinarlo antes de
implementar.

También pendiente de confirmar en vivo: si la política RLS de `camila_casos`
(que ya exige `auth.uid()`, ver comentario en `CFG` de simulacion.html)
realmente limita cada dentista a ver solo sus propios casos vía `tenant_id`,
o si cualquier cuenta logueada puede leer casos de otro tenant.
