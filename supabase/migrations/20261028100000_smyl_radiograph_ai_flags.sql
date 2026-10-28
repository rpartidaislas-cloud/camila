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
-- `enabled` = piloto concedido por la plataforma (sólo service_role). `paused` = pausa de la propia
-- clínica (smyl_radiograph_set_tenant_flag). Efectivo = (global OR piloto) AND NOT pausada, y además
-- cada bandera exige las de las que depende (tooth_ai→qc, report→tooth_ai, longitudinal→qc).
create table if not exists public.smyl_radiograph_flag_tenants (
  key text not null references public.smyl_radiograph_feature_flags(key) on delete cascade,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  enabled boolean not null default false,
  paused boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (key, tenant_id)
);
alter table public.smyl_radiograph_flag_tenants add column if not exists paused boolean not null default false;
drop trigger if exists smyl_radiograph_flag_tenants_audit on public.smyl_radiograph_flag_tenants;
create trigger smyl_radiograph_flag_tenants_audit after insert or update or delete on public.smyl_radiograph_flag_tenants
  for each row execute function public.smyl_audit_row();

-- Ajustes de plataforma (sólo service_role): topes y permisos que ninguna clínica puede cambiar.
create table if not exists public.smyl_radiograph_settings (
  key text primary key check (key in ('allow_simulated','daily_run_cap','validation_min_sources','validation_min_annotators','failed_retry_cap')),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.smyl_radiograph_settings(key, value) values
  ('allow_simulated', 'false'::jsonb), ('daily_run_cap', '500'::jsonb),
  ('validation_min_sources', '30'::jsonb), ('validation_min_annotators', '2'::jsonb), ('failed_retry_cap', '3'::jsonb)
on conflict (key) do nothing;
create or replace function public.smyl_radiograph_setting(p_key text) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select value from public.smyl_radiograph_settings where key = p_key $$;
revoke all on function public.smyl_radiograph_setting(text) from public, anon, authenticated;

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
    and config::text !~* '"[^"]*(api[_-]?key|secret|token|authori[sz]ation|password|credential)[^"]*"\s*:'
  ),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, provider, name, version)
);
-- Un motor simulado genera geometría sintética, no anatomía: sólo puede activarse si la plataforma lo
-- permite de forma explícita (entorno de demostración). El valor por defecto es 'false'.
create or replace function public.smyl_radiograph_guard_engine()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.enabled and new.provider = 'simulated' and coalesce(public.smyl_radiograph_setting('allow_simulated'), 'false'::jsonb) is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'Un motor simulado no puede activarse: la plataforma no lo permite (entorno de demostración).';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists smyl_radiograph_engines_guard on public.smyl_radiograph_engines;
create trigger smyl_radiograph_engines_guard before insert or update on public.smyl_radiograph_engines
  for each row execute function public.smyl_radiograph_guard_engine();
-- Interruptor global: como máximo un motor activo por tipo de análisis.
create unique index if not exists smyl_radiograph_engines_one_active_idx
  on public.smyl_radiograph_engines(kind) where enabled;

alter table public.smyl_radiograph_feature_flags enable row level security;
alter table public.smyl_radiograph_flag_tenants enable row level security;
alter table public.smyl_radiograph_engines enable row level security;
alter table public.smyl_radiograph_settings enable row level security;
revoke all on public.smyl_radiograph_feature_flags, public.smyl_radiograph_flag_tenants,
  public.smyl_radiograph_engines, public.smyl_radiograph_settings from public, anon, authenticated;
revoke truncate on public.smyl_radiograph_feature_flags, public.smyl_radiograph_flag_tenants,
  public.smyl_radiograph_engines, public.smyl_radiograph_settings from service_role;
-- Sin políticas ni grants: sólo service_role lee/escribe. Las lecturas del navegador pasan
-- por las funciones de abajo, que exponen únicamente booleanos.

-- Efectivo = (global OR piloto) AND NOT pausada, encadenado con sus dependencias. Una clínica nunca puede
-- encender lo que la plataforma no habilitó ni reactivar una fila de piloto que la plataforma apagó.
create or replace function public.smyl_radiograph_flag_enabled(p_key text, p_tenant uuid)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_self boolean;
begin
  select (f.enabled or coalesce(t.enabled, false)) and not coalesce(t.paused, false) into v_self
  from public.smyl_radiograph_feature_flags f
  left join public.smyl_radiograph_flag_tenants t on t.key = f.key and t.tenant_id = p_tenant
  where f.key = p_key;
  if not coalesce(v_self, false) then return false; end if;
  if p_key = 'radiograph.tooth_ai_v1' then return public.smyl_radiograph_flag_enabled('radiograph.qc_v2', p_tenant); end if;
  if p_key = 'radiograph.report_v1' then return public.smyl_radiograph_flag_enabled('radiograph.tooth_ai_v1', p_tenant); end if;
  if p_key = 'radiograph.longitudinal_v1' then return public.smyl_radiograph_flag_enabled('radiograph.qc_v2', p_tenant); end if;
  return true;
end;
$$;
revoke all on function public.smyl_radiograph_flag_enabled(text, uuid) from public, anon, authenticated;

-- Pausa / reanudación por clínica (clinic.manage). Sólo toca `paused`: no puede conceder ni retirar el piloto.
create or replace function public.smyl_radiograph_set_tenant_flag(p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinic.manage') then raise exception using errcode = '42501', message = 'Sólo quien administra la clínica puede pausar o reanudar el motor.'; end if;
  if p_enabled is null then raise exception using errcode = '22023', message = 'Indica si reanudar o pausar.'; end if;
  if not exists (select 1 from public.smyl_radiograph_feature_flags f where f.key = p_key) then raise exception using errcode = '22023', message = 'Bandera desconocida.'; end if;
  if p_enabled and not exists (
    select 1 from public.smyl_radiograph_feature_flags f left join public.smyl_radiograph_flag_tenants t on t.key = f.key and t.tenant_id = v_tenant
    where f.key = p_key and (f.enabled or coalesce(t.enabled, false))) then
    raise exception using errcode = '42501', message = 'Esta función no está habilitada por la plataforma para tu clínica.'; end if;
  insert into public.smyl_radiograph_flag_tenants(key, tenant_id, enabled, paused, updated_by, updated_at) values (p_key, v_tenant, false, not p_enabled, auth.uid(), clock_timestamp())
  on conflict (key, tenant_id) do update set paused = excluded.paused, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return public.smyl_radiograph_ai_capabilities();
end;
$$;
revoke all on function public.smyl_radiograph_set_tenant_flag(text, boolean) from public, anon;
grant execute on function public.smyl_radiograph_set_tenant_flag(text, boolean) to authenticated;

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
