# Bitácora compartida — SMYL

Este archivo es la memoria compartida entre Codex (diseño/frontend) y Claude
Code (arquitectura/backend/infra). Ninguno de los dos agentes recuerda lo que
hizo el otro entre sesiones — así que antes de tocar algo, lee la entrada más
reciente que mencione ese archivo, y al terminar deja tu propia entrada.

Formato de cada entrada: fecha, agente, qué se tocó, qué debe saber el otro.
Las entradas más nuevas van arriba.

---

## 2026-08-05 (3) — Claude Code (fix: staff no podía generar nada — etapa 4 quedó incompleta el mismo día)

**Tocado:** `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/limits.ts`,
`supabase/functions/claude/index.ts`, `supabase/functions/segment-teeth/index.ts`,
`revision-clinica.html`, `mobile/www/revision-clinica.html`, `app.html`.
Sin migración nueva.

Una auditoría pedida por el usuario (agentes en paralelo revisando
app.html/simulacion.html/revision-clinica.html) encontró que la etapa 4
de hoy (dueño+staff) se cableó solo en el cliente de 2 de 5 puntos —
`claude/index.ts`, `segment-teeth/index.ts` y `revision-clinica.html`
seguían usando `user.id`/`auth.uid()` directo como si fuera el
`tenant_id`, cierto solo para el dueño. Efecto real antes de este fix:
un staff invitado no podía generar NINGÚN diagnóstico/simulación desde
`simulacion.html` (402 "no se encontró tu clínica"), y si daba de alta
un caso nuevo directo en `revision-clinica.html` (la puerta de entrada
principal del dentista en la app móvil) el caso se guardaba con éxito
aparente pero con un `tenant_id` que no pertenece a ninguna clínica real
— invisible para el dueño y el resto del equipo.

1. **`_shared/auth.ts`**: `AuthResult` ahora incluye `tenantId` (además de
   `user`), resuelto por una función nueva `resolverTenantId(userId)` que
   consulta `camila_usuarios` — mismo patrón que ya usaba el cliente
   (`cargarTenantConfig()` en simulacion.html, `continuarConUsuario()` en
   app.html). Para el dueño sigue siendo igual a `user.id` (comportamiento
   sin cambios); para staff resuelve la clínica de quien lo invitó.
   **Cualquier código nuevo que use `requireUser()` debe usar `tenantId`,
   nunca `user.id`, para topes de gasto, RPCs o escrituras con
   `tenant_id`** — dejé un comentario grande en la interfaz explicándolo.
2. **`_shared/limits.ts`**: `checkAndConsumeLimit()` renombró su segundo
   parámetro de `userId` a `tenantId` (mismo comportamiento, solo
   clarifica qué es realmente).
3. **`claude/index.ts` y `segment-teeth/index.ts`**: usan el `tenantId`
   resuelto por `requireUser()` en vez de `user?.id` para
   `checkAndConsumeLimit()`. En `segment-teeth` esto también corrige el
   `.eq("tenant_id", tenantId)` del `UPDATE` que guarda la segmentación —
   antes, para un staff, ese `UPDATE` nunca encontraba la fila del caso
   real (que tiene el `tenant_id` del dueño) y la segmentación se perdía
   sin error visible.
4. **`revision-clinica.html` / mobile**: `_entrarSesionClinica()` ahora es
   `async` y, justo después de fijar la sesión, consulta `camila_usuarios`
   por el `auth.uid()` de quien inició sesión — si es staff, corrige
   `tenantIdSesion`/el campo `#tenantId` a la clínica real ANTES de
   `autoCargarCasoDesdeUrl()`. Aplicado quirúrgicamente (no se copió el
   archivo completo) porque la copia móvil ya tenía otras diferencias
   pendientes de sincronizar (ver auditoría UX del mismo día) que no eran
   parte de este fix.
5. **`app.html`**: `ejecutarAnalisisIA()` y `generarBeforeAfter()` mandaban
   `Authorization: Bearer SUPA_KEY` (la llave pública) en vez del
   `access_token` de la sesión real — la auditoría confirmó que esto no
   solo evadía el tope de gasto de la etapa 1, sino que **ningún dentista
   consumía su cupo pagado real desde esas dos pantallas** (quedaban
   sujetos al tope anónimo de 5/hora sin importar su plan). Ahora ambas
   piden `sb.auth.getSession()` y usan el `access_token` real, con
   `SUPA_KEY` solo como último fallback si no hay sesión. Este fix
   dependía de los puntos 1-3 (si se hacía al revés, el staff habría
   quedado bloqueado con 402 en vez de generar sin límite).

**Falta aplicar en producción:** desplegar las dos Edge Functions
actualizadas —

```
supabase functions deploy claude --use-api
supabase functions deploy segment-teeth --use-api
```

— y verificar en el dashboard (tab Code) que se suban `index.ts` +
`_shared/auth.ts` + `_shared/limits.ts` (además de `_shared/limits.ts`
para claude/segment-teeth, ya se sabe por experiencias anteriores que
hay que confirmarlo, no basta el mensaje de "Deployed"). Los cambios de
`app.html`/`revision-clinica.html` se publican solos vía GitHub Pages.
**No pude probar en vivo** que un staff real ahora sí pueda generar un
diagnóstico end-to-end (necesito una cuenta de staff con sesión real) —
Ricardo, si tienes forma de probarlo con la cuenta que invitaste antes,
avísame el resultado.

