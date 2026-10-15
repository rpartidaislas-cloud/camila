-- SMYL · Agenda, integridad v2.
-- Unifica buffers clínicos, disponibilidad de sillones y apartados temporales
-- para que la agenda manual y la agenda conversacional compartan reglas.
begin;

alter table public.smyl_appointment_requests
  add column if not exists preferred_room_id uuid,
  add column if not exists slot_hold_expires_at timestamptz;

alter table public.smyl_appointment_requests
  drop constraint if exists smyl_appointment_requests_preferred_room_fk;
alter table public.smyl_appointment_requests
  add constraint smyl_appointment_requests_preferred_room_fk
  foreign key (tenant_id, preferred_room_id)
  references public.smyl_rooms(tenant_id, id) on delete restrict;

create index if not exists smyl_appointment_requests_active_hold_idx
  on public.smyl_appointment_requests(
    tenant_id, preferred_professional_id, preferred_room_id,
    requested_start, requested_end, slot_hold_expires_at
  ) where status='pending' and slot_hold_expires_at is not null;

create or replace function public.smyl_validate_service_appointment_slot(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_request_id uuid,
  p_service_id uuid,
  p_branch_id uuid,
  p_professional_id uuid,
  p_room_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_weekday integer;
  v_duration integer;
  v_before integer;
  v_after integer;
begin
  if p_tenant_id is null or p_service_id is null or p_branch_id is null
     or p_professional_id is null or p_starts_at is null or p_ends_at is null
     or p_starts_at>=p_ends_at then
    raise exception using errcode='22023',message='La selección de agenda está incompleta.';
  end if;

  select s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes
    into v_duration,v_before,v_after
  from public.smyl_services s
  where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active;
  if not found then
    raise exception using errcode='P0002',message='El servicio no existe o está inactivo.';
  end if;
  if p_ends_at<>p_starts_at+make_interval(mins=>v_duration) then
    raise exception using errcode='23514',message='La duración no coincide con el servicio seleccionado.';
  end if;

  select b.timezone into v_timezone
  from public.smyl_branches b
  where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.active;
  if not found then
    raise exception using errcode='P0002',message='La sucursal no existe o está inactiva.';
  end if;

  v_local_start:=p_starts_at at time zone v_timezone;
  v_local_end:=p_ends_at at time zone v_timezone;
  v_weekday:=extract(dow from v_local_start)::integer;
  if v_local_end::date<>v_local_start::date then
    raise exception using errcode='22023',message='Una cita no puede cruzar al día siguiente.';
  end if;

  if not exists(
    select 1 from public.smyl_professional_branches pb
    where pb.tenant_id=p_tenant_id and pb.professional_id=p_professional_id
      and pb.branch_id=p_branch_id
  ) then
    raise exception using errcode='23514',message='El profesional no está asignado a esa sucursal.';
  end if;
  if exists(
    select 1 from public.smyl_professional_services ps
    where ps.tenant_id=p_tenant_id and ps.professional_id=p_professional_id
  ) and not exists(
    select 1 from public.smyl_professional_services ps
    where ps.tenant_id=p_tenant_id and ps.professional_id=p_professional_id
      and ps.service_id=p_service_id
  ) then
    raise exception using errcode='23514',message='El profesional no ofrece ese servicio.';
  end if;

  if p_room_id is not null and not exists(
    select 1 from public.smyl_rooms r
    where r.tenant_id=p_tenant_id and r.id=p_room_id
      and r.branch_id=p_branch_id and r.active
  ) then
    raise exception using errcode='23514',message='El sillón no pertenece a esa sucursal o está inactivo.';
  end if;
  if p_room_id is null and exists(
    select 1 from public.smyl_rooms r
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.active
  ) then
    raise exception using errcode='23514',message='Selecciona un sillón o consultorio disponible.';
  end if;

  if not exists(
    select 1 from public.smyl_clinic_hours h
    where h.tenant_id=p_tenant_id and h.branch_id=p_branch_id
      and h.weekday=v_weekday and h.active
      and v_local_start::time>=h.starts_at and v_local_end::time<=h.ends_at
  ) then
    raise exception using errcode='23514',message='La cita está fuera del horario de la clínica.';
  end if;
  if not exists(
    select 1 from public.smyl_professional_hours h
    where h.tenant_id=p_tenant_id and h.professional_id=p_professional_id
      and h.branch_id=p_branch_id and h.weekday=v_weekday and h.active
      and v_local_start::time>=h.starts_at and v_local_end::time<=h.ends_at
  ) then
    raise exception using errcode='23514',message='La cita está fuera de la disponibilidad del profesional.';
  end if;

  if exists(
    select 1
    from public.smyl_appointments a
    join public.smyl_services s on s.tenant_id=a.tenant_id and s.id=a.service_id
    where a.tenant_id=p_tenant_id and a.professional_id=p_professional_id
      and a.id<>coalesce(p_appointment_id,'00000000-0000-0000-0000-000000000000')::uuid
      and a.status in ('confirmed','arrived','in_progress')
      and p_starts_at-make_interval(mins=>v_before)<a.ends_at+make_interval(mins=>s.buffer_after_minutes)
      and p_ends_at+make_interval(mins=>v_after)>a.starts_at-make_interval(mins=>s.buffer_before_minutes)
  ) then
    raise exception using errcode='23P01',message='El profesional ya tiene una cita o tiempo clínico reservado.';
  end if;

  if p_room_id is not null and exists(
    select 1
    from public.smyl_appointments a
    join public.smyl_services s on s.tenant_id=a.tenant_id and s.id=a.service_id
    where a.tenant_id=p_tenant_id and a.room_id=p_room_id
      and a.id<>coalesce(p_appointment_id,'00000000-0000-0000-0000-000000000000')::uuid
      and a.status in ('confirmed','arrived','in_progress')
      and p_starts_at-make_interval(mins=>v_before)<a.ends_at+make_interval(mins=>s.buffer_after_minutes)
      and p_ends_at+make_interval(mins=>v_after)>a.starts_at-make_interval(mins=>s.buffer_before_minutes)
  ) then
    raise exception using errcode='23P01',message='El sillón o consultorio ya está reservado.';
  end if;

  if exists(
    select 1 from public.smyl_schedule_blocks b
    where b.tenant_id=p_tenant_id and b.active and b.branch_id=p_branch_id
      and (b.professional_id=p_professional_id or (p_room_id is not null and b.room_id=p_room_id))
      and p_starts_at-make_interval(mins=>v_before)<b.ends_at
      and p_ends_at+make_interval(mins=>v_after)>b.starts_at
  ) then
    raise exception using errcode='23P01',message='El horario está bloqueado.';
  end if;

  if exists(
    select 1
    from public.smyl_appointment_requests r
    join public.smyl_services s on s.tenant_id=r.tenant_id and s.id=r.service_id
    where r.tenant_id=p_tenant_id and r.status='pending'
      and r.slot_hold_expires_at>clock_timestamp()
      and r.id<>coalesce(p_request_id,'00000000-0000-0000-0000-000000000000')::uuid
      and (r.preferred_professional_id=p_professional_id
           or (p_room_id is not null and r.preferred_room_id=p_room_id))
      and p_starts_at-make_interval(mins=>v_before)<r.requested_end+make_interval(mins=>s.buffer_after_minutes)
      and p_ends_at+make_interval(mins=>v_after)>r.requested_start-make_interval(mins=>s.buffer_before_minutes)
  ) then
    raise exception using errcode='23P01',message='Ese horario está temporalmente apartado por otro paciente.';
  end if;
end;
$$;

revoke all on function public.smyl_validate_service_appointment_slot(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz)
  from public,anon,authenticated;

create or replace function public.smyl_inbox_available_slots_v2(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_service_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_branch_id uuid default null,
  p_professional_id uuid default null,
  p_limit integer default 12
) returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  branch_id uuid,
  branch_name text,
  timezone text,
  professional_id uuid,
  professional_name text,
  specialty text,
  room_id uuid,
  room_name text,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  buffer_before_minutes integer,
  buffer_after_minutes integer
)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,12),1),30);
begin
  if p_tenant_id is null or p_actor_id is null or p_service_id is null
     or p_from is null or p_to is null or p_from>=p_to
     or p_to-p_from>interval '31 days' then
    raise exception using errcode='22023',message='El periodo de disponibilidad no es válido.';
  end if;
  if not (
    exists(select 1 from public.camila_tenants t where t.id=p_tenant_id and t.id=p_actor_id and t.activo)
    or exists(
      select 1 from public.camila_usuarios u
      join public.smyl_member_roles mr on mr.tenant_id=u.tenant_id and mr.user_id=u.id
      join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
      join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
      where u.id=p_actor_id and u.tenant_id=p_tenant_id and u.activo
        and rp.permission_key='schedule.read'
    )
  ) then
    raise exception using errcode='42501',message='No tienes permiso para consultar disponibilidad.';
  end if;

  return query
  with service as (
    select s.id,s.name,s.duration_minutes,s.buffer_before_minutes,s.buffer_after_minutes
    from public.smyl_services s
    where s.tenant_id=p_tenant_id and s.id=p_service_id and s.active
  ), candidates as (
    select slot.starts_at,
           slot.starts_at+make_interval(mins=>s.duration_minutes) as ends_at,
           b.id as branch_id,b.name as branch_name,b.timezone,
           p.id as professional_id,p.display_name as professional_name,p.specialty,
           s.id as service_id,s.name as service_name,s.duration_minutes,
           s.buffer_before_minutes,s.buffer_after_minutes
    from service s
    join public.smyl_professional_services ps
      on ps.tenant_id=p_tenant_id and ps.service_id=s.id
    join public.smyl_professionals p
      on p.tenant_id=ps.tenant_id and p.id=ps.professional_id and p.active
    join public.smyl_professional_hours ph
      on ph.tenant_id=p.tenant_id and ph.professional_id=p.id and ph.active
    join public.smyl_branches b
      on b.tenant_id=ph.tenant_id and b.id=ph.branch_id and b.active
    cross join lateral generate_series(
      (p_from at time zone b.timezone)::date,
      ((p_to-interval '1 second') at time zone b.timezone)::date,
      interval '1 day'
    ) day_row(day_value)
    cross join lateral generate_series(
      (day_row.day_value::date+ph.starts_at) at time zone b.timezone,
      ((day_row.day_value::date+ph.ends_at) at time zone b.timezone)-make_interval(mins=>s.duration_minutes),
      interval '15 minutes'
    ) slot(starts_at)
    where (p_branch_id is null or b.id=p_branch_id)
      and (p_professional_id is null or p.id=p_professional_id)
      and extract(dow from day_row.day_value)::integer=ph.weekday
  ), free_professional as (
    select c.*
    from candidates c
    where c.starts_at>=greatest(p_from,clock_timestamp()) and c.ends_at<=p_to
      and exists(
        select 1 from public.smyl_clinic_hours ch
        where ch.tenant_id=p_tenant_id and ch.branch_id=c.branch_id
          and ch.weekday=extract(dow from c.starts_at at time zone c.timezone)::integer and ch.active
          and (c.starts_at at time zone c.timezone)::time>=ch.starts_at
          and (c.ends_at at time zone c.timezone)::time<=ch.ends_at
      )
      and not exists(
        select 1 from public.smyl_appointments a
        join public.smyl_services old_s on old_s.tenant_id=a.tenant_id and old_s.id=a.service_id
        where a.tenant_id=p_tenant_id and a.professional_id=c.professional_id
          and a.status in ('confirmed','arrived','in_progress')
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<a.ends_at+make_interval(mins=>old_s.buffer_after_minutes)
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>a.starts_at-make_interval(mins=>old_s.buffer_before_minutes)
      )
      and not exists(
        select 1 from public.smyl_schedule_blocks bl
        where bl.tenant_id=p_tenant_id and bl.active and bl.branch_id=c.branch_id
          and bl.professional_id=c.professional_id
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<bl.ends_at
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>bl.starts_at
      )
      and not exists(
        select 1 from public.smyl_appointment_requests req
        join public.smyl_services held_s on held_s.tenant_id=req.tenant_id and held_s.id=req.service_id
        where req.tenant_id=p_tenant_id and req.status='pending'
          and req.slot_hold_expires_at>clock_timestamp()
          and req.preferred_professional_id=c.professional_id
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<req.requested_end+make_interval(mins=>held_s.buffer_after_minutes)
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>req.requested_start-make_interval(mins=>held_s.buffer_before_minutes)
      )
  )
  select c.starts_at,c.ends_at,c.branch_id,c.branch_name,c.timezone,
         c.professional_id,c.professional_name,c.specialty,
         room_choice.id,room_choice.name,
         c.service_id,c.service_name,c.duration_minutes,
         c.buffer_before_minutes,c.buffer_after_minutes
  from free_professional c
  left join lateral (
    select r.id,r.name
    from public.smyl_rooms r
    where r.tenant_id=p_tenant_id and r.branch_id=c.branch_id and r.active
      and not exists(
        select 1 from public.smyl_appointments a
        join public.smyl_services old_s on old_s.tenant_id=a.tenant_id and old_s.id=a.service_id
        where a.tenant_id=p_tenant_id and a.room_id=r.id
          and a.status in ('confirmed','arrived','in_progress')
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<a.ends_at+make_interval(mins=>old_s.buffer_after_minutes)
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>a.starts_at-make_interval(mins=>old_s.buffer_before_minutes)
      )
      and not exists(
        select 1 from public.smyl_schedule_blocks bl
        where bl.tenant_id=p_tenant_id and bl.active and bl.branch_id=c.branch_id
          and bl.room_id=r.id
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<bl.ends_at
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>bl.starts_at
      )
      and not exists(
        select 1 from public.smyl_appointment_requests req
        join public.smyl_services held_s on held_s.tenant_id=req.tenant_id and held_s.id=req.service_id
        where req.tenant_id=p_tenant_id and req.status='pending'
          and req.slot_hold_expires_at>clock_timestamp() and req.preferred_room_id=r.id
          and c.starts_at-make_interval(mins=>c.buffer_before_minutes)<req.requested_end+make_interval(mins=>held_s.buffer_after_minutes)
          and c.ends_at+make_interval(mins=>c.buffer_after_minutes)>req.requested_start-make_interval(mins=>held_s.buffer_before_minutes)
      )
    order by r.name,r.id
    limit 1
  ) room_choice on true
  where not exists(
    select 1 from public.smyl_rooms configured
    where configured.tenant_id=p_tenant_id and configured.branch_id=c.branch_id and configured.active
  ) or room_choice.id is not null
  order by c.starts_at,c.professional_name,c.branch_name
  limit v_limit;
