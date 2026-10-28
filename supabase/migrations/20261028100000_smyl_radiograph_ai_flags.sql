-- SMYL radiografía asistida — Etapa 0: banderas cerradas por defecto y registro de motores.
-- Todo queda apagado al aplicar. Ningún frontend puede encender una bandera ni leer la
-- configuración de un motor: sólo service_role (consola / Edge Function) escribe aquí.
-- Idempotente: se puede volver a ejecutar sin cambiar nada.
begin;

create table if not exists public.smyl_radiograph_feature_flags (
  key text primary key check (key in (
    'radiograph.qc_v2','radiograph.tooth_ai_v1','radiograph.report_v1',
    'radiograph.longitudinal_v1','radiograph.cbct_v1'
  )),
  enabled boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.smyl_radiograph_feature_flags(key) values
  ('radiograph.qc_v2'),('radiograph.tooth_ai_v1'),('radiograph.report_v1'),
  ('radiograph.longitudinal_v1'),('radiograph.cbct_v1')
on conflict (key) do nothing;

-- Piloto por clínica: una bandera global apagada puede encenderse para un tenant concreto.
create table if not exists public.smyl_radiograph_flag_tenants (
  key text not null references public.smyl_radiograph_feature_flags(key) on delete cascade,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (key, tenant_id)
);

-- Registro de motores permitidos. Nunca guarda credenciales: el CHECK rechaza llaves típicas
-- de secretos; las credenciales viven en los secretos de la Edge Function.
create table if not exists public.smyl_radiograph_engines (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('qc','tooth_localization','finding_candidates')),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9._-]{1,59}$'),
  name text not null check (name ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$'),
  version text not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  contract_version integer not null check (contract_version > 0),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config) = 'object' and octet_length(config::text) <= 8192
    and not (config ?| array['apiKey','api_key','secret','token','authorization','password','credential'])
  ),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, provider, name, version)
);
-- Interruptor global: como máximo un motor activo por tipo de análisis.
create unique index if not exists smyl_radiograph_engines_one_active_idx
  on public.smyl_radiograph_engines(kind) where enabled;

alter table public.smyl_radiograph_feature_flags enable row level security;
alter table public.smyl_radiograph_flag_tenants enable row level security;
alter table public.smyl_radiograph_engines enable row level security;
revoke all on public.smyl_radiograph_feature_flags, public.smyl_radiograph_flag_tenants,
  public.smyl_radiograph_engines from public, anon, authenticated;
-- Sin políticas ni grants: sólo service_role lee/escribe. Las lecturas del navegador pasan
-- por las funciones de abajo, que exponen únicamente booleanos.

create or replace function public.smyl_radiograph_flag_enabled(p_key text, p_tenant uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select f.enabled or coalesce((
      select t.enabled from public.smyl_radiograph_flag_tenants t
      where t.key = f.key and t.tenant_id = p_tenant
    ), false)
    from public.smyl_radiograph_feature_flags f where f.key = p_key
  ), false);
$$;
revoke all on function public.smyl_radiograph_flag_enabled(text, uuid) from public, anon;
grant execute on function public.smyl_radiograph_flag_enabled(text, uuid) to authenticated;

-- Motor activo para un tipo de análisis. Sólo servidor: devuelve id y versión, nunca config.
create or replace function public.smyl_radiograph_active_engine(p_kind text)
returns table (id uuid, provider text, name text, version text, contract_version integer)
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.id, e.provider, e.name, e.version, e.contract_version
  from public.smyl_radiograph_engines e where e.kind = p_kind and e.enabled limit 1;
$$;
revoke all on function public.smyl_radiograph_active_engine(text) from public, anon, authenticated;

-- Lo único que ve el navegador: qué banderas aplican a su clínica. Sin motores ni versiones.
create or replace function public.smyl_radiograph_ai_capabilities()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  return jsonb_build_object(
    'schema', 1,
    'tenant_id', v_tenant,
    'clinicalRead', v_tenant is not null and public.smyl_has_permission(v_tenant, 'clinical.read'),
    'clinicalWrite', v_tenant is not null and public.smyl_has_permission(v_tenant, 'clinical.write'),
    'clinicalApprove', v_tenant is not null and public.smyl_has_permission(v_tenant, 'clinical.approve'),
    'flags', jsonb_build_object(
      'radiograph.qc_v2', public.smyl_radiograph_flag_enabled('radiograph.qc_v2', v_tenant),
      'radiograph.tooth_ai_v1', public.smyl_radiograph_flag_enabled('radiograph.tooth_ai_v1', v_tenant),
      'radiograph.report_v1', public.smyl_radiograph_flag_enabled('radiograph.report_v1', v_tenant),
      'radiograph.longitudinal_v1', public.smyl_radiograph_flag_enabled('radiograph.longitudinal_v1', v_tenant),
      'radiograph.cbct_v1', public.smyl_radiograph_flag_enabled('radiograph.cbct_v1', v_tenant)
    )
  );
end;
$$;
revoke all on function public.smyl_radiograph_ai_capabilities() from public, anon;
grant execute on function public.smyl_radiograph_ai_capabilities() to authenticated;

comment on table public.smyl_radiograph_feature_flags is 'Banderas del flujo radiográfico asistido. Apagadas por defecto; sólo service_role las cambia.';
comment on table public.smyl_radiograph_engines is 'Proveedor/modelo/versión permitidos por tipo de análisis. Nunca guarda credenciales.';
commit;
