# Integración SMYL ↔ LANA

## Chat de Meta administrado por LANA

LANA es la única dueña operativa de WhatsApp, Messenger e Instagram. SMYL
no registra un segundo webhook de Meta, no solicita tokens de Meta y no
duplica la bandeja de conversaciones.

La pantalla **LANA y canales** del panel permite que el dueño de una clínica
pegue una sola vez el `api_key` de `camila_integraciones` generado en LANA.
La Edge Function `lana-connection` valida ese código contra el endpoint ya
desplegado de LANA:

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
```

Debe contener exactamente 32 bytes codificados en Base64. Esta conexión no
autoriza envíos clínicos automáticos: una simulación, diagnóstico o propuesta
siempre requiere revisión y aprobación profesional antes de compartirse.

El alta y revocación de cada `api_key` sigue ocurriendo en LANA por su
superadmin. El panel de SMYL no crea credenciales de LANA ni administra las
cuentas de Meta.

## Expediente desde una conversación y contexto de atención

LANA abre el panel profesional con una referencia opaca a la conversación:

```text
GET https://rpartidaislas-cloud.github.io/camila/app.html
  ?ir=lana-handoff
  &conversation_id=<uuid>
```

La Edge Function `lana-handoff` usa la conexión cifrada para consultar en
LANA únicamente canal, nombre, correo y teléfono. El historial de mensajes no
se copia. Antes de confirmar, SMYL muestra coincidencias de paciente por correo
o teléfono y deja que el profesional reutilice el expediente correcto o cree
uno nuevo. La tabla `camila_lana_handoffs` y la RPC
`camila_confirmar_lana_handoff` hacen el enlace idempotente por tenant y
conversación.

En sentido inverso, la ficha del paciente muestra **Abrir chat** y dirige a la
conversación exacta de LANA. Los mensajes y credenciales de Meta permanecen en
LANA.

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
supabase/migrations/20260917_lana_integration.sql
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
