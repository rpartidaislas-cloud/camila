# Integración de SMYL con Google Calendar

## Alcance aprobado

La primera entrega usa el siguiente alcance:

1. **Espejo SMYL → Google.** SMYL sigue
   siendo la fuente clínica de verdad. Crear, reprogramar o cancelar una cita
   actualiza su evento en Google; editar ese evento en Google no modifica SMYL.
2. **Sincronización bidireccional.** También recibe cambios desde Google. Exige
   reglas de conflicto, webhooks, renovación de canales y una política explícita
   para impedir que un cambio externo eluda disponibilidad, permisos o auditoría.

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

## Si se aprueba sincronización bidireccional

- Endpoint HTTPS para notificaciones de Google Calendar.
- Un canal `watch` por calendario, renovación antes de expiración y verificación
  de `X-Goog-Channel-ID`, `X-Goog-Resource-ID` y token de canal.
- Sincronización incremental de eventos como respaldo, porque Google advierte
  que algunas notificaciones pueden perderse.
- Los cambios externos se guardan primero como solicitud de revisión; no crean
  ni alteran automáticamente una cita clínica hasta pasar las validaciones
  canónicas de SMYL.

## Referencias oficiales

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/guides/create-events
- https://developers.google.com/workspace/calendar/api/guides/push

