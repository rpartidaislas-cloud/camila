-- SMYL · Negociación de citas entre profesional y paciente.
-- WhatsApp es un canal; SMYL conserva estado, disponibilidad y confirmación.

begin;

create table if not exists public.smyl_appointment_negotiations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  request_id uuid not null,
  state text not null default 'waiting_professional' check (state in (
    'waiting_professional', 'waiting_patient', 'ready_to_confirm',
    'needs_attention', 'confirmed', 'rejected', 'expired'
  )),
  round_count integer not null default 1 check (round_count between 1 and 3),
  response_due_at timestamptz not null,
  confirmed_appointment_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  unique (tenant_id, request_id),
  foreign key (tenant_id, request_id)
    references public.smyl_appointment_requests(tenant_id, id) on delete cascade,
  foreign key (tenant_id, confirmed_appointment_id)
    references public.smyl_appointments(tenant_id, id) on delete restrict
);

create table if not exists public.smyl_appointment_negotiation_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  negotiation_id uuid not null,
  round_number integer not null check (round_number between 1 and 3),
  recipient text not null check (recipient in ('professional', 'patient')),
  status text not null default 'offered' check (status in (
    'offered', 'accepted', 'rejected', 'replaced', 'expired'
  )),
  branch_id uuid not null,
  professional_id uuid not null,
  room_id uuid,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hold_expires_at timestamptz not null,
  response_channel text check (response_channel in ('smyl', 'whatsapp', 'manual')),
  responded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, id),
  foreign key (tenant_id, negotiation_id)
    references public.smyl_appointment_negotiations(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id)
    references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, room_id)
    references public.smyl_rooms(tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id)
    references public.smyl_services(tenant_id, id) on delete restrict,
  check (starts_at < ends_at)
);

create unique index if not exists smyl_negotiation_one_open_proposal_idx
  on public.smyl_appointment_negotiation_proposals (tenant_id, negotiation_id, recipient)
  where status = 'offered';

create index if not exists smyl_negotiation_queue_idx
  on public.smyl_appointment_negotiations (tenant_id, state, response_due_at);

create table if not exists public.smyl_appointment_negotiation_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  negotiation_id uuid not null,
  event_type text not null check (event_type in (
    'started', 'professional_confirmed', 'professional_changed',
    'professional_rejected', 'patient_accepted', 'patient_requested_options',
    'proposal_reopened', 'confirmed', 'expired', 'escalated'
  )),
  actor_kind text not null check (actor_kind in ('user', 'professional', 'patient', 'system')),
  actor_id uuid references auth.users(id) on delete set null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, negotiation_id)
    references public.smyl_appointment_negotiations(tenant_id, id) on delete cascade
);

alter table public.smyl_appointment_negotiations enable row level security;
alter table public.smyl_appointment_negotiation_proposals enable row level security;
alter table public.smyl_appointment_negotiation_events enable row level security;

create policy smyl_appointment_negotiations_read
  on public.smyl_appointment_negotiations for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_negotiation_proposals_read
  on public.smyl_appointment_negotiation_proposals for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_negotiation_events_read
  on public.smyl_appointment_negotiation_events for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));

revoke all on public.smyl_appointment_negotiations,
  public.smyl_appointment_negotiation_proposals,
  public.smyl_appointment_negotiation_events from public, anon, authenticated;
grant select on public.smyl_appointment_negotiations,
  public.smyl_appointment_negotiation_proposals,
  public.smyl_appointment_negotiation_events to authenticated;

create or replace function public.smyl_negotiation_actor_can_manage(
  p_tenant_id uuid,
  p_professional_id uuid
) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p_tenant_id = public.smyl_current_tenant()
    and (
      public.smyl_has_permission(p_tenant_id, 'schedule.manage')
      or exists (
        select 1 from public.smyl_professionals p
        where p.tenant_id = p_tenant_id and p.id = p_professional_id
          and p.user_id = auth.uid() and p.active
      )
    );
