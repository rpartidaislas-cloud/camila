-- Local candidate: bounded specialist runs. Publish compatible readers before activating.
-- No backfill, broader grants, provider calls or patient delivery.
begin;
create or replace function public.smyl_validate_photo_analysis(a jsonb, views text[], max_findings integer)
returns void language plpgsql set search_path='' as $$
declare r jsonb; i jsonb; f jsonb; images text[]:=array[]::text[]; findings text[]:=array[]::text[];
begin
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
  if jsonb_array_length(r->'images')<>cardinality(views) or jsonb_array_length(r->'findings')>max_findings or jsonb_array_length(r->'limitations')>8
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

end;$$;

create or replace function public.smyl_workflow_analysis(w jsonb, photos jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare spec jsonb; s jsonb; expected jsonb; a jsonb; f jsonb; p jsonb; img jsonb;
 idx integer:=0; pos integer; requested integer:=0; completed integer:=0;
 views text[]; all_images jsonb:='[]'; sorted_images jsonb:='[]'; all_findings jsonb:='[]';
begin
 if jsonb_typeof(w) is distinct from 'object' or w-array['schema','at','stages']<>'{}'::jsonb
 or not(w ?& array['schema','at','stages']) or w->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(w->'at') is distinct from 'string'
 or coalesce(w->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
 or jsonb_typeof(w->'stages') is distinct from 'array'
 then raise exception 'Invalid workflow' using errcode='22023'; end if;
 perform (w->>'at')::timestamptz;
 for spec in select value from jsonb_array_elements('[{"key":"front","views":["frontal","extraoral"],"offset":0},{"key":"side","views":["left","right","tresCuartos"],"offset":10},{"key":"intraoral","views":["intraoral","intraoralLeft","intraoralRight"],"offset":20}]'::jsonb) loop
  select coalesce(jsonb_agg(v.value->'view' order by v.ordinality),'[]'::jsonb) into expected
  from jsonb_array_elements(photos) with ordinality v where spec->'views' ? (v.value->>'view');
  if jsonb_array_length(expected)=0 then continue; end if;
  s:=w->'stages'->idx; idx:=idx+1;
  if jsonb_typeof(s) is distinct from 'object' or s-array['key','views','state','attempt','result']<>'{}'::jsonb
  or not(s ?& array['key','views','state','attempt','result']) or s->'key' is distinct from spec->'key'
  or s->'views' is distinct from expected or coalesce(s->>'state','') not in ('ready','requested','completed','unconfirmed')
  then raise exception 'Invalid workflow stage' using errcode='22023'; end if;
  if (s->>'state'='ready' and s->'attempt' is distinct from 'null'::jsonb)
  or (s->>'state'<>'ready' and (jsonb_typeof(s->'attempt') is distinct from 'string' or coalesce(s->>'attempt','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))
  then raise exception 'Invalid stage attempt' using errcode='22023'; end if;
  if s->>'state'='requested' then requested:=requested+1; end if;
  if s->>'state'<>'completed' then
   if s->'result' is distinct from 'null'::jsonb then raise exception 'Unexpected workflow result' using errcode='22023'; end if;
  else
   a:=s->'result'; if a='null'::jsonb then raise exception 'Missing stage result' using errcode='22023'; end if;
   select array_agg(value) into views from jsonb_array_elements_text(expected);
   perform public.smyl_validate_photo_analysis(a,views,10);
   completed:=completed+1;
   all_images:=all_images||(a->'report'->'images'); pos:=0;
   for f in select value from jsonb_array_elements(a->'report'->'findings') loop
    pos:=pos+1;all_findings:=all_findings||jsonb_build_array(jsonb_set(f,'{id}',to_jsonb('f'||((spec->>'offset')::integer+pos)::text)));
   end loop;
  end if;
 end loop;
 if idx=0 or idx<>jsonb_array_length(w->'stages') or requested>1 then raise exception 'Invalid workflow plan' using errcode='22023'; end if;
 if completed=0 then return 'null'::jsonb; end if;
 for p in select value from jsonb_array_elements(photos) loop
  select value into img from jsonb_array_elements(all_images) where value->>'view'=p->>'view';
  if img is not null then sorted_images:=sorted_images||jsonb_build_array(img); end if;
 end loop;
 return jsonb_build_object('model','claude-sonnet-4-6','at',w->'at','requestId','','report',
 jsonb_build_object('schema',1,'images',sorted_images,'findings',all_findings,'limitations','[]'::jsonb));
end;$$;

create or replace function public.smyl_check_workflow_transition(old_doc jsonb, new_doc jsonb)
returns void language plpgsql set search_path='' as $$
declare s jsonb; prior jsonb; changed integer:=0; idx integer:=0; i jsonb;
begin
 if old_doc is null then
  if new_doc->'analysis'<>'null'::jsonb or jsonb_array_length(new_doc->'items')<>0
  or exists(select 1 from jsonb_array_elements(new_doc->'workflow'->'stages') v where v->>'state'<>'ready')
  then raise exception 'Start with a saved empty workflow' using errcode='22023'; end if;
  return;
 end if;
 if old_doc->'schema'<>'3'::jsonb or new_doc->'schema'<>'3'::jsonb
 or old_doc->'workflow'->'at' is distinct from new_doc->'workflow'->'at'
 then raise exception 'Keep workflow identity' using errcode='22023'; end if;
 for s in select value from jsonb_array_elements(new_doc->'workflow'->'stages') loop
  prior:=old_doc->'workflow'->'stages'->idx;idx:=idx+1;
  if prior->'key' is distinct from s->'key' or prior->'views' is distinct from s->'views'
  then raise exception 'Keep stage identity' using errcode='22023'; end if;
  if prior is distinct from s then
   changed:=changed+1;
   if not ((prior->>'state'='ready' and s->>'state'='requested') or (prior->>'state'='requested' and s->>'state' in ('completed','unconfirmed')))
   then raise exception 'Workflow stage cannot be repeated or rewritten' using errcode='22023'; end if;
   if prior->>'state'='requested' and prior->'attempt' is distinct from s->'attempt'
   then raise exception 'Keep request attempt identity' using errcode='22023'; end if;
  end if;
 end loop;
 if changed>1 or idx<>jsonb_array_length(old_doc->'workflow'->'stages')
 then raise exception 'Save one stage transition at a time' using errcode='22023'; end if;
 for i in select value from jsonb_array_elements(new_doc->'items') loop
  if i->>'sourceId'<>'' and not exists(select 1 from jsonb_array_elements(old_doc->'items') v where v->>'id'=i->>'id') and i->>'state'<>'pending'
  then raise exception 'New suggestions require professional review' using errcode='22023'; end if;
 end loop;
end;$$;
revoke all on function public.smyl_validate_photo_analysis(jsonb,text[],integer) from public,anon,authenticated;
revoke all on function public.smyl_workflow_analysis(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.smyl_check_workflow_transition(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.smyl_save_photo_review(p_case_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_photo_reviews language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); c public.smyl_patient_case_archive; old public.smyl_photo_reviews;
 result public.smyl_photo_reviews; p jsonb; a jsonb; r jsonb; i jsonb; f jsonb; prior jsonb;
 views text[]:=array[]::text[]; ids text[]:=array[]::text[]; sources text[]:=array[]::text[];
 findings text[]:=array[]::text[]; images text[]:=array[]::text[];
 expected_evidence jsonb; previous_evidence jsonb; next_item jsonb; analysis_views text[];
begin
 if not public.smyl_case_owner() then raise exception 'Photo review access denied' using errcode='42501'; end if;
 select * into c from public.smyl_patient_case_archive where id=p_case_id and tenant_id=t;
 if not found then raise exception 'Foreign case' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_document is null
 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>250000
 or p_document-(array['schema','photos','analysis','items'] || case when p_document->'schema'='3'::jsonb then array['workflow'] else array[]::text[] end)<>'{}'::jsonb
 or not(p_document ?& array['schema','photos','analysis','items'])
 or coalesce(p_document->'schema','null'::jsonb) not in ('1'::jsonb,'2'::jsonb,'3'::jsonb)
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
 analysis_views:=views;
 if p_document->'schema'='3'::jsonb then
  if public.smyl_workflow_analysis(p_document->'workflow',p_document->'photos') is distinct from a
  then raise exception 'Aggregate does not match stage evidence' using errcode='22023'; end if;
  select coalesce(array_agg(value->>'view'),array[]::text[]) into analysis_views from jsonb_array_elements(a->'report'->'images');
  if (select count(*) from jsonb_array_elements(p_document->'items') v where v->>'sourceId'='')>34
  then raise exception 'Reserve space for pending specialists' using errcode='22023'; end if;
 end if;
 perform public.smyl_validate_photo_analysis(a,analysis_views,32);
 if a<>'null'::jsonb then
  r:=a->'report';
  select coalesce(array_agg(value->>'id'),array[]::text[]) into findings from jsonb_array_elements(r->'findings');
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-(array['id','sourceId','view','tooth','text','state'] || case when p_document->'schema' in ('2'::jsonb,'3'::jsonb) then array['evidence'] else array[]::text[] end)<>'{}'::jsonb
  or not(i ?& array['id','sourceId','view','tooth','text','state'])
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(ids)
  or jsonb_typeof(i->'sourceId') is distinct from 'string' or length(i->>'sourceId')>4
  or not coalesce(i->>'view'=any(views),false)
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600
  or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or (i->>'state'='confirmed' and (i->>'tooth'='' or trim(i->>'text')=''))
  then raise exception 'Invalid review item' using errcode='22023'; end if;
  if p_document->'schema' in ('2'::jsonb,'3'::jsonb) then
   if jsonb_typeof(i->'evidence') is distinct from 'array' then raise exception 'Invalid evidence list' using errcode='22023'; end if;
   if jsonb_array_length(i->'evidence') not between 1 and cardinality(views)
   or not exists(select 1 from jsonb_array_elements(i->'evidence') e where e->>'view'=i->>'view')
   then raise exception 'Keep origin evidence' using errcode='22023'; end if;
   select coalesce(jsonb_agg(src.value order by src.ordinality),'[]'::jsonb) into expected_evidence
   from jsonb_array_elements(p_document->'photos') with ordinality src
   where exists(select 1 from jsonb_array_elements(i->'evidence') e where e->>'view'=src.value->>'view');
   if i->'evidence'<>expected_evidence then raise exception 'Invalid or foreign evidence' using errcode='22023'; end if;
  end if;
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
 if p_document->'schema'='3'::jsonb then perform public.smyl_check_workflow_transition(old.document,p_document); end if;
 if old.revision is not null then
  if (old.document->>'schema')::integer>(p_document->>'schema')::integer
  then raise exception 'Evidence schema cannot be downgraded' using errcode='22023'; end if;
  if old.document->'photos'<>p_document->'photos' or (p_document->'schema'<>'3'::jsonb and old.document->'analysis'<>p_document->'analysis')
  then raise exception 'Original analysis is immutable' using errcode='22023'; end if;
  for prior in select value from jsonb_array_elements(old.document->'items') loop
   if not exists(select 1 from jsonb_array_elements(p_document->'items') v where v->>'id'=prior->>'id' and v->'sourceId'=prior->'sourceId' and v->'view'=prior->'view')
   then raise exception 'Keep item identity; use rejected state' using errcode='22023'; end if;
  end loop;
 end if;
 -- Evidence changes must first commit as pending. A separate save may confirm them.
 if p_document->'schema' in ('2'::jsonb,'3'::jsonb) then
  for next_item in select value from jsonb_array_elements(p_document->'items') loop
   select value into prior from jsonb_array_elements(coalesce(old.document->'items','[]'::jsonb)) where value->>'id'=next_item->>'id';
   if prior is not null and old.document->'schema' in ('2'::jsonb,'3'::jsonb) then previous_evidence:=prior->'evidence';
   else select jsonb_agg(value) into previous_evidence from jsonb_array_elements(p_document->'photos') where value->>'view'=next_item->>'view'; end if;
   if previous_evidence is distinct from next_item->'evidence' and next_item->>'state'<>'pending'
   then raise exception 'Changed evidence requires pending review' using errcode='22023'; end if;
  end loop;
 end if;
 insert into public.smyl_photo_reviews(case_id,tenant_id,patient_id,revision,document,updated_at,updated_by)
 values(p_case_id,t,c.patient_id,p_expected_revision+1,p_document,clock_timestamp(),t)
 on conflict(case_id) do update set revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at,updated_by=excluded.updated_by returning * into result;
 insert into public.smyl_photo_review_versions select result.*;
 return result;
end;$$;
create or replace function public.smyl_photo_review_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'enabled',public.smyl_case_owner(),'tenant_id',auth.uid(),'review_schema',3,'multi_evidence',true,'specialist_workflow',1);
$$;
-- Existing grants are preserved by CREATE OR REPLACE; explicitly keep anonymous callers out.
revoke all on function public.smyl_photo_review_capabilities() from public,anon;
grant execute on function public.smyl_photo_review_capabilities() to authenticated;
commit;

