# Bitácora compartida — SMYL

Este archivo es la memoria compartida entre Codex (diseño/frontend) y Claude
Code (arquitectura/backend/infra). Ninguno de los dos agentes recuerda lo que
hizo el otro entre sesiones — así que antes de tocar algo, lee la entrada más
reciente que mencione ese archivo, y al terminar deja tu propia entrada.

Formato de cada entrada: fecha, agente, qué se tocó, qué debe saber el otro.
Las entradas más nuevas van arriba.

---

## 2026-08-10 (5) — Codex (elimina halo amarillo y refuerza cerámica/anatomía)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Sustituida la transición interior de 2–4 px por antialias cercano a 1 px,
  con alfa sesgado hacia la restauración. Evita que reaparezca el esmalte
  original como contorno amarillo sin expandir la máscara sobre encía.
- El prompt exige cobertura completa de la cara vestibular, sin doble borde,
  halo amarillo ni exposición del diente viejo; refuerza centrales dominantes,
  laterales más estrechos/cortos, caninos individualizados, arco incisal y
  troneras naturales.
- El color VITA ahora se describe como cerámica ópticamente estratificada
  bajo la iluminación original: dentina cervical, cuerpo, translucidez
  incisal, mamelones, opalescencia, áreas de espejo y sombras de convexidad.
- El recorte facial de generación es más cerrado alrededor de la sonrisa para
  dedicar más resolución efectiva a la anatomía dental. La reinserción sigue
  realizándose sobre la fotografía maestra intacta.

---

## 2026-08-10 (4) — Codex (integración de carillas sin efecto de sobreposición)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- Integrado el feather interior de la máscara generado por Claude: suaviza el
  canto de recorte sin expandir píxeles sobre encía o labios.
- Endurecido el filtro de arcada superior. Si hay dos filas dentales claras,
  se separan por el mayor espacio vertical entre centros y sólo se compone la
  fila superior; FDI queda como respaldo para tomas de una sola fila.
- Si no existen ni coordenadas válidas ni identificación FDI, la simulación
  falla de forma explícita en lugar de copiar todas las máscaras y alcanzar
  dientes inferiores.

---

## 2026-08-10 (3) — Codex (carillas anatómicas: generación local de alta resolución)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

- La simulación facial ya no manda la fotografía completa a generación. Se
  obtiene un recorte clínico de la sonrisa a resolución nativa, se genera y
  segmenta únicamente en ese recorte, y después se reinserta en las
  coordenadas exactas de la fotografía maestra. Esto da muchos más píxeles a
  la anatomía dental y mantiene intactos rostro, labios, encías y encuadre.
- Se eliminó la instrucción que forzaba "8 a 10" coronas, porque promovía
  dientes estrechos, repetidos y de apariencia protésica. Ahora existe
  correspondencia uno-a-uno con cada diente superior realmente visible, sin
  inventar piezas ni cambiar los dientes inferiores.
- El prompt exige jerarquía morfológica: centrales dominantes, laterales algo
  menores y caninos con transición propia; además prohíbe expresamente el
  patrón de teclas de piano/chiclets, la fila de dentadura, el blanco plano y
  los bordes incisales idénticos.
- No se realizó una generación pagada durante la validación. La prueba final
  debe hacerse con una fotografía clínica real y revisar el resultado a 100 %
  antes de usarlo como material de presentación al paciente.

---

## 2026-08-10 (2) — Claude Code (CAUSA REAL del "No se pudo generar tu simulación": segment-teeth nunca tuvo credenciales en el proyecto Smyl)

**Tocado:** `supabase/functions/segment-teeth/index.ts`, `simulacion.html`,
`mobile/www/simulacion.html`.

Tras hacer que la pantalla de error mostrara el motivo real (ver entrada
anterior), la siguiente captura del celular dijo por fin la verdad:
**`Error: supabaseUrl is required`**. Con eso el diagnóstico fue directo.

