-- SMYL · La Nube, PR 1: archivo general de la clínica (carpetas, subir, vincular, papelera, medidor y permisos).
-- Reutiliza el circuito de archivos privados que ya existe: cuarentena (smyl_file_security), verificación de contenido
-- (edge function secure-clinical-file), ciclo de vida y medición de almacenamiento. NO toca smyl_patient_files:
-- el expediente conserva su flujo y su control actuales.
-- Permisos nuevos: cloud.read (ver), cloud.upload (subir), cloud.manage (organizar, vincular y borrar), cloud.share (reservado
-- para compartir con enlace, PR 2). Lo clínico (fotos, rayos X, consentimientos o archivos con paciente) exige además clinical.read
-- y el alcance de datos del paciente.
-- El límite de almacenamiento es opcional: si la migración de medición (20261116140000) no está aplicada, no se bloquea nada.
begin;

-- 1. Permisos -----------------------------------------------------------------------------------------------------------
alter table public.smyl_role_permissions drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions add constraint smyl_role_permissions_permission_key_check check (permission_key in (
  'clinic.read', 'clinic.manage',
  'team.read', 'team.manage', 'audit.read',
  'schedule.read', 'schedule.manage',
  'patients.read', 'patients.manage',
  'clinical.read', 'clinical.write', 'clinical.approve',
  'proposal.read', 'proposal.write', 'proposal.approve', 'proposal.followup',
  'messages.read', 'messages.respond', 'messages.manage',
  'inventory.read', 'inventory.manage', 'inventory.consume', 'inventory.adjust', 'inventory.purchase',
  'finance.read', 'finance.manage', 'finance.cash', 'finance.cash.supervise', 'finance.invoice', 'finance.refund',
  'catalog.manage', 'catalog.prices',
  'settings.manage',
  'cloud.read', 'cloud.upload', 'cloud.manage', 'cloud.share'
));

-- Propietario y Administrador reciben todos los permisos de la Nube; los demás roles los asigna la clínica desde Equipo.
insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, k.permission_key
from public.smyl_roles r
cross join (values ('cloud.read'), ('cloud.upload'), ('cloud.manage'), ('cloud.share')) as k(permission_key)
where r.system_role and r.code in ('propietario', 'administrador')
on conflict do nothing;

create or replace function public.smyl_seed_cloud_permissions()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.system_role and new.code in ('propietario', 'administrador') then
    insert into public.smyl_role_permissions (tenant_id, role_id, permission_key)
    values (new.tenant_id, new.id, 'cloud.read'), (new.tenant_id, new.id, 'cloud.upload'),
           (new.tenant_id, new.id, 'cloud.manage'), (new.tenant_id, new.id, 'cloud.share')
    on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.smyl_seed_cloud_permissions() from public, anon, authenticated;
drop trigger if exists smyl_roles_seed_cloud_permissions on public.smyl_roles;
create trigger smyl_roles_seed_cloud_permissions after insert on public.smyl_roles
for each row execute function public.smyl_seed_cloud_permissions();

-- 2. Tablas -------------------------------------------------------------------------------------------------------------
create table if not exists public.smyl_cloud_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index if not exists smyl_cloud_folders_name_idx on public.smyl_cloud_folders (tenant_id, lower(btrim(name)));

create table if not exists public.smyl_cloud_files (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  folder_id uuid,
  category text check (category is null or category in ('photo', 'xray', 'document', 'consent', 'other')),
  patient_id uuid,
  appointment_id uuid,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 180),
  storage_path text not null check (char_length(storage_path) between 10 and 900),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  notes text not null default '' check (char_length(notes) <= 1000),
  source text not null default 'upload' check (source in ('upload', 'chat')),
  status text not null default 'active' check (status in ('active', 'trashed')),
  trashed_at timestamptz,
  trashed_by uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, storage_path),
  foreign key (tenant_id, folder_id) references public.smyl_cloud_folders (tenant_id, id)
);
create index if not exists smyl_cloud_files_tenant_idx on public.smyl_cloud_files (tenant_id, status, created_at desc);
create index if not exists smyl_cloud_files_patient_idx on public.smyl_cloud_files (tenant_id, patient_id) where patient_id is not null;
create index if not exists smyl_cloud_files_folder_idx on public.smyl_cloud_files (tenant_id, folder_id) where folder_id is not null;