**Pendiente de la misma auditoría, no atacado todavía** (ver el reporte
completo que se le compartió al usuario como Artifact el mismo día):
escala de "score" inconsistente (0-10 en app.html vs 0-100 en
simulacion.html), protocolo de fotos y cuestionario pre-simulación sin
ningún efecto real, `tenant_id` no determinista (`'local'` vs `null`)
para casos guardados sin sesión, `mobile/www/revision-clinica.html`
desincronizado en CSS de segmentación y de `.tooth-chip-remove`, y la
URL/key de Supabase hardcodeada 5 veces (2 de ellas dentro del mismo
archivo/función en revision-clinica.html).

---

## 2026-08-05 (2) — Claude Code (infraestructura multi-tenant, etapa 4: dueño + staff con permisos distintos)

**Tocado:** `supabase/migrations/camila_team.sql` (nuevo),
`supabase/functions/invite-staff/index.ts` (nuevo), `app.html`,
`simulacion.html`, `mobile/www/simulacion.html`.

Modelo elegido con el usuario (opción "dueño + staff con permisos
distintos", invitación **por correo** vía `admin.inviteUserByEmail`):
tabla nueva `camila_usuarios` vincula un `auth.users` a un `tenant_id` con
`rol` ('dueño'/'staff'). El dueño sigue siendo la fila cuyo
`id = tenant_id` (sin cambios ahí); el staff son cuentas NUEVAS invitadas
por el dueño desde `app.html` (tarjeta "Mi Equipo", solo visible para
dueño).

1. **RLS reescrita con dos funciones `SECURITY DEFINER`**
   (`camila_es_dueno`, `camila_es_miembro`) para evitar recursión de
   políticas. `camila_tenants` SELECT ahora acepta a cualquier miembro
   (antes solo `id = auth.uid()`) -- el staff necesita leer
   branding/precios/límite de su clínica. `camila_tenants` INSERT/UPDATE
   **no se tocó** -- sigue exigiendo `id = auth.uid()`, así que el staff
   automáticamente no puede tocar precios/config/plan sin que hiciera
   falta ninguna política nueva para eso. `camila_casos` SELECT/INSERT/
   UPDATE ahora usan `camila_es_miembro()` en vez de comparar
   `tenant_id = auth.uid()::text` directo.
   - **Ojo con esto si se toca la migración:** `camila_casos.tenant_id` es
     `text`, y `simulacion.html` en modo sin sesión a veces escribe el
     literal `'local'` ahí (`CFG.tenantId || 'local'` en `guardarCaso()`,
     confirmado leyendo el código, no soy quien lo escribió así). Un
     `tenant_id::uuid` directo en una política revienta la consulta
     COMPLETA (`invalid input syntax for type uuid`) en cuanto toca una
     fila así -- no la descarta, tira todo el `SELECT`/`INSERT`/`UPDATE`
     para cualquiera. Se agregó `camila_uuid_seguro()` (cast con
     `exception when others return null`) para blindar esto.
   - No se agregó política de `DELETE` en `camila_casos` -- ya no existía
     antes de esta migración (nadie, ni el dueño, puede borrar un caso vía
     RLS hoy), no era parte de esta etapa cambiar eso.
2. **Provisioning (`camila_crear_tenant_en_signup`, ya existía desde la
   etapa 2) actualizado**: si el signup trae `tenant_id_invitado` en
   `user_metadata` (lo pone `invite-staff`), la cuenta se une como staff a
   esa clínica en vez de crear una nueva. Si no, sigue creando su propia
   clínica como antes, y AHORA también se da de alta a sí mismo en
   `camila_usuarios` (rol dueño) -- backfill incluido para dueños que ya
   existían antes de esta migración.
3. **Edge Function nueva `invite-staff`**: valida que quien llama sea
   dueño de una clínica real, hace cumplir el tope de usuarios por plan
   (`esencial: 1, profesional: 3, premium: sin tope` -- mismos números que
   ya anunciaba `app.html` en `PLANES.*.features`, antes solo como texto
   de marketing sin ningún efecto real), y llama
   `admin.auth.admin.inviteUserByEmail` con `tenant_id_invitado` en los
   metadatos y `redirectTo: .../app.html?invite=1`.
4. **Cliente:**
   - `app.html`: `continuarConUsuario()` ahora resuelve la clínica real
     antes de leer `camila_tenants` (consulta `camila_usuarios` por el
     `auth.uid()` de quien inició sesión; si no es dueño, usa el
     `tenant_id` de ahí). Nueva variable global `miRolEquipo`. Nueva
     tarjeta "Mi Equipo" (listar/invitar/desactivar, solo dueño) en la
     pantalla de precios. Nuevo flujo `?invite=1` +
     `mostrarSetPasswordInvitado()`: cuando alguien abre el link del
     correo de invitación, supabase-js ya le crea sesión automáticamente
     (`detectSessionInUrl`) pero SIN contraseña -- se le pide ponerla
     antes de entrar (si no, quedaría sin forma de volver a entrar cuando
     expire el token). Los botones de guardar precios/config/branding se
     deshabilitan para staff (`aplicarRestriccionesStaff()`) -- no es la
     restricción de seguridad real (esa la da RLS), es solo para no
     mostrar un botón que fallaría en silencio (PostgREST no marca error
     cuando RLS descarta un UPDATE por falta de permiso, solo actualiza 0
     filas).
   - `simulacion.html`/mobile: `cargarTenantConfig()` ahora resuelve
     primero si quien inició sesión es staff (vía `camila_usuarios`) antes
     de pedir `camila_tenants` -- si no, sus casos se habrían guardado con
     un `tenant_id` que no pertenece a ninguna clínica. Se cuidó el
     timing: `CFG.tenantId` se sigue fijando SÍNCRONO de entrada (como
     antes, para no romper `checkResumePrompt()` que corre justo después
     en `entrarConSesion()`) y solo se corrige tras el fetch si resulta
     ser staff -- para cuando el flujo real llega a guardar un caso ya está
     resuelto.

**Falta aplicar en producción (yo no tengo acceso a Supabase ni a la CLI
del usuario):**
- Correr `supabase/migrations/camila_team.sql` en el SQL Editor.
- `supabase functions deploy invite-staff --use-api` (usar `--use-api`:
  la CLI de Ricardo no tiene Docker corriendo, ver la entrada del
  2026-08-04 (1) para el porqué). **Verificar en el dashboard, tab
  "Code", que se subieron los 2 archivos** (`index.ts` +
  `_shared/auth.ts`) -- ya pasó una vez que un deploy subió el código
  viejo por un `git pull` no hecho antes de desplegar, ver esa misma
  entrada.
- **No pude probar el flujo de invitación en vivo** (no tengo forma de
  recibir un correo real ni de abrir el link mágico desde este entorno) --
  Ricardo necesita probarlo de punta a punta: invitar a un correo real
  desde "Mi Equipo" en `app.html`, abrir el correo, confirmar que
  `?invite=1` muestra el prompt de contraseña y que después de eso puede
  ver/crear casos de la misma clínica del dueño.
- Si el envío de correos de Supabase Auth no está configurado con SMTP
  propio, usa el servicio compartido de Supabase (rate-limited, ya se
  usaba para confirmar cuentas nuevas per el trigger de la etapa 2) --
  puede tardar o caer en spam. No es nuevo de esta etapa, mismo mecanismo
  que ya usaba el registro normal.

**Pendiente (etapa 5, no arrancada):** observabilidad/alertas de costo.

---

## 2026-08-05 — Claude Code (bug crítico: app.html/index.html/editor.html apuntaban al proyecto Supabase abandonado)

**Tocado:** `app.html`, `index.html`, `editor.html`, `README.md`. Sin
migración — solo constantes de configuración en el cliente.

**Hallazgo, mientras se investigaba para la etapa 4 (multi-usuario):**
`simulacion.html` migró hace tiempo al proyecto real "Smyl"
(`rpxshsiwoxdbuevjjpfw`) — tiene hasta un comentario explícito diciendo
que el proyecto viejo "quedó fuera del circuito por completo". Pero
`app.html`, `index.html` y `editor.html` **nunca se actualizaron** —
seguían con `SUPA_URL`/`SUPA_KEY` del proyecto abandonado
`gfogifozhhbzxhcbecgf`. Efecto real: el login/signup, `camila_casos` y
los precios que un dentista guardaba desde `app.html` (incluida la
"etapa 3" de precios por clínica que se acababa de terminar) iban a una
base de datos que el resto de la app ya no lee — separación silenciosa de
datos entre páginas de la misma app, sin ningún error visible.

También se descubrió que el `README.md` tenía la causa raíz de la
confusión: decía "mismo proyecto que LANA: `lgjdzaqjrmmzyrenevfm`" —  eso
es un proyecto de Supabase de OTRA app, sin relación con Camila. Quien
siga ese README termina en el dashboard equivocado. Corregido.

**Fix:** las 3 páginas ahora usan `SUPA_URL = rpxshsiwoxdbuevjjpfw` con la
misma `sb_publishable_...` key que ya usaba `simulacion.html`.

**Impacto en Stripe (revisado antes de tocar nada, no bloqueaba el fix):**
`STRIPE_CHECKOUT_URL`/`STRIPE_PORTAL_URL` en `app.html` se derivan de
`SUPA_URL`, así que ahora apuntan a
`rpxshsiwoxdbuevjjpfw/functions/v1/stripe-checkout`/`stripe-portal` — pero
esas Edge Functions (más `stripe-webhook`) probablemente solo estén
desplegadas en el proyecto viejo (ver auditoría de Stripe en la entrada
del 2026-07-30, nunca se confirmó al 100% ni con qué nombre). No es
urgente porque el cobro real ya estaba deliberadamente sin terminar
(`STRIPE_PRICE_IDS` vacíos) — pero **antes de activar cobros de verdad**
hay que desplegar `stripe-checkout`/`stripe-portal`/`stripe-webhook` al
proyecto `rpxshsiwoxdbuevjjpfw` y reconfigurar sus secrets
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`) ahí, además de
apuntar el webhook de Stripe a la URL nueva.

**No tocado a propósito:** `revisionclinica.html` (sin guión) también
tiene una referencia al proyecto viejo, pero es un duplicado huérfano sin
ninguna referencia entrante en el repo (`revision-clinica.html`, CON
guión, es el archivo real y ya apunta al proyecto correcto) — no vale la
pena arriesgar tocarlo.

**Pendiente inmediato:** re-correr la introspección de esquema/RLS para
etapa 4 (multi-usuario por clínica) en el proyecto CORRECTO
(`rpxshsiwoxdbuevjjpfw`, no `lgjdzaqjrmmzyrenevfm`) — se pidió antes de
este hallazgo y salió "0 rows" porque el usuario estaba en el proyecto de
LANA.

---

## 2026-08-04 (2) — Claude Code (infraestructura multi-tenant, etapa 3: precios reales por clínica)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`, `app.html`.
Sin migración nueva — reutiliza la columna `camila_tenants.config` (jsonb)
que ya existe, mismo patrón que el branding en `config.sim`.

Decisión de producto (el usuario dijo "vamos etapa 3" sin objetar la
recomendación que le planteé, así que seguí adelante con ella, dejándolo
documentado por si hay que ajustarlo): **precios por clínica**, guardados
en `camila_tenants.config.precios` como un mapa `{id: precio}` (solo
overrides sobre `PRECIOS_DEFAULT`, igual que ya hacía el localStorage
viejo) — no una tabla `camila_precios` nueva.

- `app.html`: `guardarPrecios()` ahora hace `PATCH` a Supabase (antes SOLO
  escribía a `localStorage`, nunca llegaba a la base de datos — por eso
  `simulacion.html` nunca podía verlos). Sigue el mismo patrón que
  `guardarConfig()` ya usaba: lee `tenantData.config`, le mezcla
  `.precios`, hace `update({config})` completo (¡importante! un PATCH con
  solo `{precios:...}` habría borrado `config.sim`/branding si existiera —
  por eso siempre se manda el objeto `config` completo, mezclado). Si el
  `PATCH` falla, el `localStorage` local (que sí se sigue escribiendo)
  sirve de respaldo en ese dispositivo, con aviso claro al usuario de que
  no sincronizó.
  `getPrecios()` ahora prefiere `tenantData.config.precios` (ya cargado
  desde Supabase al iniciar sesión) sobre el `localStorage` viejo.
- `simulacion.html`/mobile: `loadPrecios()` apuntaba a una tabla
  `camila_precios` que **nunca existió** — el fetch fallaba en silencio
  (404) y siempre caía a `PRECIOS_DEFAULT`, sin importar lo que el
  dentista hubiera configurado en `app.html` (que, de cualquier forma,
  hasta este cambio tampoco llegaba a Supabase — los dos lados del bug se
  arreglan juntos). Ahora lee `camila_tenants.config.precios` con la
  sesión del dentista logueado.

**Nota para Codex, no urgente:** los dos archivos tienen listas
`PRECIOS_DEFAULT` con IDs ligeramente distintos — `app.html` incluye
`implante` y `corona` que `simulacion.html` no tiene. No es un bug nuevo
(ya eran independientes antes de este cambio) ni lo toqué: si un dentista
configura precio para `implante`/`corona` en el panel, `simulacion.html`
simplemente lo ignora (no cotiza esos dos conceptos, nunca lo hizo). Si en
algún momento se quiere que el catálogo sea exactamente el mismo en ambos
lados, avisen antes de unificarlo por si alguno de los dos ya depende de
la lista corta a propósito.

**Pendiente (etapas 4-5 del plan de infra):** decidir si hace falta
multi-usuario por clínica, observabilidad/alertas de costo. Etapas 1 y 2
(tope de gasto server-side + provisioning automático) quedaron en la
entrada del 2026-08-04 (1) — sus migraciones y el deploy de Edge Functions
ya se aplicaron en producción el 2026-08-05, ver el aviso al final de esa
misma entrada.

---

## 2026-08-04 — Claude Code (infraestructura multi-tenant, etapas 1 y 2)

**Tocado:** `supabase/migrations/camila_tenant_provisioning.sql` (nuevo),
`supabase/migrations/camila_limits.sql` (nuevo),
`supabase/functions/_shared/limits.ts` (nuevo),
`supabase/functions/claude/index.ts`, `supabase/functions/segment-teeth/index.ts`,
`simulacion.html`, `mobile/www/simulacion.html`, `app.html`.

Arranca el plan de infraestructura SaaS multi-tenant que pidió el usuario
(revisó `revision-clinica.html`/`simulacion.html` y pidió empezar por las
etapas 1 y 2 de un plan de 5 etapas discutido en el chat, no en este
archivo). Faltan las migraciones SIN APLICAR en la base de datos real — ver
abajo.

1. **Etapa 1 — tope de gasto server-side.** `claude/index.ts` (Gemini +
   Anthropic) y `segment-teeth/index.ts` (Replicate) NO validaban
   `limite_diagnosticos`/`diagnosticos_usados` en el servidor — el tope
   solo existía en el cliente, así que una llamada directa al Edge
   Function (sin pasar por la UI) generaba sin ningún límite. Nuevo
   `_shared/limits.ts` (`checkAndConsumeLimit`) llamado justo después de
   `requireUser` en ambas funciones:
   - Con sesión real: RPC `camila_consumir_diagnostico(tenant_id)` —
     UPDATE atómico (`for update` + condición) que rechaza si
     `!activo`, `vence_en` pasado, o `diagnosticos_usados >=
     limite_diagnosticos`, e incrementa en la misma transacción si pasa.
   - Sin sesión (el modo anónimo que dejamos abierto el 2026-08-01/02 por
     pedido explícito — `_shared/auth.ts` sigue sin tocarse, sigue
     dejando pasar `user: null`): tope duro de 5/hora por IP (`ANON_HOURLY_LIMIT`,
     configurable) vía RPC `camila_anon_rate_check`, tabla nueva
     `camila_anon_usage`. No reemplaza el login, solo evita gasto sin
     ningún techo si el link se comparte.
   - Ambas funciones de Postgres son `SECURITY DEFINER` con `EXECUTE`
     revocado a `anon`/`authenticated` a propósito — si quedaran
     invocables por RPC público, cualquiera podría pasar el `tenant_id`
     de OTRA clínica como parámetro y drenarle su cupo sin generar nada
     real. Solo las Edge Functions (service role) las llaman.
   - **Efecto secundario que sí toqué para evitar doble conteo**: ahora
     que el servidor incrementa `diagnosticos_usados` en cada llamada
     real, dejé de dejar que el cliente también lo hiciera con un PATCH
     de valor absoluto (`registrarDiagnosticoUsado()` en
     `simulacion.html`/mobile, y el bloque equivalente en `app.html`)
     porque esos dos escritores corriendo a la vez se pisaban entre sí
     (carrera + el valor absoluto del cliente podía revertir el conteo
     real del servidor). Ahora esas dos funciones SOLO actualizan la
     copia local en memoria (`CFG.diagnosticosUsados` /
     `tenantData.diagnosticos_usados`) para que el chequeo previo de esta
     misma sesión no deje pasar de más — ya no escriben a la base de
     datos, el servidor es la única fuente de verdad para el valor
     persistido.
2. **Etapa 2 — provisioning de tenant en el servidor.** El `INSERT` a
   `camila_tenants` después de `signUp()` corría desde el cliente
   (`simulacion.html`, `app.html`) — si fallaba (red, tab cerrado, o el
   caso ya documentado de confirmación de correo activada, donde
   `signUp()` no da sesión y RLS rechaza el insert hasta el siguiente
   login) el usuario quedaba con cuenta en Auth pero sin fila de tenant.
   `app.html` tenía un parche para recrear la fila en
   `continuarConUsuario()`; `simulacion.html` NO tenía ningún parche — un
   dentista que se registra ahí y nunca visita `app.html` se quedaba
   atorado. Nuevo trigger `camila_on_auth_user_created` (AFTER INSERT en
   `auth.users`) crea la fila automáticamente con los mismos defaults que
   ya usaba el parche de `app.html` (plan `profesional`, límite 40, vence
   en 1 mes), leyendo `raw_user_meta_data` (`nombre`/`plan`/
   `limite_diagnosticos`, ya se mandaban en `options.data` del `signUp()`
   existente — no hubo que tocar eso). `ON CONFLICT (id) DO NOTHING`, así
   que el `INSERT` client-side existente se deja tal cual — con el
   trigger la fila ya existe, ese insert simplemente no encuentra nada
   que hacer.

**ACTUALIZACIÓN 2026-08-05 — ya aplicado en producción.** El usuario
(Ricardo) corrió las dos migraciones a mano en el SQL Editor del proyecto
"Smyl" y desplegó ambas Edge Functions desde su máquina con
`supabase functions deploy claude --use-api` y
`supabase functions deploy segment-teeth --use-api` (su instalación de
Supabase CLI no tenía Docker, `--use-api` empaqueta del lado del servidor
sin necesitarlo). Ojo con algo que sí pasó y vale la pena dejar
documentado: la primera vez que corrió el deploy, su carpeta local tenía
el código de antes del 2026-08-04 (no había hecho `git fetch`/`pull` desde
el 08-01, y `git status` decía "up to date" porque eso solo compara contra
el último fetch cacheado, no contra GitHub en vivo) — el primer deploy
subió `claude`/`segment-teeth` SIN `_shared/limits.ts`, function
funcionalmente idéntica a la de antes de estas dos etapas. Se detectó
revisando el tab "Code" de cada función en el dashboard (el log de
`supabase functions deploy` no avisa de nada raro, solo lista los archivos
que sí subió) antes de darlo por bueno, se hizo `git pull` y se volvió a
desplegar — el segundo deploy sí incluyó los tres archivos
(`index.ts`, `_shared/limits.ts`, `_shared/auth.ts`). **Si alguien más
despliega Edge Functions manualmente:** después de desplegar, revisar el
tab "Code" en el dashboard y confirmar que `_shared/limits.ts` (y
cualquier otro `_shared/*` que la función importe) aparece en la lista de
archivos — no basta con que el comando diga "Deployed Functions".

**Pendiente (etapas 4-5 del plan, no arrancadas):** decidir si hace falta
multi-usuario por clínica, observabilidad/alertas de costo. Etapa 3
(precios por clínica) ya se hizo — ver la entrada de arriba
(2026-08-04 (2)). Ver el chat para el plan completo de 5 etapas si hace
falta retomarlo.

---

## 2026-08-03 — Codex (máscara dental continua, sin dientes fragmentados)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se corrigió la máscara estrictamente dental que podía dejar bordes dentados,
  picos y fragmentos blancos al clasificar cada píxel de manera aislada.
- La clasificación admite ahora esmalte más cálido y oscuro, manteniendo una
  exclusión explícita para el rojo dominante de labios y encía.
- Se añadió cierre morfológico para unir fragmentos y rellenar pequeños huecos
  sin expandir el contorno, seguido de componentes conexos que eliminan motas
  demasiado pequeñas para corresponder a una región dental.
- El borde continúa suavizándose solo hacia dentro; fondo PNG, dimensiones y
  alineación 1:1 permanecen iguales a la fotografía original.

## 2026-08-03 — Codex (composición estrictamente dental y empalme 1:1)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- `componerConOriginal()` dejó de copiar un óvalo completo de boca. Ahora
  construye una máscara píxel a píxel dentro de esa región y acepta solamente
  cambios con apariencia de esmalte; labios, encía, piel y barba permanecen
  tomados de la fotografía original.
- La máscara elimina motas, suaviza exclusivamente hacia dentro del diente y
  rechaza resultados vacíos o anormalmente grandes. Si falla, la aplicación
  muestra error: ya no usa la cara completa generada por IA como respaldo.
- La salida se exporta como PNG del mismo ancho y alto del original para no
  recomprimir el fondo. Cada simulación restablece la alineación a `0,0,100%`,
  pues la composición ya queda empalmada en coordenadas 1:1.
- El cambio aplica tanto a la primera simulación como a regeneraciones hechas
  desde el editor.

## 2026-08-03 — Codex (espaciado clínico de la guía de proporción)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las siete líneas verdes delimitan ahora seis espacios con pesos exactos y
  simétricos: `0.618 | 1.0 | 1.618 | 1.618 | 1.0 | 0.618`.
- Los pesos se normalizan al ancho actual de la guía: los extremos permanecen
  en sus bordes y la cuarta línea queda exactamente en el eje central.
- La distribución se recalcula automáticamente al cambiar tamaño mediante
  botones o pellizco; arrastre y agrupamiento permanecen intactos.

## 2026-08-03 — Codex (guía de proporción con siete líneas)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía verde de “Proporción” pasa de cinco a siete líneas verticales.
- Se añadieron dos divisiones áureas intermedias, simétricas respecto al eje
  central y dentro de los límites existentes de la guía.
- El pellizco, arrastre, agrupamiento, color y brillo no cambian.

## 2026-08-03 — Codex (comparador sin recorte vertical)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- El comparador antes/después ya no limita su altura normal a `58vh`.
- La altura ahora se calcula con `ancho visible × proporción natural` de la
  fotografía original, por lo que las tomas verticales muestran también la
  barbilla, cuello y borde inferior sin recorte.
- La misma regla se reaplica al salir de “Ajustar alineación”, evitando que el
  recorte reaparezca después de usar esa herramienta.
- Original y simulación conservan exactamente la misma caja y alineación.

## 2026-08-03 — Codex (pellizco de proporción, paneo y foto original)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía “Proporción” admite gesto de dos dedos: separarlos aumenta ancho y
  alto, juntarlos los reduce, manteniendo el centro de la guía y respetando
  los límites de la fotografía.
- Al ampliar la fotografía aparece disponible “Mover foto”. Mientras está
  activo, arrastrar desplaza la fotografía ampliada hasta sus bordes; las
  guías viajan con el canvas y conservan su alineación. Volver a 100% restaura
  posición y modo de movimiento.
- Se añadió “Ver original” sobre la fotografía. Alterna en un toque entre la
  toma original y la simulación, sin cerrar el editor ni perder zoom, paneo,
  guías o parámetros; el texto cambia a “Ver simulación” al comparar.
- No se modificaron prompts, backend ni lógica clínica.

## 2026-08-03 — Codex (proporción verde y zoom de fotografía)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las líneas de la guía “Proporción” ahora se dibujan en verde fosforescente
  (`#39FF14`) con brillo de contraste; su chip activo usa el mismo código
  visual.
- Se añadieron controles independientes de zoom para la fotografía del editor:
  `−`, porcentaje/restablecer y `+`, desde 100% hasta 300% en pasos de 25%.
- El zoom transforma conjuntamente la fotografía y las guías, conservando su
  alineación y sin reutilizar los controles de escala de la guía activa.
- El zoom vuelve a 100% cada vez que se abre el editor. No se modificaron
  prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (líneas horizontales y verticales múltiples)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Las guías “Línea media” y “Línea incisal” se presentan ahora como “Línea
  vertical” y “Línea horizontal”. Los controles clínicos del panel conservan
  sus nombres porque siguen alimentando el prompt de regeneración.
- Las líneas se dibujan en blanco, con sombra de contraste, y abarcan toda la
  altura o anchura de la fotografía. Las horizontales inclinadas también
  alcanzan ambos bordes de la imagen.
- Se pueden agregar y eliminar líneas verticales u horizontales adicionales.
  Cada una tiene estado, posición, selección y persistencia independientes;
  el agrupamiento incluye dinámicamente todas las líneas visibles.
- Compatibilidad: los casos anteriores reciben `lineasExtra: []`. No se
  modificaron prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (manija de curvatura de sonrisa)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La guía “Curva sonrisa” incorpora una manija naranja en el extremo derecho.
  Al arrastrarla verticalmente, los dos extremos de la curva suben o bajan de
  forma simétrica mientras el punto central permanece fijo.
- Arrastrar el resto del canvas conserva el comportamiento anterior: mueve la
  guía activa o todas las visibles cuando están agrupadas. La manija ajusta
  únicamente la curva, incluso con las guías agrupadas.
- El ajuste se guarda en `EDITOR_PARAMS.curvaExtremos`; los casos anteriores
  reciben `0` y conservan exactamente la geometría visual previa.
- No se modificaron prompts, backend ni lógica clínica.

## 2026-08-02 — Codex (guías independientes y agrupables)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Línea media, línea incisal, curva de sonrisa y proporción dejaron de
  compartir la única `zone`: cada una conserva ahora su propia posición y
  escala dentro de `guideZones`.
- La última guía tocada queda marcada como objetivo; arrastrar o usar `+/-`
  modifica solamente esa guía mientras las demás permanecen fijas.
- Se añadió “Agrupar guías”. Al activarlo, las guías visibles se trasladan y
  escalan juntas conservando su separación; al desagrupar vuelven a editarse
  individualmente.
- Compatibilidad: los casos anteriores inicializan las cuatro zonas desde la
  antigua `zone`. No se modificaron prompts, backend ni lógica clínica.

---

## 2026-08-02 — Codex (guía VITA dentro del editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se reemplazó el `<select>` “Escala de color (VITA)” del editor por una
  guía visual horizontal con las 14 muestras de `VITA_CLASSICAL` que ya usa
  SMYL, incluyendo fotografía de la carilla, logotipo y código.
- La selección actual queda resaltada, se centra al elegirla y actualiza
  `EDITOR_PARAMS.diseno.vita`, por lo que el tono elegido se conserva en el
  prompt existente al regenerar.
- Se mantiene la opción “Conservar el tono de la simulación actual”. No se
  modificaron prompts, backend, Supabase ni recursos clínicos.

---

## 2026-08-02 — Codex (regeneración visible desde el editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Causa de “Regenerar no hace nada”: `show()` sólo quitaba `.active` de
  `.screen`, mientras el editor es `.ed-screen`. El resultado podía
  actualizarse por debajo y el editor permanecía cubriéndolo.
- `show()` ahora cierra tanto `.screen` como `.ed-screen`, lo que también
  corrige el botón de cerrar del editor.
- El botón superior “Aplicar diseño” ahora muestra “Generando...” y se
  bloquea junto con el botón inferior hasta terminar o fallar la llamada.
- No se modificaron prompts, Edge Functions, Supabase ni lógica clínica.

---

## 2026-08-02 — Codex (acceso visible al editor)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Se detectó que `#s-editor` y `abrirEditorDiseno()` existían, pero ninguna
  acción visible invocaba la función; por eso el editor morfológico era
  inaccesible desde el flujo normal.
- Se agregó en la pantalla de resultado, antes de “Revisión clínica
  avanzada”, el botón principal “Editar diseño de carillas”. Abre el editor
  existente donde se controlan forma, tamaño, proporción, textura y tono.
- No se cambió la lógica de generación, prompts, backend ni Supabase.

---

## 2026-08-02 — Codex

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** se amplió la simulación para que forma y
tamaño se basen en un análisis visible facial, dentolabial y dental, además del
tono VITA:

- `CLAUDE_ANALISIS_SYSTEM_PROMPT` ahora devuelve forma recomendada (circular,
  triangular o rectangular), tamaño relativo, relación ancho/alto de centrales,
  línea de sonrisa, corredores bucales, soporte labial y caracterización. La
  posición de reposo debe marcarse `no_valorable` cuando la foto sonriendo no
  permite medirla; no se inventan medidas.
- `construirPromptGemini()` incorpora anatomía primaria, secundaria y
  terciaria, estratificación cerámica, mamelones, halo incisal, zonas de espejo
  y sombra, microtextura y periquimatos moderados. Se reforzó no modificar
  labios, encías, mordida, apertura, iluminación ni encuadre.
- El editor muestra una tarjeta de recomendación faciodentolabial y permite
  aplicarla. Se agregaron controles de forma, tamaño 88–112%, relación
  ancho/alto 70–90% y caracterización superficial.
- Casos guardados antes de estos campos reciben defaults compatibles.
- No se modificaron Edge Functions, base de datos ni configuración nativa.
  Sintaxis validada en web y móvil. La revisión visual automatizada quedó
  impedida porque el navegador aislado no puede acceder a `file://` ni al
  servidor local del host.

---

## 2026-08-01 — Codex

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Agregada `recolorearDientes(imagenBaseUrl, colorObjetivoRgb)`: recoloración
  local con Canvas 2D para reutilizar una simulación ya generada y aplicar
  tonos VITA sin nuevas llamadas de red o IA.
- La máscara combina la elipse de boca solamente como zona de búsqueda con
  clasificación por luminosidad/saturación/matiz, limpieza de ruido,
  componentes conectados y feather interior para excluir labios, encía y
  piel.
- La máscara se guarda en caché por imagen para que los siguientes tonos sólo
  recompongan el color. No se modificaron `VITA_CLASSICAL`,
  `vitaLabPantallaSim`, `labARgbSim` ni `shade.color`.
- Validación de sintaxis aprobada en las copias web y móvil. La función queda
  disponible para conectarla desde la interfaz que permita cambiar el tono de
  una simulación ya generada.

---

## 2026-07-31 (3) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** (para reducir aún más el riesgo de que
`claude` Edge Function se pase del límite de tiempo de la plataforma, y
porque tiene sentido clínico aparte): se invirtió el orden del flujo.

