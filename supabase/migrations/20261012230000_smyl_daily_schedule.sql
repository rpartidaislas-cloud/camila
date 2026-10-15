-- SMYL · Etapa 2: agenda diaria dental.
-- Servicios, disponibilidad profesional, citas, bloqueos y solicitudes del asistente.

begin;

create table public.smyl_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  category text not null default 'general' check (char_length(category) between 2 and 50),
  duration_minutes integer not null default 60 check (duration_minutes between 10 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  reference_price numeric(12,2) check (reference_price is null or reference_price >= 0),
  color_token text not null default 'teal' check (color_token in ('navy','teal','blue','green','amber','coral','violet','slate')),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create unique index smyl_services_name_idx
  on public.smyl_services(tenant_id, lower(name)) where active;

create table public.smyl_professional_services (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, professional_id, service_id),
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete cascade
);

create table public.smyl_professional_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  branch_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  unique (tenant_id, professional_id, branch_id, weekday, starts_at, ends_at),
  foreign key (tenant_id, professional_id, branch_id)
    references public.smyl_professional_branches(tenant_id, professional_id, branch_id) on delete cascade,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete cascade
);

create index smyl_professional_hours_lookup_idx
  on public.smyl_professional_hours(tenant_id, professional_id, branch_id, weekday) where active;

create table public.smyl_appointments (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  professional_id uuid not null,
  service_id uuid not null,
  room_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed','arrived','in_progress','completed','no_show','cancelled')),
  source text not null default 'manual' check (source in ('manual','assistant_request','inbox','patient_portal')),
  notes text not null default '' check (char_length(notes) <= 2000),
  cancellation_reason text not null default '' check (char_length(cancellation_reason) <= 500),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, room_id) references public.smyl_rooms(tenant_id, id) on delete restrict
);

create index smyl_appointments_calendar_idx on public.smyl_appointments(tenant_id, starts_at, ends_at);
create index smyl_appointments_professional_idx on public.smyl_appointments(tenant_id, professional_id, starts_at);
create index smyl_appointments_patient_idx on public.smyl_appointments(tenant_id, patient_id, starts_at desc);

create table public.smyl_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  branch_id uuid not null,
  professional_id uuid,
  room_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 2 and 200),
  block_type text not null default 'unavailable' check (block_type in ('unavailable','break','meeting','maintenance','personal')),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (professional_id is not null or room_id is not null),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_id) references public.smyl_rooms(tenant_id, id) on delete cascade
);

create index smyl_schedule_blocks_calendar_idx on public.smyl_schedule_blocks(tenant_id, starts_at, ends_at) where active;

-- LANA/SMYL Asistente registra solicitudes, nunca citas confirmadas. La clínica
-- las acepta de forma explícita mediante una RPC que ejecuta todas las mismas validaciones.
create table public.smyl_appointment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid,
  service_id uuid,
  preferred_branch_id uuid,
  requested_start timestamptz,
  requested_end timestamptz,
  source text not null default 'assistant' check (source in ('assistant','inbox','patient_portal','manual')),
  external_request_key text,
  patient_message text not null default '' check (char_length(patient_message) <= 2000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','expired')),
  appointment_id uuid,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete restrict,
  foreign key (tenant_id, preferred_branch_id) references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete restrict
);

create unique index smyl_appointment_requests_external_idx
  on public.smyl_appointment_requests(tenant_id, source, external_request_key)
  where external_request_key is not null;
create index smyl_appointment_requests_pending_idx
  on public.smyl_appointment_requests(tenant_id, created_at) where status = 'pending';

create table public.smyl_appointment_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  event_type text not null check (event_type in ('created','rescheduled','status_changed','cancelled','request_accepted')),
  from_status text,
  to_status text,
  actor_id uuid references auth.users(id) on delete set null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete cascade
);

create index smyl_appointment_events_lookup_idx on public.smyl_appointment_events(tenant_id, appointment_id, created_at);

