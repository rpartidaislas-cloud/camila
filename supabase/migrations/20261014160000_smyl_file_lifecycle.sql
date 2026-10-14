-- SMYL · Seguridad etapa 4: ciclo de vida, reescaneo y borrado verificable.
begin;

alter table public.smyl_file_security drop constraint if exists smyl_file_security_status_check;
alter table public.smyl_file_security add constraint smyl_file_security_status_check
  check(status in ('pending','clean','rejected','legacy','legacy_review','deleted'));
alter table public.smyl_file_security
  add column if not exists last_checked_at timestamptz,
  add column if not exists check_attempts integer not null default 0 check(check_attempts>=0),
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_reason text;

create table public.smyl_file_retention_policies(
  bucket_id text primary key,
  pending_hours integer not null check(pending_hours between 1 and 168),
  unlinked_days integer not null check(unlinked_days between 1 and 90),
  rejected_hours integer not null check(rejected_hours between 1 and 168),
  linked_auto_delete boolean not null default false check(linked_auto_delete=false),
  note text not null
);
insert into public.smyl_file_retention_policies(bucket_id,pending_hours,unlinked_days,rejected_hours,note) values
 ('smyl-case-photos',24,7,1,'Casos vinculados: conservación clínica; sin borrado automático.'),
 ('smyl-radiographs',24,7,1,'Radiografías vinculadas: conservación clínica; sin borrado automático.'),
 ('smyl-clinical-files',24,7,1,'Expediente vinculado: conservación clínica; sin borrado automático.'),
 ('smyl-proposal-photos',24,7,1,'Propuestas vinculadas: conservación comercial; sin borrado automático.'),
 ('smyl-professional-cv',24,7,1,'CV vinculado: conservación profesional; sin borrado automático.'),
 ('smyl-professional-cases',24,7,1,'Casos autorizados vinculados: sin borrado automático.');
alter table public.smyl_file_retention_policies enable row level security;
revoke all on public.smyl_file_retention_policies from public,anon,authenticated;

create table public.smyl_file_deletion_log(
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  bucket_id text not null,
  object_path text not null,
  reason text not null,
  object_existed boolean not null,
  requested_by uuid,
  deleted_at timestamptz not null default now()
);
alter table public.smyl_file_deletion_log enable row level security;
revoke all on public.smyl_file_deletion_log from public,anon,authenticated;
create index smyl_file_deletion_log_tenant_idx on public.smyl_file_deletion_log(tenant_id,deleted_at desc);

create table public.smyl_file_maintenance_runs(
  tenant_id uuid primary key,
  last_started_at timestamptz not null,
  last_finished_at timestamptz,
  deleted_count integer not null default 0,
  rescanned_count integer not null default 0,
  review_count integer not null default 0,
  error_count integer not null default 0
);
alter table public.smyl_file_maintenance_runs enable row level security;
revoke all on public.smyl_file_maintenance_runs from public,anon,authenticated;