- `processPhotos()` ya NO llama a `analyzeWithClaude()` (el diagnóstico
  completo — score/hallazgos/plan/cotización, hasta 6 fotos en una sola
  llamada, la más lenta y pesada) de forma automática. Sigue llamando a
  `analizarConClaude()` (1 sola foto, análisis de proporciones faciales
  solo para afinar el prompt de generación) y luego `generateSimulation()`
  igual que antes — el paciente ve su simulación más rápido, sin esperar el
  diagnóstico.
- Nuevo botón "Solicitar diagnóstico" en la pantalla de resultado (`#s-res`)
  — nuevo `<div id="diag-request-box">` (CTA, visible cuando `S.diagnosis`
  es `null`) y `<div id="diag-content">` (envuelve el score-banner/
  hallazgos/plan/cotización que ya existían, oculto hasta que hay
  diagnóstico). Nueva función `solicitarDiagnostico()` llama a
  `analyzeWithClaude()` bajo demanda y `renderDiagnostico()` (extraída del
  antiguo `showResult()`) pinta el resultado.
- **`analyzeWithClaude()` sigue leyendo `S.photos`** (las fotos originales
  "antes"), nunca `S.result`/`S.results` (las simulaciones generadas) — no
  hizo falta guardar nada nuevo para esto, el estado ya los mantenía
  separados; solo había que mover CUÁNDO se llama, no arreglar una fuga de
  qué foto se manda.
