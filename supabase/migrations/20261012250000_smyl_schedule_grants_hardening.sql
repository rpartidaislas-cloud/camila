-- SMYL · Etapa 2: cierre explícito de privilegios del dominio de agenda.
-- Supabase concede privilegios amplios por defecto a tablas nuevas del esquema
-- public. RLS ya bloquea escrituras, pero esta capa obliga a usar las RPC.
begin;

revoke all on table
  public.smyl_services,
  public.smyl_professional_services,
  public.smyl_professional_hours,
  public.smyl_appointments,
  public.smyl_schedule_blocks,
  public.smyl_appointment_requests,
  public.smyl_appointment_events,
  public.smyl_appointment_reminders
from anon, authenticated;

grant select on table
  public.smyl_services,
  public.smyl_professional_services,
  public.smyl_professional_hours,
  public.smyl_appointments,
  public.smyl_schedule_blocks,
  public.smyl_appointment_requests,
  public.smyl_appointment_events,
  public.smyl_appointment_reminders
to authenticated;

-- Solo catálogos y disponibilidad admiten CRUD directo, siempre bajo RLS.
grant insert, update, delete on table
  public.smyl_services,
  public.smyl_professional_services,
  public.smyl_professional_hours
to authenticated;

revoke all on sequence public.smyl_appointment_events_id_seq from anon, authenticated;

commit;
