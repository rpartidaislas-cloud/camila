# Integración SMYL ↔ LANA

> Contrato vigente: `docs/SMYL_LANA_CHAT_CONTRACT_V1.md` (`1.2`). LANA es la
> fuente canónica del chat y los canales; SMYL es la fuente canónica dental.
> Esta separación aplica también a las nuevas pantallas de Inbox.

## Chat de Meta administrado por LANA

LANA es la única dueña operativa de WhatsApp, Messenger e Instagram. SMYL
no registra un segundo webhook de Meta, no solicita tokens de Meta y no
duplica la bandeja de conversaciones.

La pantalla **LANA y canales** permite que el dueño active LANA sin copiar
credenciales. `lana-connection` llama servidor-a-servidor a `smyl-provision`
con una credencial exclusiva de plataforma y una `Idempotency-Key` estable por
clínica. LANA crea o reutiliza el tenant vinculado, entrega la API key una sola
vez al servidor de SMYL y guarda en su propia base únicamente el hash más una
copia cifrada para reintentos idempotentes. SMYL cifra de nuevo la credencial
con AES-256-GCM antes de persistirla.

El flujo manual con un `api_key` generado en LANA permanece dentro del bloque
**Ya tengo un código de enlace** para cuentas existentes. En ambos casos se
valida contra:

```text
GET https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api/conversations?limit=1
```

Después de validarlo, SMYL lo cifra con AES-256-GCM y guarda únicamente el
ciphertext, IV y huella dentro de la configuración de la clínica. La clave
nunca regresa al navegador ni se guarda en `localStorage`. Solo el dueño
puede establecer o reemplazar la conexión; el staff puede consultar y
verificar el estado.

Configurar en SMYL como Edge Function Secret:

```text
SMYL_LANA_ENCRYPTION_KEY
SMYL_LANA_PLATFORM_SECRET
```

Debe contener exactamente 32 bytes codificados en Base64. Esta conexión no
autoriza envíos clínicos automáticos: una simulación, diagnóstico o propuesta
siempre requiere revisión y aprobación profesional antes de compartirse.

En LANA se requieren además `SMYL_PLATFORM_SECRET` con el mismo valor y
`SMYL_LANA_API_KEY_WRAP_KEY` (32 bytes en Base64). Ninguno de estos valores
llega al navegador.

Cuando la cuenta está activa, `lana-channels` consulta `GET /channels` y
muestra el estado real de WhatsApp, Messenger e Instagram. **Conectar** crea
una sesión de diez minutos y un solo uso, limitada al tenant y canal exactos.
El token viaja en el fragmento de la URL y se elimina al abrir la ventana
alojada por LANA. Esa ventana ejecuta OAuth/Embedded Signup; tokens, webhooks e
historial continúan siendo propiedad de LANA. SMYL recibe únicamente éxito o
fallo y vuelve a consultar el estado seguro del canal.

Antes de producción deben quedar configurados y aprobados en Meta los App IDs,
Configuration IDs, redirect URI, webhooks y permisos avanzados. La pantalla no
sustituye App Review. La compatibilidad actual usa los conectores existentes
por canal; la configuración de Meta debe migrarse a Unified Onboarding v4 sin
cambiar este límite de seguridad entre SMYL y LANA.

## Expediente desde SMYL y contexto de atención

SMYL se opera como producto independiente. LANA no muestra enlaces hacia SMYL
y el profesional no necesita abrir el panel de LANA. Al abrir un hilo del Inbox,
SMYL intenta resolver su identidad de forma idempotente dentro de la clínica.
Una coincidencia única por correo o teléfono canónico se vincula en segundo
plano. Si no existe coincidencia, se crea únicamente un contacto provisional
cuando hay un identificador verificable; esto no crea un caso clínico. Varias
coincidencias o la ausencia de identificadores abren la revisión manual.

