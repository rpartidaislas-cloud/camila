-- SMYL · Corrige «Confirmar cita» del chat: la solicitud no se podía confirmar.
--
-- Qué fallaba: smyl_inbox_confirm_appointment_request (versión de integridad v2) marcaba la solicitud como aceptada y le ponía
-- appointment_id ANTES de insertar la cita. smyl_appointment_requests.appointment_id tiene una llave foránea a smyl_appointments
-- que no es diferible, así que la base respondía «violates foreign key constraint
-- smyl_appointment_requests_tenant_id_appointment_id_fkey» y la cita nunca se creaba. (La versión anterior sí insertaba primero.)
-- Qué cambia: solo el ORDEN: primero se inserta la cita y después se actualiza la solicitud. Mismas validaciones, mismos permisos.
--
-- Aplicar en Supabase → SQL Editor. Es idempotente (create or replace).

begin;

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
  insert into public.smyl_appointments(id,tenant_id,branch_id,patient_id,professional_id,service_id,room_id,starts_at,ends_at,status,source,notes,created_by,updated_by)
  values(p_appointment_id,p_tenant_id,v_req.preferred_branch_id,v_req.patient_id,v_req.preferred_professional_id,v_req.service_id,v_req.preferred_room_id,v_req.requested_start,v_ends_at,'confirmed','inbox','Elección confirmada por el equipo desde Mensajes.',p_actor_id,p_actor_id);
  update public.smyl_appointment_requests set status='accepted',appointment_id=p_appointment_id,decided_by=p_actor_id,decided_at=clock_timestamp()
  where tenant_id=p_tenant_id and id=p_request_id;
  insert into public.smyl_appointment_events(tenant_id,appointment_id,event_type,to_status,actor_id,event_data)
  values(p_tenant_id,p_appointment_id,'request_accepted','confirmed',p_actor_id,jsonb_build_object('request_id',p_request_id,'source','inbox'));
  if v_req.requested_start-interval '24 hours'>clock_timestamp() then
    insert into public.smyl_appointment_reminders(tenant_id,appointment_id,scheduled_for)
    values(p_tenant_id,p_appointment_id,v_req.requested_start-interval '24 hours') on conflict do nothing;
  end if;
  return p_appointment_id;
end;
$$;

revoke all on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.smyl_inbox_confirm_appointment_request(uuid,uuid,uuid,uuid) to service_role;

commit;
