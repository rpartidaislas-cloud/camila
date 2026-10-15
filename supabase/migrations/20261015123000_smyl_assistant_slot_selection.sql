-- SMYL · Agenda conversacional: ofertas temporales y elección del paciente.
-- No almacena PII, no confirma citas y sólo service_role puede operar.
begin;

create table if not exists public.smyl_assistant_slot_offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  lana_tenant_id uuid not null,
  lana_conversation_id uuid not null,
  offer_key uuid not null,
  service_id uuid not null,
  slots jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  selected_index smallint,
  request_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, offer_key),
  foreign key (tenant_id, service_id)
    references public.smyl_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, request_id)
    references public.smyl_appointment_requests(tenant_id, id) on delete restrict,
  check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 3),
  check (selected_index is null or selected_index between 1 and 3),
  check (expires_at > created_at)
);

create index if not exists smyl_assistant_slot_offers_active_idx
  on public.smyl_assistant_slot_offers(tenant_id, lana_conversation_id, expires_at desc)
  where selected_index is null;

alter table public.smyl_assistant_slot_offers enable row level security;
revoke all on table public.smyl_assistant_slot_offers from public, anon, authenticated;
grant select, insert, update on table public.smyl_assistant_slot_offers to service_role;

create or replace function public.smyl_assistant_create_appointment_request(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_service_id uuid,
  p_branch_id uuid,
  p_professional_id uuid,
  p_starts_at timestamptz,
  p_external_key uuid
) returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_patient_id uuid;
  v_ends_at timestamptz;
  v_room_id uuid;
  v_request_id uuid;
begin
  if p_tenant_id is null or p_conversation_id is null or p_service_id is null
     or p_branch_id is null or p_professional_id is null or p_starts_at is null
     or p_external_key is null then
    raise exception using errcode='22023',message='La elección de horario está incompleta.';
  end if;

  select id into v_request_id
  from public.smyl_appointment_requests
  where tenant_id=p_tenant_id and source='assistant'
    and external_request_key=p_external_key::text;
  if v_request_id is not null then return v_request_id; end if;

  select h.patient_id into v_patient_id
  from public.camila_lana_handoffs h
  where h.tenant_id=p_tenant_id and h.lana_conversation_id=p_conversation_id;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text||':'||p_professional_id::text||':'||p_starts_at::date::text,0
  ));
  select slot.ends_at,slot.room_id into v_ends_at,v_room_id
  from public.smyl_inbox_available_slots_v2(
    p_tenant_id,p_tenant_id,p_service_id,p_starts_at,
    p_starts_at+interval '1 day',p_branch_id,p_professional_id,30
  ) slot
  where slot.starts_at=p_starts_at and slot.branch_id=p_branch_id
    and slot.professional_id=p_professional_id
  limit 1;
  if v_ends_at is null then
    raise exception using errcode='23P01',message='Ese horario ya no está disponible. Consulta la agenda nuevamente.';
  end if;
  if v_room_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_tenant_id::text||':'||v_room_id::text||':'||p_starts_at::date::text,0
    ));
  end if;
  perform public.smyl_validate_service_appointment_slot(
    p_tenant_id,null,null,p_service_id,p_branch_id,p_professional_id,
    v_room_id,p_starts_at,v_ends_at
  );

  insert into public.smyl_appointment_requests(
    tenant_id,patient_id,service_id,preferred_branch_id,preferred_professional_id,
    preferred_room_id,lana_conversation_id,requested_start,requested_end,
    slot_hold_expires_at,source,external_request_key,patient_message
  ) values(
    p_tenant_id,v_patient_id,p_service_id,p_branch_id,p_professional_id,
    v_room_id,p_conversation_id,p_starts_at,v_ends_at,
    clock_timestamp()+interval '10 minutes','assistant',p_external_key::text,
    'Horario elegido por el paciente en Meta; pendiente de confirmación humana.'
  ) returning id into v_request_id;

  insert into public.smyl_audit_events(
    tenant_id,actor_id,action,entity_type,entity_id,after_data
  ) values(
    p_tenant_id,null,'insert','assistant_appointment_request',v_request_id,
    jsonb_build_object(
      'source','lana_ai_runtime','conversation_id',p_conversation_id,
      'service_id',p_service_id,'branch_id',p_branch_id,
      'professional_id',p_professional_id,'starts_at',p_starts_at,
      'patient_linked',v_patient_id is not null,'appointment_created',false
    )
  );
  return v_request_id;
end;
$$;

revoke all on function public.smyl_assistant_create_appointment_request(
  uuid,uuid,uuid,uuid,uuid,timestamptz,uuid
) from public,anon,authenticated;
grant execute on function public.smyl_assistant_create_appointment_request(
  uuid,uuid,uuid,uuid,uuid,timestamptz,uuid
) to service_role;

create or replace function public.smyl_link_pending_requests_after_handoff()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  update public.smyl_appointment_requests
  set patient_id=new.patient_id,updated_at=clock_timestamp()
  where tenant_id=new.tenant_id
    and lana_conversation_id=new.lana_conversation_id
    and patient_id is null and status='pending';
  return new;
end;
$$;

revoke all on function public.smyl_link_pending_requests_after_handoff()
  from public,anon,authenticated;
drop trigger if exists trg_smyl_link_pending_requests_after_handoff
  on public.camila_lana_handoffs;
create trigger trg_smyl_link_pending_requests_after_handoff
after insert on public.camila_lana_handoffs
for each row execute function public.smyl_link_pending_requests_after_handoff();

comment on table public.smyl_assistant_slot_offers is
  'Temporary, non-PII SMYL slot offers shown by LANA. They never represent an appointment or a hold.';
comment on function public.smyl_assistant_create_appointment_request(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid) is
  'Creates an idempotent pending request after canonical slot revalidation; never creates or confirms an appointment.';

commit;
