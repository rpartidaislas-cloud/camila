-- SMYL · Etapa 3: almacenamiento privado para archivos clínicos.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('smyl-clinical-files','smyl-clinical-files',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.smyl_clinical_file_path_allowed(p_name text,p_permission text)
returns boolean language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare v_parts text[]; v_tenant uuid; v_patient uuid;
begin
  v_parts:=string_to_array(p_name,'/');
  if array_length(v_parts,1)<4 or v_parts[1]!~'^[0-9a-f-]{36}$' or v_parts[2]!~'^[0-9a-f-]{36}$' or v_parts[3]!~'^[0-9a-f-]{36}$' then return false; end if;
  v_tenant:=v_parts[1]::uuid; v_patient:=v_parts[2]::uuid;
  return v_tenant=public.smyl_current_tenant()
    and public.smyl_has_permission(v_tenant,p_permission)
    and exists(select 1 from public.camila_pacientes p where p.tenant_id=v_tenant and p.id=v_patient);
exception when others then return false;
end; $$;

revoke all on function public.smyl_clinical_file_path_allowed(text,text) from public,anon;
grant execute on function public.smyl_clinical_file_path_allowed(text,text) to authenticated;

drop policy if exists smyl_clinical_files_read on storage.objects;
create policy smyl_clinical_files_read on storage.objects for select to authenticated
  using(bucket_id='smyl-clinical-files' and public.smyl_clinical_file_path_allowed(name,'clinical.read'));
drop policy if exists smyl_clinical_files_insert on storage.objects;
create policy smyl_clinical_files_insert on storage.objects for insert to authenticated
  with check(bucket_id='smyl-clinical-files' and public.smyl_clinical_file_path_allowed(name,'clinical.write'));

commit;
