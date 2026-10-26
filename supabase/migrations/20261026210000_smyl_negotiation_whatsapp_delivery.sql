-- SMYL · Transporte WhatsApp para la negociación de citas.
-- LANA conserva el canal; SMYL sólo guarda correlación, estado e idempotencia.

begin;

create table if not exists public.smyl_professional_whatsapp_links (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  lana_conversation_id uuid not null,
  active boolean not null default true,
  linked_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, professional_id),
  unique (tenant_id, lana_conversation_id),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_appointment_negotiation_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  negotiation_id uuid not null,
  proposal_id uuid not null,
  recipient text not null check (recipient in ('professional', 'patient')),
  lana_conversation_id uuid not null,
  template_name text not null check (template_name in (
    'cita_confirmacion_profesional_v1', 'cita_propuesta_paciente_v1'
  )),
  provider_message_id text,
  status text not null default 'pending' check (status in (
    'pending', 'sent', 'delivered', 'failed', 'responded'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  last_error text not null default '',
  idempotency_key uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, proposal_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, negotiation_id)
    references public.smyl_appointment_negotiations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, proposal_id)
    references public.smyl_appointment_negotiation_proposals(tenant_id, id) on delete cascade
);

create unique index if not exists smyl_negotiation_delivery_message_idx
  on public.smyl_appointment_negotiation_deliveries (
    tenant_id, lana_conversation_id, provider_message_id
  ) where provider_message_id is not null;

create table if not exists public.smyl_appointment_negotiation_channel_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  delivery_id uuid not null,
  provider_event_id text not null,
  action text not null check (action in ('confirm', 'change', 'reject', 'accept', 'other', 'clinic')),
  received_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, provider_event_id),
  foreign key (tenant_id, delivery_id)
    references public.smyl_appointment_negotiation_deliveries(tenant_id, id) on delete cascade
);

alter table public.smyl_professional_whatsapp_links enable row level security;
alter table public.smyl_appointment_negotiation_deliveries enable row level security;
alter table public.smyl_appointment_negotiation_channel_events enable row level security;

create policy smyl_professional_whatsapp_links_read
  on public.smyl_professional_whatsapp_links for select to authenticated
  using (
    smyl_professional_whatsapp_links.tenant_id = public.smyl_current_tenant()
    and (
      public.smyl_has_permission(smyl_professional_whatsapp_links.tenant_id, 'schedule.manage')
      or exists (
        select 1 from public.smyl_professionals p
        where p.tenant_id = smyl_professional_whatsapp_links.tenant_id
          and p.id = smyl_professional_whatsapp_links.professional_id
          and p.user_id = auth.uid()
      )
    )
  );
create policy smyl_appointment_negotiation_deliveries_read
  on public.smyl_appointment_negotiation_deliveries for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_negotiation_channel_events_read
  on public.smyl_appointment_negotiation_channel_events for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));

revoke all on public.smyl_professional_whatsapp_links,
  public.smyl_appointment_negotiation_deliveries,
  public.smyl_appointment_negotiation_channel_events from public, anon, authenticated;
grant select on public.smyl_professional_whatsapp_links,
  public.smyl_appointment_negotiation_deliveries,
  public.smyl_appointment_negotiation_channel_events to authenticated;

create or replace function public.smyl_apply_whatsapp_negotiation_response(
  p_tenant_id uuid,
  p_delivery_id uuid,
  p_provider_event_id text,
  p_action text
) returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_delivery public.smyl_appointment_negotiation_deliveries;
  v_negotiation public.smyl_appointment_negotiations;
  v_proposal public.smyl_appointment_negotiation_proposals;
  v_request public.smyl_appointment_requests;
  v_inserted bigint;
  v_due timestamptz;
  v_state text;
