begin;

-- Números estables para expedientes actuales y nuevos, independientes del nombre.
alter table public.camila_pacientes add column record_number bigint generated always as identity;
create unique index camila_patient_record_number_idx on public.camila_pacientes(record_number);

alter table public.smyl_cloud_files
  add column clinic_use boolean not null default false,
  add constraint smyl_cloud_clinic_destination check (
    not clinic_use or (patient_id is null and appointment_id is null and
      (category is null or category in ('document','other')))),
  add column needs_organization boolean generated always as
    (category is null or (patient_id is null and not clinic_use)) stored;

create index smyl_cloud_pending_idx on public.smyl_cloud_files(tenant_id, created_at desc, id)
  where status = 'active' and needs_organization;

-- La misma búsqueda sirve para encontrar expedientes y para elegir un destino.
create function public.smyl_cloud_search_text(p_value text)
returns text language sql immutable strict parallel safe set search_path = pg_catalog as $$
  select lower(translate(btrim(p_value), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'));
$$;
revoke all on function public.smyl_cloud_search_text(text) from public, anon;
grant execute on function public.smyl_cloud_search_text(text) to authenticated;

create function public.smyl_cloud_find_patients(p_search text)
returns table(id uuid, nombre text, apellido text, telefono text, record_number bigint)
language sql stable security invoker set search_path = pg_catalog, public as $$
  with term as (select public.smyl_cloud_search_text(p_search) as q)
  select p.id, p.nombre, p.apellido, p.telefono, p.record_number
  from public.camila_pacientes p cross join term
  where p.tenant_id=public.smyl_current_tenant() and term.q <> ''
    and public.smyl_has_permission(p.tenant_id,'cloud.read')
    and public.smyl_has_permission(p.tenant_id,'clinical.read')
    and public.smyl_can_access_patient(p.tenant_id,p.id,'clinical') and (
      strpos(public.smyl_cloud_search_text(concat_ws(' ',p.nombre,p.apellido)), term.q)>0
      or strpos(public.smyl_cloud_search_text(concat_ws(' ',p.apellido,p.nombre)), term.q)>0
      or p.record_number::text = regexp_replace(term.q, '^exp[- ]*', '')
      or p.id::text = term.q
      or (length(term.q)>=4 and strpos(p.telefono,term.q)>0)
    );
$$;
revoke all on function public.smyl_cloud_find_patients(text) from public, anon;
grant execute on function public.smyl_cloud_find_patients(text) to authenticated;

-- SECURITY INVOKER conserva el alcance de las políticas de archivos y pacientes.
create function public.smyl_cloud_search_files(p_search text)
returns setof public.smyl_cloud_files language sql stable security invoker
set search_path = pg_catalog, public as $$
  select f.* from public.smyl_cloud_files f
  where f.tenant_id = public.smyl_current_tenant() and (
    strpos(public.smyl_cloud_search_text(f.display_name),public.smyl_cloud_search_text(p_search))>0
    or f.patient_id in (select p.id from public.smyl_cloud_find_patients(p_search) p)
  );
$$;
revoke all on function public.smyl_cloud_search_files(text) from public, anon;
grant execute on function public.smyl_cloud_search_files(text) to authenticated;

-- Una sola firma, compatible con clientes anteriores por el argumento opcional.
drop function public.smyl_cloud_register_file(uuid,text,text,text,bigint,text,uuid,uuid,uuid,text);

create or replace function public.smyl_cloud_register_file(
  p_id uuid, p_display_name text, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_sha256 text,
  p_folder_id uuid default null, p_patient_id uuid default null, p_appointment_id uuid default null, p_category text default null, p_clinic_use boolean default false)
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
  insert into public.smyl_cloud_files (id, tenant_id, folder_id, category, patient_id, appointment_id, display_name, storage_path, mime_type, size_bytes, sha256, created_by, clinic_use)
  values (p_id, v_tenant, p_folder_id, p_category, p_patient_id, p_appointment_id, btrim(p_display_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid(), coalesce(p_clinic_use, false))
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.smyl_cloud_register_file(uuid, text, text, text, bigint, text, uuid, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.smyl_cloud_register_file(uuid, text, text, text, bigint, text, uuid, uuid, uuid, text, boolean) to authenticated;

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
    clinic_use = case when p_patch ? 'clinic_use' then (p_patch->>'clinic_use')::boolean
                     when v_patient is not null or v_category in ('photo', 'xray', 'consent') then false else v_row.clinic_use end,
    appointment_id = v_appointment, notes = v_notes, updated_at = now()
  where tenant_id = v_tenant and id = p_id returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.smyl_cloud_update_file(uuid, jsonb) from public, anon;
grant execute on function public.smyl_cloud_update_file(uuid, jsonb) to authenticated;


commit;
