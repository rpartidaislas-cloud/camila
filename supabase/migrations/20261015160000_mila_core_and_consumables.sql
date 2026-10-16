-- MILA: voz clínica, acciones confirmadas y consumibles.
-- Se integra con el núcleo productivo vigente de SMYL.

begin;
create extension if not exists pgcrypto;
create table public.mila_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  paciente_id uuid,
  modo text not null check (modo in ('transcribe', 'conversa')),
  estado text not null default 'iniciada'
    check (estado in ('iniciada', 'procesando', 'completada', 'error', 'cancelada')),
  idioma text not null default 'es-MX',
  modelo text,
  duracion_segundos integer check (duracion_segundos is null or duracion_segundos >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, paciente_id)
    references public.camila_pacientes(tenant_id, id) on delete set null
);
create table public.mila_recordings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  session_id uuid not null references public.mila_sessions(id) on delete cascade,
  object_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  duracion_segundos integer check (duracion_segundos is null or duracion_segundos >= 0),
  retention_until timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  unique (session_id)
);
create table public.mila_transcripts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  session_id uuid not null references public.mila_sessions(id) on delete cascade,
  texto text not null,
  idioma text,
  duracion_segundos integer,
  segmentos jsonb,
  modelo text,
  created_at timestamptz not null default now(),
  unique (session_id)
);
create table public.mila_clinical_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  session_id uuid not null references public.mila_sessions(id) on delete cascade,
  paciente_id uuid,
  contenido jsonb not null,
  status text not null default 'borrador'
    check (status in ('borrador', 'aprobada', 'descartada')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id),
  foreign key (tenant_id, paciente_id)
    references public.camila_pacientes(tenant_id, id) on delete set null
);
create table public.mila_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.mila_sessions(id) on delete set null,
  action_type text not null check (action_type in ('crear_cita', 'crear_cotizacion')),
  summary text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'executing', 'completed', 'cancelled', 'failed', 'expired')),
  result jsonb,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.mila_tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.mila_sessions(id) on delete set null,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create table public.mila_audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid references public.mila_sessions(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.mila_sessions enable row level security;
alter table public.mila_recordings enable row level security;
alter table public.mila_transcripts enable row level security;
alter table public.mila_clinical_notes enable row level security;
alter table public.mila_confirmations enable row level security;
alter table public.mila_tool_calls enable row level security;
alter table public.mila_audit_log enable row level security;
create policy mila_sessions_select_miembros on public.mila_sessions
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_recordings_select_miembros on public.mila_recordings
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_transcripts_select_miembros on public.mila_transcripts
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_notes_select_miembros on public.mila_clinical_notes
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_confirmations_select_miembros on public.mila_confirmations
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_tool_calls_select_miembros on public.mila_tool_calls
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy mila_audit_select_dueno on public.mila_audit_log
  for select to authenticated using (public.camila_es_dueno(tenant_id));
revoke all on public.mila_sessions, public.mila_recordings, public.mila_transcripts,
  public.mila_clinical_notes, public.mila_confirmations, public.mila_tool_calls,
  public.mila_audit_log from anon, authenticated;
grant select on public.mila_sessions, public.mila_recordings, public.mila_transcripts,
  public.mila_clinical_notes, public.mila_confirmations, public.mila_tool_calls,
  public.mila_audit_log to authenticated;
create index mila_sessions_tenant_fecha_idx on public.mila_sessions (tenant_id, created_at desc);
create index mila_confirmations_pending_idx on public.mila_confirmations (tenant_id, status, expires_at);
create index mila_audit_tenant_fecha_idx on public.mila_audit_log (tenant_id, created_at desc);
-- Verificación explícita porque las Edge Functions operan con service role y
-- nunca deben interpretar esa llave como autorización del dentista.
create function public.mila_actor_has_permission(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_permission text
) returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select
    exists (
      select 1 from public.camila_tenants t
      where t.id = p_tenant_id and t.id = p_actor_id and t.activo
    )
    or exists (
      select 1
      from public.camila_usuarios u
      join public.smyl_member_roles mr
        on mr.tenant_id = u.tenant_id and mr.user_id = u.id
      join public.smyl_roles r
        on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
      join public.smyl_role_permissions rp
        on rp.tenant_id = r.tenant_id and rp.role_id = r.id
      where u.id = p_actor_id
        and u.tenant_id = p_tenant_id
        and u.activo
        and rp.permission_key = p_permission
    );
$$;
revoke all on function public.mila_actor_has_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mila_actor_has_permission(uuid,uuid,text) to service_role;
-- Ejecuta sólo acciones previamente preparadas y confirmadas en pantalla. El
-- bloqueo de fila vuelve idempotentes los dobles toques y reintentos.
create function public.mila_confirm_action(
  p_confirmation_id uuid,
  p_tenant_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_confirmation public.mila_confirmations%rowtype;
  v_entity jsonb;
  v_entity_id uuid;
  v_entity_type text;
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_patient public.camila_pacientes%rowtype;
  v_plan public.smyl_clinical_plans%rowtype;
  v_tenant public.camila_tenants%rowtype;
  v_document jsonb;
  v_items jsonb;
  v_total_cents bigint;
  v_professional_name text;
begin
  select * into v_confirmation
  from public.mila_confirmations
  where id = p_confirmation_id
    and tenant_id = p_tenant_id
    and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No encontré esa confirmación.');
  end if;
  if v_confirmation.status = 'completed' then
    return jsonb_build_object(
      'ok', true,
      'already_completed', true,
      'entity_type', case when v_confirmation.action_type = 'crear_cita' then 'smyl_appointment' else 'smyl_proposal' end,
      'session_id', v_confirmation.session_id,
      'result', v_confirmation.result
    );
  end if;
  if v_confirmation.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'La confirmación ya no está disponible.');
  end if;
  if v_confirmation.expires_at < clock_timestamp() then
    update public.mila_confirmations set status = 'expired', updated_at = clock_timestamp()
      where id = v_confirmation.id;
    return jsonb_build_object('ok', false, 'error', 'La confirmación expiró. Pídele a MILA que prepare la acción nuevamente.');
  end if;

  if v_confirmation.action_type = 'crear_cita' then
    if not public.mila_actor_has_permission(p_tenant_id, p_user_id, 'schedule.manage') then
      return jsonb_build_object('ok', false, 'error', 'No tienes permiso para administrar la agenda.');
    end if;

    select duration_minutes into v_duration
    from public.smyl_services
    where tenant_id = p_tenant_id
      and id = (v_confirmation.payload->>'service_id')::uuid
      and active;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'El servicio ya no está disponible.');
    end if;
    if not exists (
      select 1 from public.camila_pacientes
      where tenant_id = p_tenant_id and id = (v_confirmation.payload->>'patient_id')::uuid
    ) then
      return jsonb_build_object('ok', false, 'error', 'El paciente ya no está disponible.');
    end if;
    if not exists (
      select 1 from public.smyl_professionals
      where tenant_id = p_tenant_id and id = (v_confirmation.payload->>'professional_id')::uuid and active
    ) then
      return jsonb_build_object('ok', false, 'error', 'El profesional ya no está disponible.');
    end if;
    if exists (
      select 1 from public.smyl_professional_services
      where tenant_id = p_tenant_id and professional_id = (v_confirmation.payload->>'professional_id')::uuid
    ) and not exists (
      select 1 from public.smyl_professional_services
      where tenant_id = p_tenant_id
        and professional_id = (v_confirmation.payload->>'professional_id')::uuid
        and service_id = (v_confirmation.payload->>'service_id')::uuid
    ) then
      return jsonb_build_object('ok', false, 'error', 'El profesional no ofrece ese servicio.');
    end if;

    v_entity_id := gen_random_uuid();
    v_start := (v_confirmation.payload->>'starts_at')::timestamptz;
    v_end := v_start + make_interval(mins => v_duration);
    perform pg_advisory_xact_lock(hashtextextended(
      p_tenant_id::text || ':' || (v_confirmation.payload->>'professional_id') || ':' || v_start::date::text, 0
    ));
    perform public.smyl_validate_appointment_slot(
      p_tenant_id,
      v_entity_id,
      (v_confirmation.payload->>'branch_id')::uuid,
      (v_confirmation.payload->>'professional_id')::uuid,
      nullif(v_confirmation.payload->>'room_id', '')::uuid,
      v_start,
      v_end
    );

    insert into public.smyl_appointments(
      id, tenant_id, branch_id, patient_id, professional_id, service_id,
      room_id, starts_at, ends_at, status, source, notes, created_by, updated_by
    ) values (
      v_entity_id,
      p_tenant_id,
      (v_confirmation.payload->>'branch_id')::uuid,
      (v_confirmation.payload->>'patient_id')::uuid,
      (v_confirmation.payload->>'professional_id')::uuid,
      (v_confirmation.payload->>'service_id')::uuid,
      nullif(v_confirmation.payload->>'room_id', '')::uuid,
      v_start,
      v_end,
      'confirmed',
      'assistant_request',
      left(coalesce(v_confirmation.payload->>'notes', ''), 2000),
      p_user_id,
      p_user_id
    );
    insert into public.smyl_appointment_events(
      tenant_id, appointment_id, event_type, to_status, actor_id, event_data
    ) values (
      p_tenant_id, v_entity_id, 'created', 'confirmed', p_user_id,
      jsonb_build_object('source', 'mila', 'confirmation_id', v_confirmation.id)
    );
    if v_start - interval '24 hours' > clock_timestamp() then
      insert into public.smyl_appointment_reminders(tenant_id, appointment_id, scheduled_for)
      values (p_tenant_id, v_entity_id, v_start - interval '24 hours')
      on conflict do nothing;
    end if;
    v_entity := jsonb_build_object(
      'id', v_entity_id, 'starts_at', v_start, 'ends_at', v_end, 'status', 'confirmed'
    );
    v_entity_type := 'smyl_appointment';

  elsif v_confirmation.action_type = 'crear_cotizacion' then
    if not public.mila_actor_has_permission(p_tenant_id, p_user_id, 'proposal.write') then
      return jsonb_build_object('ok', false, 'error', 'No tienes permiso para crear propuestas.');
    end if;

    select * into v_patient from public.camila_pacientes
      where tenant_id = p_tenant_id and id = (v_confirmation.payload->>'patient_id')::uuid;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'El paciente ya no está disponible.');
    end if;
    select * into v_plan from public.smyl_clinical_plans
      where tenant_id = p_tenant_id and patient_id = v_patient.id for update;
    if not found or v_plan.status <> 'reviewed'
       or v_plan.revision <> (v_confirmation.payload->>'plan_revision')::integer
       or v_plan.document->'schema' is distinct from '2'::jsonb then
      return jsonb_build_object('ok', false, 'error', 'El plan clínico debe estar revisado y vigente antes de crear la cotización.');
    end if;

    v_items := v_confirmation.payload->'items';
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 20 then
      return jsonb_build_object('ok', false, 'error', 'La cotización no contiene partidas válidas.');
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_items) item
      where jsonb_typeof(item) <> 'object'
        or coalesce(item->>'id', '') !~ '^[A-Za-z0-9-]{1,80}$'
        or coalesce(item->>'label', '') = ''
        or coalesce(item->>'quantity', '') !~ '^\d{1,3}$'
        or (item->>'quantity')::integer not between 1 and 100
        or coalesce(item->>'unit_cents', '') !~ '^\d{1,9}$'
    ) then
      return jsonb_build_object('ok', false, 'error', 'Una partida de la cotización es inválida.');
    end if;
    select coalesce(sum((item->>'quantity')::bigint * (item->>'unit_cents')::bigint), 0)
      into v_total_cents from jsonb_array_elements(v_items) item;

    select * into v_tenant from public.camila_tenants where id = p_tenant_id;
    select display_name into v_professional_name from public.smyl_professionals
      where tenant_id = p_tenant_id and user_id = p_user_id and active limit 1;
    v_entity_id := gen_random_uuid();
    v_document := jsonb_build_object(
      'schema', 2,
      'title', 'Cotización dental',
      'introduction', 'Borrador preparado por MILA y pendiente de revisión profesional.',
      'terms', '',
      'valid_until', '',
      'items', v_items,
      'photos', null
    );

    insert into public.smyl_proposals(
      id, tenant_id, patient_id, plan_revision, revision, status, document,
      total_cents, patient_name, clinic_name, professional_name,
      updated_by, updated_at, approved_by, approved_at
    ) values (
      v_entity_id,
      p_tenant_id,
      v_patient.id,
      v_plan.revision,
      1,
      'draft',
      v_document,
      v_total_cents,
      btrim(v_patient.nombre || ' ' || v_patient.apellido),
      coalesce(nullif(v_tenant.config->>'consultorio', ''), v_tenant.nombre, 'Clínica dental'),
      coalesce(v_professional_name, nullif(v_tenant.config->>'doctor', ''), 'Equipo clínico'),
      p_user_id,
      clock_timestamp(),
      null,
      null
    );
    insert into public.smyl_proposal_versions(proposal_id, revision, tenant_id, snapshot)
      select id, revision, tenant_id, to_jsonb(p) from public.smyl_proposals p where id = v_entity_id;

    v_entity := jsonb_build_object(
      'id', v_entity_id, 'total_cents', v_total_cents, 'currency', 'MXN', 'status', 'draft'
    );
    v_entity_type := 'smyl_proposal';
  else
    return jsonb_build_object('ok', false, 'error', 'La acción solicitada no está permitida.');
  end if;

  update public.mila_confirmations
    set status = 'completed', result = v_entity, confirmed_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_confirmation.id;

  return jsonb_build_object(
    'ok', true,
    'completed', true,
    'entity_type', v_entity_type,
    'session_id', v_confirmation.session_id,
    'result', v_entity
  );
