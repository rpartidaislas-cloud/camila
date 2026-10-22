-- Tiempo adicional por cita: el dentista puede pedir más tiempo que el estándar del tratamiento.
-- La duración base sigue viniendo del servicio; extra_minutes se suma y queda guardado aparte
-- para poder medir qué tratamientos suelen necesitar más tiempo.
begin;

alter table public.smyl_appointments
  add column if not exists extra_minutes integer not null default 0,
  add column if not exists extra_reason text not null default '';
alter table public.smyl_appointments drop constraint if exists smyl_appointments_extra_minutes_check;
alter table public.smyl_appointments add constraint smyl_appointments_extra_minutes_check
  check (extra_minutes between 0 and 240 and extra_minutes%15=0);
alter table public.smyl_appointments drop constraint if exists smyl_appointments_extra_reason_check;
alter table public.smyl_appointments add constraint smyl_appointments_extra_reason_check
  check (char_length(extra_reason)<=200);

alter table public.smyl_appointment_events drop constraint if exists smyl_appointment_events_event_type_check;
alter table public.smyl_appointment_events add constraint smyl_appointment_events_event_type_check
  check (event_type in ('created','rescheduled','status_changed','cancelled','request_accepted','extra_time_changed'));

drop function if exists public.smyl_validate_service_appointment_slot(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz);
drop function if exists public.smyl_create_appointment(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text);

create or replace function public.smyl_validate_service_appointment_slot(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_request_id uuid,
  p_service_id uuid,
  p_branch_id uuid,
  p_professional_id uuid,
  p_room_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_extra_minutes integer default 0
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
  if coalesce(p_extra_minutes,0)<0 or p_extra_minutes>240 or p_extra_minutes%15<>0 then
    raise exception using errcode='22023',message='El tiempo adicional debe ser de 0 a 240 minutos, en bloques de 15.';
  end if;
  if p_ends_at<>p_starts_at+make_interval(mins=>v_duration+coalesce(p_extra_minutes,0)) then
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
revoke all on function public.smyl_validate_service_appointment_slot(uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,integer)
  from public,anon,authenticated;

create or replace function public.smyl_create_appointment(
  p_id uuid,p_patient_id uuid,p_professional_id uuid,p_service_id uuid,
  p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz,p_notes text default '',
  p_source text default 'manual',p_extra_minutes integer default 0,p_extra_reason text default ''
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_duration integer; v_ends timestamptz; v_extra integer:=coalesce(p_extra_minutes,0);
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
  v_ends:=p_starts_at+make_interval(mins=>v_duration+v_extra);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_professional_id::text||':'||p_starts_at::date::text,0));
  if p_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(v_tenant,p_id,null,p_service_id,p_branch_id,p_professional_id,p_room_id,p_starts_at,v_ends,v_extra);
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,room_id,starts_at,ends_at,status,source,notes,extra_minutes,extra_reason,created_by,updated_by)
  values(p_id,v_tenant,p_branch_id,p_patient_id,p_professional_id,p_service_id,p_room_id,p_starts_at,v_ends,'confirmed',p_source,left(coalesce(p_notes,''),2000),v_extra,left(coalesce(p_extra_reason,''),200),auth.uid(),auth.uid());
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data)
  values(v_tenant,p_id,'created','confirmed',auth.uid(),jsonb_build_object('source',p_source,'extra_minutes',v_extra));
  if p_starts_at-interval '24 hours'>now() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(v_tenant,p_id,p_starts_at-interval '24 hours');
  end if;
  return p_id;
end;
$$;

-- La reprogramación conserva el tiempo adicional que ya tenía la cita.
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
  v_ends:=p_starts_at+make_interval(mins=>v_duration+v_row.extra_minutes);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||v_row.professional_id::text||':'||p_starts_at::date::text,0));
  if p_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(v_tenant,p_appointment_id,null,v_row.service_id,p_branch_id,v_row.professional_id,p_room_id,p_starts_at,v_ends,v_row.extra_minutes);
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

-- Ampliar o reducir el tiempo adicional de una cita ya agendada (0 a 240 min, bloques de 15).
create or replace function public.smyl_set_appointment_extra(
  p_appointment_id uuid,p_extra_minutes integer,p_extra_reason text,p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_appointments; v_duration integer; v_ends timestamptz; v_extra integer:=coalesce(p_extra_minutes,0);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_row from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='La cita no existe.'; end if;
  if v_row.updated_at<>p_expected_updated_at then raise exception using errcode='40001',message='La cita cambió en otra sesión. Actualiza la agenda.'; end if;
  if v_row.status not in ('confirmed','arrived','in_progress') then raise exception using errcode='23514',message='Solo se puede cambiar el tiempo de una cita vigente.'; end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=v_tenant and id=v_row.service_id;
  if not found then raise exception using errcode='P0002',message='El servicio ya no está disponible.'; end if;
  v_ends:=v_row.starts_at+make_interval(mins=>v_duration+v_extra);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||v_row.professional_id::text||':'||v_row.starts_at::date::text,0));
  if v_row.room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||v_row.room_id::text||':'||v_row.starts_at::date::text,0)); end if;
  perform public.smyl_validate_service_appointment_slot(v_tenant,p_appointment_id,null,v_row.service_id,v_row.branch_id,v_row.professional_id,v_row.room_id,v_row.starts_at,v_ends,v_extra);
  update public.smyl_appointments set ends_at=v_ends,extra_minutes=v_extra,extra_reason=left(coalesce(p_extra_reason,''),200),updated_by=auth.uid() where tenant_id=v_tenant and id=p_appointment_id;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,actor_id,event_data)
  values(v_tenant,p_appointment_id,'extra_time_changed',auth.uid(),jsonb_build_object('from',v_row.extra_minutes,'to',v_extra));
end;
$$;

revoke all on function public.smyl_create_appointment(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,integer,text) from public,anon;
revoke all on function public.smyl_set_appointment_extra(uuid,integer,text,timestamptz) from public,anon;
grant execute on function public.smyl_create_appointment(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,integer,text),
  public.smyl_set_appointment_extra(uuid,integer,text,timestamptz) to authenticated;

commit;