create or replace function public.smyl_file_is_referenced(p_bucket text,p_path text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  case p_bucket
    when 'smyl-clinical-files' then
      return exists(select 1 from public.smyl_patient_files f where f.storage_path=p_path);
    when 'smyl-case-photos' then
      return exists(select 1 from public.smyl_patient_case_archive c,
        lateral jsonb_array_elements(coalesce(c.document->'views','[]'::jsonb)) v
        where v->'original'->>'path'=p_path or v->'result'->>'path'=p_path);
    when 'smyl-radiographs' then
      return exists(select 1 from public.smyl_dental_records d,
        lateral jsonb_array_elements(coalesce(d.document->'studies','[]'::jsonb)) s
        where s->'asset'->>'path'=p_path);
    when 'smyl-proposal-photos' then
      return exists(select 1 from public.smyl_proposals p where
        p.document->'photos'->>'before_path'=p_path or p.document->'photos'->>'simulation_path'=p_path);
    when 'smyl-professional-cv' then
      return exists(select 1 from public.smyl_professional_profiles p where p.cv_storage_path=p_path);
    when 'smyl-professional-cases' then
      return exists(select 1 from public.smyl_professional_cases c where
        c.before_path=p_path or c.after_path=p_path or c.consent_path=p_path);
    else return true;
  end case;
end;
$$;
revoke all on function public.smyl_file_is_referenced(text,text) from public,anon,authenticated;
grant execute on function public.smyl_file_is_referenced(text,text) to service_role;

create or replace function public.smyl_file_cleanup_candidates(p_tenant uuid,p_limit integer default 50)
returns table(bucket_id text,object_path text,reason text)
language sql security definer set search_path=pg_catalog,public as $$
  select s.bucket_id,s.object_path,
    case when s.status='pending' then 'abandoned_quarantine'
         when s.status='rejected' then 'rejected_object_cleanup'
         else 'unlinked_upload' end
  from public.smyl_file_security s join public.smyl_file_retention_policies p using(bucket_id)
  where s.tenant_id=p_tenant and (
    (s.status='pending' and s.created_at<now()-(p.pending_hours*interval '1 hour')) or
    (s.status='rejected' and s.created_at<now()-(p.rejected_hours*interval '1 hour')) or
    (s.status='clean' and s.created_at<now()-(p.unlinked_days*interval '1 day')
      and not public.smyl_file_is_referenced(s.bucket_id,s.object_path))
  )
  order by s.created_at
  limit greatest(1,least(coalesce(p_limit,50),100));
$$;
revoke all on function public.smyl_file_cleanup_candidates(uuid,integer) from public,anon,authenticated;
grant execute on function public.smyl_file_cleanup_candidates(uuid,integer) to service_role;

create or replace function public.smyl_file_legacy_candidates(p_tenant uuid,p_limit integer default 3)
returns table(bucket_id text,object_path text)
language sql security definer set search_path=pg_catalog,public as $$
  select s.bucket_id,s.object_path from public.smyl_file_security s
  where s.tenant_id=p_tenant and s.status='legacy'
  order by s.created_at
  limit greatest(1,least(coalesce(p_limit,3),10));
$$;
revoke all on function public.smyl_file_legacy_candidates(uuid,integer) from public,anon,authenticated;
grant execute on function public.smyl_file_legacy_candidates(uuid,integer) to service_role;

create or replace function public.smyl_record_file_deletion(
  p_tenant uuid,p_bucket text,p_path text,p_reason text,p_existed boolean,p_actor uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.smyl_file_security where tenant_id=p_tenant and bucket_id=p_bucket and object_path=p_path)
     or public.smyl_file_is_referenced(p_bucket,p_path) then
    raise exception using errcode='23514',message='El archivo no puede eliminarse porque está vinculado o no pertenece a la clínica.';
  end if;
  update public.smyl_file_security set status='deleted',deleted_at=now(),deletion_reason=left(p_reason,120),last_checked_at=now(),check_attempts=check_attempts+1
   where tenant_id=p_tenant and bucket_id=p_bucket and object_path=p_path;
  insert into public.smyl_file_deletion_log(tenant_id,bucket_id,object_path,reason,object_existed,requested_by)
   values(p_tenant,p_bucket,p_path,left(p_reason,120),coalesce(p_existed,false),p_actor);
end;
$$;
revoke all on function public.smyl_record_file_deletion(uuid,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.smyl_record_file_deletion(uuid,text,text,text,boolean,uuid) to service_role;

-- Archivos históricos dudosos permanecen legibles hasta revisión humana; no se
-- destruye evidencia preexistente por una heurística nueva.
create or replace function public.smyl_file_is_usable(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.smyl_file_security s where s.bucket_id=p_bucket
    and s.object_path=p_path and s.status in ('clean','legacy','legacy_review'));
$$;

commit;