`segment-teeth/index.ts` leía sus credenciales así:
```
const SB_URL = Deno.env.get("SB_URL") || "";
```
— **solo** los secrets manuales `SB_URL`/`SB_SERVICE_ROLE_KEY`, sin caer a
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, que Supabase inyecta sola en
toda Edge Function. Esos secrets manuales existían en el proyecto viejo
(`gfogifozhhbzxhcbecgf`) y **nunca se configuraron en "Smyl"**, así que
`createClient("", "")` reventaba en cada llamada. `_shared/auth.ts` y
`_shared/limits.ts` ya usaban el fallback correcto desde siempre — solo
este archivo se quedó atrás cuando se migró de proyecto.

**Por qué no se había notado:** hasta hace pocos días nada del flujo normal
llamaba a `segment-teeth` (solo `revision-clinica.html`, que casi no se
usaba). Los cambios recientes de Codex hicieron que la **composición de
cada simulación** la invoque, así que el bug latente pasó a romper el flujo
principal.

Arreglado con el mismo orden de preferencia que el resto
(`SUPABASE_URL || SB_URL`), más una guarda al inicio del handler que
responde un mensaje claro si faltan `SUPABASE_URL`/`SERVICE_ROLE_KEY` o
`REPLICATE_API_TOKEN`, en vez de reventar a media simulación con un error
críptico.

**Lección para la próxima:** dos rondas completas se perdieron persiguiendo
hipótesis equivocadas (cupo agotado, tope por IP) porque
`mostrarErrorProceso()` disfrazaba TODO de "problema de conexión". Ya se
corrigió para mostrar cualquier mensaje real; **no volver a meter errores
detrás de un mensaje genérico** — el costo de depurar a ciegas desde una
captura de celular es altísimo.

**Falta verificar en producción:** que `REPLICATE_API_TOKEN` esté
configurado como secret en Smyl y que el bucket `camila-masks` exista ahí
(la función lo usa para subir las máscaras). Si falta cualquiera de los
dos, la guarda nueva lo dirá claro en el mensaje de error.

---

## 2026-08-10 — Claude Code (fix: "No se pudo generar tu simulación" — el cupo del plan se agotaba 4x más rápido de lo debido)

**Tocado:** `supabase/functions/_shared/limits.ts`,
`supabase/functions/claude/index.ts`, `simulacion.html`,
`mobile/www/simulacion.html`.

Ricardo reportó que la simulación fallaba con "Hubo un problema de
conexión generando tu simulación". Al revisar el código, ese mensaje es
el **genérico por defecto** de `mostrarErrorProceso()` — solo se muestra
cuando el error NO es caída de red ni timeout. O sea: el servidor sí
estaba respondiendo con un motivo real, y la UI lo estaba disfrazando de
problema de conexión (mandando a "Reintentar" ante errores que reintentar
no arregla nunca). Tres bugs distintos, uno de ellos causa raíz:

1. **CAUSA RAÍZ — cada llamada a la Edge Function `claude` descontaba un
   "diagnóstico" del plan.** Una sola simulación hace **4+ llamadas**
   (`validarEncuadreFrontal`, `analizarConClaude`, `analyzeWithClaude`,
   `generateSimulation`), y tres de ellas están envueltas en
   `conReintento` (hasta 2 intentos cada una) → hasta **7 descuentos por
   simulación**. Un plan de 40 "diagnósticos/mes" daba ~10 simulaciones
   reales, y darle a "Reintentar" cerca del límite consumía MÁS cupo.
   Esto no se notaba antes de hoy porque el contador no se aplicaba de
   verdad (ver entrada 2026-08-05 (3): `app.html` mandaba la llave
   anónima, y el staff ni siquiera podía generar) — al arreglar eso hoy,
   el contador empezó a funcionar y se agotó rápido con las pruebas del
   día.
   **Fix:** solo `action === 'generate_image'` descuenta del plan. Las
   llamadas de análisis pasan por `checkLimitSinConsumir()` (nueva en
   `limits.ts`) que verifica clínica real/activa/con cupo pero NO
   incrementa. Para poder decidir según la acción hubo que mover el
   `req.json()` ANTES del chequeo de límite (antes iba después a
   propósito, para no parsear bodies grandes si el tenant ya estaba
   agotado — se pierde esa micro-optimización a cambio de cobrar bien).