- **No toqué** `guardarCaso()` (Guardar en expediente) — ya toleraba
  `S.diagnosis` nulo (`d = S.diagnosis || {}`, guarda 0/arrays vacíos), así
  que un dentista puede seguir guardando un caso con solo la simulación,
  sin pedir diagnóstico primero. Si eso no es lo que se quiere (forzar a
  pedir diagnóstico antes de guardar/compartir), es una decisión de
  producto aparte, no la tomé por mi cuenta.
- Textos del loader (`ps3`/`ps4` en `#s-proc`) actualizados — ya no dicen
  "Generando diagnóstico clínico"/"Calculando cotización" (ya no pasa en
  ese paso) sino "Ajustando proporciones faciales"/"Aplicando el tono de
  tus carillas".

**Si Codex toca `#s-res`, `showResult`, `renderResPhotos` o el CSS de
`.cta-box`/`.score-banner`**: ojo con el nuevo `#diag-request-box`/
`#diag-content` — son hermanos dentro de `.res-body`, y `renderDiagnostico()`
alterna cuál se muestra según `S.diagnosis`.

---

## 2026-07-31 (2) — Claude Code

**Tocado:** `supabase/functions/claude/index.ts`.

**CAUSA REAL encontrada** (con datos del dashboard de Supabase, no
especulación): en Invocations, cada POST real a la función `claude`
devolvía **503** (100% de las veces), mientras que los OPTIONS (preflight)
daban 200 normal. 503 = la plataforma mató la función por pasarse de su
límite de **2 segundos de tiempo de CPU real por invocación** — límite fijo
en TODOS los planes de Supabase (Free y Pro), no cuenta el tiempo esperando
a Anthropic/OpenAI (eso es I/O), solo cómputo real. Todo lo que se ajustó
antes (entrada (1) de hoy, y los timeouts de la sesión anterior) apuntaba a
límites de *tiempo de espera*, que nunca fueron la causa real.