$$;

revoke all on function public.smyl_negotiation_actor_can_manage(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.smyl_start_appointment_negotiation(
  p_request_id uuid,
  p_professional_id uuid,
  p_branch_id uuid,
  p_room_id uuid,
  p_starts_at timestamptz,
  p_hold_minutes integer default 10
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_request public.smyl_appointment_requests;
  v_service public.smyl_services;
  v_negotiation public.smyl_appointment_negotiations;
  v_ends_at timestamptz;
  v_due timestamptz;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para preparar confirmaciones.';
  end if;
  if p_hold_minutes not between 5 and 30 then
    raise exception using errcode = '22023', message = 'La reserva temporal debe durar entre 5 y 30 minutos.';
  end if;

  select * into v_request from public.smyl_appointment_requests
  where tenant_id = v_tenant and id = p_request_id for update;
  if not found or v_request.status <> 'pending' then
    raise exception using errcode = '23514', message = 'La solicitud ya fue atendida o no existe.';
  end if;
  if v_request.patient_id is null or v_request.service_id is null then
    raise exception using errcode = '23514', message = 'La solicitud necesita paciente y servicio.';
  end if;

  select * into v_negotiation from public.smyl_appointment_negotiations
  where tenant_id = v_tenant and request_id = p_request_id for update;
  if found and v_negotiation.state in ('waiting_professional', 'waiting_patient')
      and v_negotiation.response_due_at <= clock_timestamp() then
    update public.smyl_appointment_negotiations
      set state = 'expired', updated_at = clock_timestamp()
      where tenant_id = v_tenant and id = v_negotiation.id;
    update public.smyl_appointment_negotiation_proposals
      set status = 'expired', responded_at = clock_timestamp(), response_channel = 'smyl'
      where tenant_id = v_tenant and negotiation_id = v_negotiation.id and status = 'offered';
    insert into public.smyl_appointment_negotiation_events (
      tenant_id, negotiation_id, event_type, actor_kind, actor_id
    ) values (v_tenant, v_negotiation.id, 'expired', 'system', auth.uid());
    v_negotiation.state := 'expired';
  end if;
  if found and v_negotiation.state not in ('needs_attention', 'expired') then
    return v_negotiation.id;
  end if;
  if found and v_negotiation.round_count >= 3 then
    update public.smyl_appointment_negotiations
      set state = 'needs_attention', updated_at = clock_timestamp()
      where tenant_id = v_tenant and id = v_negotiation.id;
    insert into public.smyl_appointment_negotiation_events (
      tenant_id, negotiation_id, event_type, actor_kind, actor_id,
      event_data
    ) values (
      v_tenant, v_negotiation.id, 'escalated', 'system', auth.uid(),
      jsonb_build_object('reason', 'round_limit', 'round', v_negotiation.round_count)
    );
    raise exception using errcode = '23514', message = 'Se alcanzaron tres propuestas. Continúa la coordinación de forma manual.';
  end if;

  select * into v_service from public.smyl_services
  where tenant_id = v_tenant and id = v_request.service_id and active;
  if not found then raise exception using errcode = 'P0002', message = 'El servicio no está disponible.'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_due := clock_timestamp() + make_interval(mins => p_hold_minutes);

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_professional_id::text || ':' || p_starts_at::date::text, 0));
  perform public.smyl_validate_service_appointment_slot(
    v_tenant, null, p_request_id, v_request.service_id, p_branch_id,
    p_professional_id, p_room_id, p_starts_at, v_ends_at
  );

  if v_negotiation.id is null then
    insert into public.smyl_appointment_negotiations (
      tenant_id, request_id, state, round_count, response_due_at, created_by
    ) values (
      v_tenant, p_request_id, 'waiting_professional', 1, v_due, auth.uid()
    ) returning * into v_negotiation;
  else
    update public.smyl_appointment_negotiations
    set state = 'waiting_professional', round_count = least(round_count + 1, 3),
        response_due_at = v_due, updated_at = clock_timestamp()
    where id = v_negotiation.id and tenant_id = v_tenant
    returning * into v_negotiation;
  end if;

  update public.smyl_appointment_negotiation_proposals
  set status = 'replaced', responded_at = clock_timestamp(), response_channel = 'smyl'
  where tenant_id = v_tenant and negotiation_id = v_negotiation.id and status = 'offered';

  insert into public.smyl_appointment_negotiation_proposals (
    tenant_id, negotiation_id, round_number, recipient, branch_id,
    professional_id, room_id, service_id, starts_at, ends_at,
    hold_expires_at, created_by
  ) values (
    v_tenant, v_negotiation.id, v_negotiation.round_count, 'professional', p_branch_id,
    p_professional_id, p_room_id, v_request.service_id, p_starts_at, v_ends_at,
    v_due, auth.uid()
  );

  update public.smyl_appointment_requests
  set preferred_branch_id = p_branch_id, preferred_professional_id = p_professional_id,
      preferred_room_id = p_room_id, requested_start = p_starts_at,
      requested_end = v_ends_at, slot_hold_expires_at = v_due
  where tenant_id = v_tenant and id = p_request_id;

  insert into public.smyl_appointment_negotiation_events (
    tenant_id, negotiation_id, event_type, actor_kind, actor_id,
    event_data
  ) values (
    v_tenant, v_negotiation.id,
    case when v_negotiation.round_count = 1 then 'started' else 'proposal_reopened' end,
    'user', auth.uid(), jsonb_build_object('round', v_negotiation.round_count)
  );
  return v_negotiation.id;