end;
$$;

revoke all on function public.smyl_inbox_available_slots_v2(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.smyl_inbox_available_slots_v2(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
  to service_role;

create or replace function public.smyl_inbox_available_slots(
  p_tenant_id uuid,p_actor_id uuid,p_service_id uuid,p_from timestamptz,p_to timestamptz,
  p_branch_id uuid default null,p_professional_id uuid default null,p_limit integer default 12
) returns table(
  starts_at timestamptz,ends_at timestamptz,branch_id uuid,branch_name text,timezone text,
  professional_id uuid,professional_name text,specialty text,service_id uuid,
  service_name text,duration_minutes integer
)
language sql
security definer
set search_path=pg_catalog,public
as $$
  select s.starts_at,s.ends_at,s.branch_id,s.branch_name,s.timezone,
         s.professional_id,s.professional_name,s.specialty,
         s.service_id,s.service_name,s.duration_minutes
  from public.smyl_inbox_available_slots_v2(
    p_tenant_id,p_actor_id,p_service_id,p_from,p_to,p_branch_id,p_professional_id,p_limit
  ) s;
$$;

revoke all on function public.smyl_inbox_available_slots(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.smyl_inbox_available_slots(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
  to service_role;

create or replace function public.smyl_create_appointment(
  p_id uuid,p_patient_id uuid,p_professional_id uuid,p_service_id uuid,
  p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz,p_notes text default '',
  p_source text default 'manual'
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_duration integer; v_ends timestamptz;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then
    raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.';
  end if;
  if p_id is null then raise exception using errcode='22023',message='Falta la clave idempotente de la cita.'; end if;
  if exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_id) then return p_id; end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=v_tenant and id=p_service_id and active;
  if not found then raise exception using errcode='P0002',message='El servicio no existe o está inactivo.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002',message='El paciente no existe.'; end if;
  if not exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and id=p_professional_id and active) then raise exception using errcode='P0002',message='El profesional no existe o está inactivo.'; end if;
  v_ends:=p_starts_at+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_professional_id::text||':'||p_starts_at::date::text,0));
  if p_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(v_tenant,p_id,null,p_service_id,p_branch_id,p_professional_id,p_room_id,p_starts_at,v_ends);
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,room_id,starts_at,ends_at,status,source,notes,created_by,updated_by)
  values(p_id,v_tenant,p_branch_id,p_patient_id,p_professional_id,p_service_id,p_room_id,p_starts_at,v_ends,'confirmed',p_source,left(coalesce(p_notes,''),2000),auth.uid(),auth.uid());
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data)
  values(v_tenant,p_id,'created','confirmed',auth.uid(),jsonb_build_object('source',p_source));
  if p_starts_at-interval '24 hours'>now() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(v_tenant,p_id,p_starts_at-interval '24 hours');
  end if;
  return p_id;
