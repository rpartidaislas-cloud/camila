-- Local candidate: private, dentist-reviewed suggestions for immutable 2D dental radiographs.
-- No provider call, patient delivery, backfill or automatic diagnosis occurs in SQL.
begin;
create table public.smyl_radiograph_reviews (
 patient_id uuid not null, study_id uuid not null, tenant_id uuid not null,
 revision integer not null check(revision>0), document jsonb not null,
 updated_at timestamptz not null, updated_by uuid not null references auth.users(id),
 primary key(patient_id,study_id),
 foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_radiograph_review_versions (
 patient_id uuid not null, study_id uuid not null, tenant_id uuid not null,
 revision integer not null, document jsonb not null,
 updated_at timestamptz not null, updated_by uuid not null references auth.users(id),
 primary key(patient_id,study_id,revision),
 foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
alter table public.smyl_radiograph_reviews enable row level security;
alter table public.smyl_radiograph_review_versions enable row level security;
revoke all on public.smyl_radiograph_reviews,public.smyl_radiograph_review_versions from public,anon,authenticated;
grant select on public.smyl_radiograph_reviews,public.smyl_radiograph_review_versions to authenticated;
create policy radiograph_review_read on public.smyl_radiograph_reviews for select to authenticated using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));
create policy radiograph_review_history_read on public.smyl_radiograph_review_versions for select to authenticated using(tenant_id=(select auth.uid()) and (select public.smyl_case_owner()));

