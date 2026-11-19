-- SMYL · Mensajes automáticos de citas, fase 1: confirmación al agendar + WhatsApp por sucursal.
--
-- Qué agrega (todo aditivo; lo que ya funciona —recordatorio 24 h— no cambia):
--   1. Confirmación automática: smyl_appointment_reminders admite reminder_type = 'confirmation'. La clínica la enciende con su propia
--      plantilla (smyl_reminder_settings.confirmation_*). Solo citas creadas por el equipo o el portal (las del chat ya se hablaron ahí),
--      y solo desde que se enciende (confirmation_since): nunca se manda en retroactivo.
--   2. Una cita movida genera una nueva confirmación con la fecha nueva (starts_snapshot), y una confirmación reciente evita el
--      recordatorio pegado a ella (menos de 6 h después).
--   3. Ventana de envío (por omisión 9:00–20:00, hora de la sucursal) y «exigir consentimiento» (solo pacientes con
--      camila_pacientes.consentimiento_whatsapp = true). Ojo: ese campo vale false para «no registrado», por eso la exigencia es opcional.
--   4. WhatsApp por sucursal: la clínica decide si usa UN número para todas las sucursales (whatsapp_mode = 'single', número en
--      smyl_reminder_settings.whatsapp_phone) o UNO POR SUCURSAL ('per_branch', número en smyl_branches.whatsapp_phone). Los dentistas
--      heredan el de su sucursal. whatsapp_channel_ref queda reservado para enlazar el canal de LANA cuando soporte varios números.
--   5. Teléfono de contacto opcional del dentista: solo se usa en las plantillas si él lo marca como público.
-- Sin datos de pacientes nuevos y sin envíos propios: el envío lo sigue haciendo la Edge Function appointment-reminders vía LANA.

begin;

-- 1. Tipos de mensaje y huella del horario al que corresponde cada uno.
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.smyl_appointment_reminders'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%reminder_type%'
  loop
    execute format('alter table public.smyl_appointment_reminders drop constraint %I', v_name);
  end loop;
end $$;
alter table public.smyl_appointment_reminders
  add constraint smyl_appointment_reminders_type_check check (reminder_type in ('24h', '2h', 'custom', 'confirmation')),
  add column if not exists starts_snapshot timestamptz;
comment on column public.smyl_appointment_reminders.starts_snapshot is 'Horario de la cita al que corresponde la confirmación; si la cita se mueve, se envía otra.';

-- 2. Configuración por clínica.
alter table public.smyl_reminder_settings
  add column if not exists confirmation_enabled boolean not null default false,
  add column if not exists confirmation_template_id uuid,
  add column if not exists confirmation_template_name text not null default '' check (char_length(confirmation_template_name) <= 200),
  add column if not exists confirmation_template_language text not null default '' check (char_length(confirmation_template_language) <= 20),
  add column if not exists confirmation_variables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(confirmation_variables) = 'array' and jsonb_array_length(confirmation_variables) <= 20),
  add column if not exists confirmation_since timestamptz,
  add column if not exists send_window_start time not null default '09:00',
  add column if not exists send_window_end time not null default '20:00',
  add column if not exists require_consent boolean not null default false,
  add column if not exists whatsapp_mode text not null default 'single' check (whatsapp_mode in ('single', 'per_branch')),
  add column if not exists whatsapp_phone text not null default '' check (char_length(whatsapp_phone) <= 40);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_reminder_settings_confirmation_template_check') then
    alter table public.smyl_reminder_settings
      add constraint smyl_reminder_settings_confirmation_template_check check (not confirmation_enabled or confirmation_template_id is not null),
      add constraint smyl_reminder_settings_window_check check (send_window_end - send_window_start >= interval '1 hour');
  end if;
end $$;