end;
$$;

create or replace function public.smyl_reschedule_appointment(
  p_appointment_id uuid,p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz,p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_appointments; v_duration integer; v_ends timestamptz;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_row from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='La cita no existe.'; end if;
  if v_row.updated_at<>p_expected_updated_at then raise exception using errcode='40001',message='La cita cambió en otra sesión. Actualiza la agenda.'; end if;
  if v_row.status<>'confirmed' then raise exception using errcode='23514',message='Solo se puede reprogramar una cita confirmada.'; end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=v_tenant and id=v_row.service_id and active;
  if not found then raise exception using errcode='P0002',message='El servicio ya no está disponible.'; end if;
  v_ends:=p_starts_at+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||v_row.professional_id::text||':'||p_starts_at::date::text,0));
  if p_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(v_tenant,p_appointment_id,null,v_row.service_id,p_branch_id,v_row.professional_id,p_room_id,p_starts_at,v_ends);
  update public.smyl_appointments set branch_id=p_branch_id,room_id=p_room_id,starts_at=p_starts_at,ends_at=v_ends,updated_by=auth.uid() where tenant_id=v_tenant and id=p_appointment_id;
  update public.smyl_appointment_reminders set status='cancelled' where tenant_id=v_tenant and appointment_id=p_appointment_id and status='pending';
  if p_starts_at-interval '24 hours'>now() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(v_tenant,p_appointment_id,p_starts_at-interval '24 hours') on conflict do nothing;
  end if;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,actor_id,event_data)
  values(v_tenant,p_appointment_id,'rescheduled',auth.uid(),jsonb_build_object('from',v_row.starts_at,'to',p_starts_at));