La Edge Function `lana-inbox` usa la conexión cifrada servidor a servidor para
consultar únicamente canal, nombre, correo y teléfono. El historial de mensajes
no se copia. La tabla `camila_lana_handoffs` y la RPC
`smyl_auto_link_lana_conversation` hacen el enlace idempotente por tenant y
conversación, exigen permisos y no seleccionan arbitrariamente entre duplicados.
La resolución manual también vive en `lana-inbox`: vuelve a validar el alcance
del hilo antes de mostrar candidatos y exige una elección explícita cuando hay
duplicados. `lana-handoff` permanece únicamente como puente compatible para
clientes antiguos y reenvía la operación al mismo control autorizado. El origen
provisional se conserva en `link_kind`, y la confirmación manual y los adjuntos
clínicos comparten un solo bloqueo por tenant y conversación para impedir casos
duplicados. Los mensajes y credenciales de Meta permanecen en el backend de
LANA, pero toda la operación visible del dentista ocurre en SMYL.

La misma pantalla **LANA y canales** permite editar contexto de atención. La
Edge Function `lana-context` llama `GET/PUT /context` en `camila-api`; LANA lo
guarda dentro de `config_json.ia_config.smyl_context` y lo incorpora a los
prompts reales de WhatsApp, Messenger e Instagram. Los límites clínicos no son
editables: no diagnosticar, prescribir, prometer resultados, interpretar
fotografías ni revelar expedientes, y no compartir artefactos de SMYL sin
revisión y envío explícitos de un profesional.

## Laboratorio privado de respuestas

La etapa 5 añade una prueba de conversación dentro de **LANA y canales**. SMYL
envía el mensaje y hasta ocho turnos temporales a `POST /context/preview` a
través de `lana-context`; la API key permanece cifrada y fuera del navegador.

La prueba usa Anthropic desde LANA, el contexto activo del tenant, su nivel de
autonomía y los bloques compartidos de conocimiento, horario y seguridad. No
crea una conversación, no ejecuta marcadores, no agenda ni cancela citas y no
envía contenido a Meta. `SOLICITAR_ASESOR` se transforma en una indicación
visual para el profesional. Solo el dueño puede probar; la llamada cuenta en
el límite mensual y se registra con canal `smyl_preview`.

## Bandeja clínica de atención

La etapa 6 añade al inicio de SMYL una lista de conversaciones que requieren
acción. `lana-attention` consulta `GET /attention` en LANA y combina cada
referencia con `camila_lana_handoffs` para indicar si ya existe expediente.

La bandeja usa solo metadatos operativos: identificador opaco, nombre visible,
canal, motivo genérico, antigüedad, cantidad sin leer y estado de pausa. No
copia el último mensaje, el resumen para asesor, teléfonos, correos ni el
historial. Desde cada fila se puede abrir el chat exacto en LANA o reutilizar
el flujo confirmado de creación/vinculación de expediente.

El dueño de la clínica puede marcar una solicitud de asesor como resuelta;
esto limpia `necesita_asesor` y `resumen_asesor` en LANA, pero no envía nada,
no elimina la conversación y no reanuda la IA. El personal puede consultar la
cola y preparar el expediente, pero el cierre desde SMYL queda reservado al
dueño.

Aplicar también:

```text
supabase/migrations/20261011120000_lana_conversation_handoffs.sql
```

### Estado de producción · 2026-10-10

- La clínica activa de SMYL quedó vinculada con su única cuenta coincidente y
  activa de LANA. La correspondencia se comprobó por cuenta exacta; no se
  eligió un tenant por similitud de nombre.
- `camila_integraciones` y sus dos triggers de reenvío están aplicados y
  registrados en el historial de migraciones de LANA.
- `camila-api` normaliza tanto la ruta completa del gateway como la ruta
  recortada que Supabase entrega a la función en producción.
- El código quedó cifrado en SMYL y la prueba `connect` + `verify` aprobó el
  contrato de conversaciones con límite 1. No se envió ningún mensaje, no se
  registró webhook entrante y no se mostró contenido de pacientes.
- El secreto temporal utilizado para la activación inicial fue eliminado. La
  función publicada volvió a su autenticación normal de sesión profesional.

## Variables privadas

Configurar como Supabase Edge Function Secrets; nunca se incluyen en el
frontend ni en Git:

```text
OPENAI_API_KEY
LANA_WEBHOOK_URL
LANA_WEBHOOK_SECRET
```

`LANA_WEBHOOK_SECRET` es el secreto compartido. LANA lo valida cuando SMYL
envía un webhook y SMYL lo valida cuando LANA llama `analizar-foto`.

