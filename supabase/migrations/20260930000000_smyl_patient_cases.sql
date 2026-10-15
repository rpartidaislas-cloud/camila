-- Additive patient-case archive. Requires 20260929000000 only; no LANA.
-- Disabled by default until real Auth/Storage verification is complete.
begin;
create table public.smyl_case_activation (
  tenant_id uuid primary key references public.camila_tenants(id),
  enabled boolean not null default false
);
alter table public.smyl_case_activation enable row level security;
revoke all on public.smyl_case_activation from public, anon, authenticated;

create table public.smyl_patient_case_archive (
  id uuid primary key,
  tenant_id uuid not null,
  patient_id uuid not null,
  document jsonb not null,
  new_patient_request jsonb,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create index smyl_case_patient_idx on public.smyl_patient_case_archive(tenant_id,patient_id,created_at desc,id);
alter table public.smyl_patient_case_archive enable row level security;
revoke all on public.smyl_patient_case_archive from public,anon,authenticated;
grant select on public.smyl_patient_case_archive to authenticated;

create function public.smyl_case_owner() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists (select 1 from auth.users u where u.id=auth.uid() and u.is_anonymous=false)
    and exists (select 1 from public.smyl_case_activation a where a.tenant_id=auth.uid() and a.enabled);
$$;
revoke all on function public.smyl_case_owner() from public,anon;
grant execute on function public.smyl_case_owner() to authenticated;
create policy case_owner_read on public.smyl_patient_case_archive for select to authenticated
  using (tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));

-- New bucket only. Collision intentionally fails; never change a pre-existing bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('smyl-case-photos','smyl-case-photos',false,10485760,array['image/jpeg','image/png','image/webp']);

create function public.smyl_case_path_allowed(p_name text) returns boolean
language sql stable set search_path='' as $$
  select public.smyl_case_owner() and p_name ~ (
    '^'||auth.uid()::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    ||'(frontal|left|right|tresCuartos|extraoral|intraoral|intraoralLeft|intraoralRight)/(original|result)-[0-9a-f]{64}\.(jpeg|png|webp)$');
$$;
revoke all on function public.smyl_case_path_allowed(text) from public,anon;
grant execute on function public.smyl_case_path_allowed(text) to authenticated;
create policy case_photo_read on storage.objects for select to authenticated
  using(bucket_id='smyl-case-photos' and public.smyl_case_path_allowed(name));
create policy case_photo_insert on storage.objects for insert to authenticated
  with check(bucket_id='smyl-case-photos' and public.smyl_case_path_allowed(name));
-- Restrictive guards prevent unrelated permissive policies from exposing this bucket.
create policy case_photo_read_guard on storage.objects as restrictive for select to public
  using(bucket_id<>'smyl-case-photos' or (auth.uid() is not null and public.smyl_case_path_allowed(name)));
create policy case_photo_insert_guard on storage.objects as restrictive for insert to public
  with check(bucket_id<>'smyl-case-photos' or (auth.uid() is not null and public.smyl_case_path_allowed(name)));
create policy case_photo_no_update on storage.objects as restrictive for update to public
  using(bucket_id<>'smyl-case-photos') with check(bucket_id<>'smyl-case-photos');
create policy case_photo_no_delete on storage.objects as restrictive for delete to public
  using(bucket_id<>'smyl-case-photos');

create function public.smyl_case_capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'enabled',public.smyl_case_owner(),
   'tenant_id',auth.uid(),'bucket','smyl-case-photos','private',
   exists(select 1 from storage.buckets where id='smyl-case-photos' and not public));
$$;

create function public.smyl_save_patient_case(p_id uuid,p_patient_id uuid,p_new_patient jsonb,p_document jsonb)
returns public.smyl_patient_case_archive
language plpgsql security definer set search_path='' as $$
declare
  tenant uuid:=auth.uid(); patient uuid; old_case public.smyl_patient_case_archive;
  v jsonb; a jsonb; role_name text; view_name text; seen text[]:=array[]::text[];
  total bigint:=0; result_count integer:=0; expected_path text; meta jsonb; settings jsonb;