end;
$$;

create or replace function public.smyl_professional_negotiation_decision(
  p_negotiation_id uuid,
  p_decision text,
  p_branch_id uuid default null,
  p_room_id uuid default null,
  p_starts_at timestamptz default null,
  p_hold_minutes integer default 10
) returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_negotiation public.smyl_appointment_negotiations;
  v_proposal public.smyl_appointment_negotiation_proposals;
  v_request public.smyl_appointment_requests;
  v_service public.smyl_services;
  v_start timestamptz;
  v_end timestamptz;
  v_branch uuid;
  v_room uuid;
  v_due timestamptz;
begin
  select * into v_negotiation from public.smyl_appointment_negotiations
  where tenant_id = v_tenant and id = p_negotiation_id for update;
  if not found or v_negotiation.state <> 'waiting_professional' then
    raise exception using errcode = '23514', message = 'La confirmación profesional ya fue atendida.';
  end if;
  if v_negotiation.response_due_at <= clock_timestamp() then
    raise exception using errcode = '23514', message = 'La propuesta venció. Vuelve a validar el horario.';
  end if;
  select * into v_proposal from public.smyl_appointment_negotiation_proposals
  where tenant_id = v_tenant and negotiation_id = p_negotiation_id
    and recipient = 'professional' and status = 'offered'
  order by created_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0002', message = 'No existe una propuesta profesional activa.'; end if;
  if not public.smyl_negotiation_actor_can_manage(v_tenant, v_proposal.professional_id) then
    raise exception using errcode = '42501', message = 'No puedes responder por este profesional.';
  end if;
  if p_decision not in ('confirm', 'change', 'reject') then
    raise exception using errcode = '22023', message = 'La respuesta profesional no es válida.';
  end if;
  if p_hold_minutes not between 5 and 30 then
    raise exception using errcode = '22023', message = 'La reserva temporal debe durar entre 5 y 30 minutos.';
  end if;

  if p_decision = 'reject' then
    update public.smyl_appointment_negotiation_proposals
      set status = 'rejected', responded_at = clock_timestamp(), response_channel = 'smyl'
      where id = v_proposal.id;
    update public.smyl_appointment_negotiations
      set state = 'rejected', updated_at = clock_timestamp() where id = p_negotiation_id;
    update public.smyl_appointment_requests
      set status = 'rejected', decided_by = auth.uid(), decided_at = clock_timestamp(),
          slot_hold_expires_at = null where tenant_id = v_tenant and id = v_negotiation.request_id;
    insert into public.smyl_appointment_negotiation_events (tenant_id, negotiation_id, event_type, actor_kind, actor_id)
      values (v_tenant, p_negotiation_id, 'professional_rejected', 'professional', auth.uid());
    return 'rejected';
  end if;

  select * into v_request from public.smyl_appointment_requests
    where tenant_id = v_tenant and id = v_negotiation.request_id for update;
  select * into v_service from public.smyl_services
    where tenant_id = v_tenant and id = v_request.service_id and active;
  if not found then
    raise exception using errcode = 'P0002', message = 'El servicio no está disponible.';
  end if;

  v_start := case when p_decision = 'change' then p_starts_at else v_proposal.starts_at end;
  v_branch := case when p_decision = 'change' then p_branch_id else v_proposal.branch_id end;
  v_room := case when p_decision = 'change' then p_room_id else v_proposal.room_id end;
  if v_start is null or v_branch is null then
    raise exception using errcode = '22023', message = 'El nuevo horario está incompleto.';
  end if;
  v_end := v_start + make_interval(mins => v_service.duration_minutes);
  v_due := clock_timestamp() + make_interval(mins => p_hold_minutes);

  perform public.smyl_validate_service_appointment_slot(
    v_tenant, null, v_request.id, v_request.service_id, v_branch,
    v_proposal.professional_id, v_room, v_start, v_end
  );

  update public.smyl_appointment_negotiation_proposals
    set status = 'accepted', responded_at = clock_timestamp(), response_channel = 'smyl'
    where id = v_proposal.id;
  insert into public.smyl_appointment_negotiation_proposals (
    tenant_id, negotiation_id, round_number, recipient, branch_id,
    professional_id, room_id, service_id, starts_at, ends_at,
    hold_expires_at, created_by
  ) values (
    v_tenant, p_negotiation_id, v_negotiation.round_count, 'patient', v_branch,
    v_proposal.professional_id, v_room, v_request.service_id, v_start, v_end,
    v_due, auth.uid()
  );
  update public.smyl_appointment_negotiations
    set state = 'waiting_patient', response_due_at = v_due, updated_at = clock_timestamp()
    where id = p_negotiation_id;
  update public.smyl_appointment_requests
    set preferred_branch_id = v_branch, preferred_professional_id = v_proposal.professional_id,
        preferred_room_id = v_room, requested_start = v_start, requested_end = v_end,
        slot_hold_expires_at = v_due
    where tenant_id = v_tenant and id = v_request.id;
  insert into public.smyl_appointment_negotiation_events (tenant_id, negotiation_id, event_type, actor_kind, actor_id)
    values (v_tenant, p_negotiation_id,
      case when p_decision = 'change' then 'professional_changed' else 'professional_confirmed' end,
      'professional', auth.uid());
  return 'waiting_patient';