-- 3. WhatsApp por sucursal y teléfono público opcional del dentista.
alter table public.smyl_branches
  add column if not exists whatsapp_phone text not null default '' check (char_length(whatsapp_phone) <= 40),
  add column if not exists whatsapp_channel_ref text not null default '' check (char_length(whatsapp_channel_ref) <= 120);
comment on column public.smyl_branches.whatsapp_phone is 'Número de WhatsApp de la sucursal (donde el paciente responde). Vacío = usa el de la clínica o el teléfono de la sucursal.';
alter table public.smyl_professionals
  add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 40),
  add column if not exists contact_phone_public boolean not null default false;
comment on column public.smyl_professionals.contact_phone_public is 'Solo si es true el teléfono de contacto del dentista puede aparecer en mensajes al paciente.';

-- 4. Reclamo de mensajes pendientes (agrega confirmaciones, datos de contacto y consentimiento).
drop function if exists public.smyl_claim_appointment_reminders(uuid, integer);
create function public.smyl_claim_appointment_reminders(p_tenant_id uuid, p_limit integer default 25)
returns table (
  reminder_id uuid,
  appointment_id uuid,
  reminder_type text,
  scheduled_for timestamptz,
  attempt_count integer,
  starts_at timestamptz,
  patient_id uuid,
  patient_first_name text,
  patient_last_name text,
  service_name text,
  professional_name text,
  branch_name text,
  branch_phone text,
  branch_timezone text,
  branch_id uuid,
  branch_whatsapp text,
  professional_phone text,
  whatsapp_consent boolean,
  appointment_source text
)
language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
begin
  -- Mensajes de citas que ya no están confirmadas o que ya pasaron.
  update public.smyl_appointment_reminders r
     set status = 'cancelled', next_attempt_at = null,
         last_error = 'La cita ya no está confirmada o ya ocurrió.'
    from public.smyl_appointments a
   where r.tenant_id = p_tenant_id and r.status = 'pending'
     and a.tenant_id = r.tenant_id and a.id = r.appointment_id
     and (a.status <> 'confirmed' or a.starts_at <= now());

  -- Confirmaciones: citas confirmadas del equipo o del portal, creadas (o movidas) desde que se encendió la función,
  -- que aún no tienen confirmación vigente para su horario actual.
  insert into public.smyl_appointment_reminders(tenant_id, appointment_id, reminder_type, scheduled_for, starts_snapshot)
  select a.tenant_id, a.id, 'confirmation', now(), a.starts_at
    from public.smyl_appointments a
    join public.smyl_reminder_settings s on s.tenant_id = a.tenant_id
   where a.tenant_id = p_tenant_id and a.status = 'confirmed'
     and s.confirmation_enabled and s.confirmation_template_id is not null and s.confirmation_since is not null
     and a.source in ('manual', 'patient_portal')
     and a.starts_at > now() + interval '2 hours' and a.starts_at < now() + interval '90 days'
     and (a.created_at >= s.confirmation_since
          or exists (select 1 from public.smyl_appointment_events e
                      where e.tenant_id = a.tenant_id and e.appointment_id = a.id
                        and e.event_type = 'rescheduled' and e.created_at >= s.confirmation_since))
     and not exists (
       select 1 from public.smyl_appointment_reminders c
        where c.tenant_id = a.tenant_id and c.appointment_id = a.id and c.reminder_type = 'confirmation'
          and c.starts_snapshot = a.starts_at and c.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Citas confirmadas sin recordatorio vigente (p. ej. al reprogramar de vuelta a un horario cuyo recordatorio ya estaba cancelado).
  insert into public.smyl_appointment_reminders(tenant_id, appointment_id, reminder_type, scheduled_for)
  select a.tenant_id, a.id, 'custom', a.starts_at - interval '24 hours'
    from public.smyl_appointments a
   where a.tenant_id = p_tenant_id and a.status = 'confirmed'
     and a.starts_at > now() + interval '24 hours 5 minutes'
     and a.starts_at < now() + interval '45 days'
     and not exists (
       select 1 from public.smyl_appointment_reminders r
        where r.tenant_id = a.tenant_id and r.appointment_id = a.id
          and r.reminder_type <> 'confirmation' and r.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Una confirmación reciente ya cumple la función del recordatorio: no se manda otro menos de 6 h después.
  update public.smyl_appointment_reminders r
     set status = 'cancelled', next_attempt_at = null,
         last_error = 'Se omitió: la confirmación se envía menos de 6 horas antes de este recordatorio.'
    from public.smyl_appointment_reminders c
    join public.smyl_appointments a on a.tenant_id = c.tenant_id and a.id = c.appointment_id
   where r.tenant_id = p_tenant_id and r.status = 'pending' and r.reminder_type <> 'confirmation'
     and c.tenant_id = r.tenant_id and c.appointment_id = r.appointment_id and c.reminder_type = 'confirmation'
     and c.status in ('pending', 'processing', 'sent') and c.starts_snapshot = a.starts_at
     and r.scheduled_for >= c.scheduled_for and r.scheduled_for < c.scheduled_for + interval '6 hours';

  -- Reclamos interrumpidos antes de llegar a LANA: se reintentan con la misma clave de idempotencia.
  update public.smyl_appointment_reminders r
     set status = 'pending'
   where r.tenant_id = p_tenant_id and r.status = 'processing'
     and r.provider_reference is null and r.updated_at < now() - interval '10 minutes';

  return query
  with picked as (
    select r.id
      from public.smyl_appointment_reminders r
      join public.smyl_appointments a on a.tenant_id = r.tenant_id and a.id = r.appointment_id
     where r.tenant_id = p_tenant_id and r.status = 'pending'
       and (r.next_attempt_at is null or r.next_attempt_at <= now())
       and a.status = 'confirmed' and a.starts_at > now()
     order by (r.reminder_type = 'confirmation') desc, r.scheduled_for
     limit greatest(1, least(coalesce(p_limit, 25), 50))
     for update of r skip locked
  ), claimed as (
    update public.smyl_appointment_reminders r
       set status = 'processing', attempt_count = least(r.attempt_count + 1, 20), next_attempt_at = null
      from picked
     where r.id = picked.id
    returning r.id, r.appointment_id, r.reminder_type, r.scheduled_for, r.attempt_count
  )
  select c.id, c.appointment_id, c.reminder_type, c.scheduled_for, c.attempt_count,
         a.starts_at, a.patient_id, p.nombre, p.apellido,
         s.name, pr.display_name, b.name, b.phone, b.timezone,
         b.id,
         case when cfg.whatsapp_mode = 'per_branch' and nullif(btrim(b.whatsapp_phone), '') is not null then btrim(b.whatsapp_phone)
              else nullif(btrim(coalesce(cfg.whatsapp_phone, '')), '') end,
         case when pr.contact_phone_public then nullif(btrim(pr.contact_phone), '') end,
         p.consentimiento_whatsapp,
         a.source
    from claimed c
    join public.smyl_appointments a on a.tenant_id = p_tenant_id and a.id = c.appointment_id
    join public.camila_pacientes p on p.tenant_id = p_tenant_id and p.id = a.patient_id
    left join public.smyl_services s on s.tenant_id = p_tenant_id and s.id = a.service_id
    left join public.smyl_professionals pr on pr.tenant_id = p_tenant_id and pr.id = a.professional_id
    left join public.smyl_branches b on b.tenant_id = p_tenant_id and b.id = a.branch_id
    left join public.smyl_reminder_settings cfg on cfg.tenant_id = p_tenant_id
   order by (c.reminder_type = 'confirmation') desc, c.scheduled_for;
end;
$$;

revoke all on function public.smyl_claim_appointment_reminders(uuid, integer) from public, anon, authenticated;
grant execute on function public.smyl_claim_appointment_reminders(uuid, integer) to service_role;

commit;