begin
  if p_tenant_id is null or p_delivery_id is null
     or nullif(btrim(coalesce(p_provider_event_id, '')), '') is null
     or p_action not in ('confirm', 'change', 'reject', 'accept', 'other', 'clinic') then
    raise exception using errcode = '22023', message = 'Respuesta de WhatsApp no válida.';
  end if;

  select * into v_delivery
  from public.smyl_appointment_negotiation_deliveries
  where tenant_id = p_tenant_id and id = p_delivery_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Entrega no encontrada.'; end if;

  insert into public.smyl_appointment_negotiation_channel_events (
    tenant_id, delivery_id, provider_event_id, action
  ) values (
    p_tenant_id, p_delivery_id, left(btrim(p_provider_event_id), 200), p_action
  ) on conflict (tenant_id, provider_event_id) do nothing returning id into v_inserted;
  if v_inserted is null then
    select n.state into v_state
    from public.smyl_appointment_negotiations n
    where n.tenant_id = p_tenant_id and n.id = v_delivery.negotiation_id;
    return coalesce(v_state, 'ignored');
  end if;

  select * into v_negotiation from public.smyl_appointment_negotiations
  where tenant_id = p_tenant_id and id = v_delivery.negotiation_id for update;
  select * into v_proposal from public.smyl_appointment_negotiation_proposals
  where tenant_id = p_tenant_id and id = v_delivery.proposal_id for update;
  if not found or v_proposal.status <> 'offered' or v_delivery.status = 'responded' then
    return v_negotiation.state;
  end if;

  if v_proposal.hold_expires_at <= clock_timestamp() then
    update public.smyl_appointment_negotiation_proposals
      set status = 'expired', responded_at = clock_timestamp(), response_channel = 'whatsapp'
      where tenant_id = p_tenant_id and id = v_proposal.id;
    update public.smyl_appointment_negotiations
      set state = 'expired', updated_at = clock_timestamp()
      where tenant_id = p_tenant_id and id = v_negotiation.id;
    update public.smyl_appointment_negotiation_deliveries
      set status = 'responded', responded_at = clock_timestamp(), updated_at = clock_timestamp()
      where tenant_id = p_tenant_id and id = v_delivery.id;
    insert into public.smyl_appointment_negotiation_events (
      tenant_id, negotiation_id, event_type, actor_kind, event_data
    ) values (
      p_tenant_id, v_negotiation.id, 'expired', 'system', jsonb_build_object('channel', 'whatsapp')
    );
    return 'expired';
  end if;

  if v_delivery.recipient = 'professional' then
    if p_action not in ('confirm', 'change', 'reject') then
      raise exception using errcode = '22023', message = 'La respuesta no corresponde al profesional.';
    end if;
    if v_negotiation.state <> 'waiting_professional' then return v_negotiation.state; end if;

    if p_action = 'reject' then
      update public.smyl_appointment_negotiation_proposals set status = 'rejected',
        responded_at = clock_timestamp(), response_channel = 'whatsapp'
        where tenant_id = p_tenant_id and id = v_proposal.id;
      update public.smyl_appointment_negotiations set state = 'rejected', updated_at = clock_timestamp()
        where tenant_id = p_tenant_id and id = v_negotiation.id;
      update public.smyl_appointment_requests set status = 'rejected', decided_at = clock_timestamp(),
        slot_hold_expires_at = null where tenant_id = p_tenant_id and id = v_negotiation.request_id;
      insert into public.smyl_appointment_negotiation_events (
        tenant_id, negotiation_id, event_type, actor_kind, event_data
      ) values (p_tenant_id, v_negotiation.id, 'professional_rejected', 'professional', jsonb_build_object('channel', 'whatsapp'));
    elsif p_action = 'change' then
      update public.smyl_appointment_negotiation_proposals set status = 'rejected',
        responded_at = clock_timestamp(), response_channel = 'whatsapp'
        where tenant_id = p_tenant_id and id = v_proposal.id;
      update public.smyl_appointment_negotiations set state = 'needs_attention', updated_at = clock_timestamp()
        where tenant_id = p_tenant_id and id = v_negotiation.id;
      update public.smyl_appointment_requests set slot_hold_expires_at = null
        where tenant_id = p_tenant_id and id = v_negotiation.request_id;
      insert into public.smyl_appointment_negotiation_events (
        tenant_id, negotiation_id, event_type, actor_kind, event_data
      ) values (p_tenant_id, v_negotiation.id, 'professional_changed', 'professional', jsonb_build_object('channel', 'whatsapp', 'requires_slot', true));
    else
      select * into v_request from public.smyl_appointment_requests
        where tenant_id = p_tenant_id and id = v_negotiation.request_id for update;
      perform public.smyl_validate_service_appointment_slot(
        p_tenant_id, null, v_request.id, v_proposal.service_id, v_proposal.branch_id,
        v_proposal.professional_id, v_proposal.room_id, v_proposal.starts_at, v_proposal.ends_at
      );
      v_due := clock_timestamp() + interval '10 minutes';
      update public.smyl_appointment_negotiation_proposals set status = 'accepted',
        responded_at = clock_timestamp(), response_channel = 'whatsapp'
        where tenant_id = p_tenant_id and id = v_proposal.id;
      insert into public.smyl_appointment_negotiation_proposals (
        tenant_id, negotiation_id, round_number, recipient, branch_id, professional_id,
        room_id, service_id, starts_at, ends_at, hold_expires_at
      ) values (
        p_tenant_id, v_negotiation.id, v_negotiation.round_count, 'patient',
        v_proposal.branch_id, v_proposal.professional_id, v_proposal.room_id,
        v_proposal.service_id, v_proposal.starts_at, v_proposal.ends_at, v_due
      );
      update public.smyl_appointment_negotiations set state = 'waiting_patient',
        response_due_at = v_due, updated_at = clock_timestamp()
        where tenant_id = p_tenant_id and id = v_negotiation.id;
      update public.smyl_appointment_requests set slot_hold_expires_at = v_due
        where tenant_id = p_tenant_id and id = v_request.id;
      insert into public.smyl_appointment_negotiation_events (
        tenant_id, negotiation_id, event_type, actor_kind, event_data
      ) values (p_tenant_id, v_negotiation.id, 'professional_confirmed', 'professional', jsonb_build_object('channel', 'whatsapp'));
    end if;
  else
    if p_action not in ('accept', 'other', 'clinic') then
      raise exception using errcode = '22023', message = 'La respuesta no corresponde al paciente.';
    end if;
    if v_negotiation.state <> 'waiting_patient' then return v_negotiation.state; end if;
    update public.smyl_appointment_negotiation_proposals set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
      responded_at = clock_timestamp(), response_channel = 'whatsapp'
      where tenant_id = p_tenant_id and id = v_proposal.id;
    update public.smyl_appointment_negotiations set state = case when p_action = 'accept' then 'ready_to_confirm' else 'needs_attention' end,
      updated_at = clock_timestamp() where tenant_id = p_tenant_id and id = v_negotiation.id;
    insert into public.smyl_appointment_negotiation_events (
      tenant_id, negotiation_id, event_type, actor_kind, event_data
    ) values (
      p_tenant_id, v_negotiation.id,
      case when p_action = 'accept' then 'patient_accepted' else 'patient_requested_options' end,
      'patient', jsonb_build_object('channel', 'whatsapp', 'requested_clinic', p_action = 'clinic')
    );
  end if;

  update public.smyl_appointment_negotiation_deliveries set status = 'responded',
    responded_at = clock_timestamp(), updated_at = clock_timestamp()
    where tenant_id = p_tenant_id and id = v_delivery.id;
  select state into v_state from public.smyl_appointment_negotiations
    where tenant_id = p_tenant_id and id = v_negotiation.id;
  return v_state;
end;
$$;

revoke all on function public.smyl_apply_whatsapp_negotiation_response(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.smyl_apply_whatsapp_negotiation_response(uuid,uuid,text,text)
  to service_role;

comment on table public.smyl_appointment_negotiation_channel_events is
  'Deduplicación de callbacks firmados; no guarda texto, teléfono ni contenido del mensaje.';

commit;