## 1. Abrir una simulación desde LANA

```text
GET https://<dominio-smyl>/nueva/
  ?tenant_id=<uuid-v4>
  &cita_id=<entero>
  &paciente=<nombre-url-encoded>
  &telefono=<e164>
  &origen=lana
```

La ruta `nueva/index.html` valida el contexto, lo guarda en `sessionStorage`
y redirige a `simulacion.html?origen=lana`. Así nombre y teléfono dejan de
aparecer en la barra y en el historial del navegador. El simulador sólo aplica
el contexto si `tenant_id` coincide con la clínica real de la sesión del
dentista. Nombre y teléfono quedan prellenados.

Al guardar, el caso conserva `lana_cita_id` y `lana_origen`. La Edge Function
`lana-webhook` vuelve a consultar el caso y el tenant en servidor y envía:

```json
{
  "evento": "simulacion_guardada",
  "tenant_id": "<uuid>",
  "cita_id": 123,
  "simulacion_id": "<uuid>",
  "url_resultado": "https://<dominio-smyl>/revision-clinica.html?caso=<uuid>",
  "url_imagen": "https://...",
  "notas": "...",
  "timestamp": "<ISO-8601>"
}
```

`url_imagen` es opcional. Sólo se manda cuando la simulación pudo subirse al
bucket privado y existe una URL HTTPS firmada. La Edge Function también exige
que `url_resultado` sea HTTPS y pertenezca al mismo origen web de SMYL que
realizó la petición; no acepta enlaces externos proporcionados por el cliente.

## 2. Recibir una foto desde LANA

En el stack actual, `/api/analizar-foto` se implementa como una Edge Function:

```text
POST https://<proyecto-smyl>.supabase.co/functions/v1/analizar-foto
Authorization: Bearer <LANA_WEBHOOK_SECRET>
Content-Type: application/json
Idempotency-Key: <identificador-estable-opcional>
```

Body:

```json
{
  "tenant_id": "<uuid-v4>",
  "cita_id": 123,
  "paciente_nombre": "Juan García",
  "paciente_telefono": "+523313445614",
  "imagen_url": "https://.../imagen.jpg",
  "origen": "whatsapp"
}
```

La función valida el secreto y el tenant, reserva una fila y responde:

```json
{"recibido":true,"simulacion_id":"<uuid>"}
```

Después ejecuta en segundo plano:

1. descarga HTTPS controlada, con límite de 8 MB y bloqueo de destinos de red
   privada;
2. análisis con `gpt-4o-2024-11-20`, imagen de entrada y JSON Schema estricto;
3. persistencia del diagnóstico y estado;
4. webhook `analisis_completado` a LANA;
5. hasta tres reintentos después del intento inicial, con esperas de 2, 4 y
   8 segundos para errores de red o respuestas 5xx. Los 4xx no se repiten.

La generación de la imagen “después” queda reservada en
`imagen_simulacion_url`, actualmente `null` (fase 2).

### Semántica de errores asíncronos

No es técnicamente posible devolver `500` por un fallo de GPT después de haber
devuelto el `200` inmediato. En este contrato asíncrono, fallos de descarga o
GPT dejan `estado='error'`, guardan `error_procesamiento` y **no** llaman el
webhook de completado. Errores previos a reservar el trabajo (secreto, payload,
tenant o base de datos) sí regresan 4xx/5xx directamente.

## Base de datos

Aplicar:

```text
supabase/legacy-unapplied/20260917_lana_integration.sql
```

La migración añade los campos LANA a `camila_casos` y crea
`smyl_analisis_fotos`, con RLS para miembros de la clínica, estado de proceso,
resultado estructurado, idempotencia y telemetría de webhook.

## Despliegue

Estas dos funciones manejan su propia autenticación y deben desplegarse sin la
verificación JWT automática de la pasarela:

```text
supabase functions deploy analizar-foto --no-verify-jwt
supabase functions deploy lana-webhook --no-verify-jwt
```

`analizar-foto` valida el secreto compartido. `lana-webhook` valida dentro de
la función el JWT real del dentista y rechaza el fallback anónimo histórico.

## Capacitación dental versionada — etapa 2

