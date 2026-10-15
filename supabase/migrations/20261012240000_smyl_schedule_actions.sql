-- SMYL · Etapa 2: acciones atómicas y máquina de estados de agenda.
begin;

create or replace function public.smyl_validate_appointment_slot(
  p_tenant_id uuid, p_appointment_id uuid, p_branch_id uuid, p_professional_id uuid,
  p_room_id uuid, p_starts_at timestamptz, p_ends_at timestamptz
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_timezone text; v_local_start timestamp; v_local_end timestamp; v_weekday integer;
begin
  if p_starts_at >= p_ends_at then raise exception using errcode='22023', message='La hora de término debe ser posterior al inicio.'; end if;
  select b.timezone into v_timezone from public.smyl_branches b where b.tenant_id=p_tenant_id and b.id=p_branch_id and b.active;
  if not found then raise exception using errcode='P0002', message='La sucursal no existe o está inactiva.'; end if;
  v_local_start := p_starts_at at time zone v_timezone;
  v_local_end := p_ends_at at time zone v_timezone;
  v_weekday := extract(dow from v_local_start)::integer;
  if v_local_end::date <> v_local_start::date then raise exception using errcode='22023', message='Una cita no puede cruzar al día siguiente.'; end if;
  if not exists (select 1 from public.smyl_professional_branches pb where pb.tenant_id=p_tenant_id and pb.professional_id=p_professional_id and pb.branch_id=p_branch_id) then
    raise exception using errcode='23514', message='El profesional no está asignado a esa sucursal.';
  end if;
  if p_room_id is not null and not exists (select 1 from public.smyl_rooms r where r.tenant_id=p_tenant_id and r.id=p_room_id and r.branch_id=p_branch_id and r.active) then
    raise exception using errcode='23514', message='El espacio no pertenece a esa sucursal o está inactivo.';
  end if;
  if not exists (select 1 from public.smyl_clinic_hours h where h.tenant_id=p_tenant_id and h.branch_id=p_branch_id and h.weekday=v_weekday and h.active and v_local_start::time >= h.starts_at and v_local_end::time <= h.ends_at) then
    raise exception using errcode='23514', message='La cita está fuera del horario de la clínica.';
  end if;
  if not exists (select 1 from public.smyl_professional_hours h where h.tenant_id=p_tenant_id and h.professional_id=p_professional_id and h.branch_id=p_branch_id and h.weekday=v_weekday and h.active and v_local_start::time >= h.starts_at and v_local_end::time <= h.ends_at) then
    raise exception using errcode='23514', message='La cita está fuera de la disponibilidad del profesional.';
  end if;
  if exists (select 1 from public.smyl_appointments a where a.tenant_id=p_tenant_id and a.professional_id=p_professional_id and a.id<>coalesce(p_appointment_id,'00000000-0000-0000-0000-000000000000')::uuid and a.status in ('confirmed','arrived','in_progress') and p_starts_at<a.ends_at and p_ends_at>a.starts_at) then
    raise exception using errcode='23P01', message='El profesional ya tiene una cita en ese horario.';
  end if;
  if p_room_id is not null and exists (select 1 from public.smyl_appointments a where a.tenant_id=p_tenant_id and a.room_id=p_room_id and a.id<>coalesce(p_appointment_id,'00000000-0000-0000-0000-000000000000')::uuid and a.status in ('confirmed','arrived','in_progress') and p_starts_at<a.ends_at and p_ends_at>a.starts_at) then
    raise exception using errcode='23P01', message='El sillón o consultorio ya está reservado.';
  end if;
  if exists (select 1 from public.smyl_schedule_blocks b where b.tenant_id=p_tenant_id and b.active and (b.professional_id=p_professional_id or (p_room_id is not null and b.room_id=p_room_id)) and p_starts_at<b.ends_at and p_ends_at>b.starts_at) then
    raise exception using errcode='23P01', message='El horario está bloqueado.';
  end if;
end; $$;

create or replace function public.smyl_create_appointment(
  p_id uuid, p_patient_id uuid, p_professional_id uuid, p_service_id uuid,
  p_branch_id uuid, p_room_id uuid, p_starts_at timestamptz, p_notes text default '',
  p_source text default 'manual'
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_duration integer; v_ends timestamptz;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501', message='No tienes permiso para administrar la agenda.'; end if;
  if p_id is null then raise exception using errcode='22023', message='Falta la clave idempotente de la cita.'; end if;
  if exists(select 1 from public.smyl_appointments where tenant_id=v_tenant and id=p_id) then return p_id; end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=v_tenant and id=p_service_id and active;
  if not found then raise exception using errcode='P0002', message='El servicio no existe o está inactivo.'; end if;
  if not exists(select 1 from public.camila_pacientes where tenant_id=v_tenant and id=p_patient_id) then raise exception using errcode='P0002', message='El paciente no existe.'; end if;
  if not exists(select 1 from public.smyl_professionals where tenant_id=v_tenant and id=p_professional_id and active) then raise exception using errcode='P0002', message='El profesional no existe o está inactivo.'; end if;
  if exists(select 1 from public.smyl_professional_services where tenant_id=v_tenant and professional_id=p_professional_id) and not exists(select 1 from public.smyl_professional_services where tenant_id=v_tenant and professional_id=p_professional_id and service_id=p_service_id) then raise exception using errcode='23514', message='El profesional no ofrece ese servicio.'; end if;
  v_ends:=p_starts_at+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_professional_id::text||':'||p_starts_at::date::text,0));
  if p_room_id is not null then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||p_room_id::text||':'||p_starts_at::date::text,0)); end if;
  perform public.smyl_validate_appointment_slot(v_tenant,p_id,p_branch_id,p_professional_id,p_room_id,p_starts_at,v_ends);
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,room_id,starts_at,ends_at,status,source,notes,created_by,updated_by)
  values(p_id,v_tenant,p_branch_id,p_patient_id,p_professional_id,p_service_id,p_room_id,p_starts_at,v_ends,'confirmed',p_source,left(coalesce(p_notes,''),2000),auth.uid(),auth.uid());
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data) values(v_tenant,p_id,'created','confirmed',auth.uid(),jsonb_build_object('source',p_source));
  if p_starts_at - interval '24 hours' > now() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(v_tenant,p_id,p_starts_at-interval '24 hours');
  end if;
  return p_id;