end;
$$;
revoke all on function public.mila_confirm_action(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mila_confirm_action(uuid,uuid,uuid) to service_role;
create table public.smyl_wallets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  resource text not null check (resource in ('mila_seconds', 'whatsapp_messages', 'ai_credits')),
  balance_units bigint not null default 0 check (balance_units >= 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, resource)
);
create table public.smyl_consumable_products (
  id text primary key,
  resource text not null check (resource in ('mila_seconds', 'whatsapp_messages', 'ai_credits')),
  nombre text not null,
  description text,
  unit_amount bigint not null check (unit_amount > 0),
  price_minor integer check (price_minor is null or price_minor >= 0),
  currency text not null default 'MXN',
  active boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.smyl_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  resource text not null check (resource in ('mila_seconds', 'whatsapp_messages', 'ai_credits')),
  entry_type text not null check (entry_type in ('credit', 'debit', 'meter_only', 'refund', 'adjustment')),
  quantity_units bigint not null check (quantity_units > 0),
  balance_before bigint not null,
  balance_after bigint not null,
  source_type text not null,
  source_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create table public.smyl_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  resource text not null check (resource in ('mila_seconds', 'whatsapp_messages', 'ai_credits')),
  quantity_units bigint not null check (quantity_units > 0),
  provider text,
  provider_model text,
  source_type text not null,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
alter table public.smyl_wallets enable row level security;
alter table public.smyl_consumable_products enable row level security;
alter table public.smyl_usage_ledger enable row level security;
alter table public.smyl_usage_events enable row level security;
create policy smyl_wallets_select_miembros on public.smyl_wallets
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy smyl_products_select_authenticated on public.smyl_consumable_products
  for select to authenticated using (true);
create policy smyl_ledger_select_miembros on public.smyl_usage_ledger
  for select to authenticated using (public.camila_es_miembro(tenant_id));
create policy smyl_usage_select_dueno on public.smyl_usage_events
  for select to authenticated using (public.camila_es_dueno(tenant_id));
revoke all on public.smyl_wallets, public.smyl_consumable_products,
  public.smyl_usage_ledger, public.smyl_usage_events from anon, authenticated;
grant select on public.smyl_wallets, public.smyl_consumable_products,
  public.smyl_usage_ledger, public.smyl_usage_events to authenticated;
create index smyl_ledger_tenant_fecha_idx on public.smyl_usage_ledger (tenant_id, created_at desc);
create index smyl_usage_tenant_fecha_idx on public.smyl_usage_events (tenant_id, occurred_at desc);
insert into public.smyl_consumable_products (
  id, resource, nombre, description, unit_amount, active, sort_order
) values
  ('mila-60', 'mila_seconds', 'MILA · 60 minutos', 'Bolsa compartida entre Transcribe y Conversa.', 3600, false, 10),
  ('mila-300', 'mila_seconds', 'MILA · 300 minutos', 'Paquete para clínicas con uso frecuente.', 18000, false, 20),
  ('whatsapp-1000', 'whatsapp_messages', 'WhatsApp · 1,000 mensajes', 'Mensajes salientes medidos desde SMYL.', 1000, false, 30),
  ('ai-100', 'ai_credits', 'SMYL IA · 100 créditos', 'Créditos para funciones de IA medibles.', 100, false, 40);
create function public.smyl_consume(
  p_tenant_id uuid,
  p_resource text,
  p_quantity_units bigint,
  p_idempotency_key text,
  p_source_type text,
  p_source_id text default null,
  p_provider text default null,
  p_provider_model text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_enforce boolean default false
) returns table (accepted boolean, metered_only boolean, balance_units bigint, ledger_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_wallet public.smyl_wallets%rowtype;
  v_existing public.smyl_usage_ledger%rowtype;
  v_after bigint;
  v_type text;
  v_ledger_id uuid;
begin
  if p_resource not in ('mila_seconds', 'whatsapp_messages', 'ai_credits') then
    raise exception 'Recurso de consumo inválido';
  end if;
  if p_quantity_units is null or p_quantity_units <= 0 then
    raise exception 'La cantidad debe ser positiva';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'Falta idempotency_key';
  end if;

  select * into v_existing from public.smyl_usage_ledger
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return query select true, v_existing.entry_type = 'meter_only', v_existing.balance_after, v_existing.id;
    return;
  end if;

  insert into public.smyl_wallets (tenant_id, resource, balance_units)
    values (p_tenant_id, p_resource, 0) on conflict (tenant_id, resource) do nothing;
  select * into v_wallet from public.smyl_wallets
    where tenant_id = p_tenant_id and resource = p_resource for update;

  if p_enforce and v_wallet.balance_units < p_quantity_units then
    return query select false, false, v_wallet.balance_units, null::uuid;
    return;
  end if;
  if v_wallet.balance_units >= p_quantity_units then
    v_after := v_wallet.balance_units - p_quantity_units;
    v_type := 'debit';
    update public.smyl_wallets set balance_units = v_after, updated_at = clock_timestamp()
      where id = v_wallet.id;
  else
    v_after := v_wallet.balance_units;
    v_type := 'meter_only';
  end if;

  insert into public.smyl_usage_ledger(
    tenant_id, resource, entry_type, quantity_units, balance_before, balance_after,
    source_type, source_id, idempotency_key, metadata
  ) values (
    p_tenant_id, p_resource, v_type, p_quantity_units, v_wallet.balance_units, v_after,
    p_source_type, p_source_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_ledger_id;
  insert into public.smyl_usage_events(
    tenant_id, resource, quantity_units, provider, provider_model, source_type, source_id, metadata
  ) values (
    p_tenant_id, p_resource, p_quantity_units, p_provider, p_provider_model,
    p_source_type, p_source_id, coalesce(p_metadata, '{}'::jsonb)
  );
  return query select true, v_type = 'meter_only', v_after, v_ledger_id;
end;
$$;
revoke all on function public.smyl_consume(uuid,text,bigint,text,text,text,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.smyl_consume(uuid,text,bigint,text,text,text,text,text,jsonb,boolean) to service_role;
create function public.smyl_credit(
  p_tenant_id uuid,
  p_resource text,
  p_quantity_units bigint,
  p_idempotency_key text,
  p_source_type text,
  p_source_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns table (balance_units bigint, ledger_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_wallet public.smyl_wallets%rowtype;
  v_existing public.smyl_usage_ledger%rowtype;
  v_after bigint;
  v_ledger_id uuid;
begin
  if p_resource not in ('mila_seconds', 'whatsapp_messages', 'ai_credits')
     or p_quantity_units is null or p_quantity_units <= 0 then
    raise exception 'Crédito inválido';
  end if;
  select * into v_existing from public.smyl_usage_ledger
    where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing.balance_after, v_existing.id;
    return;
  end if;
  insert into public.smyl_wallets (tenant_id, resource, balance_units)
    values (p_tenant_id, p_resource, 0) on conflict (tenant_id, resource) do nothing;
  select * into v_wallet from public.smyl_wallets
    where tenant_id = p_tenant_id and resource = p_resource for update;
  v_after := v_wallet.balance_units + p_quantity_units;
  update public.smyl_wallets set balance_units = v_after, updated_at = clock_timestamp()
    where id = v_wallet.id;
  insert into public.smyl_usage_ledger(
    tenant_id, resource, entry_type, quantity_units, balance_before, balance_after,
    source_type, source_id, idempotency_key, metadata
  ) values (
    p_tenant_id, p_resource, 'credit', p_quantity_units, v_wallet.balance_units, v_after,
    p_source_type, p_source_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_ledger_id;
  return query select v_after, v_ledger_id;
end;
$$;
revoke all on function public.smyl_credit(uuid,text,bigint,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.smyl_credit(uuid,text,bigint,text,text,text,jsonb) to service_role;
insert into public.smyl_wallets (tenant_id, resource, balance_units)
select t.id, r.resource, 0
from public.camila_tenants t
cross join (values ('mila_seconds'), ('whatsapp_messages'), ('ai_credits')) as r(resource)
on conflict (tenant_id, resource) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mila-audio', 'mila-audio', false, 26214400,
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a']
);
commit;