SMYL ya incluye una implementación local de **Capacitar IA** adaptada a
odontología. La clínica edita conocimiento estructurado (voz, clínica,
servicios, FAQ, citas, precios, datos administrativos y escalamiento) en un
borrador. Guardar no cambia las conversaciones reales. El servidor valida el
contenido y solo **Publicar capacitación** actualiza el runtime de LANA.

LANA conserva `smyl_training_profiles`, versiones inmutables, solicitudes
idempotentes y auditoría. La publicación se realiza dentro de una transacción:
crea la versión y actualiza `tenants.config_json.ia_config.smyl_training`, el
mismo bloque que consumen los webhooks. Restaurar copia una versión a borrador;
no hace rollback silencioso de producción.

Los límites clínicos son código no editable: LANA no diagnostica, prescribe,
interpreta imágenes, promete resultados ni revela expedientes. El laboratorio
privado permite probar borrador o publicación con el mismo compilador y sin
crear conversaciones ni enviar mensajes.

Orden de despliegue pendiente:

1. Aplicar en LANA `20261011210000_smyl_dental_training.sql`.
2. Desplegar en LANA `camila-api`.
3. Desplegar en SMYL `lana-training`.
4. Publicar los activos web/PWA de SMYL.
5. Validar guardado, conflicto de revisión, publicación, replay idempotente,
   restauración y prueba borrador/publicación en una clínica controlada.

Nada de esta etapa se ha aplicado o publicado en producción todavía.

## Inbox operativo — etapa 3

La implementación local añade una bandeja única para WhatsApp, Messenger e
Instagram sin copiar conversaciones a tablas de SMYL. El navegador llama
`lana-inbox` con su sesión profesional; esa función resuelve tenant, actor y
rol, y utiliza la credencial cifrada únicamente para consultar `camila-api`.
LANA devuelve DTO mínimos y conserva el historial canónico.

El Inbox incluye paginación de conversaciones y mensajes, lectura,
sincronización incremental cada cinco segundos cuando la pantalla está
visible, cola optimista aislada por conversación, reintento con la misma clave
idempotente, asignación, pausa/reanudación y resolución de solicitudes. Un
envío humano pausa a LANA antes de permitir que el flujo continúe. Los medios
y la Ficha 360 siguen reservados para la etapa 4.

Orden de despliegue pendiente:

1. Aplicar en LANA `20261011220000_smyl_inbox_operational.sql`.
2. Desplegar en LANA `camila-api`.
3. Desplegar en SMYL `lana-inbox`.
4. Publicar `app.html`, `smyl-inbox.js/css`, los activos de atención y `sw.js`
   tanto en web como en el paquete móvil.
5. Probar con dos miembros de una clínica: asignación concurrente, pausa,
   respuesta real, reintento, actualización en dos pestañas y aislamiento de
   tenant en WhatsApp, Messenger e Instagram.

Nada de la etapa 3 se ha aplicado o publicado en producción todavía.

## Medios y Ficha 360 — etapa 4

La implementación local amplía el Inbox sin mover su fuente de verdad: LANA
conserva mensajes, medios y acciones; SMYL conserva pacientes, casos y datos
clínicos. `lana-inbox` transmite formularios al servidor de LANA, nunca expone
la API key y firma la identidad del miembro autenticado. Imágenes, documentos
y audio se almacenan en el bucket privado `salud-adjuntos`; `camila-api` sólo
entrega una URL firmada por cinco minutos al solicitar el hilo.

El compositor admite adjunto, pegado y arrastre de imagen, ubicación confirmada,
respuesta citada y reenvío. Cada envío mantiene la misma `Idempotency-Key` al
reintentar. Destacar y eliminar lógicamente pasan por una RPC tenant-aware con
advisory lock y auditoría. Las capacidades se anuncian por canal: WhatsApp
soporta imagen, documento, audio y ubicación; Messenger imagen/documento;
Instagram imagen, sin fingir soporte de documento.

La Ficha 360 se obtiene desde SMYL mediante el vínculo confirmado y respeta el
alcance clínico del rol, además del acceso a la conversación. Expone un
subconjunto del paciente y, sólo si ya existe, del caso; señala cita LANA,
simulación, propuesta y fotografías vinculadas cuando esos datos existen. Para enviar una imagen a
revisión clínica, SMYL vuelve a consultar el mensaje canónico en LANA, exige
que sea una imagen disponible y guarda sólo IDs de referencia; no copia la URL,
el archivo ni el contenido del chat.

