-- SMYL · Seguridad etapa 6: limpieza de advertencias del analizador.
begin;

create or replace function public.smyl_workflow_analysis(w jsonb, photos jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare spec jsonb; s jsonb; expected jsonb; a jsonb; f jsonb; p jsonb; img jsonb;
 idx integer:=0; pos integer; requested integer:=0; completed integer:=0;
 views text[]; all_images jsonb:='[]'::jsonb; sorted_images jsonb:='[]'::jsonb; all_findings jsonb:='[]'::jsonb;
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

create or replace function public.smyl_portal_publish(p_id uuid,p_case_id uuid,p_selection jsonb,p_token_hash text,p_code_hash text,p_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.smyl_patient_case_archive;old public.smyl_portal_shares;s jsonb;v jsonb;o jsonb;b jsonb;a jsonb:='[]'::jsonb;doc jsonb;obs jsonb:='[]'::jsonb;selected text[]:=array[]::text[];keys text[]:=array[]::text[];stamp timestamptz:=clock_timestamp();ver integer;
begin
 if (public.smyl_portal_capabilities()->>'enabled')::boolean is distinct from true then raise exception 'Portal disabled' using errcode='42501';end if;
 if p_id is null or p_case_id is null or p_days is null or p_days not in (1,7,14) or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_code_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'Invalid access' using errcode='22023';end if;
 select * into c from public.smyl_patient_case_archive where id=p_case_id and tenant_id=auth.uid();
 if not found then raise exception 'Case unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.patient_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,19));
 perform pg_advisory_xact_lock(hashtextextended(c.patient_id::text,13));
 perform pg_advisory_xact_lock(hashtextextended(c.id::text,73));
 select * into old from public.smyl_portal_shares where id=p_id;
 if found then
  if old.tenant_id=auth.uid() and old.case_id=p_case_id and old.selection=p_selection and old.token_hash=p_token_hash and old.code_hash=p_code_hash and old.expires_at=old.approved_at+make_interval(days=>p_days) then return jsonb_build_object('id',old.id,'version',old.version,'approved_at',old.approved_at,'expires_at',old.expires_at,'revoked_at',old.revoked_at);end if;
  raise exception 'Share conflict' using errcode='PT409';
 end if;
 if p_selection is null or jsonb_typeof(p_selection) is distinct from 'object' or octet_length(p_selection::text)>40000
 or p_selection-array['schema','title','summary','steps','observations','views','plan_revision','photo_revision','dental_revision','proposal_id','proposal_revision','include_budget','approved']<>'{}'
 or not(p_selection ?& array['schema','title','summary','steps','observations','views','plan_revision','photo_revision','dental_revision','proposal_id','proposal_revision','include_budget','approved'])
 or p_selection->'schema' is distinct from '1'::jsonb or p_selection->'approved' is distinct from 'true'::jsonb
 or jsonb_typeof(p_selection->'include_budget') is distinct from 'boolean'
 or jsonb_typeof(p_selection->'title') is distinct from 'string' or length(trim(p_selection->>'title')) not between 1 and 150
 or jsonb_typeof(p_selection->'summary') is distinct from 'string' or length(trim(p_selection->>'summary')) not between 1 and 5000
 or jsonb_typeof(p_selection->'steps') is distinct from 'array' or jsonb_typeof(p_selection->'observations') is distinct from 'array' or jsonb_typeof(p_selection->'views') is distinct from 'array'
 then raise exception 'Invalid selection' using errcode='22023';end if;
 if jsonb_array_length(p_selection->'steps') not between 1 and 20 or jsonb_array_length(p_selection->'observations')>64 or jsonb_array_length(p_selection->'views') not between 1 and 8 then raise exception 'Invalid size' using errcode='22023';end if;
 s:=public.smyl_portal_sources(c.id);
 if p_selection->'plan_revision' is distinct from s->'plan_revision' or p_selection->'photo_revision' is distinct from s->'photo_revision' or p_selection->'dental_revision' is distinct from s->'dental_revision' then raise exception 'Sources changed' using errcode='PT409';end if;
 for v in select value from jsonb_array_elements(p_selection->'steps') loop
  if jsonb_typeof(v) is distinct from 'object' or v-array['title','text']<>'{}' or jsonb_typeof(v->'title') is distinct from 'string' or length(trim(v->>'title')) not between 1 and 200 or jsonb_typeof(v->'text') is distinct from 'string' or length(v->>'text')>1000 then raise exception 'Invalid step' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_selection->'observations') loop
  if jsonb_typeof(v) is distinct from 'object' or v-array['source','id','tooth','text']<>'{}' or jsonb_typeof(v->'text') is distinct from 'string' or length(trim(v->>'text')) not between 1 and 600 or ((v->>'source')||':'||(v->>'id'))=any(keys) then raise exception 'Invalid observation' using errcode='22023';end if;
  if not exists(select 1 from jsonb_array_elements(s->'observations') q where q->'source'=v->'source' and q->'id'=v->'id' and q->'tooth'=v->'tooth') then raise exception 'Unreviewed observation' using errcode='22023';end if;
  keys:=array_append(keys,(v->>'source')||':'||(v->>'id'));obs:=obs||jsonb_build_array(jsonb_build_object('tooth',v->>'tooth','text',trim(v->>'text')));
 end loop;
 for v in select value from jsonb_array_elements(p_selection->'views') loop
  if jsonb_typeof(v) is distinct from 'string' or v#>>'{}'=any(selected) then raise exception 'Invalid view' using errcode='22023';end if;
  select x into o from jsonb_array_elements(c.document->'views') x where x->'view'=v and jsonb_typeof(x->'result')='object';
  if not found then raise exception 'Foreign view' using errcode='22023';end if;
  selected:=array_append(selected,v#>>'{}');a:=a||jsonb_build_array(o);
 end loop;
 doc:=jsonb_build_object('schema',1,'title',trim(p_selection->>'title'),'summary',trim(p_selection->>'summary'),'clinic',s->'clinic','steps',p_selection->'steps','observations',obs);
 if p_selection->'include_budget'='true'::jsonb then
  select q into b from jsonb_array_elements(s->'proposals') q where q->'id'=p_selection->'proposal_id' and q->'revision'=p_selection->'proposal_revision';
  if not found then raise exception 'Budget changed or unavailable' using errcode='PT409';end if;
  doc:=doc||jsonb_build_object('budget',jsonb_build_object('currency','MXN','items',b->'items','total_cents',b->'total_cents','terms',b->>'terms','valid_until',b->>'valid_until'));
 elsif p_selection->'proposal_id'<>'null'::jsonb or p_selection->'proposal_revision'<>'0'::jsonb then raise exception 'Omit budget source' using errcode='22023';
 end if;
 select coalesce(max(version),0)+1 into ver from public.smyl_portal_shares where case_id=c.id;
 -- A newly approved version withdraws older links for this case atomically.
 update public.smyl_portal_shares set revoked_at=stamp where case_id=c.id and revoked_at is null;
 insert into public.smyl_portal_shares(id,tenant_id,patient_id,case_id,version,document,selection,assets,token_hash,code_hash,approved_by,approved_at,expires_at)
 values(p_id,c.tenant_id,c.patient_id,c.id,ver,doc,p_selection,a,p_token_hash,p_code_hash,auth.uid(),stamp,stamp+make_interval(days=>p_days));
 return jsonb_build_object('id',p_id,'version',ver,'approved_at',stamp,'expires_at',stamp+make_interval(days=>p_days),'revoked_at',null);
end;$$;

create or replace function public.smyl_save_photo_review(p_case_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_photo_reviews language plpgsql security definer set search_path='' as $$
declare t uuid:=auth.uid(); c public.smyl_patient_case_archive; old public.smyl_photo_reviews;
 result public.smyl_photo_reviews; p jsonb; a jsonb; r jsonb; i jsonb; prior jsonb;
 views text[]:=array[]::text[]; ids text[]:=array[]::text[]; sources text[]:=array[]::text[];
 findings text[]:=array[]::text[];
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

create or replace function public.smyl_save_clinical_plan_v2(
  p_tenant_id uuid, p_patient_id uuid, p_expected_revision integer,
  p_document jsonb, p_review boolean default false
) returns public.smyl_clinical_plans
language plpgsql security definer set search_path='' as $$
declare
  result public.smyl_clinical_plans; item jsonb;
  service public.smyl_services; expected_snapshot jsonb; ids text[]:=array[]::text[];
  stamp timestamptz:=clock_timestamp();
begin
  if auth.uid() is null
    or not public.smyl_has_permission(p_tenant_id, 'clinical.write')
    or (p_review and not public.smyl_has_permission(p_tenant_id, 'clinical.approve'))
    or not exists(select 1 from public.camila_pacientes where id=p_patient_id and tenant_id=p_tenant_id)
  then raise exception 'Clinical access denied' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0 or p_review is null
    or p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>160000
    or p_document->'schema' is distinct from '2'::jsonb
    or p_document-array['schema','reason','background','assessment','treatments']<>'{}'::jsonb
    or jsonb_typeof(p_document->'reason')<>'string' or jsonb_typeof(p_document->'background')<>'string'
    or jsonb_typeof(p_document->'assessment')<>'string' or jsonb_typeof(p_document->'treatments')<>'array'
    or length(p_document->>'reason')>2000 or length(p_document->>'background')>8000
    or length(p_document->>'assessment')>8000 or jsonb_array_length(p_document->'treatments')>20
  then raise exception 'Invalid clinical document v2' using errcode='22023'; end if;

  for item in select value from jsonb_array_elements(p_document->'treatments') loop
    if jsonb_typeof(item)<>'object' or item-array['id','name','area','notes','phase','service_id','service_revision','service_snapshot','teeth','surfaces']<>'{}'::jsonb
      or coalesce(item->>'id','') !~ '^[A-Za-z0-9-]{1,64}$' or (item->>'id')=any(ids)
      or jsonb_typeof(item->'name')<>'string' or jsonb_typeof(item->'area')<>'string' or jsonb_typeof(item->'notes')<>'string'
      or length(item->>'name')>200 or length(item->>'area')>200 or length(item->>'notes')>2000
      or coalesce(item->>'phase','') not in ('evaluate','prevent','stabilize','treat','maintain')
      or jsonb_typeof(item->'teeth')<>'array' or jsonb_array_length(item->'teeth')>32
      or jsonb_typeof(item->'surfaces')<>'array' or jsonb_array_length(item->'surfaces')>6
      or (p_review and length(trim(item->>'name'))=0)
    then raise exception 'Invalid treatment v2' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');
    if (select count(*)<>count(distinct value) from jsonb_array_elements_text(item->'teeth'))
      or exists(select 1 from jsonb_array_elements_text(item->'teeth') v(value) where value !~ '^[1-4][1-8]$')
      or (select count(*)<>count(distinct value) from jsonb_array_elements_text(item->'surfaces'))
      or exists(select 1 from jsonb_array_elements_text(item->'surfaces') v(value) where value not in ('M','D','O','V','L','I'))
      or (jsonb_array_length(item->'surfaces')>0 and jsonb_array_length(item->'teeth')=0)
    then raise exception 'Invalid dental targets' using errcode='22023'; end if;
    if item->'service_id'='null'::jsonb then
      if item->'service_revision'<>'null'::jsonb or item->'service_snapshot'<>'null'::jsonb
      then raise exception 'Invalid manual treatment service' using errcode='22023'; end if;
    else
      if coalesce(item->>'service_id','') !~ '^[0-9a-f-]{36}$'
        or jsonb_typeof(item->'service_revision')<>'number'
        or jsonb_typeof(item->'service_snapshot')<>'object'
      then raise exception 'Invalid service link' using errcode='22023'; end if;
      select * into service from public.smyl_services
      where id=(item->>'service_id')::uuid and tenant_id=p_tenant_id and active
        and catalog_revision=(item->>'service_revision')::integer;
      if not found then raise exception 'Service is unavailable or changed' using errcode='40001'; end if;
      expected_snapshot:=jsonb_build_object(
        'name',service.name,'patient_name',service.patient_name,'category',service.category,'specialty',service.specialty,
        'scope_type',service.scope_type,'pricing_mode',service.pricing_mode,'reference_price',service.reference_price,
        'currency',service.currency,'sat_product_service_code',service.sat_product_service_code,
        'sat_unit_code',service.sat_unit_code,'tax_object_code',service.tax_object_code,'fiscal_status',service.fiscal_status
      );
      if item->'service_snapshot' is distinct from expected_snapshot
      then raise exception 'Service snapshot mismatch' using errcode='40001'; end if;
    end if;
  end loop;
  if p_review and (length(trim(p_document->>'assessment'))=0 or jsonb_array_length(p_document->'treatments')=0)
  then raise exception 'Review requires assessment and plan' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text,0));
  select * into result from public.smyl_clinical_plans where patient_id=p_patient_id for update;
  if coalesce(result.revision,0)<>p_expected_revision
  then raise exception 'Clinical revision conflict' using errcode='40001'; end if;
  insert into public.smyl_clinical_plans(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at)
  values(p_patient_id,p_tenant_id,p_document,p_expected_revision+1,case when p_review then 'reviewed' else 'draft' end,auth.uid(),stamp,
    case when p_review then auth.uid() end,case when p_review then stamp end)
  on conflict(patient_id) do update set document=excluded.document,revision=excluded.revision,status=excluded.status,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at
  returning * into result;
  insert into public.smyl_clinical_versions(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at)
  values(result.patient_id,result.tenant_id,result.document,result.revision,result.status,result.updated_by,result.updated_at,result.reviewed_by,result.reviewed_at);
  return result;
end;$$;

commit;