2. **CORS incompleto para el modo prospecto** (bug que introduje yo el
   mismo día): `simulacion.html` en modo prospecto manda el header
   `X-Tenant-Id`, pero `claude/index.ts` no lo declaraba en
   `Access-Control-Allow-Headers` — el navegador cortaba la llamada en el
   preflight y el paciente veía "problema de conexión" sin que su
   conexión tuviera nada que ver. Agregado `x-tenant-id`.
3. **El error real se ocultaba.** `mostrarErrorProceso()` solo
   distinguía "Load failed" y timeouts; cualquier otro error (incluidos
   los 402 de límite de plan) caía al genérico de conexión. Ahora los
   errores que traen un motivo del servidor se marcan explícitamente
   (`errorDelServidor()`, pone `e.esDelServidor = true` en los 3 sitios
   que hacen `throw` con `data.error`) y se muestran tal cual. De paso,
   `conReintento` ya no reintenta esos errores — reintentar un "plan
   agotado" solo retrasa el aviso y gasta otra llamada.

**Ajuste de dimensionamiento relacionado:** el tope por IP del modo
anónimo son 5 llamadas/hora. Como una simulación son ~4 llamadas, un
prospecto quedaba bloqueado a media primera simulación. Se separó un
`PROSPECTO_HOURLY_LIMIT` (default 20/hora ≈ 5 simulaciones por IP) para
el modo prospecto, dejando el estricto de 5 para el anónimo puro (sin
link de clínica). El cupo del plan de la clínica sigue siendo el límite
real de gasto; el de IP es solo anti-abuso.

**Falta aplicar en producción:** redesplegar `claude`
(`supabase functions deploy claude --use-api`). `simulacion.html` se
publica solo por GitHub Pages.

**ACTUALIZACIÓN tras revisar la base de datos con Ricardo:** la hipótesis
del cupo agotado era **incorrecta** — `diagnosticos_usados` estaba en 0 de
40, plan activo y vigente, y ambas RPC (`camila_consumir_diagnostico`,
`camila_anon_rate_check`) sí existen en el proyecto Smyl. Ese 0 es la
pista real: si el contador nunca subió pese a un día entero de pruebas,
las llamadas **no estaban llegando con sesión de dentista** — caían al
camino anónimo (`tenantId` null en `requireUser`), cuyo tope era de 5
llamadas/hora por IP. Con ~4 llamadas por simulación, la segunda
simulación de cada hora se bloqueaba con "Demasiadas solicitudes sin
iniciar sesión", que la pantalla mostraba como "problema de conexión".
El tope anónimo se subió de 5 a 20/hora (≈5 simulaciones) por la misma
razón que el de prospecto. **Falta confirmar por qué la sesión no llega
al Edge Function** cuando se usa la simulación desde el celular — puede
ser simplemente que no había sesión iniciada ahí, o algo más de fondo;
revisar `camila_anon_usage` (si tiene filas con contador alto, confirma
el diagnóstico) antes de dar el tema por cerrado.

**CONFIRMADO Y CERRADO (2026-08-10):** `camila_anon_usage` tenía 3 filas,
las tres con `contador = 5` clavado en el tope — huella inequívoca de que
las llamadas entraban por el camino anónimo y se bloqueaban. Peor: un
`count` sobre `camila_casos` dio **2 huérfanos de 2 totales, 0 en la
clínica** — o sea, el 100% de las simulaciones hechas hasta ahora quedaron
fuera del panel del dentista. Se reasignaron a mano con un `update
camila_casos set tenant_id = '<id>' where tenant_id is null or tenant_id =
'local'`.