create function public.smyl_validate_radiograph_review(p_document jsonb,p_study jsonb)
returns void language plpgsql set search_path='' as $$
declare w jsonb; a jsonb; r jsonb; o jsonb; i jsonb; id_list text[]:=array[]::text[]; source_list text[]:=array[]::text[]; report_ids text[]:=array[]::text[];
begin
 if p_document is null or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>120000
 or p_document-array['schema','study','workflow','analysis','items']<>'{}'::jsonb
 or not(p_document ?& array['schema','study','workflow','analysis','items']) or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'study') is distinct from 'object' or (p_document->'study')-array['id','type','sha256']<>'{}'::jsonb
 or p_document->'study'->>'id' is distinct from p_study->>'id' or p_document->'study'->>'type' is distinct from p_study->>'type'
 or p_document->'study'->>'sha256' is distinct from p_study->'asset'->>'sha256'
 or jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items')>12
 then raise exception 'Invalid radiograph review' using errcode='22023'; end if;
 w:=p_document->'workflow';
 if jsonb_typeof(w) is distinct from 'object' or w-array['state','attempt']<>'{}'::jsonb or not(w ?& array['state','attempt'])
 or coalesce(w->>'state','') not in ('ready','requested','completed','unconfirmed')
 or jsonb_typeof(w->'attempt') is distinct from 'number' or coalesce(w->>'attempt','') !~ '^[01]$'
 then raise exception 'Invalid radiograph workflow' using errcode='22023'; end if;
 if (w->>'state'='ready' and ((w->>'attempt')::integer<>0 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 or (w->>'state' in ('requested','unconfirmed') and ((w->>'attempt')::integer<>1 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 then raise exception 'Invalid radiograph workflow state' using errcode='22023'; end if;
 a:=p_document->'analysis';
 if w->>'state'='completed' then
  if (w->>'attempt')::integer<>1 or jsonb_typeof(a) is distinct from 'object' or a-array['model','at','requestId','report']<>'{}'::jsonb
  or not(a ?& array['model','at','requestId','report']) or a->>'model' is distinct from 'claude-sonnet-4-6'
  or jsonb_typeof(a->'at') is distinct from 'string' or coalesce(a->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
  or jsonb_typeof(a->'requestId') is distinct from 'string' or (a->>'requestId'<>'' and a->>'requestId' !~ '^msg_[a-zA-Z0-9_-]{1,100}$')
  then raise exception 'Invalid radiograph analysis' using errcode='22023'; end if;
  perform (a->>'at')::timestamptz; r:=a->'report';
  if jsonb_typeof(r) is distinct from 'object' or r-array['schema','quality','qualityNote','observations','limitations']<>'{}'::jsonb
  or not(r ?& array['schema','quality','qualityNote','observations','limitations']) or r->'schema' is distinct from '1'::jsonb
  or coalesce(r->>'quality','') not in ('usable','limited','unusable') or jsonb_typeof(r->'qualityNote') is distinct from 'string' or length(trim(r->>'qualityNote')) not between 1 and 400
  or jsonb_typeof(r->'observations') is distinct from 'array' or jsonb_array_length(r->'observations')>12
  or jsonb_typeof(r->'limitations') is distinct from 'array' or jsonb_array_length(r->'limitations')>8
  then raise exception 'Invalid radiograph report' using errcode='22023'; end if;
  if r->>'quality'='unusable' and jsonb_array_length(r->'observations')<>0 then raise exception 'Unusable image cannot have observations' using errcode='22023'; end if;
  for o in select value from jsonb_array_elements(r->'observations') loop
   if jsonb_typeof(o) is distinct from 'object' or o-array['id','category','tooth','observation','evidence']<>'{}'::jsonb
   or not(o ?& array['id','category','tooth','observation','evidence']) or coalesce(o->>'id','') !~ '^r([1-9]|1[0-2])$' or o->>'id'=any(report_ids)
   or coalesce(o->>'category','') not in ('density','contour','restoration','support','development','other')
   or not(o->'tooth'='null'::jsonb or (jsonb_typeof(o->'tooth')='string' and o->>'tooth' ~ '^[1-4][1-8]$'))
   or jsonb_typeof(o->'observation') is distinct from 'string' or length(trim(o->>'observation')) not between 1 and 500
   or jsonb_typeof(o->'evidence') is distinct from 'string' or length(trim(o->>'evidence')) not between 1 and 300
   then raise exception 'Invalid radiograph observation' using errcode='22023'; end if;
   report_ids:=array_append(report_ids,o->>'id');
  end loop;
  for o in select value from jsonb_array_elements(r->'limitations') loop
   if jsonb_typeof(o) is distinct from 'string' or length(trim(o#>>'{}')) not between 1 and 300 then raise exception 'Invalid radiograph limitation' using errcode='22023'; end if;
  end loop;
 elsif a<>'null'::jsonb then raise exception 'Unexpected radiograph analysis' using errcode='22023';
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-array['id','sourceId','tooth','text','x','y','state']<>'{}'::jsonb
  or not(i ?& array['id','sourceId','tooth','text','x','y','state'])
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(id_list)
  or coalesce(i->>'sourceId','') !~ '^r([1-9]|1[0-2])$' or i->>'sourceId'=any(source_list) or not(i->>'sourceId'=any(report_ids))
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600 or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or not((i->'x'='null'::jsonb and i->'y'='null'::jsonb) or (jsonb_typeof(i->'x')='number' and jsonb_typeof(i->'y')='number' and (i->>'x')::numeric between 0 and 1 and (i->>'y')::numeric between 0 and 1))
  or (i->>'state'='confirmed' and (trim(i->>'text')='' or i->'x'='null'::jsonb))
  then raise exception 'Invalid reviewed radiograph item' using errcode='22023'; end if;
  id_list:=array_append(id_list,i->>'id');source_list:=array_append(source_list,i->>'sourceId');
 end loop;
 if cardinality(source_list)<>cardinality(report_ids) then raise exception 'Missing radiograph suggestion' using errcode='22023'; end if;
end;$$;
revoke all on function public.smyl_validate_radiograph_review(jsonb,jsonb) from public,anon,authenticated;

create function public.smyl_save_radiograph_review(p_patient_id uuid,p_study_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_radiograph_reviews language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); dental public.smyl_dental_records; source_study jsonb; old public.smyl_radiograph_reviews; result public.smyl_radiograph_reviews; prior jsonb; item jsonb;
begin
 if not public.smyl_case_owner() then raise exception 'Radiograph review access denied' using errcode='42501'; end if;
 select * into dental from public.smyl_dental_records where patient_id=p_patient_id and tenant_id=t;
 if not found then raise exception 'Foreign dental record' using errcode='42501'; end if;
 select value into source_study from jsonb_array_elements(dental.document->'studies') where value->>'id'=p_study_id::text;
 if source_study is null then raise exception 'Foreign radiograph' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid revision' using errcode='22023'; end if;
 perform public.smyl_validate_radiograph_review(p_document,source_study);
 perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text||p_study_id::text,31));
 select * into old from public.smyl_radiograph_reviews where patient_id=p_patient_id and study_id=p_study_id for update;
 if old.revision=p_expected_revision+1 and old.document=p_document then return old; end if;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception 'Radiograph review revision conflict' using errcode='PT409'; end if;
 if old.revision is null then
  if p_document->'workflow'->>'state'<>'ready' then raise exception 'Save an empty review first' using errcode='22023'; end if;
 else
  if old.document->'study'<>p_document->'study' then raise exception 'Radiograph evidence is immutable' using errcode='22023'; end if;
  if old.document->'workflow'->>'state'='ready' then
   if p_document->'workflow'->>'state'<>'requested' then raise exception 'Start one recorded request' using errcode='22023'; end if;
  elsif old.document->'workflow'->>'state'='requested' then
   if p_document->'workflow'->>'state' not in ('completed','unconfirmed') then raise exception 'Finish the recorded request once' using errcode='22023'; end if;
   if p_document->'workflow'->>'state'='completed' and exists(select 1 from jsonb_array_elements(p_document->'items') v where v->>'state'<>'pending') then raise exception 'New suggestions require review' using errcode='22023'; end if;
  elsif old.document->'workflow'->>'state'<>p_document->'workflow'->>'state' then raise exception 'Terminal review state is immutable' using errcode='22023';
  end if;
  if old.document->'workflow'->>'state'='completed' then
   if old.document->'analysis'<>p_document->'analysis' then raise exception 'Original analysis is immutable' using errcode='22023'; end if;
   for prior in select value from jsonb_array_elements(old.document->'items') loop
    select value into item from jsonb_array_elements(p_document->'items') where value->>'id'=prior->>'id';
    if item is null or item->>'sourceId' is distinct from prior->>'sourceId' then raise exception 'Keep suggestion identity; use rejected state' using errcode='22023'; end if;
   end loop;
  end if;
 end if;
 insert into public.smyl_radiograph_reviews(patient_id,study_id,tenant_id,revision,document,updated_at,updated_by)
 values(p_patient_id,p_study_id,t,p_expected_revision+1,p_document,clock_timestamp(),t)
 on conflict(patient_id,study_id) do update set revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into result;
 insert into public.smyl_radiograph_review_versions select result.*;
 return result;
end;$$;
revoke all on function public.smyl_save_radiograph_review(uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.smyl_save_radiograph_review(uuid,uuid,integer,jsonb) to authenticated;

create function public.smyl_radiograph_review_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'enabled',public.smyl_case_owner(),'tenant_id',auth.uid(),'review_schema',1,'provider','claude');
$$;
revoke all on function public.smyl_radiograph_review_capabilities() from public,anon;
grant execute on function public.smyl_radiograph_review_capabilities() to authenticated;
comment on table public.smyl_radiograph_reviews is 'Private radiograph suggestions with immutable evidence and explicit dentist review. Not a diagnosis or patient-facing document.';
commit;
