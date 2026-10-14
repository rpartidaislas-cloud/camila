-- SMYL · Seguridad etapa 3: cuarentena y verificación autoritativa de archivos privados.
begin;

create table public.smyl_file_security (
  bucket_id text not null,
  object_path text not null,
  tenant_id uuid not null,
  status text not null check (status in ('pending','clean','rejected','legacy')),
  verified_mime_type text,
  verified_size_bytes bigint check (verified_size_bytes is null or verified_size_bytes >= 0),
  verified_sha256 text check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$'),
  rejection_reason text,
  uploaded_by uuid,
  verified_by uuid,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  primary key (bucket_id,object_path)
);

alter table public.smyl_file_security enable row level security;
revoke all on public.smyl_file_security from public,anon,authenticated;

-- Los objetos anteriores a esta migración siguen disponibles, pero quedan
-- distinguidos de los que sí pasaron la inspección de contenido nueva.
insert into public.smyl_file_security(bucket_id,object_path,tenant_id,status,created_at)
select o.bucket_id,o.name,split_part(o.name,'/',1)::uuid,'legacy',coalesce(o.created_at,now())
from storage.objects o
where o.bucket_id in (
  'smyl-case-photos','smyl-radiographs','smyl-clinical-files',
  'smyl-proposal-photos','smyl-professional-cv','smyl-professional-cases'
)
and split_part(o.name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict do nothing;

create or replace function public.smyl_quarantine_private_file()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.bucket_id in (
    'smyl-case-photos','smyl-radiographs','smyl-clinical-files',
    'smyl-proposal-photos','smyl-professional-cv','smyl-professional-cases'
  ) and split_part(new.name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    insert into public.smyl_file_security(bucket_id,object_path,tenant_id,status,uploaded_by)
    values(new.bucket_id,new.name,split_part(new.name,'/',1)::uuid,'pending',auth.uid())
    on conflict(bucket_id,object_path) do update set
      tenant_id=excluded.tenant_id,status='pending',verified_mime_type=null,
      verified_size_bytes=null,verified_sha256=null,rejection_reason=null,
      uploaded_by=excluded.uploaded_by,verified_by=null,created_at=now(),verified_at=null;
  end if;
  return new;
end;
$$;

drop trigger if exists smyl_private_file_quarantine on storage.objects;
create trigger smyl_private_file_quarantine
after insert or update of metadata on storage.objects
for each row execute function public.smyl_quarantine_private_file();

create or replace function public.smyl_file_is_usable(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.smyl_file_security s
    where s.bucket_id=p_bucket and s.object_path=p_path
      and s.status in ('clean','legacy')
  );
$$;
revoke all on function public.smyl_file_is_usable(text,text) from public,anon;
grant execute on function public.smyl_file_is_usable(text,text) to authenticated;

create or replace function public.smyl_enforce_secure_patient_file()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.smyl_file_is_usable('smyl-clinical-files',new.storage_path) then
    raise exception using errcode='23514',message='El archivo clínico sigue en verificación o fue rechazado.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_patient_file_security on public.smyl_patient_files;
create trigger smyl_patient_file_security before insert or update of storage_path on public.smyl_patient_files
for each row execute function public.smyl_enforce_secure_patient_file();

create or replace function public.smyl_enforce_secure_case_archive()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb; a jsonb; role_name text;
begin
  for v in select value from jsonb_array_elements(coalesce(new.document->'views','[]'::jsonb)) loop
    foreach role_name in array array['original','result'] loop
      a:=v->role_name;
      if a is not null and a<>'null'::jsonb and not public.smyl_file_is_usable('smyl-case-photos',a->>'path') then
        raise exception using errcode='23514',message='Una fotografía del caso sigue en verificación o fue rechazada.';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
drop trigger if exists smyl_case_archive_file_security on public.smyl_patient_case_archive;
create trigger smyl_case_archive_file_security before insert or update of document on public.smyl_patient_case_archive
for each row execute function public.smyl_enforce_secure_case_archive();

create or replace function public.smyl_enforce_secure_dental_record()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare study jsonb;
begin
  for study in select value from jsonb_array_elements(coalesce(new.document->'studies','[]'::jsonb)) loop
    if not public.smyl_file_is_usable('smyl-radiographs',study->'asset'->>'path') then
      raise exception using errcode='23514',message='Una radiografía sigue en verificación o fue rechazada.';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists smyl_dental_record_file_security on public.smyl_dental_records;
create trigger smyl_dental_record_file_security before insert or update of document on public.smyl_dental_records
for each row execute function public.smyl_enforce_secure_dental_record();

create or replace function public.smyl_enforce_secure_proposal()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare photos jsonb;
begin
  photos:=new.document->'photos';
  if photos is not null and photos<>'null'::jsonb and (
    not public.smyl_file_is_usable('smyl-proposal-photos',photos->>'before_path') or
    not public.smyl_file_is_usable('smyl-proposal-photos',photos->>'simulation_path')
  ) then raise exception using errcode='23514',message='Las fotografías de la propuesta siguen en verificación o fueron rechazadas.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_proposal_file_security on public.smyl_proposals;
create trigger smyl_proposal_file_security before insert or update of document on public.smyl_proposals
for each row execute function public.smyl_enforce_secure_proposal();

create or replace function public.smyl_enforce_secure_professional_profile()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.cv_storage_path is not null and not public.smyl_file_is_usable('smyl-professional-cv',new.cv_storage_path) then
    raise exception using errcode='23514',message='El CV sigue en verificación o fue rechazado.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_professional_profile_file_security on public.smyl_professional_profiles;
create trigger smyl_professional_profile_file_security before insert or update of cv_storage_path on public.smyl_professional_profiles
for each row execute function public.smyl_enforce_secure_professional_profile();

create or replace function public.smyl_enforce_secure_professional_case()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if (new.before_path is not null and not public.smyl_file_is_usable('smyl-professional-cases',new.before_path))
    or (new.after_path is not null and not public.smyl_file_is_usable('smyl-professional-cases',new.after_path))
    or (new.consent_path is not null and not public.smyl_file_is_usable('smyl-professional-cases',new.consent_path)) then
    raise exception using errcode='23514',message='Un archivo del caso profesional sigue en verificación o fue rechazado.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_professional_case_file_security on public.smyl_professional_cases;
create trigger smyl_professional_case_file_security before insert or update of before_path,after_path,consent_path on public.smyl_professional_cases
for each row execute function public.smyl_enforce_secure_professional_case();

-- La lectura normal también queda detrás de la cuarentena. La función Edge
-- usa service_role para inspeccionar bytes pendientes sin abrirlos al cliente.
drop policy if exists case_photo_read on storage.objects;
create policy case_photo_read on storage.objects for select to authenticated
  using(bucket_id='smyl-case-photos' and public.smyl_case_path_allowed(name)
    and public.smyl_file_is_usable(bucket_id,name));

drop policy if exists rx_read on storage.objects;
create policy rx_read on storage.objects for select to authenticated
  using(bucket_id='smyl-radiographs' and public.smyl_radiograph_path(name)
    and public.smyl_file_is_usable(bucket_id,name));

drop policy if exists smyl_clinical_files_read on storage.objects;
create policy smyl_clinical_files_read on storage.objects for select to authenticated
  using(bucket_id='smyl-clinical-files' and public.smyl_clinical_file_path_allowed(name,'clinical.read')
    and public.smyl_file_is_usable(bucket_id,name));

drop policy if exists proposal_photos_permission_read on storage.objects;
create policy proposal_photos_permission_read on storage.objects for select to authenticated
  using(bucket_id='smyl-proposal-photos'
    and (storage.foldername(name))[1]=public.smyl_current_tenant()::text
    and public.smyl_has_permission(public.smyl_current_tenant(),'proposal.read')
    and public.smyl_file_is_usable(bucket_id,name));

drop policy if exists smyl_professional_cv_read on storage.objects;
create policy smyl_professional_cv_read on storage.objects for select to authenticated
  using(bucket_id='smyl-professional-cv'
    and public.smyl_can_edit_professional_profile(
      ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid)
    and public.smyl_file_is_usable(bucket_id,name));

drop policy if exists smyl_professional_cases_storage_read on storage.objects;
create policy smyl_professional_cases_storage_read on storage.objects for select to authenticated
  using(bucket_id='smyl-professional-cases'
    and public.smyl_can_edit_professional_profile(
      ((storage.foldername(name))[1])::uuid,((storage.foldername(name))[2])::uuid)
    and public.smyl_file_is_usable(bucket_id,name));

commit;
