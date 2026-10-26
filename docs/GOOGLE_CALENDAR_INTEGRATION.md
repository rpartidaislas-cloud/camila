# Integración de SMYL con Google Calendar

## Alcance aprobado

La primera entrega usa el siguiente alcance:

1. **SMYL → Google automático.** Crear, reprogramar o cancelar una cita genera
   un trabajo idempotente que crea, actualiza o elimina el evento del calendario
   del dentista asignado.
2. **Google → SMYL con revisión.** Mover o eliminar un evento vinculado produce
   una propuesta en `Agenda > Por revisar`. Aceptarla usa las RPC canónicas de
   SMYL; rechazarla restaura Google desde la agenda clínica.
3. **Eventos nuevos de Google.** Nunca crean una cita clínica incompleta. Abren
   el formulario de SMYL para elegir paciente, servicio, sede y sillón; al
   confirmar se vincula la cita con el evento existente.

La etapa OAuth ya está implementada: inicio autenticado, callback público con
`state` de un solo uso y PKCE, cifrado AES-GCM del refresh token, consulta de
estado y revocación. La activación queda cerrada por
`GOOGLE_CALENDAR_OAUTH_READY` hasta registrar el callback en Google Cloud:

`https://rpxshsiwoxdbuevjjpfw.supabase.co/functions/v1/google-calendar-oauth`

El proyecto reutiliza el cliente OAuth existente de Gmail y mantiene una clave
de cifrado independiente para Calendar. Después de registrar el callback y
habilitar Google Calendar API, definir `GOOGLE_CALENDAR_OAUTH_READY=true`.

## Contrato recomendado

- OAuth 2.0 de aplicación web con acceso `offline`, `state` anti-CSRF y
  autorización incremental.
- Scope mínimo inicial:
  `https://www.googleapis.com/auth/calendar.events`.
- Client secret y refresh tokens sólo en servidor; nunca en `app.html`,
  JavaScript público, logs o almacenamiento local.
- Una conexión por usuario y clínica, con calendario de destino elegido de
  forma explícita.
- Mapeo persistente `appointment_id ↔ google_event_id`, idempotente. La API de
  Google permite definir el ID del evento para evitar duplicados.
- Crear, reprogramar y cancelar mediante una cola recuperable; un fallo en
  Google no revierte ni oculta el estado clínico confirmado en SMYL.
- En la primera entrega, Google recibe sólo el mínimo: horario, clínica o sede,
  profesional y una referencia interna. No se copian notas clínicas.
- Estado visible en Agenda: `No conectado`, `Conectado`, `Sincronizando` o
  `Requiere atención`, con conectar, reintentar y desconectar según corresponda.

## Sincronización bidireccional implementada

- Endpoint HTTPS `google-calendar-webhook` para notificaciones de Google.
- Un canal `watch` por calendario, renovación automática antes de expirar y verificación
  de `X-Goog-Channel-ID`, `X-Goog-Resource-ID` y token de canal.
- Sincronización incremental de eventos como respaldo, porque Google advierte
  que algunas notificaciones pueden perderse.
- Sincronización incremental con `nextSyncToken`; una respuesta `410` reinicia
  de forma segura la lectura completa.
- Los cambios externos se guardan primero como solicitud de revisión; no crean
  ni alteran automáticamente una cita clínica hasta pasar las validaciones
  canónicas de SMYL.
- El evento de Google no incluye nombre del paciente ni notas clínicas. Sólo
  horario, sede, servicio y referencias internas privadas.

## Activación pendiente en Google Cloud

El código, la migración y las funciones quedan preparados, pero el flujo real
permanece cerrado hasta terminar la verificación de la cuenta en Google Cloud,
habilitar Calendar API, registrar el callback OAuth y definir
`GOOGLE_CALENDAR_OAUTH_READY=true`. También se requiere el secreto interno
`GOOGLE_CALENDAR_SYNC_SECRET`, usado exclusivamente entre webhook y worker.

## Referencias oficiales

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/guides/create-events
- https://developers.google.com/workspace/calendar/api/guides/push

