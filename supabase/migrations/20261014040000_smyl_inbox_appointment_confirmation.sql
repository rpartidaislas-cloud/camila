-- SMYL · Agenda conversacional, etapa 3: solicitud y confirmación humana.
begin;

alter table public.smyl_appointment_requests
  add column if not exists preferred_professional_id uuid,
  add column if not exists lana_conversation_id uuid;

alter table public.smyl_appointment_requests
  drop constraint if exists smyl_appointment_requests_preferred_professional_fk;
alter table public.smyl_appointment_requests
  add constraint smyl_appointment_requests_preferred_professional_fk
  foreign key (tenant_id, preferred_professional_id)
  references public.smyl_professionals(tenant_id, id) on delete restrict;

create index if not exists smyl_appointment_requests_conversation_idx
  on public.smyl_appointment_requests(tenant_id, lana_conversation_id, created_at desc);

create or replace function public.smyl_inbox_create_appointment_request(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_conversation_id uuid,
  p_service_id uuid,
  p_branch_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_external_key uuid
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_patient_id uuid; v_ends_at timestamptz; v_request_id uuid;
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

  select h.patient_id into v_patient_id
  from public.camila_lana_handoffs h
  where h.tenant_id=p_tenant_id and h.lana_conversation_id=p_conversation_id;
  if v_patient_id is null then raise exception using errcode='23514',message='Vincula un paciente antes de registrar su elección.'; end if;

  select slot.ends_at into v_ends_at
  from public.smyl_inbox_available_slots(p_tenant_id,p_actor_id,p_service_id,p_starts_at,p_starts_at+interval '1 day',p_branch_id,p_professional_id,30) slot
  where slot.starts_at=p_starts_at and slot.branch_id=p_branch_id and slot.professional_id=p_professional_id
  limit 1;
  if v_ends_at is null then raise exception using errcode='23P01',message='Ese horario ya no está disponible. Consulta la agenda nuevamente.'; end if;

  insert into public.smyl_appointment_requests(
    tenant_id,patient_id,service_id,preferred_branch_id,preferred_professional_id,
    lana_conversation_id,requested_start,requested_end,source,external_request_key,patient_message
  ) values(
    p_tenant_id,v_patient_id,p_service_id,p_branch_id,p_professional_id,
    p_conversation_id,p_starts_at,v_ends_at,'inbox',p_external_key::text,'Horario elegido en conversación; pendiente de confirmación humana.'
  ) on conflict (tenant_id,source,external_request_key) where external_request_key is not null
    do nothing returning id into v_request_id;
  if v_request_id is null then
    select id into v_request_id from public.smyl_appointment_requests
    where tenant_id=p_tenant_id and source='inbox' and external_request_key=p_external_key::text;
  end if;
  return v_request_id;
end; $$;

create or replace function public.smyl_inbox_confirm_appointment_request(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_appointment_id uuid
) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
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

  select * into v_req from public.smyl_appointment_requests
  where tenant_id=p_tenant_id and id=p_request_id for update;
  if not found or v_req.status<>'pending' then raise exception using errcode='23514',message='La solicitud ya fue atendida o no existe.'; end if;
  if v_req.patient_id is null or v_req.service_id is null or v_req.preferred_branch_id is null
     or v_req.preferred_professional_id is null or v_req.requested_start is null then
    raise exception using errcode='23514',message='La solicitud no contiene una selección completa.';
  end if;
  select duration_minutes into v_duration from public.smyl_services
  where tenant_id=p_tenant_id and id=v_req.service_id and active;
  if not found then raise exception using errcode='P0002',message='El servicio ya no está disponible.'; end if;
  v_ends_at:=v_req.requested_start+make_interval(mins=>v_duration);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||v_req.preferred_professional_id::text||':'||v_req.requested_start::date::text,0));
  perform public.smyl_validate_appointment_slot(p_tenant_id,p_appointment_id,v_req.preferred_branch_id,v_req.preferred_professional_id,null,v_req.requested_start,v_ends_at);
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,notes,created_by,updated_by)
  values(p_appointment_id,p_tenant_id,v_req.preferred_branch_id,v_req.patient_id,v_req.preferred_professional_id,v_req.service_id,v_req.requested_start,v_ends_at,'confirmed','inbox','Elección confirmada por el equipo desde Mensajes.',p_actor_id,p_actor_id);
  update public.smyl_appointment_requests set status='accepted',appointment_id=p_appointment_id,decided_by=p_actor_id,decided_at=clock_timestamp()
  where tenant_id=p_tenant_id and id=p_request_id;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data)
  values(p_tenant_id,p_appointment_id,'request_accepted','confirmed',p_actor_id,jsonb_build_object('request_id',p_request_id,'source','inbox'));
  if v_req.requested_start-interval '24 hours'>clock_timestamp() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(p_tenant_id,p_appointment_id,v_req.requested_start-interval '24 hours') on conflict do nothing;
  end if;
  return p_appointment_id;
end; $$;

revoke all on function public.smyl_inbox_create_appointment_request(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_inbox_create_appointment_request(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) to service_role;

comment on function public.smyl_inbox_create_appointment_request(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,uuid)
is 'Records a patient slot choice from the SMYL Inbox after server-side revalidation; it does not create an appointment.';
comment on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid)
is 'Confirms a pending Inbox request atomically after explicit human action and final canonical slot validation.';

commit;