begin
  if not public.smyl_case_owner() then raise exception 'Case access denied' using errcode='42501'; end if;
  if p_id is null or (p_patient_id is null)=(p_new_patient is null) then
    raise exception 'Select exactly one patient' using errcode='22023'; end if;
  if p_new_patient is not null then
    if jsonb_typeof(p_new_patient) is distinct from 'object'
      or p_new_patient-array['id','nombre']<>'{}'::jsonb
      or jsonb_typeof(p_new_patient->'nombre') is distinct from 'string'
      or length(trim(p_new_patient->>'nombre')) not between 1 and 150
      or coalesce(p_new_patient->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception 'Invalid new patient' using errcode='22023'; end if;
    patient:=(p_new_patient->>'id')::uuid;
  else patient:=p_patient_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,7));
  select * into old_case from public.smyl_patient_case_archive where id=p_id;
  if found then
    if old_case.tenant_id=tenant and old_case.patient_id=patient
      and old_case.document=p_document and old_case.new_patient_request is not distinct from p_new_patient
    then return old_case; end if;
    raise exception 'Case identity conflict' using errcode='40001';
  end if;
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object'
    or octet_length(p_document::text)>64000 or p_document-array['schema','settings','views']<>'{}'::jsonb
    or p_document->'schema' is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'settings') is distinct from 'object'
    or jsonb_typeof(p_document->'views') is distinct from 'array'
  then raise exception 'Invalid case document' using errcode='22023'; end if;
  settings:=p_document->'settings';
  if coalesce(settings->>'mode','') not in ('alignment','veneers','combined')
    or coalesce(settings->>'arch','') not in ('upper','lower','both')
    or settings-array['mode','arch','tone','alignmentStyle','finish','construction','intensity','instructions']<>'{}'::jsonb
    or jsonb_array_length(p_document->'views') not between 1 and 8
  then raise exception 'Invalid case settings' using errcode='22023'; end if;
  for role_name in select unnest(array['tone','alignmentStyle','finish','construction','intensity','instructions']) loop
    if jsonb_typeof(settings->role_name) is distinct from 'string'
      or length(settings->>role_name)>(case when role_name='instructions' then 500 else 60 end)
    then raise exception 'Invalid case settings' using errcode='22023'; end if;
  end loop;
  for v in select value from jsonb_array_elements(p_document->'views') loop
    view_name:=v->>'view';
    if jsonb_typeof(v) is distinct from 'object' or v-array['view','original','result']<>'{}'::jsonb
      or coalesce(view_name,'') not in ('frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight')
      or view_name=any(seen)
    then raise exception 'Invalid case view' using errcode='22023'; end if;
    seen:=array_append(seen,view_name);
    foreach role_name in array array['original','result'] loop
      a:=v->role_name;
      if role_name='result' and (a is null or a='null'::jsonb) then continue; end if;
      if a is null or jsonb_typeof(a) is distinct from 'object'
        or a-array['path','sha256','bytes','mime']<>'{}'::jsonb
        or coalesce(a->>'sha256','') !~ '^[0-9a-f]{64}$'
        or coalesce(a->>'mime','') not in ('image/jpeg','image/png','image/webp')
        or jsonb_typeof(a->'bytes') is distinct from 'number'
        or coalesce(a->>'bytes','') !~ '^[0-9]{1,8}$'
      then raise exception 'Invalid case asset' using errcode='22023'; end if;
      if (a->>'bytes')::bigint not between 16 and 10485760 then raise exception 'Asset too large' using errcode='22023'; end if;
      expected_path:=tenant::text||'/'||p_id::text||'/'||view_name||'/'||role_name||'-'||(a->>'sha256')||'.'||split_part(a->>'mime','/',2);
      if a->>'path' is distinct from expected_path then raise exception 'Foreign asset path' using errcode='42501'; end if;
      select metadata into meta from storage.objects where bucket_id='smyl-case-photos' and name=expected_path;
      if not found or meta->>'mimetype' is distinct from a->>'mime'
        or (meta->>'size')::bigint is distinct from (a->>'bytes')::bigint
      then raise exception 'Asset unavailable' using errcode='22023'; end if;
      total:=total+(a->>'bytes')::bigint;
      if total>41943040 then raise exception 'Case too large' using errcode='22023'; end if;
      if role_name='result' then result_count:=result_count+1; end if;
    end loop;
  end loop;
  if result_count=0 then raise exception 'Case requires result' using errcode='22023'; end if;
  if p_new_patient is not null then
    insert into public.camila_pacientes(id,tenant_id,nombre) values(patient,tenant,trim(p_new_patient->>'nombre'));
  elsif not exists(select 1 from public.camila_pacientes where id=patient and tenant_id=tenant) then
    raise exception 'Patient unavailable' using errcode='42501';
  end if;
  insert into public.smyl_patient_case_archive(id,tenant_id,patient_id,document,new_patient_request,created_by)
    values(p_id,tenant,patient,p_document,p_new_patient,tenant) returning * into old_case;
  return old_case;
end;
$$;

create function public.smyl_patient_cases(p_patient_id uuid) returns setof public.smyl_patient_case_archive
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.smyl_case_owner() or not exists(select 1 from public.camila_pacientes where id=p_patient_id and tenant_id=auth.uid())
  then raise exception 'Patient unavailable' using errcode='42501'; end if;
  return query select * from public.smyl_patient_case_archive where patient_id=p_patient_id and tenant_id=auth.uid()
    order by created_at desc,id limit 100;
end;
$$;
revoke all on function public.smyl_case_capabilities(),public.smyl_save_patient_case(uuid,uuid,jsonb,jsonb),public.smyl_patient_cases(uuid) from public,anon;
grant execute on function public.smyl_case_capabilities(),public.smyl_save_patient_case(uuid,uuid,jsonb,jsonb),public.smyl_patient_cases(uuid) to authenticated;
comment on table public.smyl_patient_case_archive is 'Immutable simulation archive, not clinical approval. SHA256 is checked by client on upload/download, not computed by PostgreSQL; Storage metadata checks do not decode images.';
commit;