**Decisión tomada con Ricardo a raíz de eso: se ELIMINÓ el modo anónimo de
`simulacion.html`.** El "login opcional" que se había pedido en su momento
era la causa raíz de los casos huérfanos (y de que no se cargara marca ni
precios, y de que el cupo del plan nunca se cobrara). Ahora hay
exactamente dos entradas, ninguna anónima:
  1. Dentista/staff con sesión → `entrarConSesion()`.
  2. Paciente por link público `?clinica=<tenant_id>` →
     `entrarComoProspecto()` (sin cuenta, pero con clínica identificada).
Sin ninguna de las dos, `pedirSesionParaEntrar()` (reemplaza a la
eliminada `entrarSinSesion()`) bloquea la app con el overlay de login, con
un aviso amarillo explicando por qué, el botón × oculto, y
`cerrarLoginSim()` con guarda para que no se pueda esquivar.
**Ojo para quien siga:** el tope anónimo por IP (`ANON_HOURLY_LIMIT`) ya
casi no aplica a nadie con este cambio — solo quedaría para llamadas
directas a la Edge Function sin pasar por la UI. El que importa ahora es
`PROSPECTO_HOURLY_LIMIT`.

**Pendiente de confirmar con Ricardo:** cuánto cupo le queda realmente
(`select nombre, diagnosticos_usados, limite_diagnosticos, activo,
vence_en from camila_tenants;`). Si ya está en el tope, el fix de arriba
evita que se vuelva a agotar tan rápido, pero el contador actual hay que
resetearlo a mano — el consumo de hoy fue casi todo de pruebas, no de
pacientes reales.
## 2026-08-09 (4) — Codex (timeout de generación móvil)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La espera cliente para `generate_image` subió de 110s a 150s porque la Edge
Function puede recorrer varios modelos Gemini y superar 110s con demanda alta.
Además `conReintento()` ya no repite timeouts ni errores semánticos: sólo
reintenta desconexiones reales (`Load failed`, `Failed to fetch`,
`NetworkError`). Antes un timeout podía iniciar otra generación mientras la
primera seguía corriendo, duplicando tiempo y posible costo.

---

## 2026-08-09 (3) — Codex (elimina encía roja de la simulación)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La composición dejó de unir la máscara de dientes originales con la máscara
del resultado. Esa unión copiaba encía generada en las zonas donde cambiaba el
contorno de una corona y producía líneas rojizas entre dientes. Ahora sólo se
copia la máscara anatómica de las carillas generadas y se filtra a FDI 1x/2x
(arcada superior); la arcada inferior permanece idéntica al original.

El prompt también fija el tratamiento rápido en 8–10 carillas superiores
visibles, exige un cambio morfológico perceptible y conserva jerarquía de
centrales, laterales y caninos. El respaldo local continúa disponible si
Replicate falla, sin mostrar nunca la cara completa generada.

---

## 2026-08-09 (2) — Codex (recuperación si falla la segmentación remota)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`.

La segmentación anatómica con Replicate deja de ser un punto único de fallo:
si la inferencia, la descarga de máscaras o CORS falla, la generación recupera
automáticamente el compositor dental local anterior. Nunca se usa como
respaldo la cara completa generada por IA. Esto mantiene la simulación
operativa mientras se conserva la mayor precisión cuando `segment-teeth`
responde correctamente.

---

## 2026-08-06 — Claude Code (skill de Meta multi-tenant)

**Tocado:** `.claude/skills/meta-multitenant-chat/` (nuevo, solo agregado —
nada existente tocado).

Agregada una skill de referencia para conectar WhatsApp + Messenger +
Instagram en modo multi-tenant (un solo Meta App/System User "Tech
Provider" sirviendo el número/página propio de cada dentista/clínica, un
solo webhook que resuelve a qué tenant pertenece cada mensaje). Se extrajo
de una implementación real en otro proyecto (LANA), generalizada para
adaptarse a cualquier esquema de Supabase — no asume las tablas de SMYL,
hay que adaptar nombres al invocarla. Se activa sola si alguien pide
conectar WhatsApp/Messenger/Instagram, o con `/meta-multitenant-chat`. No
es una implementación — es la guía + plantillas (SQL, Edge Function,
Embedded Signup) para cuando de verdad se construya esto en SMYL.