alter table public.smyl_cloud_folders enable row level security;
alter table public.smyl_cloud_files enable row level security;
revoke all on public.smyl_cloud_folders, public.smyl_cloud_files from public, anon, authenticated;
grant select on public.smyl_cloud_folders, public.smyl_cloud_files to authenticated;

-- ¿Puede la persona actual ver este archivo? Lo clínico exige clinical.read y alcance sobre el paciente.
create or replace function public.smyl_cloud_can_see(p_tenant uuid, p_patient uuid, p_category text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_tenant is null or not public.smyl_has_permission(p_tenant, 'cloud.read') then return false; end if;
  if p_patient is null and coalesce(p_category, '') not in ('photo', 'xray', 'consent') then return true; end if;
  if not public.smyl_has_permission(p_tenant, 'clinical.read') then return false; end if;
  return p_patient is null or public.smyl_can_access_patient(p_tenant, p_patient, 'clinical');
end; $$;
revoke all on function public.smyl_cloud_can_see(uuid, uuid, text) from public, anon;
grant execute on function public.smyl_cloud_can_see(uuid, uuid, text) to authenticated;

drop policy if exists smyl_cloud_folders_read on public.smyl_cloud_folders;
create policy smyl_cloud_folders_read on public.smyl_cloud_folders for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'cloud.read'));
drop policy if exists smyl_cloud_files_read on public.smyl_cloud_files;
create policy smyl_cloud_files_read on public.smyl_cloud_files for select to authenticated
  using (public.smyl_cloud_can_see(tenant_id, patient_id, category));

-- 3. Almacenamiento privado + integración con el registro de archivos ---------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('smyl-cloud', 'smyl-cloud', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.smyl_cloud_path_ok(p_name text, p_permission text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_parts text[]; v_tenant uuid;
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) < 3 or v_parts[1] !~ '^[0-9a-f-]{36}$' or v_parts[2] !~ '^[0-9a-f-]{36}$' then return false; end if;
  v_tenant := v_parts[1]::uuid;
  return v_tenant = public.smyl_current_tenant() and public.smyl_has_permission(v_tenant, p_permission);
exception when others then return false;
end; $$;
revoke all on function public.smyl_cloud_path_ok(text, text) from public, anon;
grant execute on function public.smyl_cloud_path_ok(text, text) to authenticated;

-- Leer un objeto exige un archivo registrado que la persona pueda ver (así lo clínico se respeta también en el Storage).
create or replace function public.smyl_cloud_path_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  return public.smyl_cloud_path_ok(p_name, 'cloud.read') and exists (
    select 1 from public.smyl_cloud_files f
    where f.tenant_id = public.smyl_current_tenant() and f.storage_path = p_name
      and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category)
  );
end; $$;
revoke all on function public.smyl_cloud_path_readable(text) from public, anon;
grant execute on function public.smyl_cloud_path_readable(text) to authenticated;

-- Borrar un objeto solo si ya no tiene fila (subida fallida o eliminación definitiva).
create or replace function public.smyl_cloud_path_orphan(p_name text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  return public.smyl_cloud_path_ok(p_name, 'cloud.upload')
    and not exists (select 1 from public.smyl_cloud_files f where f.storage_path = p_name);
end; $$;
revoke all on function public.smyl_cloud_path_orphan(text) from public, anon;
grant execute on function public.smyl_cloud_path_orphan(text) to authenticated;

drop policy if exists smyl_cloud_objects_read on storage.objects;
create policy smyl_cloud_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'smyl-cloud' and public.smyl_cloud_path_readable(name));
drop policy if exists smyl_cloud_objects_insert on storage.objects;
create policy smyl_cloud_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'smyl-cloud' and public.smyl_cloud_path_ok(name, 'cloud.upload'));
drop policy if exists smyl_cloud_objects_delete on storage.objects;
create policy smyl_cloud_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'smyl-cloud' and public.smyl_cloud_path_orphan(name));

