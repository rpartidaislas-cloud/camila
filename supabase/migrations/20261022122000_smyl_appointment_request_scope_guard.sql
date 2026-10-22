-- SMYL · Autorización por alcance al decidir solicitudes de cita.
-- Una UUID conocida no concede acceso: aceptar y rechazar deben respetar
-- tanto el alcance original de la solicitud como el destino de la nueva cita.

begin;

create or replace function public.smyl_accept_appointment_request(
  p_request_id uuid,
  p_appointment_id uuid,
  p_professional_id uuid,
  p_branch_id uuid,
  p_room_id uuid,
  p_starts_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_request public.smyl_appointment_requests;
  v_appointment_id uuid;
begin
  if v_tenant is null
     or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using
      errcode = '42501',
      message = 'No tienes permiso para administrar la agenda.';
  end if;

  select * into v_request
  from public.smyl_appointment_requests
  where tenant_id = v_tenant and id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception using
      errcode = '23514',
      message = 'La solicitud ya fue atendida o no existe.';
  end if;

  if not public.smyl_can_access_schedule_row(
    v_tenant,
    v_request.preferred_branch_id,
    coalesce(v_request.preferred_professional_id, v_request.professional_id),
    v_request.patient_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'La solicitud queda fuera del alcance de tu rol.';
  end if;

  if v_request.patient_id is null or v_request.service_id is null then
    raise exception using
      errcode = '23514',
      message = 'La solicitud necesita paciente y servicio antes de aceptarse.';
  end if;

  if p_appointment_id is null then
    raise exception using
      errcode = '22023',
      message = 'Falta la clave idempotente de la cita.';
  end if;
  if exists (
    select 1
    from public.smyl_appointments appointment
    where appointment.tenant_id = v_tenant
      and appointment.id = p_appointment_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'La clave de la cita ya está en uso.';
  end if;

  -- Evita trasladar una solicitud visible hacia la agenda de otra sede o
  -- profesional que el actor no administra. El trigger de citas conserva
  -- esta misma defensa, pero se valida aquí antes de mutar la solicitud.
  if not public.smyl_can_access_schedule_row(
    v_tenant,
    p_branch_id,
    p_professional_id,
    v_request.patient_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'La cita propuesta queda fuera del alcance de tu rol.';
  end if;

  v_appointment_id := public.smyl_create_appointment(
    p_appointment_id,
    v_request.patient_id,
    p_professional_id,
    v_request.service_id,
    p_branch_id,
    p_room_id,
    p_starts_at,
    'Solicitud revisada por la clínica',
    'assistant_request'
  );

  update public.smyl_appointment_requests
  set status = 'accepted',
      appointment_id = v_appointment_id,
      decided_by = auth.uid(),
      decided_at = clock_timestamp()
  where tenant_id = v_tenant and id = p_request_id;

  insert into public.smyl_appointment_events(
    tenant_id, appointment_id, event_type, actor_id, event_data
  ) values (
    v_tenant, v_appointment_id, 'request_accepted', auth.uid(),
    jsonb_build_object('request_id', p_request_id)
  );

  return v_appointment_id;
end;
$$;

create or replace function public.smyl_reject_appointment_request(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_request public.smyl_appointment_requests;
begin
  if v_tenant is null
     or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using
      errcode = '42501',
      message = 'No tienes permiso para administrar la agenda.';
  end if;

  select * into v_request
  from public.smyl_appointment_requests
  where tenant_id = v_tenant and id = p_request_id
  for update;

  if not found or v_request.status <> 'pending' then
    raise exception using
      errcode = '23514',
      message = 'La solicitud ya fue atendida o no existe.';
  end if;

  if not public.smyl_can_access_schedule_row(
    v_tenant,
    v_request.preferred_branch_id,
    coalesce(v_request.preferred_professional_id, v_request.professional_id),
    v_request.patient_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'La solicitud queda fuera del alcance de tu rol.';
  end if;

  update public.smyl_appointment_requests
  set status = 'rejected',
      decided_by = auth.uid(),
      decided_at = clock_timestamp()
  where tenant_id = v_tenant and id = p_request_id;
end;
$$;

revoke all on function public.smyl_accept_appointment_request(
  uuid,uuid,uuid,uuid,uuid,timestamptz
) from public, anon;
revoke all on function public.smyl_reject_appointment_request(uuid)
  from public, anon;

grant execute on function public.smyl_accept_appointment_request(
  uuid,uuid,uuid,uuid,uuid,timestamptz
) to authenticated;
grant execute on function public.smyl_reject_appointment_request(uuid)
  to authenticated;

comment on function public.smyl_accept_appointment_request(
  uuid,uuid,uuid,uuid,uuid,timestamptz
) is 'Acepta una solicitud sólo si el actor puede administrar su alcance original y el destino de la cita.';
comment on function public.smyl_reject_appointment_request(uuid)
  is 'Rechaza una solicitud sólo si el actor puede administrar su alcance original.';

commit;