---

## 2026-08-09 — Codex (composición dental anatómica para simulación)

**Tocado:** `simulacion.html`, `mobile/www/simulacion.html`,
`supabase/functions/segment-teeth/index.ts`.

Se reemplazó la máscara heurística de color/luminancia por la unión de dos
máscaras anatómicas: dentición original + carillas generadas. Fuera de esa
unión la salida procede exclusivamente de la fotografía original. La primera
ejecución segmenta ambas vistas lado a lado en una sola inferencia; la máscara
original queda cacheada y las regeneraciones sólo segmentan el diseño nuevo.

`segment-teeth` acepta el modo prospecto mediante `X-Tenant-Id` y
`checkAndConsumeLimitProspecto`, además del límite autenticado habitual. Se
añadió `x-tenant-id` a CORS. No se modificaron secretos, buckets ni RLS.

No se ejecutó una generación real durante QA para no gastar el cupo; sí se
validó sintaxis y se desplegó la Edge Function.

---

## 2026-08-06 (3) — Claude Code (etapa 6: modo "prospecto" — pacientes se simulan su propia sonrisa desde casa)

**Tocado:** `supabase/migrations/camila_prospecto.sql` (nuevo),
`supabase/functions/guardar-lead-prospecto/index.ts` (nuevo),
`supabase/functions/_shared/limits.ts`, `supabase/functions/claude/index.ts`,
`simulacion.html`, `mobile/www/simulacion.html`, `app.html`.

Decisión del usuario: además del flujo de dentista (login obligatorio,
foto tomada EN consulta), `simulacion.html` necesita un segundo modo para
que un paciente potencial se tome su propia foto desde su casa, como
gancho de marketing/generación de leads. Se acordaron 3 decisiones de
diseño con el usuario antes de construir:
1. **Dos links distintos**, no una pantalla de elección — el dentista
   comparte un link público propio (`app.html` → tarjeta nueva "Link para
   pacientes potenciales" → `copiarLinkProspecto()`, genera
   `simulacion.html?clinica=<tenant_id>`).
2. **El lead se captura DESPUÉS de ver el resultado** (menor fricción) —
   mismo formulario que ya existía para que el dentista archive un caso
   (`#fn`/`#ft`/`#fe`/`#fn-notas`), reetiquetado en runtime.
3. **Mismo archivo, no uno aparte** — reutiliza toda la cámara/IA/
   cotización que ya existe; solo cambia el punto de entrada y el copy de
   la pantalla de resultado.

**Dos huecos de RLS reales que había que cerrar** (un prospecto no tiene
NINGUNA sesión, ni siquiera la de staff que sí resuelve `camila_es_miembro`):

1. `camila_tenants` no era legible sin sesión — sin esto, el link no
   podría mostrar ni el nombre de la clínica ni sus precios reales. Se
   resuelve con una vista nueva, `camila_tenants_publico`
   (`camila_prospecto.sql`), que expone SOLO `nombre`+`config` (nunca
   `email`/`plan`/`diagnosticos_usados`/`stripe_*`) — aprovecha que en
   Postgres una vista corre con los privilegios de quien la CREÓ, no de
   quien la consulta, así que puede exponer esas dos columnas a `anon`
   sin abrir ninguna política RLS en `camila_tenants` misma (que sigue
   100% protegida). `loadPrecios()` y la nueva `entrarComoProspecto()` la
   usan en vez de `camila_tenants` cuando `CFG.modoProspecto`.
2. `camila_casos` tampoco aceptaba INSERT sin sesión — el lead se habría
   perdido en silencio. Se resuelve con la Edge Function nueva
   `guardar-lead-prospecto` (service role, valida que el `tenant_id` sea
   real/activo antes de insertar, whitelist explícita de columnas
   aceptadas del body para que un prospecto no pueda colar columnas que
   no le corresponden). **A propósito NO se abrió una política de INSERT
   para `anon` en `camila_casos`** — esa tabla ya tuvo un episodio real de
   RLS abierta (`camila_casos_abierto_temporal`, ver entrada del
   2026-07-30) y no valía la pena repetir ese riesgo por esta función.
   Nueva columna `es_prospecto boolean` para distinguir estos casos de los
   que crea el propio dentista/staff (aditiva, no rompe nada existente).