-- Cuarentena: el trigger de storage.objects ahora también registra el bucket de la Nube.
create or replace function public.smyl_quarantine_private_file()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.bucket_id in (
    'smyl-case-photos', 'smyl-radiographs', 'smyl-clinical-files',
    'smyl-proposal-photos', 'smyl-professional-cv', 'smyl-professional-cases', 'smyl-cloud'
  ) and split_part(new.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    insert into public.smyl_file_security (bucket_id, object_path, tenant_id, status, uploaded_by)
    values (new.bucket_id, new.name, split_part(new.name, '/', 1)::uuid, 'pending', auth.uid())
    on conflict (bucket_id, object_path) do update set
      tenant_id = excluded.tenant_id, status = 'pending', verified_mime_type = null,
      verified_size_bytes = null, verified_sha256 = null, rejection_reason = null,
      uploaded_by = excluded.uploaded_by, verified_by = null, created_at = now(), verified_at = null;
  end if;
  return new;
end; $$;

-- Ciclo de vida: un objeto de la Nube con fila (activa o en papelera) está vinculado y no se limpia solo.
insert into public.smyl_file_retention_policies (bucket_id, pending_hours, unlinked_days, rejected_hours, note)
values ('smyl-cloud', 24, 7, 1, 'La Nube: con fila se conserva; la papelera se vacía a los 30 días y las cargas sin registrar se limpian.')
on conflict (bucket_id) do nothing;

create or replace function public.smyl_file_is_referenced(p_bucket text, p_path text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  case p_bucket
    when 'smyl-clinical-files' then
      return exists (select 1 from public.smyl_patient_files f where f.storage_path = p_path);
    when 'smyl-case-photos' then
      return exists (select 1 from public.smyl_patient_case_archive c,
        lateral jsonb_array_elements(coalesce(c.document->'views', '[]'::jsonb)) v
        where v->'original'->>'path' = p_path or v->'result'->>'path' = p_path);
    when 'smyl-radiographs' then
      return exists (select 1 from public.smyl_dental_records d,
        lateral jsonb_array_elements(coalesce(d.document->'studies', '[]'::jsonb)) s
        where s->'asset'->>'path' = p_path);
    when 'smyl-proposal-photos' then
      return exists (select 1 from public.smyl_proposals p where
        p.document->'photos'->>'before_path' = p_path or p.document->'photos'->>'simulation_path' = p_path);
    when 'smyl-professional-cv' then
      return exists (select 1 from public.smyl_professional_profiles p where p.cv_storage_path = p_path);
    when 'smyl-professional-cases' then
      return exists (select 1 from public.smyl_professional_cases c where
        c.before_path = p_path or c.after_path = p_path or c.consent_path = p_path);
    when 'smyl-cloud' then
      return exists (select 1 from public.smyl_cloud_files f where f.storage_path = p_path);
    else return true;
  end case;
end; $$;
revoke all on function public.smyl_file_is_referenced(text, text) from public, anon, authenticated;
grant execute on function public.smyl_file_is_referenced(text, text) to service_role;

-- 4. Límite de almacenamiento (opcional: solo si existe la migración de medición) ----------------------------------------
create or replace function public.smyl_cloud_storage_state(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, storage as $$
declare v_used bigint; v_limit bigint;
begin
  if to_regprocedure('public.smyl_storage_used_bytes(uuid)') is not null then
    execute 'select public.smyl_storage_used_bytes($1)' into v_used using p_tenant;
  end if;
  if to_regclass('public.smyl_storage_settings') is not null then
    execute 'select limit_bytes from public.smyl_storage_settings where tenant_id = $1' into v_limit using p_tenant;
  end if;
  return jsonb_build_object('used_bytes', coalesce(v_used, 0), 'limit_bytes', v_limit);
end; $$;
revoke all on function public.smyl_cloud_storage_state(uuid) from public, anon, authenticated;
grant execute on function public.smyl_cloud_storage_state(uuid) to service_role;

-- 5. RPCs ---------------------------------------------------------------------------------------------------------------
create or replace function public.smyl_cloud_summary()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_perm jsonb; v_counts jsonb; v_folders jsonb; v_patients jsonb; v_storage jsonb;
begin
  if v_tenant is null then raise exception using errcode = '42501', message = 'No tienes acceso a la Nube.'; end if;
  v_perm := jsonb_build_object(
    'read', public.smyl_has_permission(v_tenant, 'cloud.read'), 'upload', public.smyl_has_permission(v_tenant, 'cloud.upload'),
    'manage', public.smyl_has_permission(v_tenant, 'cloud.manage'), 'share', public.smyl_has_permission(v_tenant, 'cloud.share'),
    'clinical', public.smyl_has_permission(v_tenant, 'clinical.read'));
  if not (v_perm->>'read')::boolean then
    return jsonb_build_object('permissions', v_perm);
  end if;
  with vis as (
    select f.* from public.smyl_cloud_files f
    where f.tenant_id = v_tenant and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category)
  )
  select jsonb_build_object(
    'total', count(*) filter (where status = 'active'),
    'recent', count(*) filter (where status = 'active' and created_at > now() - interval '7 days'),
    'photo', count(*) filter (where status = 'active' and category = 'photo'),
    'xray', count(*) filter (where status = 'active' and category = 'xray'),
    'document', count(*) filter (where status = 'active' and category = 'document'),
    'consent', count(*) filter (where status = 'active' and category = 'consent'),
    'unclassified', count(*) filter (where status = 'active' and category is null),
    'no_patient', count(*) filter (where status = 'active' and patient_id is null),
    'trashed', count(*) filter (where status = 'trashed'),
    'bytes', coalesce(sum(size_bytes) filter (where status = 'active'), 0)
  ) into v_counts from vis;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'files', coalesce(c.n, 0)) order by lower(d.name)), '[]'::jsonb)
  into v_folders from public.smyl_cloud_folders d
  left join (select folder_id, count(*) n from public.smyl_cloud_files f
             where f.tenant_id = v_tenant and f.status = 'active' and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category)
             group by folder_id) c on c.folder_id = d.id
  where d.tenant_id = v_tenant;
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', t.patient_id, 'name', t.name, 'files', t.n) order by t.n desc), '[]'::jsonb)
  into v_patients from (
    select f.patient_id, btrim(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '')) as name, count(*)::int as n
    from public.smyl_cloud_files f
    left join public.camila_pacientes p on p.tenant_id = f.tenant_id and p.id = f.patient_id
    where f.tenant_id = v_tenant and f.status = 'active' and f.patient_id is not null
      and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category)
    group by f.patient_id, btrim(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, ''))
    order by count(*) desc limit 8) t;
  v_storage := public.smyl_cloud_storage_state(v_tenant);
  return jsonb_build_object('permissions', v_perm, 'counts', v_counts, 'folders', v_folders, 'patients', v_patients, 'storage', v_storage);