end;
$$;

create or replace function public.smyl_patient_negotiation_decision(
  p_negotiation_id uuid,
  p_decision text,
  p_channel text default 'manual'
) returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_negotiation public.smyl_appointment_negotiations;
  v_proposal public.smyl_appointment_negotiation_proposals;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar la respuesta del paciente.';
  end if;
  if p_decision not in ('accept', 'other') or p_channel not in ('smyl', 'whatsapp', 'manual') then
    raise exception using errcode = '22023', message = 'La respuesta del paciente no es válida.';
  end if;
  select * into v_negotiation from public.smyl_appointment_negotiations
    where tenant_id = v_tenant and id = p_negotiation_id for update;
  if not found or v_negotiation.state <> 'waiting_patient' then
    raise exception using errcode = '23514', message = 'La propuesta del paciente ya fue atendida.';
  end if;
  if v_negotiation.response_due_at <= clock_timestamp() then
    raise exception using errcode = '23514', message = 'La propuesta venció. Vuelve a validar el horario.';
  end if;
  select * into v_proposal from public.smyl_appointment_negotiation_proposals
    where tenant_id = v_tenant and negotiation_id = p_negotiation_id
      and recipient = 'patient' and status = 'offered'
    order by created_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0002', message = 'No existe una propuesta activa para el paciente.'; end if;

  update public.smyl_appointment_negotiation_proposals
    set status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
        responded_at = clock_timestamp(), response_channel = p_channel
    where id = v_proposal.id;
  update public.smyl_appointment_negotiations
    set state = case when p_decision = 'accept' then 'ready_to_confirm' else 'needs_attention' end,
        updated_at = clock_timestamp()
    where id = p_negotiation_id;
  insert into public.smyl_appointment_negotiation_events (tenant_id, negotiation_id, event_type, actor_kind, actor_id)
    values (v_tenant, p_negotiation_id,
      case when p_decision = 'accept' then 'patient_accepted' else 'patient_requested_options' end,
      'patient', auth.uid());
  return case when p_decision = 'accept' then 'ready_to_confirm' else 'needs_attention' end;