end;
$$;

create or replace function public.smyl_accept_appointment_request(
  p_request_id uuid,p_appointment_id uuid,p_professional_id uuid,p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_req public.smyl_appointment_requests; v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_req from public.smyl_appointment_requests where tenant_id=v_tenant and id=p_request_id for update;
  if not found or v_req.status<>'pending' then raise exception using errcode='23514',message='La solicitud ya fue atendida o no existe.'; end if;
  if v_req.patient_id is null or v_req.service_id is null then raise exception using errcode='23514',message='La solicitud necesita paciente y servicio antes de aceptarse.'; end if;
  update public.smyl_appointment_requests set status='accepted',decided_by=auth.uid(),decided_at=clock_timestamp() where tenant_id=v_tenant and id=p_request_id;
  v_id:=public.smyl_create_appointment(p_appointment_id,v_req.patient_id,p_professional_id,v_req.service_id,p_branch_id,p_room_id,p_starts_at,'Solicitud revisada por la clínica','assistant_request');
  update public.smyl_appointment_requests set appointment_id=v_id where tenant_id=v_tenant and id=p_request_id;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,actor_id,event_data)
  values(v_tenant,v_id,'request_accepted',auth.uid(),jsonb_build_object('request_id',p_request_id));
  return v_id;
end;
$$;

