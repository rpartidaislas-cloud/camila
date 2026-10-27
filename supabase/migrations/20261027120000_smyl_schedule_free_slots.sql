-- Horas libres para Nueva cita y Cambiar horario, calculadas en el servidor.
--
-- Antes la Agenda las calculaba en el navegador con lo que alcanzaba a ver. Con alcance de datos
-- «propio» no veía las citas de otros profesionales, así que un choque de sillón podía aparecer libre.
-- Esta función usa la misma regla que smyl_validate_service_appointment_slot (la que decide al
-- confirmar), así que lo que muestra es lo que el servidor va a aceptar.
--
-- SECURITY DEFINER a propósito: necesita ver las citas de todos los profesionales de la clínica para
-- saber qué está ocupado. Devuelve únicamente horarios libres, nunca datos de pacientes ni de citas, y
-- solo a quien puede agendar (schedule.manage) dentro de su propia clínica (smyl_current_tenant).
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente (create or replace).

create or replace function public.smyl_schedule_free_slots(
  p_service_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid,
  p_professional_id uuid,
  p_room_id uuid default null,
  p_extra_minutes integer default 0,
  p_exclude_appointment_id uuid default null,
  p_limit integer default 200
)
returns table (slot_start timestamptz, slot_end timestamptz, slot_room_id uuid, slot_room_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_extra integer := coalesce(p_extra_minutes, 0);
  v_duration integer;
  v_before integer;
  v_after integer;
  v_timezone text;
  v_total integer;
  v_has_rooms boolean;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para consultar horarios libres.';
  end if;
  if p_service_id is null or p_branch_id is null or p_professional_id is null
     or p_from is null or p_to is null or p_from >= p_to
     or p_to - p_from > interval '8 days'
     or v_extra < 0 or v_extra > 240 or v_extra % 15 <> 0 then
    raise exception using errcode = '22023', message = 'La consulta de horarios libres no es válida.';
  end if;

  -- Lo que no existe, está inactivo o no está asignado no es un error: simplemente no hay horarios.
  select s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes
    into v_duration, v_before, v_after
  from public.smyl_services s
  where s.tenant_id = v_tenant and s.id = p_service_id and s.active;
  if not found then return; end if;

  select b.timezone into v_timezone
  from public.smyl_branches b
  where b.tenant_id = v_tenant and b.id = p_branch_id and b.active;
  if not found then return; end if;

  if not exists (
    select 1 from public.smyl_professionals p
    join public.smyl_professional_branches pb
      on pb.tenant_id = p.tenant_id and pb.professional_id = p.id and pb.branch_id = p_branch_id
    where p.tenant_id = v_tenant and p.id = p_professional_id and p.active
  ) then return; end if;

  if exists (select 1 from public.smyl_professional_services ps
             where ps.tenant_id = v_tenant and ps.professional_id = p_professional_id)
     and not exists (select 1 from public.smyl_professional_services ps
                     where ps.tenant_id = v_tenant and ps.professional_id = p_professional_id
                       and ps.service_id = p_service_id) then
    return;
  end if;

  if p_room_id is not null and not exists (
    select 1 from public.smyl_rooms r
    where r.tenant_id = v_tenant and r.id = p_room_id and r.branch_id = p_branch_id and r.active
  ) then return; end if;

  v_has_rooms := exists (
    select 1 from public.smyl_rooms r
    where r.tenant_id = v_tenant and r.branch_id = p_branch_id and r.active
  );
  v_total := v_duration + v_extra;

  return query
  with local_days as (
    select d::date as day_value
    from generate_series(
      (p_from at time zone v_timezone)::date,
      ((p_to - interval '1 second') at time zone v_timezone)::date,
      interval '1 day'
    ) d
  ), candidates as (
    select slot.starts_at as c_start,
           slot.starts_at + make_interval(mins => v_total) as c_end
    from local_days ld
    join public.smyl_professional_hours ph
      on ph.tenant_id = v_tenant and ph.professional_id = p_professional_id
     and ph.branch_id = p_branch_id and ph.active
     and ph.weekday = extract(dow from ld.day_value)::integer
    cross join lateral generate_series(
      (ld.day_value + ph.starts_at) at time zone v_timezone,
      ((ld.day_value + ph.ends_at) at time zone v_timezone) - make_interval(mins => v_total),
      interval '15 minutes'
    ) slot(starts_at)
  ), free_professional as (
    select c.c_start, c.c_end
    from candidates c
    where c.c_start >= greatest(p_from, clock_timestamp()) and c.c_end <= p_to
      -- Horario de la clínica en la hora local de la sucursal.
      and exists (
        select 1 from public.smyl_clinic_hours ch
        where ch.tenant_id = v_tenant and ch.branch_id = p_branch_id and ch.active
          and ch.weekday = extract(dow from c.c_start at time zone v_timezone)::integer
          and (c.c_start at time zone v_timezone)::time >= ch.starts_at
          and (c.c_end at time zone v_timezone)::time <= ch.ends_at
      )
      -- Citas del profesional (con la preparación de cada una).
      and not exists (
        select 1 from public.smyl_appointments a
        join public.smyl_services old_s on old_s.tenant_id = a.tenant_id and old_s.id = a.service_id
        where a.tenant_id = v_tenant and a.professional_id = p_professional_id
          and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
          and a.status in ('confirmed', 'arrived', 'in_progress')
          and c.c_start - make_interval(mins => v_before) < a.ends_at + make_interval(mins => old_s.buffer_after_minutes)
          and c.c_end + make_interval(mins => v_after) > a.starts_at - make_interval(mins => old_s.buffer_before_minutes)
      )
      -- Bloqueos del profesional.
      and not exists (
        select 1 from public.smyl_schedule_blocks bl
        where bl.tenant_id = v_tenant and bl.active and bl.branch_id = p_branch_id
          and bl.professional_id = p_professional_id
          and c.c_start - make_interval(mins => v_before) < bl.ends_at
          and c.c_end + make_interval(mins => v_after) > bl.starts_at
      )
      -- Apartados vigentes de solicitudes pendientes.
      and not exists (
        select 1 from public.smyl_appointment_requests req
        join public.smyl_services held_s on held_s.tenant_id = req.tenant_id and held_s.id = req.service_id
        where req.tenant_id = v_tenant and req.status = 'pending'
          and req.slot_hold_expires_at > clock_timestamp()
          and req.preferred_professional_id = p_professional_id
          and c.c_start - make_interval(mins => v_before) < req.requested_end + make_interval(mins => held_s.buffer_after_minutes)
          and c.c_end + make_interval(mins => v_after) > req.requested_start - make_interval(mins => held_s.buffer_before_minutes)
      )
  )
  select f.c_start, f.c_end, room_choice.id, room_choice.name
  from free_professional f
  left join lateral (
    select r.id, r.name
    from public.smyl_rooms r
    where r.tenant_id = v_tenant and r.branch_id = p_branch_id and r.active
      and (p_room_id is null or r.id = p_room_id)
      and not exists (
        select 1 from public.smyl_appointments a
        join public.smyl_services old_s on old_s.tenant_id = a.tenant_id and old_s.id = a.service_id
        where a.tenant_id = v_tenant and a.room_id = r.id
          and (p_exclude_appointment_id is null or a.id <> p_exclude_appointment_id)
          and a.status in ('confirmed', 'arrived', 'in_progress')
          and f.c_start - make_interval(mins => v_before) < a.ends_at + make_interval(mins => old_s.buffer_after_minutes)
          and f.c_end + make_interval(mins => v_after) > a.starts_at - make_interval(mins => old_s.buffer_before_minutes)
      )
      and not exists (
        select 1 from public.smyl_schedule_blocks bl
        where bl.tenant_id = v_tenant and bl.active and bl.branch_id = p_branch_id and bl.room_id = r.id
          and f.c_start - make_interval(mins => v_before) < bl.ends_at
          and f.c_end + make_interval(mins => v_after) > bl.starts_at
      )
      and not exists (
        select 1 from public.smyl_appointment_requests req
        join public.smyl_services held_s on held_s.tenant_id = req.tenant_id and held_s.id = req.service_id
        where req.tenant_id = v_tenant and req.status = 'pending'
          and req.slot_hold_expires_at > clock_timestamp() and req.preferred_room_id = r.id
          and f.c_start - make_interval(mins => v_before) < req.requested_end + make_interval(mins => held_s.buffer_after_minutes)
          and f.c_end + make_interval(mins => v_after) > req.requested_start - make_interval(mins => held_s.buffer_before_minutes)
      )
    order by r.name, r.id
    limit 1
  ) room_choice on true
  where not v_has_rooms or room_choice.id is not null
  order by f.c_start
  limit v_limit;
end;
$$;

revoke all on function public.smyl_schedule_free_slots(uuid, timestamptz, timestamptz, uuid, uuid, uuid, integer, uuid, integer)
  from public, anon;
grant execute on function public.smyl_schedule_free_slots(uuid, timestamptz, timestamptz, uuid, uuid, uuid, integer, uuid, integer)
  to authenticated;

comment on function public.smyl_schedule_free_slots(uuid, timestamptz, timestamptz, uuid, uuid, uuid, integer, uuid, integer) is
  'Horarios libres cada 15 min para un tratamiento, profesional y sucursal, con la misma regla que valida al confirmar la cita. Solo devuelve horarios, no datos de citas. Requiere schedule.manage en la clínica de la sesión.';