end; $$;
revoke all on function public.smyl_cloud_summary() from public, anon;
grant execute on function public.smyl_cloud_summary() to authenticated;

-- Antes de subir: ¿hay espacio? (el guardado se pausa solo si la clínica tiene un límite definido y se llenó)
create or replace function public.smyl_cloud_upload_check(p_size bigint)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_state jsonb; v_used bigint; v_limit bigint;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.upload') then
    raise exception using errcode = '42501', message = 'Tu rol no permite subir archivos a la Nube.';
  end if;
  v_state := public.smyl_cloud_storage_state(v_tenant);
  v_used := (v_state->>'used_bytes')::bigint; v_limit := nullif(v_state->>'limit_bytes', '')::bigint;
  return jsonb_build_object('ok', v_limit is null or v_used + greatest(coalesce(p_size, 0), 0) <= v_limit,
    'used_bytes', v_used, 'limit_bytes', v_limit);
end; $$;
revoke all on function public.smyl_cloud_upload_check(bigint) from public, anon;
grant execute on function public.smyl_cloud_upload_check(bigint) to authenticated;

create or replace function public.smyl_cloud_register_file(
  p_id uuid, p_display_name text, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_sha256 text,
  p_folder_id uuid default null, p_patient_id uuid default null, p_appointment_id uuid default null, p_category text default null)