**Tercer hueco, de gasto no de lectura:** las llamadas a la Edge Function
`claude` (análisis + generación de imagen) tampoco tenían forma de saber
"esta llamada sin sesión es un prospecto de la clínica X, aplícale SU
tope real" -- antes solo existían dos caminos (sesión real, o anónimo
genérico 5/hora/IP sin ningún tenant). Se agregó un tercero:
`simulacion.html` manda el `tenant_id` en un header `X-Tenant-Id` cuando
está en modo prospecto (`headersEdgeIA()`, nuevo helper -- las 4 llamadas
a la Edge Function `claude` ahora pasan por ahí), y `claude/index.ts` lo
usa vía la función nueva `checkAndConsumeLimitProspecto()`
(`_shared/limits.ts`) que exige **los dos** controles: el tope real del
plan de esa clínica (protege su cupo pagado, y de paso confirma que el
`tenant_id` es real) Y el tope genérico por IP encima (protege contra que
alguien intente drenar el cupo de una clínica ajena a punta de scripts
solo por conocer su link público). `segment-teeth` no se tocó -- el modo
prospecto no usa el editor clínico avanzado.

**Flujo completo en `simulacion.html`:** `checkLogin()` ahora revisa
`?clinica=<id>` ANTES que cualquier sesión -- si está presente, gana
siempre y entra a `entrarComoProspecto()` (nunca muestra el overlay de
login). El resultado final (`show('s-res')`) dispara
`aplicarCopyProspecto()` (idempotente, se reetiqueta cada vez que se
regenera/cambia tono) que cambia "Guardar en expediente" por "¿Te gustó
tu nueva sonrisa?" y el botón por "Quiero agendar mi cita". Al guardar,
`guardarCaso()` ahora bifurca: modo prospecto llama a
`guardar-lead-prospecto`, modo dentista sigue con el INSERT directo de
siempre. `showCasoGuardado()` también bifurca -- en modo prospecto no
muestra "Enviar al paciente" (el prospecto YA es el paciente) ni "Ver en
panel admin" (no tiene sesión para entrar ahí), solo la confirmación de
que su interés quedó registrado.

**Falta aplicar en producción:** correr `camila_prospecto.sql` en el SQL
Editor, y desplegar `guardar-lead-prospecto`
(`supabase functions deploy guardar-lead-prospecto --use-api`) más
redesplegar `claude` (el header `X-Tenant-Id` es código nuevo en ese
archivo). Verificar como siempre en el dashboard que se suban los
archivos correctos.

**No probado en vivo:** todo el flujo de prospecto de punta a punta
(abrir el link sin sesión, ver marca/precios reales, generar la
simulación, dejar los datos, y confirmar que el caso aparece en
Historial de `app.html` marcado `es_prospecto=true`) -- necesita las
migraciones aplicadas y las funciones desplegadas primero.

---

## 2026-08-06 (2) — Claude Code (etapa 5, corrección: chat de Meta pasa a ser multi-tenant desde el diseño)

**Tocado:** `supabase/migrations/camila_chat.sql`,
`supabase/functions/meta-send/index.ts`. `meta-webhook/index.ts` no
necesitó cambios (nunca usó un token por canal, ver abajo). Ninguno de
los 3 se había aplicado/desplegado todavía, así que se corrigieron en su
lugar en vez de crear una migración nueva encima.

**Decisión del usuario:** Smyl también debe ser multi-tenant en su
conexión con Meta, igual que su otro producto "LANA" (compartió la
arquitectura completa de LANA como referencia). Cambia el modelo de
credenciales de la entrada anterior (2026-08-06 (1)):

- **Antes:** cada fila de `camila_canales` guardaba su propio
  `access_token` -- un token por canal por clínica.