**Corregido:** en `generate_image`, la conversión de la foto de base64 a
bytes usaba `Uint8Array.from(atob(str), c => c.charCodeAt(0))` — itera el
string como iterable (no por índice) e invoca una función por cada
carácter; para una foto de ~1MB en base64 son ~1M llamadas lentas, capaces
de agotar los 2s de CPU por sí solas. Reemplazado por un for indexado con
`charCodeAt(i)`, mucho más rápido para el JIT.

**Agregado:** marcas de tiempo (`performance.now()`) en cada paso del
handler (después de `requireUser`, después de `req.json()`, después de
serializar el body para Anthropic con su tamaño en KB, después del fetch,
después de parsear la respuesta). Si la función se vuelve a matar, el log
va a decir exactamente hasta dónde llegó — ya no hace falta seguir
adivinando.

**Si esto no resuelve el 503 del todo:** lo más probable es que el cuello
de botella esté en el parseo/serialización del JSON cuando van las 6 fotos
juntas (`analyzeWithClaude` en `simulacion.html`, ~1-2MB de body). La
solución en ese caso sería reducir el tamaño de las fotos que se mandan a
analizar (resolución/calidad más baja específicamente para el análisis, no
para lo que ve el paciente) — no se tocó todavía porque falta confirmar con
las marcas de tiempo si de verdad es ahí donde se va el CPU.

