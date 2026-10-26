-- OAuth de Google Calendar para SMYL.
-- Los secretos permanecen cifrados y sólo son accesibles para Edge Functions
-- con service role. El navegador nunca lee tokens ni verificadores PKCE.

begin;

create table if not exists public.smyl_google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null default 'primary',
  calendar_name text,
  calendar_timezone text,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected','requires_attention')),
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table if not exists public.smyl_google_calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  code_verifier_ciphertext text not null,
  code_verifier_iv text not null,
  return_url text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists smyl_google_calendar_oauth_states_expiry_idx
  on public.smyl_google_calendar_oauth_states(expires_at);

alter table public.smyl_google_calendar_connections enable row level security;
alter table public.smyl_google_calendar_oauth_states enable row level security;

revoke all on table public.smyl_google_calendar_connections from public, anon, authenticated, service_role;
revoke all on table public.smyl_google_calendar_oauth_states from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.smyl_google_calendar_connections to service_role;
grant select, insert, update, delete on table public.smyl_google_calendar_oauth_states to service_role;

comment on table public.smyl_google_calendar_connections is
  'Conexiones OAuth de Google Calendar. Tokens cifrados; acceso exclusivo de Edge Functions.';
comment on table public.smyl_google_calendar_oauth_states is
  'Estados OAuth de un solo uso y verificadores PKCE cifrados.';

commit;