end;
$$;

create or replace function public.smyl_confirm_appointment_negotiation(
  p_negotiation_id uuid,
  p_appointment_id uuid
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_negotiation public.smyl_appointment_negotiations;
  v_proposal public.smyl_appointment_negotiation_proposals;
  v_appointment uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para confirmar la cita.';
  end if;
  select * into v_negotiation from public.smyl_appointment_negotiations
    where tenant_id = v_tenant and id = p_negotiation_id for update;
  if not found or v_negotiation.state <> 'ready_to_confirm' then
    raise exception using errcode = '23514', message = 'La cita todavía no está lista para confirmarse.';
  end if;
  select * into v_proposal from public.smyl_appointment_negotiation_proposals
    where tenant_id = v_tenant and negotiation_id = p_negotiation_id
      and recipient = 'patient' and status = 'accepted'
    order by responded_at desc nulls last, created_at desc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'No existe una propuesta aceptada.'; end if;

  v_appointment := public.smyl_accept_appointment_request(
    v_negotiation.request_id, p_appointment_id, v_proposal.professional_id,
    v_proposal.branch_id, v_proposal.room_id, v_proposal.starts_at
  );
  update public.smyl_appointment_negotiations
    set state = 'confirmed', confirmed_appointment_id = v_appointment,
        updated_at = clock_timestamp() where id = p_negotiation_id;
  insert into public.smyl_appointment_negotiation_events (tenant_id, negotiation_id, event_type, actor_kind, actor_id)
    values (v_tenant, p_negotiation_id, 'confirmed', 'user', auth.uid());
  return v_appointment;
end;
$$;

revoke all on function public.smyl_start_appointment_negotiation(uuid,uuid,uuid,uuid,timestamptz,integer)
  from public, anon;
revoke all on function public.smyl_professional_negotiation_decision(uuid,text,uuid,uuid,timestamptz,integer)
  from public, anon;
revoke all on function public.smyl_patient_negotiation_decision(uuid,text,text)
  from public, anon;
revoke all on function public.smyl_confirm_appointment_negotiation(uuid,uuid)
  from public, anon;

grant execute on function public.smyl_start_appointment_negotiation(uuid,uuid,uuid,uuid,timestamptz,integer),
  public.smyl_professional_negotiation_decision(uuid,text,uuid,uuid,timestamptz,integer),
  public.smyl_patient_negotiation_decision(uuid,text,text),
  public.smyl_confirm_appointment_negotiation(uuid,uuid) to authenticated;

comment on table public.smyl_appointment_negotiations is
  'Estado canónico de la negociación; WhatsApp y la UI son sólo canales de respuesta.';

commit;