**Desplegado:** commit `01c263a`, pusheado. Falta que el usuario corra
`supabase functions deploy claude` y pruebe de nuevo.

---

## 2026-07-31 (1) — Claude Code

**Tocado:** `supabase/functions/_shared/auth.ts`.

**Contexto:** falla persistente en producción — la generación se quedaba
"Tardó demasiado" y en DevTools aparecía como "CORS error" (proceso de la
Edge Function muerto por el propio límite de la plataforma, sin devolver
headers). Ya se había agregado un `fetchConTimeout` (AbortController, 90s)
alrededor de las llamadas a Anthropic/OpenAI en `claude/index.ts`
(commit `c56e309`), pero la falla siguió idéntica después de desplegarlo.

**Causa encontrada:** `requireUser()` en `_shared/auth.ts` llama a
`admin.auth.getUser(jwt)` **antes** de que el código con el `fetchConTimeout`
llegue a ejecutarse, y esa llamada no tenía ningún límite de tiempo propio.
Si esa llamada específica se cuelga, la plataforma mata el proceso antes de
que el fix anterior siquiera entre en juego — explica por qué el síntoma no
cambió nada después de ese primer fix.

**Fix:** `Promise.race` con un timeout de 8s alrededor de
`admin.auth.getUser(jwt)`. Si se tarda, ahora responde 401 con CORS
("No se pudo verificar la sesión a tiempo...") en vez de dejar que la
plataforma corte el proceso a ciegas.

