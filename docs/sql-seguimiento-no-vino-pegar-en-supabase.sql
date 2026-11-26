-- SMYL · Avisos de cita: seguimiento automático de inasistencia («No vino») + botón «Quiero reagendar».
--
-- Aditivo e idempotente; apagado por omisión. 2 h después de que una cita se marca «No vino» (solo desde que la clínica lo enciende y
-- dentro de los últimos 3 días) se programa UN mensaje de WhatsApp con la plantilla elegida (conviene `cita_no_asistio_reagendar_v1`,
-- con el botón «Quiero reagendar»). Si el paciente toca el botón se guarda la respuesta 'rebook' en la cita para que recepción le ofrezca
-- horarios: la respuesta NUNCA agenda ni mueve nada. Publicar la migración antes que la función no rompe nada.

begin;

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
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.smyl_appointment_patient_responses'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%confirmed%'
  loop
    execute format('alter table public.smyl_appointment_patient_responses drop constraint %I', v_name);
  end loop;
end $$;
alter table public.smyl_appointment_reminders
  add constraint smyl_appointment_reminders_type_check check (reminder_type in ('24h', '2h', '48h', 'custom', 'confirmation', 'no_show'));
alter table public.smyl_appointment_patient_responses
  add constraint smyl_appointment_patient_responses_response_check check (response in ('confirmed', 'reschedule', 'rebook'));

alter table public.smyl_reminder_settings
  add column if not exists no_show_enabled boolean not null default false,
  add column if not exists no_show_template_id uuid,
  add column if not exists no_show_template_name text not null default '' check (char_length(no_show_template_name) <= 200),
  add column if not exists no_show_template_language text not null default '' check (char_length(no_show_template_language) <= 20),
  add column if not exists no_show_variables jsonb not null default '[]'::jsonb
    check (jsonb_typeof(no_show_variables) = 'array' and jsonb_array_length(no_show_variables) <= 20),
  add column if not exists no_show_since timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'smyl_reminder_settings_no_show_template_check') then
    alter table public.smyl_reminder_settings
      add constraint smyl_reminder_settings_no_show_template_check check (not no_show_enabled or no_show_template_id is not null);
  end if;
