-- Meta multi-tenant chat -- database schema template.
--
-- Rename `tenant_id` throughout to match whatever the host project already
-- uses (workspace_id, organization_id, account_id...). Keep it consistent
-- with every other table in that project -- don't introduce a second name
-- for the same concept.

-- Identifiers of the Meta account each tenant connected via Embedded
-- Signup. The System User token is NOT stored here -- it's a single
-- platform-wide secret (an Edge Function env var), not a per-tenant value.
create table public.meta_conexiones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  canal text not null check (canal in ('whatsapp','messenger','instagram')),
  external_id text not null,        -- phone_number_id (whatsapp) / page_id (messenger) / instagram_id
  waba_id text,                     -- whatsapp only
  display_name text,
  connected_at timestamptz default now(),
  unique (canal, external_id)       -- one external_id can only ever belong to one tenant
);

-- Unified inbox: one row per tenant+channel+customer, across all three channels.
create table public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  canal text not null check (canal in ('whatsapp','messenger','instagram')),
  cliente_id text not null,          -- phone number (whatsapp) or PSID/IGSID (messenger/instagram)
  cliente_nombre text,
  ultimo_mensaje text,
  ultimo_mensaje_rol text,           -- 'user' | 'assistant' | 'admin'
  ultimo_mensaje_at timestamptz,
  necesita_asesor boolean default false,   -- AI flagged this conversation as needing a human
  resumen_asesor text,                     -- short summary so the human doesn't have to re-read everything
  pausado boolean default false,           -- a human took over; AI stops auto-replying
  asignado_a uuid references public.usuarios(id),
  created_at timestamptz default now(),
  unique (tenant_id, canal, cliente_id)
);
-- REQUIRED: without this, Realtime's payload.old on an UPDATE only contains
-- the primary key. Any code that compares "old value vs new value" (e.g.
-- "only notify if necesita_asesor just flipped to true, not on every
-- update") will silently see `undefined` for every other column and either
-- never fire or fire on every unrelated update. This bit LANA in production
-- exactly this way -- don't skip it.
alter table public.conversaciones replica identity full;

-- Raw message history.
create table public.mensajes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  conversacion_id uuid not null references public.conversaciones(id),
  rol text not null,                 -- 'user' | 'assistant' | 'admin'
  contenido text,
  media_url text,
  created_at timestamptz default now()
);

-- Dedupe: Meta retries the same webhook delivery if your endpoint is slow
-- to respond. Without this, a retry gets processed as a brand new message
-- (duplicate AI reply, duplicate charge to your AI provider, etc).
create table public.mensajes_procesados (
  message_id text primary key,
  created_at timestamptz default now()
);

-- RLS -- adjust the tenant-resolution subquery to match how the host
-- project already scopes rows to the logged-in user's tenant.
alter table public.meta_conexiones enable row level security;
alter table public.conversaciones enable row level security;
alter table public.mensajes enable row level security;

create policy meta_conexiones_tenant on public.meta_conexiones
  for all using (tenant_id = (select tenant_id from public.usuarios where auth_id = auth.uid()));
create policy conversaciones_tenant on public.conversaciones
  for all using (tenant_id = (select tenant_id from public.usuarios where auth_id = auth.uid()));
create policy mensajes_tenant on public.mensajes
  for all using (tenant_id = (select tenant_id from public.usuarios where auth_id = auth.uid()));

-- Realtime: required for the inbox UI to update live (see references/frontend.md).
alter publication supabase_realtime add table public.conversaciones;
