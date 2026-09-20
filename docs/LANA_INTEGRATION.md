# Integración SMYL ↔ LANA

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