end $$;

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
   where r.tenant_id = p_tenant_id and r.status = 'pending' and r.reminder_type <> 'no_show'
     and a.tenant_id = r.tenant_id and a.id = r.appointment_id
     and (a.status <> 'confirmed' or a.starts_at <= now());

  -- Seguimiento de inasistencia: solo vale mientras la cita siga marcada «No vino».
  update public.smyl_appointment_reminders r
     set status = 'cancelled', next_attempt_at = null,
         last_error = 'La cita ya no está marcada como «No vino».'
    from public.smyl_appointments a
   where r.tenant_id = p_tenant_id and r.status = 'pending' and r.reminder_type = 'no_show'
     and a.tenant_id = r.tenant_id and a.id = r.appointment_id and a.status <> 'no_show';

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
          and r.reminder_type in ('24h', '2h', 'custom') and r.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Aviso 48 h antes (opcional): mismo mensaje que el de 24 h, con sus botones de confirmar / reprogramar. Solo si la clínica lo enciende
  -- y solo para citas que aún quedan a más de 48 h; las agendadas con menos anticipación solo reciben el de 24 h.
  insert into public.smyl_appointment_reminders(tenant_id, appointment_id, reminder_type, scheduled_for)
  select a.tenant_id, a.id, '48h', a.starts_at - interval '48 hours'
    from public.smyl_appointments a
    join public.smyl_reminder_settings s on s.tenant_id = a.tenant_id
   where a.tenant_id = p_tenant_id and a.status = 'confirmed'
     and s.enabled and s.reminder_48h_enabled and s.template_id is not null
     and a.starts_at > now() + interval '48 hours 5 minutes'
     and a.starts_at < now() + interval '45 days'
     and not exists (
       select 1 from public.smyl_appointment_reminders r
        where r.tenant_id = a.tenant_id and r.appointment_id = a.id
          and r.reminder_type = '48h' and r.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Seguimiento de inasistencia (opcional): 2 h después de que la cita se marca «No vino», solo para inasistencias marcadas desde que se
  -- enciende (nunca en retroactivo) y de los últimos 3 días. Un solo mensaje por cita.
  insert into public.smyl_appointment_reminders(tenant_id, appointment_id, reminder_type, scheduled_for, starts_snapshot)
  select a.tenant_id, a.id, 'no_show', now() + interval '2 hours', a.starts_at
    from public.smyl_appointments a
    join public.smyl_reminder_settings s on s.tenant_id = a.tenant_id
   where a.tenant_id = p_tenant_id and a.status = 'no_show'
     and s.no_show_enabled and s.no_show_template_id is not null and s.no_show_since is not null
     and a.updated_at >= s.no_show_since and a.starts_at >= now() - interval '3 days' and a.starts_at <= now()
     and not exists (
       select 1 from public.smyl_appointment_reminders r
        where r.tenant_id = a.tenant_id and r.appointment_id = a.id and r.reminder_type = 'no_show'
          and r.status in ('pending', 'processing', 'sent'))
  on conflict do nothing;

  -- Una confirmación reciente ya cumple la función del recordatorio: no se manda otro menos de 6 h después.
  update public.smyl_appointment_reminders r
     set status = 'cancelled', next_attempt_at = null,
         last_error = 'Se omitió: la confirmación se envía menos de 6 horas antes de este recordatorio.'
    from public.smyl_appointment_reminders c
    join public.smyl_appointments a on a.tenant_id = c.tenant_id and a.id = c.appointment_id
   where r.tenant_id = p_tenant_id and r.status = 'pending' and r.reminder_type not in ('confirmation', 'no_show')
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
       and ((r.reminder_type <> 'no_show' and a.status = 'confirmed' and a.starts_at > now())
            or (r.reminder_type = 'no_show' and a.status = 'no_show'))
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


-- Respuesta del paciente a un aviso. 'confirmed' / 'reschedule' → su cita confirmada más próxima; 'rebook' → su inasistencia más reciente (14 días).
create or replace function public.smyl_apply_patient_attendance_response(
  p_tenant uuid, p_conversation uuid, p_event_id text, p_response text, p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_patients uuid[];
  v_appointments record;
  v_count integer;
  v_inserted uuid;
begin
  if p_tenant is null or p_conversation is null or coalesce(p_event_id, '') = '' or p_response not in ('confirmed', 'reschedule', 'rebook') or p_occurred_at is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  select array_agg(distinct h.patient_id) into v_patients
    from public.camila_lana_handoffs h
   where h.tenant_id = p_tenant and h.lana_conversation_id = p_conversation and h.patient_id is not null;
  if v_patients is null then return jsonb_build_object('status', 'no_patient'); end if;
  if array_length(v_patients, 1) > 1 then return jsonb_build_object('status', 'ambiguous_patient'); end if;

  if p_response = 'rebook' then
    select count(*) into v_count
      from public.smyl_appointments a
     where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'no_show'
       and a.starts_at >= p_occurred_at - interval '14 days' and a.starts_at <= p_occurred_at;
    if v_count = 0 then return jsonb_build_object('status', 'no_appointment'); end if;
    select a.id, a.starts_at into v_appointments
      from public.smyl_appointments a
     where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'no_show'
       and a.starts_at >= p_occurred_at - interval '14 days' and a.starts_at <= p_occurred_at
     order by a.starts_at desc limit 1;
  else
    select count(*) into v_count
      from public.smyl_appointments a
     where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'confirmed'
       and a.starts_at >= p_occurred_at - interval '2 hours' and a.starts_at < p_occurred_at + interval '4 days';
    if v_count = 0 then return jsonb_build_object('status', 'no_appointment'); end if;
    select a.id, a.starts_at into v_appointments
      from public.smyl_appointments a
     where a.tenant_id = p_tenant and a.patient_id = v_patients[1] and a.status = 'confirmed'
       and a.starts_at >= p_occurred_at - interval '2 hours' and a.starts_at < p_occurred_at + interval '4 days'
     order by a.starts_at asc limit 1;
  end if;

  insert into public.smyl_appointment_patient_responses(tenant_id, appointment_id, response, appointment_starts_at, ambiguous, provider_event_id, responded_at)
  values (p_tenant, v_appointments.id, p_response, v_appointments.starts_at, v_count > 1, p_event_id, p_occurred_at)
  on conflict (tenant_id, provider_event_id) do nothing
  returning id into v_inserted;
  if v_inserted is null then return jsonb_build_object('status', 'duplicate'); end if;
  return jsonb_build_object('status', 'applied', 'response', p_response, 'appointment_id', v_appointments.id, 'ambiguous', v_count > 1);
end;
$$;
revoke all on function public.smyl_apply_patient_attendance_response(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.smyl_apply_patient_attendance_response(uuid, uuid, text, text, timestamptz) to service_role;

commit;