create or replace function public.smyl_inbox_create_appointment_request(
  p_tenant_id uuid,p_actor_id uuid,p_conversation_id uuid,p_service_id uuid,
  p_branch_id uuid,p_professional_id uuid,p_starts_at timestamptz,p_external_key uuid
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare
  v_patient_id uuid; v_ends_at timestamptz; v_room_id uuid;
  v_request_id uuid; v_existing uuid;
begin
  if p_external_key is null then raise exception using errcode='22023',message='Falta la clave idempotente.'; end if;
  if not (
    p_actor_id=p_tenant_id or exists(
      select 1 from public.camila_usuarios u
      join public.smyl_member_roles mr on mr.tenant_id=u.tenant_id and mr.user_id=u.id
      join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
      join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
      where u.id=p_actor_id and u.tenant_id=p_tenant_id and u.activo and rp.permission_key='schedule.manage'
    )
  ) then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select id into v_existing from public.smyl_appointment_requests
  where tenant_id=p_tenant_id and source='inbox' and external_request_key=p_external_key::text;
  if v_existing is not null then return v_existing; end if;
  select h.patient_id into v_patient_id from public.camila_lana_handoffs h
  where h.tenant_id=p_tenant_id and h.lana_conversation_id=p_conversation_id;
  if v_patient_id is null then raise exception using errcode='23514',message='Vincula un paciente antes de registrar su elección.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||p_professional_id::text||':'||p_starts_at::date::text,0));
  select slot.ends_at,slot.room_id into v_ends_at,v_room_id
  from public.smyl_inbox_available_slots_v2(p_tenant_id,p_actor_id,p_service_id,p_starts_at,p_starts_at+interval '1 day',p_branch_id,p_professional_id,30) slot
  where slot.starts_at=p_starts_at and slot.branch_id=p_branch_id and slot.professional_id=p_professional_id
  limit 1;
  if v_ends_at is null then raise exception using errcode='23P01',message='Ese horario ya no está disponible. Consulta la agenda nuevamente.'; end if;
  if v_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||v_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(p_tenant_id,null,null,p_service_id,p_branch_id,p_professional_id,v_room_id,p_starts_at,v_ends_at);

  insert into public.smyl_appointment_requests(
    tenant_id,patient_id,service_id,preferred_branch_id,preferred_professional_id,preferred_room_id,
    lana_conversation_id,requested_start,requested_end,slot_hold_expires_at,
    source,external_request_key,patient_message
  ) values(
    p_tenant_id,v_patient_id,p_service_id,p_branch_id,p_professional_id,v_room_id,
    p_conversation_id,p_starts_at,v_ends_at,clock_timestamp()+interval '10 minutes',
    'inbox',p_external_key::text,'Horario elegido en conversación; pendiente de confirmación humana.'
  ) returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.smyl_inbox_confirm_appointment_request(
  p_tenant_id uuid,p_actor_id uuid,p_request_id uuid,p_appointment_id uuid
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_req public.smyl_appointment_requests; v_duration integer; v_ends_at timestamptz;
begin
  if p_appointment_id is null then raise exception using errcode='22023',message='Falta la clave idempotente de la cita.'; end if;
  if not (
    p_actor_id=p_tenant_id or exists(
      select 1 from public.camila_usuarios u
      join public.smyl_member_roles mr on mr.tenant_id=u.tenant_id and mr.user_id=u.id
      join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
      join public.smyl_role_permissions rp on rp.tenant_id=r.tenant_id and rp.role_id=r.id
      where u.id=p_actor_id and u.tenant_id=p_tenant_id and u.activo and rp.permission_key='schedule.manage'
    )
  ) then raise exception using errcode='42501',message='No tienes permiso para confirmar citas.'; end if;
  if exists(select 1 from public.smyl_appointments a where a.tenant_id=p_tenant_id and a.id=p_appointment_id) then return p_appointment_id; end if;
  select * into v_req from public.smyl_appointment_requests where tenant_id=p_tenant_id and id=p_request_id for update;
  if not found or v_req.status<>'pending' then raise exception using errcode='23514',message='La solicitud ya fue atendida o no existe.'; end if;
  if v_req.patient_id is null or v_req.service_id is null or v_req.preferred_branch_id is null
     or v_req.preferred_professional_id is null or v_req.requested_start is null then
    raise exception using errcode='23514',message='La solicitud no contiene una selección completa.';
  end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=p_tenant_id and id=v_req.service_id and active;
  if not found then raise exception using errcode='P0002',message='El servicio ya no está disponible.'; end if;
  v_ends_at:=v_req.requested_start+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||v_req.preferred_professional_id::text||':'||v_req.requested_start::date::text,0));
  if v_req.preferred_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||v_req.preferred_room_id::text||':'||v_req.requested_start::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(p_tenant_id,p_appointment_id,p_request_id,v_req.service_id,v_req.preferred_branch_id,v_req.preferred_professional_id,v_req.preferred_room_id,v_req.requested_start,v_ends_at);
  update public.smyl_appointment_requests set status='accepted',appointment_id=p_appointment_id,decided_by=p_actor_id,decided_at=clock_timestamp()
  where tenant_id=p_tenant_id and id=p_request_id;
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,room_id,starts_at,ends_at,status,source,notes,created_by,updated_by)
  values(p_appointment_id,p_tenant_id,v_req.preferred_branch_id,v_req.patient_id,v_req.preferred_professional_id,v_req.service_id,v_req.preferred_room_id,v_req.requested_start,v_ends_at,'confirmed','inbox','Elección confirmada por el equipo desde Mensajes.',p_actor_id,p_actor_id);
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data)
  values(p_tenant_id,p_appointment_id,'request_accepted','confirmed',p_actor_id,jsonb_build_object('request_id',p_request_id,'source','inbox'));
  if v_req.requested_start-interval '24 hours'>clock_timestamp() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(p_tenant_id,p_appointment_id,v_req.requested_start-interval '24 hours') on conflict do nothing;
  end if;
  return p_appointment_id;
end;
$$;

revoke all on function public.smyl_inbox_create_appointment_request(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_inbox_create_appointment_request(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) to service_role;

comment on function public.smyl_inbox_available_slots_v2(uuid,uuid,uuid,timestamptz,timestamptz,uuid,uuid,integer)
is 'Canonical dental availability including service buffers, professional, branch, room and active conversational holds.';
comment on column public.smyl_appointment_requests.slot_hold_expires_at
is 'Short-lived hold only. The appointment request remains pending for human review after this timestamp.';

commit;
