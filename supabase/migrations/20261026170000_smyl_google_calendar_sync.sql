-- Sincronizacion bidireccional controlada entre la agenda clinica de SMYL y
-- el calendario personal de cada profesional.

begin;

alter table public.smyl_google_calendar_connections
  add column if not exists professional_id uuid,
  add column if not exists sync_token text,
  add column if not exists channel_id text,
  add column if not exists channel_resource_id text,
  add column if not exists channel_token_hash text,
  add column if not exists channel_expires_at timestamptz,
  add column if not exists last_sync_at timestamptz;

alter table public.smyl_google_calendar_oauth_states
  add column if not exists professional_id uuid;

update public.smyl_google_calendar_connections c
set professional_id = p.id
from public.smyl_professionals p
where p.tenant_id = c.tenant_id
  and p.user_id = c.user_id
  and p.active
  and c.professional_id is null;

alter table public.smyl_google_calendar_connections
  drop constraint if exists smyl_google_calendar_connections_professional_fk;
alter table public.smyl_google_calendar_connections
  add constraint smyl_google_calendar_connections_professional_fk
  foreign key (tenant_id, professional_id)
  references public.smyl_professionals(tenant_id, id) on delete cascade;

alter table public.smyl_google_calendar_oauth_states
  drop constraint if exists smyl_google_calendar_oauth_states_professional_fk;
alter table public.smyl_google_calendar_oauth_states
  add constraint smyl_google_calendar_oauth_states_professional_fk
  foreign key (tenant_id, professional_id)
  references public.smyl_professionals(tenant_id, id) on delete cascade;

create unique index if not exists smyl_google_calendar_professional_connection_idx
  on public.smyl_google_calendar_connections(tenant_id, professional_id)
  where professional_id is not null;

create table if not exists public.smyl_google_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  connection_id uuid not null references public.smyl_google_calendar_connections(id) on delete cascade,
  appointment_id uuid not null,
  google_event_id text not null,
  google_etag text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, appointment_id),
  unique (connection_id, google_event_id),
  foreign key (tenant_id, appointment_id)
    references public.smyl_appointments(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_google_calendar_sync_jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  connection_id uuid not null references public.smyl_google_calendar_connections(id) on delete cascade,
  appointment_id uuid not null,
  operation text not null check (operation in ('upsert','delete')),
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_error text not null default '' check (char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, appointment_id),
  foreign key (tenant_id, appointment_id)
    references public.smyl_appointments(tenant_id, id) on delete cascade
);

create index if not exists smyl_google_calendar_sync_jobs_pending_idx
  on public.smyl_google_calendar_sync_jobs(next_attempt_at, id)
  where status in ('pending','failed');

create table if not exists public.smyl_google_calendar_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  connection_id uuid not null references public.smyl_google_calendar_connections(id) on delete cascade,
  professional_id uuid not null,
  appointment_id uuid,
  google_event_id text not null,
  change_type text not null check (change_type in ('reschedule','cancel','create')),
  google_summary text not null default '' check (char_length(google_summary) <= 300),
  proposed_start timestamptz,
  proposed_end timestamptz,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade,
  foreign key (tenant_id, appointment_id)
    references public.smyl_appointments(tenant_id, id) on delete cascade
);

create unique index if not exists smyl_google_calendar_change_pending_idx
  on public.smyl_google_calendar_change_requests(connection_id, google_event_id, change_type)
  where status = 'pending';
create index if not exists smyl_google_calendar_change_tenant_idx
  on public.smyl_google_calendar_change_requests(tenant_id, status, created_at desc);

create or replace function public.smyl_enqueue_google_calendar_appointment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_connection uuid;
begin
  select c.id into v_connection
  from public.smyl_google_calendar_connections c
  where c.tenant_id = new.tenant_id
    and c.professional_id = new.professional_id
    and c.status = 'connected'
  limit 1;

  if v_connection is null then return new; end if;

  insert into public.smyl_google_calendar_sync_jobs(
    tenant_id, connection_id, appointment_id, operation, status,
    attempts, next_attempt_at, last_error, updated_at
  ) values (
    new.tenant_id, v_connection, new.id,
    case when new.status = 'cancelled' then 'delete' else 'upsert' end,
    'pending', 0, now(), '', now()
  )
  on conflict (connection_id, appointment_id) do update set
    operation = excluded.operation,
    status = 'pending',
    attempts = 0,
    next_attempt_at = now(),
    last_error = '',
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists smyl_appointments_google_calendar_queue on public.smyl_appointments;
create trigger smyl_appointments_google_calendar_queue
after insert or update of starts_at, ends_at, status, branch_id, professional_id, service_id
on public.smyl_appointments
for each row execute function public.smyl_enqueue_google_calendar_appointment();

alter table public.smyl_google_calendar_event_links enable row level security;
alter table public.smyl_google_calendar_sync_jobs enable row level security;
alter table public.smyl_google_calendar_change_requests enable row level security;

revoke all on table public.smyl_google_calendar_event_links from public, anon, authenticated, service_role;
revoke all on table public.smyl_google_calendar_sync_jobs from public, anon, authenticated, service_role;
revoke all on table public.smyl_google_calendar_change_requests from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.smyl_google_calendar_event_links to service_role;
grant select, insert, update, delete on table public.smyl_google_calendar_sync_jobs to service_role;
grant select, insert, update, delete on table public.smyl_google_calendar_change_requests to service_role;
grant usage, select on sequence public.smyl_google_calendar_sync_jobs_id_seq to service_role;

revoke all on function public.smyl_enqueue_google_calendar_appointment() from public, anon, authenticated;

comment on table public.smyl_google_calendar_change_requests is
  'Cambios recibidos desde Google que requieren una decision humana antes de alterar la agenda clinica.';

commit;
