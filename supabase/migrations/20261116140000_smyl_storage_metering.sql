-- SMYL · Almacenamiento medido por clínica.
-- No crea un libro de contabilidad nuevo: mide sobre el registro de archivos que ya existe
-- (public.smyl_file_security, alimentado por el trigger de storage.objects) y el tamaño real del objeto.
-- Sin límite definido (limit_bytes is null) no se bloquea nada: solo se mide.
begin;

create table if not exists public.smyl_storage_settings(
  tenant_id uuid primary key references public.camila_tenants(id) on delete cascade,
  limit_bytes bigint check(limit_bytes is null or limit_bytes > 0),
  alerts_enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.smyl_storage_settings enable row level security;
revoke all on public.smyl_storage_settings from public,anon,authenticated;

create index if not exists smyl_file_security_tenant_status_idx on public.smyl_file_security(tenant_id,status);

-- Bytes realmente almacenados de una clínica (objetos que existen y no fueron rechazados ni borrados).
create or replace function public.smyl_storage_used_bytes(p_tenant uuid)
returns bigint language sql stable security definer set search_path=pg_catalog,public,storage as $$
  select coalesce(sum(coalesce(s.verified_size_bytes,nullif(o.metadata->>'size','')::bigint,0)),0)::bigint
  from public.smyl_file_security s
  join storage.objects o on o.bucket_id=s.bucket_id and o.name=s.object_path
  where s.tenant_id=p_tenant and s.status not in ('rejected','deleted');
$$;
revoke all on function public.smyl_storage_used_bytes(uuid) from public,anon,authenticated;
grant execute on function public.smyl_storage_used_bytes(uuid) to service_role;

-- Resumen para la tarjeta «Almacenamiento» de Configuración. Tenant y permiso salen de auth.uid(), no del navegador.
create or replace function public.smyl_storage_usage()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,storage as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_limit bigint; v_alerts boolean:=true;
  v_used bigint; v_categories jsonb; v_patients jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='No tienes permiso para consultar el almacenamiento de la clínica.';
  end if;
  select limit_bytes,alerts_enabled into v_limit,v_alerts from public.smyl_storage_settings where tenant_id=v_tenant;
  v_alerts:=coalesce(v_alerts,true);
  with objs as (
    select s.bucket_id,s.object_path,coalesce(s.verified_size_bytes,nullif(o.metadata->>'size','')::bigint,0) as bytes
    from public.smyl_file_security s
    join storage.objects o on o.bucket_id=s.bucket_id and o.name=s.object_path
    where s.tenant_id=v_tenant and s.status not in ('rejected','deleted')
  ), cats as (
    select bucket_id,sum(bytes)::bigint as bytes,count(*)::int as files from objs group by bucket_id
  ), pats as (
    select f.patient_id,btrim(coalesce(p.nombre,'')||' '||coalesce(p.apellido,'')) as name,sum(o.bytes)::bigint as bytes,count(*)::int as files
    from objs o
    join public.smyl_patient_files f on f.tenant_id=v_tenant and f.storage_path=o.object_path and f.status='active'
    left join public.camila_pacientes p on p.tenant_id=v_tenant and p.id=f.patient_id
    where o.bucket_id='smyl-clinical-files'
    group by f.patient_id,btrim(coalesce(p.nombre,'')||' '||coalesce(p.apellido,''))
    order by sum(o.bytes) desc limit 5
  )
  select coalesce((select sum(bytes) from cats),0)::bigint,
    coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket_id,'bytes',bytes,'files',files) order by bytes desc) from cats),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('patient_id',patient_id,'name',name,'bytes',bytes,'files',files) order by bytes desc) from pats),'[]'::jsonb)
  into v_used,v_categories,v_patients;
  return jsonb_build_object('used_bytes',v_used,'limit_bytes',v_limit,'alerts_enabled',v_alerts,'categories',v_categories,'top_patients',v_patients,'measured_at',now());
end; $$;
revoke all on function public.smyl_storage_usage() from public,anon;
grant execute on function public.smyl_storage_usage() to authenticated;

create or replace function public.smyl_storage_set_alerts(p_enabled boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'settings.manage') then
    raise exception using errcode='42501',message='No tienes permiso para cambiar los avisos de almacenamiento.';
  end if;
  insert into public.smyl_storage_settings(tenant_id,alerts_enabled,updated_by,updated_at)
  values(v_tenant,coalesce(p_enabled,true),auth.uid(),now())
  on conflict(tenant_id) do update set alerts_enabled=excluded.alerts_enabled,updated_by=excluded.updated_by,updated_at=now();
end; $$;
revoke all on function public.smyl_storage_set_alerts(boolean) from public,anon;
grant execute on function public.smyl_storage_set_alerts(boolean) to authenticated;

-- El límite lo define la plataforma (plan), nunca el navegador de la clínica.
create or replace function public.smyl_set_storage_limit(p_tenant uuid,p_limit_bytes bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_limit_bytes is not null and p_limit_bytes <= 0 then raise exception using errcode='23514',message='El límite debe ser mayor que cero.'; end if;
  insert into public.smyl_storage_settings(tenant_id,limit_bytes,updated_at) values(p_tenant,p_limit_bytes,now())
  on conflict(tenant_id) do update set limit_bytes=excluded.limit_bytes,updated_at=now();
end; $$;
revoke all on function public.smyl_set_storage_limit(uuid,bigint) from public,anon,authenticated;
grant execute on function public.smyl_set_storage_limit(uuid,bigint) to service_role;

-- Con el espacio lleno solo se pausa el guardado NUEVO en el expediente. Los archivos que llegan por el chat
-- nunca se pierden (viven en LANA) y los ya guardados no se tocan. Sin límite definido el trigger no hace nada.
create or replace function public.smyl_enforce_storage_limit()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,storage as $$
declare v_limit bigint;
begin
  select limit_bytes into v_limit from public.smyl_storage_settings where tenant_id=new.tenant_id;
  if v_limit is not null and public.smyl_storage_used_bytes(new.tenant_id) >= v_limit then
    raise exception using errcode='53100',message='El espacio de la clínica está lleno. Libera espacio o amplía tu plan para guardar archivos nuevos en el expediente.';
  end if;
  return new;
end; $$;
drop trigger if exists smyl_patient_files_storage_limit on public.smyl_patient_files;
create trigger smyl_patient_files_storage_limit before insert on public.smyl_patient_files
for each row execute function public.smyl_enforce_storage_limit();

commit;