end; $$;

create or replace function public.smyl_reschedule_appointment(p_appointment_id uuid,p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_appointments; v_duration integer; v_ends timestamptz;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_row from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='La cita no existe.'; end if;
  if v_row.updated_at<>p_expected_updated_at then raise exception using errcode='40001',message='La cita cambió en otra sesión. Actualiza la agenda.'; end if;
  if v_row.status not in ('confirmed') then raise exception using errcode='23514',message='Solo se puede reprogramar una cita confirmada.'; end if;
  select duration_minutes into v_duration from public.smyl_services where tenant_id=v_tenant and id=v_row.service_id;
  v_ends:=p_starts_at+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||v_row.professional_id::text||':'||p_starts_at::date::text,0));
  perform public.smyl_validate_appointment_slot(v_tenant,p_appointment_id,p_branch_id,v_row.professional_id,p_room_id,p_starts_at,v_ends);
  update public.smyl_appointments set branch_id=p_branch_id,room_id=p_room_id,starts_at=p_starts_at,ends_at=v_ends,updated_by=auth.uid() where id=p_appointment_id;
  update public.smyl_appointment_reminders set status='cancelled'
    where tenant_id=v_tenant and appointment_id=p_appointment_id and status='pending';
  if p_starts_at - interval '24 hours' > now() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(v_tenant,p_appointment_id,p_starts_at-interval '24 hours') on conflict do nothing;
  end if;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,actor_id,event_data) values(v_tenant,p_appointment_id,'rescheduled',auth.uid(),jsonb_build_object('from',v_row.starts_at,'to',p_starts_at));
end; $$;