Orden de despliegue pendiente:

1. Aplicar en LANA `20261011230000_smyl_inbox_media_context.sql`.
2. Aplicar en SMYL `20261011230000_lana_clinical_message_links.sql`.
3. Desplegar en LANA `camila-api` y en SMYL `lana-inbox`.
4. Publicar los activos web/PWA de SMYL.
5. Probar por canal envío/recepción, replay idempotente, URL expirada,
   soft-delete, Ficha 360 y vínculo clínico con dos tenants aislados.

Nada de la etapa 4 se ha aplicado o publicado en producción todavía.

## SMYL Asistente y Copilot — etapa 5

La implementación local agrega un Copilot exclusivamente interno al Inbox. El
navegador solicita un borrador o un resumen, pero LANA recompone el tramo
reciente desde sus tablas canónicas y SMYL aporta un snapshot dental de sólo
lectura generado desde el paciente/caso confirmado. Ni el historial ni un
`tenant_id` enviados por el navegador se consideran fuente de verdad.

El resultado declara `sends_message: false`. **Usar como borrador** sólo llena
el compositor; todavía se requiere el envío explícito del miembro. Copilot no
crea citas, no cambia expedientes, no autoriza resultados y no publica
capacitación. El catálogo de herramientas refleja humano, configuración real
de agenda, servicios publicados y, únicamente cuando ya existe una acción
profesional confirmada, la disponibilidad de un resultado autorizado.

Al terminar una intervención humana, **Preparar reanudación** obtiene un
resumen sugerido con siguiente paso, dudas y hechos no confirmados. El miembro
lo corrige y confirma; LANA lo guarda y despausa la conversación en una RPC
idempotente y auditada. WhatsApp, Messenger e Instagram lo usan como traspaso
no autoritativo sólo en la primera respuesta posterior. La evaluación
útil/mejorable/insegura también queda atribuida e inmutable, pero nunca cambia
la capacitación automáticamente.

Orden de despliegue pendiente:

1. Aplicar en LANA `20261011240000_smyl_assistant_copilot.sql`.
2. Desplegar en LANA `camila-api`, `whatsapp-webhook` y `meta-webhook`; después
   desplegar en SMYL `lana-inbox`.
3. Publicar `app.html`, `smyl-inbox.js/css`, `sw.js` y sus copias móviles.
4. Probar borrador sin envío, feedback/replay, permisos de asignación,
   reanudación contextual y aislamiento con dos tenants.
5. Ejecutar un piloto con una clínica antes de habilitarlo ampliamente.

Nada de la etapa 5 se ha aplicado o publicado en producción todavía.

## Endurecimiento y puerta de piloto — etapa 7

La entrega local incorpora el endpoint `GET /inbox/operations`, límites
atómicos por tenant/actor, reintentos acotados del worker y una cola visible de
fallos. El dashboard distingue rechazo transitorio, rechazo definitivo y
entrega ambigua; esta última nunca se reenvía automáticamente. El reintento
manual exige asignación válida, idempotencia y `retry_safe=true`.

Orden de activación pendiente:

1. Aplicar en LANA `20261011260000_smyl_inbox_hardening_pilot.sql` después de
   las migraciones de las etapas anteriores.
2. Desplegar en LANA `camila-api` y
   `whatsapp-mensajes-programados-enviar`; después desplegar en SMYL
   `lana-inbox`.
3. Publicar `app.html`, `smyl-inbox.js/css`, `sw.js` y sus copias móviles con
   la versión de activo `v=5`.
4. Verificar dos tenants aislados, solapamiento del cron, desconexión de cada
   canal, límite `429`, reintento seguro y entrega ambigua sin duplicado.
5. Elegir una clínica, responsables y horarios de observación; activar el
   piloto de forma manual y revisar alertas/cola diariamente antes de abrir
   autoservicio multi-tenant.

La preparación técnica local no equivale a un piloto ejecutado. Nada de esta
etapa fue aplicado, desplegado, publicado ni activado en producción.