- **Ahora:** un solo **System User "Tech Provider"** con token
  **permanente** (Secret `META_TOKEN`, compartido por todas las
  clínicas) firma todas las llamadas a la Graph API. `camila_canales` ya
  NO guarda ningún token -- solo los identificadores de cuenta de cada
  clínica (`id_externo` = phone_number_id/page_id/ig_business_id, más
  `waba_id` nuevo para WhatsApp). Esto es exactamente lo que hace falta
  para que, más adelante, cada dentista pueda conectar su propia cuenta
  vía Embedded Signup sin que la plataforma tenga que guardar ni rotar un
  token por cliente.
- `meta-send/index.ts`: ya no lee `access_token` de `camila_canales`,
  usa `META_TOKEN` (env var) para las tres llamadas de envío.
- `meta-webhook/index.ts`: sin cambios -- nunca leyó ni usó un token
  (solo recibe y guarda mensajes, no manda nada), así que ya era
  compatible con el modelo nuevo sin tocar nada.
- El alta de canales SIGUE siendo manual por ahora (INSERT vía SQL
  Editor con el `phone_number_id`/`waba_id`/`page_id` real de cada
  clínica) — el autoservicio (Embedded Signup, botón "Conectar
  WhatsApp" en el panel) es una fase posterior, no bloquea probar el
  flujo completo con la clínica de Ricardo.

**Además:** se escribió y se le entregó al usuario (como archivo, no
como parte de este repo) una guía completa y portable —SQL + Edge
Functions Deno + frontend con Embedded Signup + bandeja con Realtime—
para que su OTRO programa ("LANA" u otro, tiene su propio repo/Supabase)
implemente el mismo patrón multi-tenant. Esa guía no vive en este repo a
propósito.

**Sigue pendiente, sin cambios respecto a la entrada anterior:** aplicar
la migración, desplegar las 2 funciones, configurar los Secrets
(ahora **`META_TOKEN`** en vez de guardar tokens por fila, más
`META_APP_SECRET`/`META_WEBHOOK_VERIFY_TOKEN` igual que antes), y
conseguir el token permanente del System User desde Meta (Configuración
de la Empresa → Usuarios del sistema) en vez del token temporal de 24h
de la pantalla de pruebas -- ese temporal solo sirve para probar el
handshake, no para dejarlo en producción.

---

## 2026-08-06 — Claude Code (etapa 5: chat unificado con Meta — WhatsApp/Messenger/Instagram, fase 1)

**Tocado:** `supabase/migrations/camila_chat.sql` (nuevo),
`supabase/functions/meta-webhook/index.ts` (nuevo),
`supabase/functions/meta-send/index.ts` (nuevo).
Sin tocar `app.html`/`simulacion.html`/`revision-clinica.html` todavía.

El usuario quiere un chat integrado con Meta (IG + Messenger + WhatsApp),
con dos capas: (1) bandeja unificada donde el dentista/staff responde a
mano, (2) chatbot con IA encima (lo que ya anuncia el plan Profesional
como "Chatbot de pacientes" sin que existiera). Se armó un plan completo
(compartido con el usuario como Artifact) y se empezó por lo que no
depende de que Meta apruebe nada: el modelo de datos y las dos Edge
Functions de mensajería. **Decisión de producto acordada con el
usuario:** fase 1 conecta SOLO la clínica del propio dueño de Smyl (una
app de Meta separada de LANA) — NO el modelo "cada dentista conecta su
propia cuenta" (eso requiere que Meta apruebe a Smyl como Tech
Provider/Embedded Signup, un trámite mucho más largo que no tiene caso
pedir antes de probar que el chat funciona con un cliente real).