create or replace function public.smyl_transition_appointment(p_appointment_id uuid,p_status text,p_reason text,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_appointments; v_allowed boolean:=false;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_row from public.smyl_appointments where tenant_id=v_tenant and id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='La cita no existe.'; end if;
  if v_row.updated_at<>p_expected_updated_at then raise exception using errcode='40001',message='La cita cambió en otra sesión. Actualiza la agenda.'; end if;
  v_allowed := (v_row.status='confirmed' and p_status in ('arrived','no_show','cancelled')) or (v_row.status='arrived' and p_status in ('in_progress','cancelled')) or (v_row.status='in_progress' and p_status in ('completed','cancelled'));
  if not v_allowed then raise exception using errcode='23514',message='Ese cambio de estado no está permitido.'; end if;
  if p_status='cancelled' and char_length(btrim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='Indica el motivo de cancelación.'; end if;
  update public.smyl_appointments set status=p_status,cancellation_reason=case when p_status='cancelled' then left(btrim(p_reason),500) else cancellation_reason end,updated_by=auth.uid() where id=p_appointment_id;
  if p_status in ('cancelled','no_show','completed') then
    update public.smyl_appointment_reminders set status='cancelled'
      where tenant_id=v_tenant and appointment_id=p_appointment_id and status='pending';
  end if;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,from_status,to_status,actor_id,event_data) values(v_tenant,p_appointment_id,case when p_status='cancelled' then 'cancelled' else 'status_changed' end,v_row.status,p_status,auth.uid(),jsonb_build_object('reason',coalesce(p_reason,'')));
end; $$;

create or replace function public.smyl_create_schedule_block(p_branch_id uuid,p_professional_id uuid,p_room_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text,p_block_type text default 'unavailable')
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  if p_professional_id is null and p_room_id is null then raise exception using errcode='22023',message='Selecciona un profesional o espacio.'; end if;
  if p_ends_at<=p_starts_at then raise exception using errcode='22023',message='El bloqueo debe tener una duración válida.'; end if;
  if not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=p_branch_id and active) then raise exception using errcode='P0002',message='La sucursal no existe o está inactiva.'; end if;
  if p_professional_id is not null and not exists(select 1 from public.smyl_professional_branches where tenant_id=v_tenant and professional_id=p_professional_id and branch_id=p_branch_id) then raise exception using errcode='23514',message='El profesional no está asignado a esa sucursal.'; end if;
  if p_room_id is not null and not exists(select 1 from public.smyl_rooms where tenant_id=v_tenant and id=p_room_id and branch_id=p_branch_id and active) then raise exception using errcode='23514',message='El espacio no pertenece a esa sucursal.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':'||coalesce(p_professional_id,p_room_id)::text||':'||p_starts_at::date::text,0));
  if exists(select 1 from public.smyl_appointments a where a.tenant_id=v_tenant and a.status in ('confirmed','arrived','in_progress') and (a.professional_id=p_professional_id or (p_room_id is not null and a.room_id=p_room_id)) and p_starts_at<a.ends_at and p_ends_at>a.starts_at) then raise exception using errcode='23P01',message='Hay una cita activa dentro de ese bloqueo.'; end if;
  if exists(select 1 from public.smyl_schedule_blocks b where b.tenant_id=v_tenant and b.active and (b.professional_id=p_professional_id or (p_room_id is not null and b.room_id=p_room_id)) and p_starts_at<b.ends_at and p_ends_at>b.starts_at) then raise exception using errcode='23P01',message='Ese recurso ya tiene un bloqueo en el horario.'; end if;
  insert into public.smyl_schedule_blocks(tenant_id,branch_id,professional_id,room_id,starts_at,ends_at,reason,block_type,created_by) values(v_tenant,p_branch_id,p_professional_id,p_room_id,p_starts_at,p_ends_at,btrim(p_reason),p_block_type,auth.uid()) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.smyl_accept_appointment_request(p_request_id uuid,p_appointment_id uuid,p_professional_id uuid,p_branch_id uuid,p_room_id uuid,p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_req public.smyl_appointment_requests; v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  select * into v_req from public.smyl_appointment_requests where tenant_id=v_tenant and id=p_request_id for update;
  if not found or v_req.status<>'pending' then raise exception using errcode='23514',message='La solicitud ya fue atendida o no existe.'; end if;
  if v_req.patient_id is null or v_req.service_id is null then raise exception using errcode='23514',message='La solicitud necesita paciente y servicio antes de aceptarse.'; end if;
  v_id:=public.smyl_create_appointment(p_appointment_id,v_req.patient_id,p_professional_id,v_req.service_id,p_branch_id,p_room_id,p_starts_at,'Solicitud revisada por la clínica','assistant_request');
  update public.smyl_appointment_requests set status='accepted',appointment_id=v_id,decided_by=auth.uid(),decided_at=now() where id=p_request_id;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,actor_id,event_data) values(v_tenant,v_id,'request_accepted',auth.uid(),jsonb_build_object('request_id',p_request_id));
  return v_id;
end; $$;

create or replace function public.smyl_reject_appointment_request(p_request_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'schedule.manage') then raise exception using errcode='42501',message='No tienes permiso para administrar la agenda.'; end if;
  update public.smyl_appointment_requests set status='rejected',decided_by=auth.uid(),decided_at=now() where tenant_id=v_tenant and id=p_request_id and status='pending';
  if not found then raise exception using errcode='23514',message='La solicitud ya fue atendida o no existe.'; end if;
end; $$;

revoke all on function public.smyl_validate_appointment_slot(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.smyl_create_appointment(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text) from public,anon;
revoke all on function public.smyl_reschedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon;
revoke all on function public.smyl_transition_appointment(uuid,text,text,timestamptz) from public,anon;
revoke all on function public.smyl_create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text,text) from public,anon;
revoke all on function public.smyl_accept_appointment_request(uuid,uuid,uuid,uuid,uuid,timestamptz) from public,anon;
revoke all on function public.smyl_reject_appointment_request(uuid) from public,anon;
grant execute on function public.smyl_create_appointment(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,text,text), public.smyl_reschedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz), public.smyl_transition_appointment(uuid,text,text,timestamptz), public.smyl_create_schedule_block(uuid,uuid,uuid,timestamptz,timestamptz,text,text), public.smyl_accept_appointment_request(uuid,uuid,uuid,uuid,uuid,timestamptz), public.smyl_reject_appointment_request(uuid) to authenticated;

commit;
