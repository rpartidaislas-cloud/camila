-- SMYL · Diagnóstico de la confirmación automática de citas (solo LECTURA: no modifica nada).
-- Pégalo en Supabase → SQL Editor y ejecútalo tras agendar una cita de prueba. Cada bloque responde una pregunta.
-- Sustituye el correo/identificador solo si quieres acotar a una clínica; sin filtro muestra las más recientes de todas.

-- 1. ¿Está encendida la función y con qué plantilla? (una fila por clínica)
select tenant_id, confirmation_enabled, confirmation_template_name, confirmation_since,
       enabled as recordatorio_24h, send_window_start, send_window_end, require_consent, whatsapp_mode, whatsapp_phone
  from smyl_reminder_settings
 order by updated_at desc nulls last
 limit 5;

-- 2. Últimos mensajes automáticos y en qué estado quedaron.
--    status: pending (esperando su hora/ventana) · processing · sent · failed · cancelled
--    last_error explica por qué no salió (consentimiento, sin chat de WhatsApp, plantilla no aprobada, etc.).
select r.created_at, r.reminder_type, r.status, r.scheduled_for, r.attempt_count, r.last_error,
       a.starts_at as cita, a.source as origen
  from smyl_appointment_reminders r
  join smyl_appointments a on a.tenant_id = r.tenant_id and a.id = r.appointment_id
 order by r.created_at desc
 limit 15;

-- 3. ¿Tus citas recientes cumplen las reglas para que se les mande confirmación?
--    Debe ser: confirmada, origen manual/patient_portal, creada DESPUÉS de confirmation_since y a más de 2 h.
select a.id, a.created_at, a.starts_at, a.status, a.source,
       (a.created_at >= s.confirmation_since) as creada_despues_de_encender,
       (a.starts_at > now() + interval '2 hours') as faltan_mas_de_2h,
       exists (select 1 from smyl_appointment_reminders r
                where r.tenant_id = a.tenant_id and r.appointment_id = a.id and r.reminder_type = 'confirmation') as ya_tiene_confirmacion
  from smyl_appointments a
  join smyl_reminder_settings s on s.tenant_id = a.tenant_id
 order by a.created_at desc
 limit 10;

-- 4. ¿El paciente tiene un chat de WhatsApp vinculado? (sin él, la confirmación espera hasta 2 h antes de la cita)
select p.nombre, p.apellido, p.consentimiento_whatsapp,
       (select count(*) from camila_lana_handoffs h
         where h.tenant_id = p.tenant_id and h.patient_id = p.id and h.lana_channel = 'whatsapp') as chats_whatsapp
  from camila_pacientes p
 order by p.created_at desc
 limit 10;
