-- Manual odontogram + private radiographs. No AI provider enabled.
begin;
create table public.smyl_dental_records (
 patient_id uuid primary key, tenant_id uuid not null, revision integer not null check(revision>0),
 document jsonb not null, updated_at timestamptz not null, updated_by uuid not null references auth.users(id),
 foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_dental_versions (
 patient_id uuid not null, tenant_id uuid not null, revision integer not null,
 document jsonb not null, updated_at timestamptz not null, updated_by uuid not null references auth.users(id),
 primary key(patient_id,revision), foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
alter table public.smyl_dental_records enable row level security;
alter table public.smyl_dental_versions enable row level security;
revoke all on public.smyl_dental_records,public.smyl_dental_versions from public,anon,authenticated;
grant select on public.smyl_dental_records,public.smyl_dental_versions to authenticated;
create policy dental_read on public.smyl_dental_records for select to authenticated
 using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));
create policy dental_history_read on public.smyl_dental_versions for select to authenticated
 using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('smyl-radiographs','smyl-radiographs',false,20971520,array['image/png','image/jpeg']);
create function public.smyl_radiograph_path(p_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.smyl_case_owner() or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}\.(png|jpeg)$' then return false; end if;
 if split_part(p_name,'/',1)<>auth.uid()::text then return false; end if;
 return exists(select 1 from public.camila_pacientes where tenant_id=auth.uid() and id::text=split_part(p_name,'/',2));
end;$$;
revoke all on function public.smyl_radiograph_path(text) from public,anon;
grant execute on function public.smyl_radiograph_path(text) to authenticated;
create policy rx_read on storage.objects for select to authenticated using(bucket_id='smyl-radiographs' and public.smyl_radiograph_path(name));
create policy rx_insert on storage.objects for insert to authenticated with check(bucket_id='smyl-radiographs' and public.smyl_radiograph_path(name));
create policy rx_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'smyl-radiographs' or (auth.uid() is not null and public.smyl_radiograph_path(name)));
create policy rx_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'smyl-radiographs' or (auth.uid() is not null and public.smyl_radiograph_path(name)));
create policy rx_no_update on storage.objects as restrictive for update to public using(bucket_id<>'smyl-radiographs') with check(bucket_id<>'smyl-radiographs');
create policy rx_no_delete on storage.objects as restrictive for delete to public using(bucket_id<>'smyl-radiographs');

create function public.smyl_save_dental_record(p_patient_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_dental_records language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); result public.smyl_dental_records; item jsonb; k text; a jsonb; mark jsonb;
 seen text[]:=array[]::text[]; mark_ids text[]; expected text; metadata jsonb; old_study jsonb;
