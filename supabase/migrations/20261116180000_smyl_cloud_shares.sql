-- SMYL · La Nube, PR 2: compartir un archivo con enlace privado (vence, se revoca y deja bitácora).
-- Requiere la migración de la Nube (20261116170000). El enlace vive solo en la edge function `cloud-share`: aquí se guarda
-- únicamente el HASH del token (nunca el token) y, si el enlace pide código, el hash salado del código.
-- Permiso: cloud.share. Lo clínico además exige que la persona pueda ver el archivo (smyl_cloud_can_see).
begin;

create table if not exists public.smyl_cloud_shares (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  file_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  code_hash text check (code_hash is null or code_hash ~ '^[a-f0-9]{64}$'),
  code_salt text check (code_salt is null or code_salt ~ '^[a-f0-9]{16}$'),
  requires_code boolean generated always as (code_hash is not null) stored,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, file_id) references public.smyl_cloud_files (tenant_id, id) on delete cascade,
  check ((code_hash is null) = (code_salt is null))
);
create index if not exists smyl_cloud_shares_file_idx on public.smyl_cloud_shares (tenant_id, file_id, created_at desc);

create table if not exists public.smyl_cloud_share_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  share_id uuid not null references public.smyl_cloud_shares(id) on delete cascade,
  event text not null check (event in ('created', 'viewed', 'code_failed', 'locked', 'revoked')),
  created_at timestamptz not null default now()
);
create index if not exists smyl_cloud_share_events_share_idx on public.smyl_cloud_share_events (share_id, created_at desc);

alter table public.smyl_cloud_shares enable row level security;
alter table public.smyl_cloud_share_events enable row level security;
revoke all on public.smyl_cloud_shares, public.smyl_cloud_share_events from public, anon, authenticated;
-- La clínica solo lee los datos de seguimiento: nunca los hashes. Todo lo demás lo hace la edge function con la clave de servicio.
grant select (id, tenant_id, file_id, requires_code, expires_at, revoked_at, failed_attempts, view_count, last_viewed_at, created_by, created_at)
  on public.smyl_cloud_shares to authenticated;

create or replace function public.smyl_cloud_can_share(p_file_id uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.share') then return false; end if;
  return exists (
    select 1 from public.smyl_cloud_files f
    where f.tenant_id = v_tenant and f.id = p_file_id and f.status = 'active'
      and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category)
  );
end; $$;
revoke all on function public.smyl_cloud_can_share(uuid) from public, anon;
grant execute on function public.smyl_cloud_can_share(uuid) to authenticated;

drop policy if exists smyl_cloud_shares_read on public.smyl_cloud_shares;
create policy smyl_cloud_shares_read on public.smyl_cloud_shares for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'cloud.share') and public.smyl_cloud_can_share(file_id));

commit;
