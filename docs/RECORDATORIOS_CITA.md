# Recordatorios automáticos de cita por WhatsApp

Fase 4 del rediseño del chat. Cada cita confirmada genera un recordatorio
24 horas antes (esto ya existía en `smyl_appointment_reminders`). Ahora SMYL lo
entrega a LANA como **mensaje programado de WhatsApp con una plantilla
aprobada**. El trabajador de LANA (`whatsapp-mensajes-programados-enviar`) lo
envía a su hora, aunque nadie tenga SMYL abierto.

## Cómo funciona

1. Al agendar, reprogramar o cambiar el estado de una cita (Agenda o
   Mensajes), y al abrir la Agenda o Mensajes, el navegador llama a la Edge
   Function `appointment-reminders` (`action: "dispatch"`).
2. La función reclama los pendientes con `smyl_claim_appointment_reminders`
   (solo `service_role`, `for update skip locked`). Después busca la
   conversación de WhatsApp vinculada al paciente (`camila_lana_handoffs`) y
   programa la plantilla en LANA con `send_at` = 24 h antes de la cita. El
   `Idempotency-Key` es el id del recordatorio, así que un reintento nunca
   duplica el mensaje.
3. Si la cita se mueve, se cancela, se completa o se marca como inasistencia,
   el trigger `smyl_appointments_reminder_sync` cancela el recordatorio y, si
   ya estaba en LANA, lo marca con `provider_cancel_required`. La siguiente
   ejecución lo cancela también en LANA.
4. Cuando llega la hora, la función consulta a LANA el resultado y deja el
   recordatorio como `sent` o `failed`. La Agenda muestra los fallidos como
   tareas por atender.

Casos especiales:
- **Paciente sin WhatsApp vinculado:** queda en espera y se reintenta cada
  hora. Si llega la hora sin vínculo, queda `failed` con el motivo.
- **Cita a menos de 2 h:** se omite (`cancelled`).
- **Error transitorio de LANA (429/5xx/sin respuesta):** hasta 5 intentos
  con espera creciente. Un rechazo definitivo queda `failed` con el mensaje
  de LANA.
- **Desactivar los recordatorios:** cancela todo lo que estaba en cola,
  también en LANA.

## Configuración en la app

Agenda → pestaña **Disponibilidad** → tarjeta **Recordatorios por WhatsApp**
→ **Configurar**. Configurar requiere los permisos `schedule.manage` y
`messages.respond`; para consultar basta `schedule.read`.

Se elige una plantilla de categoría **Utilidad** aprobada por Meta en LANA y
qué dato va en cada variable: nombre del paciente, fecha, hora, servicio,
profesional, sucursal, teléfono de la sucursal, nombre de la clínica o texto
fijo. Ejemplo de plantilla:

> Hola {{1}}, te recordamos tu cita el {{2}} a las {{3}} en {{4}}. Responde a
> este mensaje si necesitas cambiarla.

## Despliegue (pendiente, requiere acceso al proyecto de Supabase)

```bash
supabase db push                                   # aplica 20261019010000_smyl_appointment_reminder_delivery.sql
supabase functions deploy appointment-reminders
```

