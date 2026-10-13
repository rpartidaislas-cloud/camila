-- PostgREST can retry 40001 indefinitely. This business conflict must return HTTP 409.
-- Only the photo-review RPC changes; no schema, data, grant or policy changes.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;
create or replace function public.smyl_save_photo_review(p_case_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_photo_reviews language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); c public.smyl_patient_case_archive; old public.smyl_photo_reviews;
 result public.smyl_photo_reviews; p jsonb; a jsonb; r jsonb; i jsonb; f jsonb; prior jsonb;
 views text[]:=array[]::text[]; ids text[]:=array[]::text[]; sources text[]:=array[]::text[];
 findings text[]:=array[]::text[]; images text[]:=array[]::text[];
begin
 if not public.smyl_case_owner() then raise exception 'Photo review access denied' using errcode='42501'; end if;
 select * into c from public.smyl_patient_case_archive where id=p_case_id and tenant_id=t;
 if not found then raise exception 'Foreign case' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_document is null
 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>150000
 or p_document-array['schema','photos','analysis','items']<>'{}'::jsonb
 or not(p_document ?& array['schema','photos','analysis','items'])
 or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'photos') is distinct from 'array'
 or jsonb_typeof(p_document->'items') is distinct from 'array'
 then raise exception 'Invalid review' using errcode='22023'; end if;
 if jsonb_array_length(p_document->'photos') not between 1 and 8 or jsonb_array_length(p_document->'items')>64
 then raise exception 'Invalid review size' using errcode='22023'; end if;
 for p in select value from jsonb_array_elements(p_document->'photos') loop
  if jsonb_typeof(p) is distinct from 'object' or p-array['view','sha256']<>'{}'::jsonb
  or jsonb_typeof(p->'view') is distinct from 'string' or jsonb_typeof(p->'sha256') is distinct from 'string'
  or coalesce(p->>'sha256','') !~ '^[a-f0-9]{64}$' or (p->>'view')=any(views)
  then raise exception 'Invalid photo' using errcode='22023'; end if;
  if not exists(select 1 from jsonb_array_elements(c.document->'views') v where v->>'view'=p->>'view' and v->'original'->>'sha256'=p->>'sha256')
  then raise exception 'Foreign original' using errcode='42501'; end if;
  views:=array_append(views,p->>'view');
 end loop;
 a:=p_document->'analysis';
 if a<>'null'::jsonb then
  if jsonb_typeof(a) is distinct from 'object' or a-array['model','at','requestId','report']<>'{}'::jsonb
  or not(a ?& array['model','at','requestId','report']) or a->>'model' is distinct from 'claude-sonnet-4-6'
  or jsonb_typeof(a->'at') is distinct from 'string' or coalesce(a->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
  or jsonb_typeof(a->'requestId') is distinct from 'string' or (a->>'requestId'<>'' and a->>'requestId' !~ '^msg_[a-zA-Z0-9_-]{1,100}$')
  then raise exception 'Invalid analysis metadata' using errcode='22023'; end if;
  perform (a->>'at')::timestamptz; r:=a->'report';
  if jsonb_typeof(r) is distinct from 'object' or r-array['schema','images','findings','limitations']<>'{}'::jsonb
  or r->'schema' is distinct from '1'::jsonb or jsonb_typeof(r->'images') is distinct from 'array'
  or jsonb_typeof(r->'findings') is distinct from 'array' or jsonb_typeof(r->'limitations') is distinct from 'array'
  then raise exception 'Invalid analysis report' using errcode='22023'; end if;
  if jsonb_array_length(r->'images')<>cardinality(views) or jsonb_array_length(r->'findings')>32 or jsonb_array_length(r->'limitations')>8
  then raise exception 'Invalid report size' using errcode='22023'; end if;
  for i in select value from jsonb_array_elements(r->'images') loop
   if jsonb_typeof(i) is distinct from 'object' or i-array['view','quality','note']<>'{}'::jsonb
   or not coalesce(i->>'view'=any(views),false) or i->>'view'=any(images)
   or coalesce(i->>'quality','') not in ('usable','limited','unusable')
   or jsonb_typeof(i->'note') is distinct from 'string' or length(trim(i->>'note')) not between 1 and 300
   then raise exception 'Invalid image quality' using errcode='22023'; end if;
   images:=array_append(images,i->>'view');
  end loop;
  for f in select value from jsonb_array_elements(r->'findings') loop
   if jsonb_typeof(f) is distinct from 'object' or f-array['id','view','tooth','category','observation','evidence']<>'{}'::jsonb
   or not(f ?& array['id','view','tooth','category','observation','evidence'])
   or coalesce(f->>'id','') !~ '^f[1-9][0-9]?$' or f->>'id'=any(findings)
   or not coalesce(f->>'view'=any(views),false)
   or not(f->'tooth'='null'::jsonb or (jsonb_typeof(f->'tooth')='string' and f->>'tooth' ~ '^[1-4][1-8]$'))
   or coalesce(f->>'category','') not in ('deposit','color','wear','position','gap','soft_tissue','other')
   or jsonb_typeof(f->'observation') is distinct from 'string' or length(trim(f->>'observation')) not between 1 and 400
   or jsonb_typeof(f->'evidence') is distinct from 'string' or length(trim(f->>'evidence')) not between 1 and 250
   or exists(select 1 from jsonb_array_elements(r->'images') q where q->>'view'=f->>'view' and q->>'quality'='unusable')
   then raise exception 'Invalid suggestion' using errcode='22023'; end if;
   findings:=array_append(findings,f->>'id');
  end loop;
  for i in select value from jsonb_array_elements(r->'limitations') loop
   if jsonb_typeof(i) is distinct from 'string' or length(trim(i#>>'{}')) not between 1 and 300
   then raise exception 'Invalid limitation' using errcode='22023'; end if;
  end loop;
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-array['id','sourceId','view','tooth','text','state']<>'{}'::jsonb
  or not(i ?& array['id','sourceId','view','tooth','text','state'])
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(ids)
  or jsonb_typeof(i->'sourceId') is distinct from 'string' or length(i->>'sourceId')>4
  or not coalesce(i->>'view'=any(views),false)
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600
  or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or (i->>'state'='confirmed' and (i->>'tooth'='' or trim(i->>'text')=''))
  then raise exception 'Invalid review item' using errcode='22023'; end if;
  ids:=array_append(ids,i->>'id');
  if i->>'sourceId'<>'' then
   if i->>'sourceId'=any(sources) or not exists(select 1 from jsonb_array_elements(r->'findings') as source_finding(value) where source_finding.value->>'id'=i->>'sourceId' and source_finding.value->>'view'=i->>'view')
   then raise exception 'Invalid suggestion source' using errcode='22023'; end if;
   sources:=array_append(sources,i->>'sourceId');
  end if;
 end loop;
 if cardinality(sources)<>cardinality(findings) then raise exception 'Missing suggestion' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case_id::text,19));
 select * into old from public.smyl_photo_reviews where case_id=p_case_id for update;
 if old.revision=p_expected_revision+1 and old.document=p_document then return old; end if;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception 'Review revision conflict' using errcode='PT409'; end if;
 if old.revision is not null then
  if old.document->'photos'<>p_document->'photos' or old.document->'analysis'<>p_document->'analysis'
  then raise exception 'Original analysis is immutable' using errcode='22023'; end if;
  for prior in select value from jsonb_array_elements(old.document->'items') loop
   if not exists(select 1 from jsonb_array_elements(p_document->'items') v where v->>'id'=prior->>'id' and v->'sourceId'=prior->'sourceId' and v->'view'=prior->'view')
   then raise exception 'Keep item identity; use rejected state' using errcode='22023'; end if;
  end loop;
 end if;
 insert into public.smyl_photo_reviews(case_id,tenant_id,patient_id,revision,document,updated_at,updated_by)
 values(p_case_id,t,c.patient_id,p_expected_revision+1,p_document,clock_timestamp(),t)
 on conflict(case_id) do update set revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into result;
 insert into public.smyl_photo_review_versions select result.*;
 return result;
end;$$;
commit;