begin
 if not public.smyl_case_owner() or not exists(select 1 from public.camila_pacientes where id=p_patient_id and tenant_id=t)
 then raise exception 'Dental access denied' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_document is null
 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>500000
 or p_document-array['schema','teeth','studies']<>'{}'::jsonb or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'teeth') is distinct from 'object' or jsonb_typeof(p_document->'studies') is distinct from 'array'
 then raise exception 'Invalid dental record' using errcode='22023'; end if;
 if jsonb_array_length(p_document->'studies')>20 then raise exception 'Too many studies' using errcode='22023'; end if;
 for k,item in select key,value from jsonb_each(p_document->'teeth') loop
  if k !~ '^[1-4][1-8]$' or jsonb_typeof(item) is distinct from 'object'
   or item-array['observation','action','status']<>'{}'::jsonb
   or jsonb_typeof(item->'observation') is distinct from 'string' or length(item->>'observation')>2000
   or jsonb_typeof(item->'action') is distinct from 'string' or length(item->>'action')>2000
   or coalesce(item->>'status','') not in ('pending','following','done')
  then raise exception 'Invalid tooth note' using errcode='22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_document->'studies') loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['id','type','label','date','asset','notes','marks']<>'{}'::jsonb
   or coalesce(item->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (item->>'id')=any(seen) or coalesce(item->>'type','') not in ('panoramic','periapical','bitewing','other')
   or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label')>100
   or jsonb_typeof(item->'notes') is distinct from 'string' or length(item->>'notes')>4000
   or jsonb_typeof(item->'date') is distinct from 'string' or (item->>'date'<>'' and item->>'date' !~ '^\d{4}-\d{2}-\d{2}$')
   or jsonb_typeof(item->'marks') is distinct from 'array'
  then raise exception 'Invalid study' using errcode='22023'; end if;
  seen:=array_append(seen,item->>'id');
  if item->>'date'<>'' then perform (item->>'date')::date; end if;
  a:=item->'asset';
  if a is null or jsonb_typeof(a) is distinct from 'object' or a-array['path','sha256','mime','bytes']<>'{}'::jsonb
   or coalesce(a->>'sha256','') !~ '^[0-9a-f]{64}$' or coalesce(a->>'mime','') not in ('image/png','image/jpeg')
   or jsonb_typeof(a->'bytes') is distinct from 'number' or coalesce(a->>'bytes','') !~ '^[0-9]{1,8}$'
  then raise exception 'Invalid radiograph' using errcode='22023'; end if;
  if (a->>'bytes')::bigint not between 16 and 20971520 then raise exception 'Invalid size' using errcode='22023'; end if;
  expected:=t::text||'/'||p_patient_id::text||'/'||(item->>'id')||'/'||(a->>'sha256')||'.'||split_part(a->>'mime','/',2);
  if a->>'path' is distinct from expected then raise exception 'Foreign radiograph' using errcode='42501'; end if;
  select o.metadata into metadata from storage.objects o where bucket_id='smyl-radiographs' and name=expected;
  if not found or metadata->>'mimetype' is distinct from a->>'mime' or (metadata->>'size')::bigint is distinct from (a->>'bytes')::bigint
  then raise exception 'Radiograph unavailable' using errcode='22023'; end if;
  if jsonb_array_length(item->'marks')>50 then raise exception 'Too many marks' using errcode='22023'; end if;
  mark_ids:=array[]::text[];
  for mark in select value from jsonb_array_elements(item->'marks') loop
   if jsonb_typeof(mark) is distinct from 'object' or mark-array['id','x','y','tooth','note']<>'{}'::jsonb
    or coalesce(mark->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (mark->>'id')=any(mark_ids)
    or jsonb_typeof(mark->'x') is distinct from 'number' or jsonb_typeof(mark->'y') is distinct from 'number'
    or jsonb_typeof(mark->'note') is distinct from 'string' or length(mark->>'note')>2000
    or jsonb_typeof(mark->'tooth') is distinct from 'string' or (mark->>'tooth'<>'' and mark->>'tooth' !~ '^[1-4][1-8]$')
   then raise exception 'Invalid mark' using errcode='22023'; end if;
   if (mark->>'x')::numeric not between 0 and 1 or (mark->>'y')::numeric not between 0 and 1 then raise exception 'Invalid coordinates' using errcode='22023'; end if;
   mark_ids:=array_append(mark_ids,mark->>'id');
  end loop;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text,13));
 select * into result from public.smyl_dental_records where patient_id=p_patient_id for update;
 -- Idempotent acknowledgement of a successful save whose response was lost.
 if result.revision=p_expected_revision+1 and result.document=p_document then return result; end if;
 if coalesce(result.revision,0)<>p_expected_revision then raise exception 'Dental revision conflict' using errcode='40001'; end if;
 for old_study in select value from jsonb_array_elements(coalesce(result.document->'studies','[]'::jsonb)) loop
  if not exists(select 1 from jsonb_array_elements(p_document->'studies') v where v->>'id'=old_study->>'id' and v->'asset'=old_study->'asset')
  then raise exception 'Original radiographs are immutable' using errcode='22023'; end if;
 end loop;
 insert into public.smyl_dental_records(patient_id,tenant_id,revision,document,updated_by,updated_at)
 values(p_patient_id,t,p_expected_revision+1,p_document,t,clock_timestamp())
 on conflict(patient_id) do update set revision=excluded.revision,document=excluded.document,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into result;
 insert into public.smyl_dental_versions select result.*;
 return result;
end;$$;
revoke all on function public.smyl_save_dental_record(uuid,integer,jsonb) from public,anon;
grant execute on function public.smyl_save_dental_record(uuid,integer,jsonb) to authenticated;
comment on table public.smyl_dental_records is 'Manual professional notes, not AI findings. Immutable original files; metadata verified in SQL, content digest checked by clients. No clinical image interpretation enabled.';
commit;