La función usa los secretos que ya existen (`SMYL_LANA_ENCRYPTION_KEY`) y las
variables que Supabase inyecta (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`).

Hasta que se despliegue, la Agenda muestra "El servicio de recordatorios no
está disponible todavía" en la tarjeta. El resto de la app no cambia.

### Alternativa sin CLI: pegar la función en el panel

El editor de Edge Functions del panel no puede importar `../_shared`, así que
hay un archivo único ya generado: `docs/bundles/appointment-reminders.single-file.ts`.

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre exacto: `appointment-reminders`. Pega el archivo completo.
3. Deja **Verify JWT** apagado (la función valida cada petición por su cuenta) y despliega.

Si cambia la función o algún archivo de `_shared`, regenera el archivo con
`node scripts/bundle-edge-function.mjs appointment-reminders` (una prueba falla
si queda desactualizado) y vuelve a pegarlo.

## Revisión automática cada 15 minutos (cron)

Sin cron, el recordatorio sale igual (LANA guarda el envío programado), pero el estado
«Enviado» y los pacientes que se vinculan después solo se procesan cuando alguien abre SMYL.
El cron llama a la función cada 15 minutos para todas las clínicas con recordatorios activos.

**Verify JWT debe estar apagado en esta función.** El proyecto usa las claves nuevas
(`sb_publishable_…`), que no son JWT, y el cron no tiene sesión de usuario. Es seguro porque la
función autentica cada petición por su cuenta: con la sesión del usuario (`requireUser`) o con el
secreto `x-smyl-cron-secret` comparado en tiempo constante; sin ninguna de las dos responde 401.
(`supabase/config.toml` ya lo refleja; en el panel está en la página de la función.)

1. **Extensiones:** Database → Extensions → activar `pg_cron` y `pg_net`.
2. **Secreto** (en el SQL Editor; se genera dentro de la base y no se ve en ningún otro lado):

```sql
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'smyl_reminders_cron_secret');
select decrypted_secret from vault.decrypted_secrets where name = 'smyl_reminders_cron_secret';
```

   Copia el valor de la segunda consulta y guárdalo en Edge Functions → Secrets con el nombre
   `SMYL_REMINDERS_CRON_SECRET`.
3. **Prueba manual** (debe responder `200` en `net._http_response`):

```sql
select net.http_post(
  url := 'https://rpxshsiwoxdbuevjjpfw.supabase.co/functions/v1/appointment-reminders',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-smyl-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'smyl_reminders_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 20000);
select status_code, content::text from net._http_response order by created desc limit 1;
```

4. **Programar:**

```sql
select cron.schedule('smyl-recordatorios-cita', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://rpxshsiwoxdbuevjjpfw.supabase.co/functions/v1/appointment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-smyl-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'smyl_reminders_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 20000);
$$);
```

5. **Verificar:** `select jobname, schedule, active from cron.job;` y, pasados 15 minutos,
   `select status, return_message from cron.job_run_details order by start_time desc limit 3;`.
   Para detenerlo: `select cron.unschedule('smyl-recordatorios-cita');`.

Errores comunes: `401 Invalid JWT` → Verify JWT sigue activado; `401 Secreto de cron no válido` →
el valor del secreto de Edge Functions no coincide con el de Vault (o tiene menos de 32 caracteres).

Nunca pegues el secreto en el código, en el repositorio ni en un chat.

## Verificación hecha

- La migración se aplicó junto con las 80 migraciones del repo sobre
  PostgreSQL 16 local. Se probaron siete casos del trigger y del reclamo:
  - el reclamo devuelve los datos del paciente;
  - un segundo reclamo no repite;
  - reprogramar marca la cancelación en LANA;
  - la reparación crea el recordatorio faltante;
  - cancelar la cita lo cancela;
  - una cita cancelada no se reclama;
  - `authenticated` no puede ejecutar el reclamo.
- La Edge Function pasa un chequeo estricto de TypeScript.
- `tests/appointment-reminders-dispatch.test.mjs` ejecuta el archivo único desplegable con una
  base en memoria y una LANA simulada (con el cifrado real de la clave). Cubre: envío con la
  identidad, plantilla y datos correctos; reintentos con la misma clave de idempotencia; rechazos
  definitivos; paciente sin WhatsApp; citas a menos de 2 h; cancelación en LANA al mover o
  cancelar la cita (y reintento si LANA falla); sincronización de enviado / fallido / cancelado;
  carrera si la cita se mueve mientras LANA responde; apagar sin depender de LANA; permisos; y
  modo cron.
- **No se probó contra LANA real.** Falta validar en piloto que LANA acepte
  el programado con la plantilla y que reporte `enviado`.