1. **`camila_chat.sql`** — 3 tablas nuevas:
   - `camila_canales`: las cuentas de Meta conectadas por clínica
     (`tenant_id`, `canal` whatsapp/messenger/instagram, `id_externo`
     -- phone_number_id/page_id/ig_business_id según el canal --,
     `access_token`). RLS: **solo dueño** (`camila_es_dueno`), nunca
     staff — son credenciales, mismo criterio que precios/config en
     `camila_tenants`. El alta de canales hoy es manual (INSERT directo
     vía SQL Editor con el token que entrega Meta) — no hay UI de
     "Conectar WhatsApp" todavía, eso es fase futura (Embedded Signup).
   - `camila_conversaciones`: un hilo por contacto por canal. RLS:
     cualquier miembro de la clínica (`camila_es_miembro`) puede
     ver/actualizar (para atender la bandeja) — sin INSERT de cliente,
     las crea el webhook.
   - `camila_mensajes`: cada mensaje individual, con `id_externo_meta`
     para no duplicar si Meta reintenta el webhook. RLS: **solo SELECT**
     para el cliente — los INSERT siempre los hace el service role
     (`meta-webhook` para entrantes, `meta-send` para salientes), así la
     tabla es el registro real de lo que se envió/recibió de verdad, no
     de lo que alguien intentó desde el cliente.
   - **Ojo, importante:** `paciente_id` en `camila_conversaciones` es un
     `uuid` SUELTO, sin FK. `camila_pacientes` NO existe como tabla real
     en esta base de datos (confirmado por introspección directa el
     2026-08-05 — la referencia en `app.html` es del mismo patrón de
     tabla fantasma ya visto con `camila_notificaciones`/
     `camila_precios`). Una FK a esa tabla habría hecho fallar esta
     migración completa. Si algún día `camila_pacientes` se crea de
     verdad, ahí sí conviene agregar la FK.
2. **`meta-webhook`**: recibe los tres canales en una sola URL (Meta usa
   el campo `object` del payload para decir cuál es). Verifica la firma
   `X-Hub-Signature-256` (HMAC-SHA256 con `META_APP_SECRET`) antes de
   procesar nada — sin esto, cualquiera que supiera la URL podría inyectar
   mensajes falsos como si vinieran de un paciente real. Responde el
   `hub.challenge` en el GET de verificación si `META_WEBHOOK_VERIFY_TOKEN`
   coincide. Siempre responde 200 aunque falle el procesamiento interno
   (si no, Meta reintenta el mismo evento en bucle).
3. **`meta-send`**: la usa el dentista/staff desde `app.html` (cuando se
   construya esa pantalla) para responder. Verifica que la conversación
   pertenezca a su clínica (`requireUser` + comparar `tenant_id`, mismo
   patrón que el resto de las Edge Functions), llama al endpoint de Graph
   API que corresponda, y guarda el mensaje saliente.

**Falta aplicar en producción:** correr `camila_chat.sql` en el SQL
Editor, y desplegar las 2 funciones nuevas
(`supabase functions deploy meta-webhook --use-api` /
`supabase functions deploy meta-send --use-api`, verificar en el
dashboard que se suban `index.ts` + `_shared/auth.ts` para `meta-send` --
`meta-webhook` no depende de `_shared/`, no manda sesión de usuario).
Además hacen falta 3 Secrets nuevos en Supabase:
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (uno inventado por
Ricardo), y configurar la URL del webhook en el dashboard de Meta
apuntando a `.../functions/v1/meta-webhook`.

**No probado en vivo, no puede probarse todavía:** ninguna de las dos
funciones se ha ejecutado contra credenciales reales de Meta — el shape
exacto de cada payload (especialmente WhatsApp `contacts`/`messages`, y
`is_echo` en Messenger/Instagram) está basado en la documentación de
Meta, no verificado contra tráfico real. Cuando Ricardo tenga la app de
Meta creada con el número de prueba de WhatsApp, hay que probar el flujo
completo antes de dar por buena la fase 1.

**Pendiente (siguiente parte de esta misma etapa):** pantalla "💬
Mensajes" en `app.html` (bandeja + hilo + responder), y después el
chatbot con IA (fase 2, reutiliza la Edge Function `claude` con un prompt
nuevo que tenga contexto de precios/horarios/FAQ de la clínica). Ver el
Artifact del plan completo compartido con el usuario el mismo día.

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
