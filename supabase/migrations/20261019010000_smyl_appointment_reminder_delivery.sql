-- Fase 4 del chat: entrega real de los recordatorios de cita.
--
-- smyl_appointment_reminders ya se llenaba al agendar (24 h antes), pero nada
-- los enviaba. La Edge Function appointment-reminders los entrega a LANA como
-- mensajes programados de WhatsApp con una plantilla aprobada; el trabajador
-- de LANA los envía a su hora aunque nadie tenga SMYL abierto.
--
-- Estados en SMYL:
--   pending    -> aún no llega a LANA (o espera reintento / conversación vinculada)
--   processing -> reclamado por el worker; con provider_reference ya está
--                 programado en LANA y se sincroniza su resultado
--   sent       -> LANA confirmó el envío
--   failed     -> no se pudo entregar; la Agenda lo muestra como pendiente de atención
--   cancelled  -> la cita se movió/canceló o el recordatorio se omitió

alter table public.smyl_appointment_reminders
  add column if not exists provider_conversation_id uuid,
  add column if not exists provider_status text not null default '',
  add column if not exists provider_cancel_required boolean not null default false,
  add column if not exists next_attempt_at timestamptz;

alter table public.smyl_appointment_reminders
  drop constraint if exists smyl_appointment_reminders_provider_status_check;
alter table public.smyl_appointment_reminders
  add constraint smyl_appointment_reminders_provider_status_check check (char_length(provider_status) <= 40);

create index if not exists smyl_appointment_reminders_dispatch_idx
  on public.smyl_appointment_reminders(tenant_id, status, scheduled_for)
  where status in ('pending', 'processing') or provider_cancel_required;

-- Configuración por clínica. Sólo la Edge Function (service_role) escribe.
create table if not exists public.smyl_reminder_settings (
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  enabled boolean not null default false,
  template_id uuid,
  template_name text not null default '' check (char_length(template_name) <= 200),
  template_language text not null default '' check (char_length(template_language) <= 20),
  variables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(variables) = 'array' and jsonb_array_length(variables) <= 20),
  last_dispatch_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or template_id is not null)
);

drop trigger if exists smyl_reminder_settings_touch on public.smyl_reminder_settings;
create trigger smyl_reminder_settings_touch before update on public.smyl_reminder_settings
  for each row execute function public.smyl_touch_updated_at();
drop trigger if exists smyl_reminder_settings_audit on public.smyl_reminder_settings;
create trigger smyl_reminder_settings_audit after insert or update or delete on public.smyl_reminder_settings
  for each row execute function public.smyl_audit_row();

alter table public.smyl_reminder_settings enable row level security;
drop policy if exists smyl_reminder_settings_read on public.smyl_reminder_settings;
create policy smyl_reminder_settings_read on public.smyl_reminder_settings
  for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
revoke all on table public.smyl_reminder_settings from anon;
revoke insert, update, delete on table public.smyl_reminder_settings from authenticated;
grant select on public.smyl_reminder_settings to authenticated;

-- Mover, cancelar, completar o marcar inasistencia cancela el recordatorio
-- vigente. Si ya estaba programado en LANA, se marca para cancelarlo allá.
-- Las RPC de agenda actualizan la cita antes de crear el recordatorio nuevo,
-- así que este trigger nunca cancela el que se acaba de generar.
create or replace function public.smyl_sync_reminders_with_appointment()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status in ('cancelled', 'no_show', 'completed') or new.starts_at is distinct from old.starts_at then
    update public.smyl_appointment_reminders r
       set provider_cancel_required = r.provider_reference is not null,
           status = 'cancelled',
           next_attempt_at = null
     where r.tenant_id = new.tenant_id
       and r.appointment_id = new.id
       and r.status in ('pending', 'processing');
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_appointments_reminder_sync on public.smyl_appointments;
create trigger smyl_appointments_reminder_sync after update of starts_at, status on public.smyl_appointments
  for each row execute function public.smyl_sync_reminders_with_appointment();

revoke all on function public.smyl_sync_reminders_with_appointment() from public, anon, authenticated;

-- Reclama recordatorios listos para entregarse a LANA. Sólo service_role.
create or replace function public.smyl_claim_appointment_reminders(p_tenant_id uuid, p_limit integer default 25)
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
  branch_timezone text
)
language plpgsql security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
begin
  -- Recordatorios de citas que ya no están confirmadas o que ya pasaron.
  update public.smyl_appointment_reminders r
     set status = 'cancelled', next_attempt_at = null,
         last_error = 'La cita ya no está confirmada o ya ocurrió.'
    from public.smyl_appointments a
   where r.tenant_id = p_tenant_id and r.status = 'pending'
     and a.tenant_id = r.tenant_id and a.id = r.appointment_id
     and (a.status <> 'confirmed' or a.starts_at <= now());

  -- Citas confirmadas sin recordatorio vigente (p. ej. al reprogramar de vuelta
  -- a un horario cuyo recordatorio ya estaba cancelado: la RPC hace
  -- "on conflict do nothing" con la llave única y no crea uno nuevo).
  insert into public.smyl_appointment_reminders(tenant_id, appointment_id, reminder_type, scheduled_for)
  select a.tenant_id, a.id, 'custom', a.starts_at - interval '24 hours'
    from public.smyl_appointments a
   where a.tenant_id = p_tenant_id and a.status = 'confirmed'
     and a.starts_at > now() + interval '24 hours 5 minutes'
     and a.starts_at < now() + interval '45 days'
     and not exists (
       select 1 from public.smyl_appointment_reminders r
        where r.tenant_id = a.tenant_id and r.appointment_id = a.id
          and r.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Reclamos interrumpidos antes de llegar a LANA: se reintentan con la misma
  -- clave de idempotencia (el id del recordatorio), así que no duplican envíos.
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
     order by r.scheduled_for
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
         s.name, pr.display_name, b.name, b.phone, b.timezone
    from claimed c
    join public.smyl_appointments a on a.tenant_id = p_tenant_id and a.id = c.appointment_id
    join public.camila_pacientes p on p.tenant_id = p_tenant_id and p.id = a.patient_id
    left join public.smyl_services s on s.tenant_id = p_tenant_id and s.id = a.service_id
    left join public.smyl_professionals pr on pr.tenant_id = p_tenant_id and pr.id = a.professional_id
    left join public.smyl_branches b on b.tenant_id = p_tenant_id and b.id = a.branch_id
   order by c.scheduled_for;
end;
$$;

revoke all on function public.smyl_claim_appointment_reminders(uuid, integer) from public, anon, authenticated;
grant execute on function public.smyl_claim_appointment_reminders(uuid, integer) to service_role;