-- Cola propia de SMYL. El worker de mensajería podrá entregarla después, pero
-- agendar/cancelar nunca depende de que un proveedor externo responda.
create table public.smyl_appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null,
  reminder_type text not null default '24h' check (reminder_type in ('24h','2h','custom')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','cancelled','failed')),
  delivery_channel text not null default 'preferred' check (delivery_channel in ('preferred','whatsapp','messenger','instagram','email','sms')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  provider_reference text,
  last_error text not null default '' check (char_length(last_error) <= 1000),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, appointment_id, reminder_type, scheduled_for),
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete cascade
);
create index smyl_appointment_reminders_pending_idx
  on public.smyl_appointment_reminders(scheduled_for) where status = 'pending';

create or replace function public.smyl_prevent_professional_hour_overlap()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not new.active then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.professional_id::text || ':' || new.branch_id::text || ':' || new.weekday::text, 0));
  if exists (
    select 1 from public.smyl_professional_hours h
    where h.tenant_id = new.tenant_id and h.professional_id = new.professional_id
      and h.branch_id = new.branch_id and h.weekday = new.weekday and h.active
      and h.id <> new.id and new.starts_at < h.ends_at and new.ends_at > h.starts_at
  ) then
    raise exception using errcode = '23P01', message = 'La disponibilidad se traslapa con otro bloque activo.';
  end if;
  return new;
end; $$;

create trigger smyl_professional_hours_no_overlap before insert or update on public.smyl_professional_hours
  for each row execute function public.smyl_prevent_professional_hour_overlap();

do $$
declare v_table text;
begin
  foreach v_table in array array['smyl_services','smyl_professional_hours','smyl_appointments','smyl_schedule_blocks','smyl_appointment_requests','smyl_appointment_reminders'] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.smyl_touch_updated_at()', v_table, v_table);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.smyl_audit_row()', v_table, v_table);
  end loop;
end $$;

alter table public.smyl_services enable row level security;
alter table public.smyl_professional_services enable row level security;
alter table public.smyl_professional_hours enable row level security;
alter table public.smyl_appointments enable row level security;
alter table public.smyl_schedule_blocks enable row level security;
alter table public.smyl_appointment_requests enable row level security;
alter table public.smyl_appointment_events enable row level security;
alter table public.smyl_appointment_reminders enable row level security;

create policy smyl_services_read on public.smyl_services for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_services_manage on public.smyl_services for all to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.manage')) with check (tenant_id = public.smyl_current_tenant() and public.smyl_has_permission(tenant_id, 'schedule.manage'));
create policy smyl_professional_services_read on public.smyl_professional_services for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_professional_services_manage on public.smyl_professional_services for all to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.manage')) with check (tenant_id = public.smyl_current_tenant() and public.smyl_has_permission(tenant_id, 'schedule.manage'));
create policy smyl_professional_hours_read on public.smyl_professional_hours for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_professional_hours_manage on public.smyl_professional_hours for all to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.manage')) with check (tenant_id = public.smyl_current_tenant() and public.smyl_has_permission(tenant_id, 'schedule.manage'));
create policy smyl_appointments_read on public.smyl_appointments for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_schedule_blocks_read on public.smyl_schedule_blocks for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_requests_read on public.smyl_appointment_requests for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_events_read on public.smyl_appointment_events for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));
create policy smyl_appointment_reminders_read on public.smyl_appointment_reminders for select to authenticated using (public.smyl_has_permission(tenant_id, 'schedule.read'));

revoke all on table public.smyl_services, public.smyl_professional_services, public.smyl_professional_hours,
  public.smyl_appointments, public.smyl_schedule_blocks, public.smyl_appointment_requests,
  public.smyl_appointment_events from anon;
revoke all on table public.smyl_appointment_reminders from anon;
grant select on public.smyl_services, public.smyl_professional_services,
  public.smyl_professional_hours, public.smyl_appointments,
  public.smyl_schedule_blocks, public.smyl_appointment_requests,
  public.smyl_appointment_events, public.smyl_appointment_reminders to authenticated;
grant insert, update, delete on public.smyl_services, public.smyl_professional_services, public.smyl_professional_hours to authenticated;

commit;
