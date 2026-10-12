# Agenda diaria de SMYL

**Etapa:** 2 de la plataforma vertical dental  
**Fecha:** 12 de octubre de 2026  
**Estado:** esquema y acciones desplegados en Supabase SMYL; panel web/PWA preparado para publicación.

## Resultado funcional

La clínica puede configurar servicios y su duración, definir disponibilidad por profesional y sede, consultar la agenda por día o semana, confirmar y reprogramar citas, bloquear horarios y registrar llegada, inicio de atención, término, inasistencia o cancelación.

La agenda usa las sucursales, espacios, profesionales, equipo y permisos creados en la etapa 1. Todos los registros pertenecen a un `tenant_id`; no se consulta ni se comparte una tabla de LANA.

## Regla de SMYL Asistente

Una conversación puede producir una `smyl_appointment_request`, nunca una cita confirmada. La solicitud conserva la preferencia expresada por el paciente y permanece `pending` hasta que una persona con `schedule.manage` la revise.

Solo `smyl_accept_appointment_request` convierte la solicitud en cita. Esa acción ejecuta las mismas validaciones que una cita manual y registra quién tomó la decisión. Rechazar no crea cita.

## Integridad operativa

- `smyl_create_appointment` usa un UUID entregado por el cliente como clave idempotente.
- Las altas y reprogramaciones se serializan con advisory locks por profesional y recurso.
- Se validan sede, profesional, servicio, espacio, horario de clínica, disponibilidad profesional, citas concurrentes y bloqueos.
- La reprogramación y los cambios de estado usan `updated_at` como control optimista para no sobrescribir cambios de otra sesión.
- La máquina de estados solo permite transiciones operativas válidas.
- Eventos y recordatorios son históricos; el navegador solo los puede leer.
- Las tablas operativas no admiten escritura directa por `authenticated`; las mutaciones pasan por RPC `SECURITY DEFINER` con permiso `schedule.manage`.
- RLS y privilegios SQL forman dos capas independientes. `anon` no tiene acceso.

## Recordatorios

Al confirmar una cita con más de 24 horas de anticipación se crea un recordatorio pendiente. Reprogramar cancela el pendiente anterior y agenda uno nuevo; cancelar, marcar inasistencia o completar cancela recordatorios que ya no corresponden.

La cola pertenece a SMYL. Un trabajador posterior podrá entregarla por el canal preferido mediante la infraestructura servidor a servidor de mensajería; el proveedor de mensajes no podrá crear ni confirmar citas.

## Objetos desplegados

Migraciones:

- `20261012230000_smyl_daily_schedule.sql`
- `20261012240000_smyl_schedule_actions.sql`
- `20261012250000_smyl_schedule_grants_hardening.sql`
- `20261012260000_smyl_professional_hours_validation.sql`

Tablas:

- `smyl_services`
- `smyl_professional_services`
- `smyl_professional_hours`
- `smyl_appointments`
- `smyl_schedule_blocks`
- `smyl_appointment_requests`
- `smyl_appointment_events`
- `smyl_appointment_reminders`

## Próxima etapa

La etapa 3 es **Ficha clínica 360**: un expediente longitudinal que reúna datos generales, antecedentes, odontograma, notas, citas, fotografías, archivos, casos, propuestas y seguimiento con permisos clínicos específicos.