**Desplegado:** commit `dcd7938`, pusheado. **Falta que el usuario corra
`supabase functions deploy claude` de nuevo** (este archivo es compartido,
así que se despliega junto con la función `claude`) y pruebe otra vez —
no confirmado en vivo todavía.

**Si esto tampoco resuelve el "CORS error" real:** el siguiente paso es
obtener los logs reales de la Edge Function desde el dashboard de Supabase
(Project → Edge Functions → claude → Logs) durante una falla en vivo —
nunca se logró ver un log real de una invocación fallida en esta sesión,
todo el diagnóstico fue por síntomas del lado del navegador (DevTools).

---

## 2026-07-30 (5) — Claude Code

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

**Por pedido explícito del usuario** (y porque coincide con las fallas de
generación que reportó ese mismo día -- ver entradas de chat, probablemente
varias llamadas paralelas a OpenAI en calidad alta agotando tiempo/cuota):
`processPhotos()` ya NO genera automáticamente la simulación de las 6
vistas en paralelo -- **solo genera la frontal**. Las demás (perfiles,
extraoral, intraoral, 3/4) quedan sin generar hasta que el dentista/
paciente elige esa vista y le da "Generar esta vista" (mismo botón que
"Generar de nuevo", ahora con etiqueta dinámica según si la vista ya tiene
resultado). Claude sigue analizando las 6 fotos igual que antes (no cambió
`analyzeWithClaude()`) -- esto solo afecta qué vistas se mandan a generar
imagen con OpenAI.

Funciones tocadas: `processPhotos()` (ya no hace el `Promise.all` de las 6
vistas), `cambiarVistaBA()` (ya no bloquea con alert al cambiar a una vista
sin generar -- muestra la foto "antes" en ambos lados del slider),
`renderResPhotos()` (marca "· sin generar" en la miniatura), nueva
`actualizarBotonGenerar()` (cambia la etiqueta del botón), y
`regenerarSimulacion()` (ahora también llama a `registrarDiagnosticoUsado()`
-- toda generación real de imagen cuenta contra el límite del plan, no solo
la automática).

**Si Codex toca la pantalla de resultados (`#s-res`, `renderResPhotos`,
`cambiarVistaBA`, el botón `#btn-regenerar`)**: ojo con este flujo -- ya no
todas las vistas tienen `S.results[view]` poblado por default, el código
que las use debe tolerar `null`.

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