returns public.smyl_cloud_files language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cloud_files; v_state jsonb; v_limit bigint;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.upload') then
    raise exception using errcode = '42501', message = 'Tu rol no permite subir archivos a la Nube.';
  end if;
  if p_storage_path is null or p_storage_path not like v_tenant::text || '/' || p_id::text || '/%' then
    raise exception using errcode = '23514', message = 'La ruta no pertenece a esta clínica.';
  end if;
  if not public.smyl_file_is_usable('smyl-cloud', p_storage_path) then
    raise exception using errcode = '23514', message = 'El archivo sigue en verificación o fue rechazado.';
  end if;
  if p_category is not null and p_category not in ('photo', 'xray', 'document', 'consent', 'other') then
    raise exception using errcode = '23514', message = 'Tipo de archivo no válido.';
  end if;
  if (p_patient_id is not null or p_category in ('photo', 'xray', 'consent')) and not public.smyl_has_permission(v_tenant, 'clinical.read') then
    raise exception using errcode = '42501', message = 'Para guardar archivos clínicos o de un paciente necesitas permiso clínico.';
  end if;
  if p_patient_id is not null then
    if not exists (select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id)
       or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
      raise exception using errcode = 'P0002', message = 'El paciente no existe o queda fuera de tu alcance.';
    end if;
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.smyl_appointments a where a.tenant_id = v_tenant and a.id = p_appointment_id and a.patient_id is not distinct from p_patient_id) then
    raise exception using errcode = 'P0002', message = 'La cita no existe o no es de ese paciente.';
  end if;
  if p_folder_id is not null and not exists (select 1 from public.smyl_cloud_folders d where d.tenant_id = v_tenant and d.id = p_folder_id) then
    raise exception using errcode = 'P0002', message = 'La carpeta no existe.';
  end if;
  v_state := public.smyl_cloud_storage_state(v_tenant); v_limit := nullif(v_state->>'limit_bytes', '')::bigint;
  if v_limit is not null and (v_state->>'used_bytes')::bigint >= v_limit then
    raise exception using errcode = '53100', message = 'El espacio de la clínica está lleno. Libera espacio o amplía tu plan para guardar archivos nuevos.';
  end if;
  insert into public.smyl_cloud_files (id, tenant_id, folder_id, category, patient_id, appointment_id, display_name, storage_path, mime_type, size_bytes, sha256, created_by)
  values (p_id, v_tenant, p_folder_id, p_category, p_patient_id, p_appointment_id, btrim(p_display_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid())
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.smyl_cloud_register_file(uuid, text, text, text, bigint, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.smyl_cloud_register_file(uuid, text, text, text, bigint, text, uuid, uuid, uuid, text) to authenticated;

-- Organizar: renombrar, mover, clasificar, vincular a paciente/cita, notas. Cada clave presente en el JSON se aplica.
create or replace function public.smyl_cloud_update_file(p_id uuid, p_patch jsonb)
returns public.smyl_cloud_files language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cloud_files;
  v_name text; v_folder uuid; v_category text; v_patient uuid; v_appointment uuid; v_notes text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.manage') then
    raise exception using errcode = '42501', message = 'Tu rol no permite organizar los archivos de la Nube.';
  end if;
  select * into v_row from public.smyl_cloud_files where tenant_id = v_tenant and id = p_id for update;
  if not found or not public.smyl_cloud_can_see(v_row.tenant_id, v_row.patient_id, v_row.category) then
    raise exception using errcode = 'P0002', message = 'El archivo no existe o no tienes acceso.';
  end if;
  v_name := case when p_patch ? 'display_name' then btrim(p_patch->>'display_name') else v_row.display_name end;
  v_folder := case when p_patch ? 'folder_id' then nullif(p_patch->>'folder_id', '')::uuid else v_row.folder_id end;
  v_category := case when p_patch ? 'category' then nullif(p_patch->>'category', '') else v_row.category end;
  v_patient := case when p_patch ? 'patient_id' then nullif(p_patch->>'patient_id', '')::uuid else v_row.patient_id end;
  v_appointment := case when p_patch ? 'appointment_id' then nullif(p_patch->>'appointment_id', '')::uuid else v_row.appointment_id end;
  v_notes := case when p_patch ? 'notes' then coalesce(p_patch->>'notes', '') else v_row.notes end;
  if p_patch ? 'patient_id' and v_patient is distinct from v_row.patient_id and not (p_patch ? 'appointment_id') then v_appointment := null; end if;
  if v_name is null or char_length(v_name) not between 1 and 180 then raise exception using errcode = '23514', message = 'El nombre debe tener entre 1 y 180 caracteres.'; end if;
  if v_category is not null and v_category not in ('photo', 'xray', 'document', 'consent', 'other') then raise exception using errcode = '23514', message = 'Tipo de archivo no válido.'; end if;
  if (v_patient is not null or v_category in ('photo', 'xray', 'consent')) and not public.smyl_has_permission(v_tenant, 'clinical.read') then
    raise exception using errcode = '42501', message = 'Para clasificar como clínico o vincular a un paciente necesitas permiso clínico.';
  end if;
  if v_patient is not null and (not exists (select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = v_patient)
     or not public.smyl_can_access_patient(v_tenant, v_patient, 'clinical')) then
    raise exception using errcode = 'P0002', message = 'El paciente no existe o queda fuera de tu alcance.';
  end if;
  if v_appointment is not null and not exists (
    select 1 from public.smyl_appointments a where a.tenant_id = v_tenant and a.id = v_appointment and a.patient_id is not distinct from v_patient) then
    raise exception using errcode = 'P0002', message = 'La cita no existe o no es de ese paciente.';
  end if;
  if v_folder is not null and not exists (select 1 from public.smyl_cloud_folders d where d.tenant_id = v_tenant and d.id = v_folder) then
    raise exception using errcode = 'P0002', message = 'La carpeta no existe.';
  end if;
  update public.smyl_cloud_files set display_name = v_name, folder_id = v_folder, category = v_category, patient_id = v_patient,
    appointment_id = v_appointment, notes = v_notes, updated_at = now()
  where tenant_id = v_tenant and id = p_id returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.smyl_cloud_update_file(uuid, jsonb) from public, anon;
grant execute on function public.smyl_cloud_update_file(uuid, jsonb) to authenticated;

create or replace function public.smyl_cloud_set_trashed(p_ids uuid[], p_trashed boolean)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_count integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.manage') then
    raise exception using errcode = '42501', message = 'Tu rol no permite borrar archivos de la Nube.';
  end if;
  update public.smyl_cloud_files f set status = case when p_trashed then 'trashed' else 'active' end,
    trashed_at = case when p_trashed then now() else null end, trashed_by = case when p_trashed then auth.uid() else null end, updated_at = now()
  where f.tenant_id = v_tenant and f.id = any(p_ids) and f.status = case when p_trashed then 'active' else 'trashed' end
    and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.smyl_cloud_set_trashed(uuid[], boolean) from public, anon;
grant execute on function public.smyl_cloud_set_trashed(uuid[], boolean) to authenticated;

-- Eliminación definitiva (solo desde la papelera): borra la fila y devuelve las rutas para que el navegador quite los objetos.
create or replace function public.smyl_cloud_delete_forever(p_ids uuid[])
returns text[] language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_paths text[];
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.manage') then
    raise exception using errcode = '42501', message = 'Tu rol no permite eliminar archivos de la Nube.';
  end if;
  with gone as (
    delete from public.smyl_cloud_files f where f.tenant_id = v_tenant and f.id = any(p_ids) and f.status = 'trashed'
      and public.smyl_cloud_can_see(f.tenant_id, f.patient_id, f.category) returning f.storage_path)
  select coalesce(array_agg(storage_path), '{}') into v_paths from gone;
  return v_paths;
end; $$;
revoke all on function public.smyl_cloud_delete_forever(uuid[]) from public, anon;
grant execute on function public.smyl_cloud_delete_forever(uuid[]) to authenticated;

create or replace function public.smyl_cloud_folder_save(p_id uuid, p_name text)
returns public.smyl_cloud_folders language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_cloud_folders;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.manage') then
    raise exception using errcode = '42501', message = 'Tu rol no permite organizar carpetas de la Nube.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using errcode = '23514', message = 'El nombre de la carpeta debe tener entre 1 y 80 caracteres.';
  end if;
  if p_id is null then
    insert into public.smyl_cloud_folders (tenant_id, name, created_by) values (v_tenant, btrim(p_name), auth.uid()) returning * into v_row;
  else
    update public.smyl_cloud_folders set name = btrim(p_name), updated_at = now() where tenant_id = v_tenant and id = p_id returning * into v_row;
    if not found then raise exception using errcode = 'P0002', message = 'La carpeta no existe.'; end if;
  end if;
  return v_row;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'Ya existe una carpeta con ese nombre.';
end; $$;
revoke all on function public.smyl_cloud_folder_save(uuid, text) from public, anon;
grant execute on function public.smyl_cloud_folder_save(uuid, text) to authenticated;

create or replace function public.smyl_cloud_folder_delete(p_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'cloud.manage') then
    raise exception using errcode = '42501', message = 'Tu rol no permite organizar carpetas de la Nube.';
  end if;
  if exists (select 1 from public.smyl_cloud_files f where f.tenant_id = v_tenant and f.folder_id = p_id and f.status = 'active') then
    raise exception using errcode = '23514', message = 'La carpeta tiene archivos. Muévelos antes de eliminarla.';
  end if;
  update public.smyl_cloud_files set folder_id = null where tenant_id = v_tenant and folder_id = p_id;
  delete from public.smyl_cloud_folders where tenant_id = v_tenant and id = p_id;
end; $$;
revoke all on function public.smyl_cloud_folder_delete(uuid) from public, anon;
grant execute on function public.smyl_cloud_folder_delete(uuid) to authenticated;

commit;
