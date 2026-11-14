-- Hallazgos dentales estructurados, compatibles con el expediente dental v1.
--
-- El documento canónico conserva schema=1, teeth y studies. La extensión
-- opcional findings.schema=2 registra eventos append-only; no interpreta ni
-- reescribe observaciones históricas y deja autor/fecha en las versiones del
-- servidor.

create or replace function public.smyl_save_dental_record(p_patient_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_dental_records language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 v_tenant uuid:=public.smyl_current_tenant(); v_actor uuid:=auth.uid(); result public.smyl_dental_records;
 item jsonb; k text; a jsonb; mark jsonb; seen text[]:=array[]::text[]; mark_ids text[];
 expected text; metadata jsonb; old_study jsonb;
 finding_event jsonb; source_ref jsonb; finding_ids text[]:=array[]::text[];
 superseded_finding_ids text[]:=array[]::text[]; prior_finding jsonb;
 old_event jsonb; old_events jsonb; new_events jsonb; old_event_index bigint;
begin
 if v_actor is null or v_tenant is null
    or not public.smyl_has_permission(v_tenant,'clinical.write')
    or not exists(select 1 from public.camila_pacientes where id=p_patient_id and tenant_id=v_tenant)
    or not public.smyl_can_access_patient(v_tenant,p_patient_id,'clinical')
 then raise exception 'Dental access denied' using errcode='42501'; end if;

 if p_expected_revision is null or p_expected_revision<0 or p_document is null
 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>500000
 or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'teeth') is distinct from 'object'
 or jsonb_typeof(p_document->'studies') is distinct from 'array'
 or (
   (p_document ? 'findings' and p_document-array['schema','teeth','studies','findings']<>'{}'::jsonb)
   or (not (p_document ? 'findings') and p_document-array['schema','teeth','studies']<>'{}'::jsonb)
 )
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

 if p_document ? 'findings' then
  if jsonb_typeof(p_document->'findings') is distinct from 'object'
   or (p_document->'findings')-array['schema','events']<>'{}'::jsonb
   or p_document->'findings'->'schema' is distinct from '2'::jsonb
   or jsonb_typeof(p_document->'findings'->'events') is distinct from 'array'
   or jsonb_array_length(p_document->'findings'->'events')>200
  then raise exception 'Invalid dental findings' using errcode='22023'; end if;

  for finding_event in select value from jsonb_array_elements(p_document->'findings'->'events') loop
   if jsonb_typeof(finding_event) is distinct from 'object'
    or finding_event-array['id','tooth','surface','conditionCode','condition','state','capture','supersedes','sourceRef']<>'{}'::jsonb
    or coalesce(finding_event->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (finding_event->>'id')=any(finding_ids)
    or coalesce(finding_event->>'tooth','') !~ '^[1-4][1-8]$'
    or coalesce(finding_event->>'surface','') not in ('whole','M','D','V','L','O','I')
    or coalesce(finding_event->>'conditionCode','') not in ('caries','restoration','crown','endodontics','missing','implant','fracture','sealant','other')
    or jsonb_typeof(finding_event->'condition') is distinct from 'string'
    or btrim(coalesce(finding_event->>'condition',''))=''
    or length(finding_event->>'condition')>180
    or coalesce(finding_event->>'state','') not in ('active','following','resolved')
    or coalesce(finding_event->>'capture','') not in ('touch','voice')
    or not (finding_event ? 'supersedes')
    or not (finding_event ? 'sourceRef')
   then raise exception 'Invalid dental finding' using errcode='22023'; end if;

   if finding_event->>'surface'='O' and right(finding_event->>'tooth',1)::integer<4
   then raise exception 'Invalid occlusal surface' using errcode='22023'; end if;
   if finding_event->>'surface'='I' and right(finding_event->>'tooth',1)::integer>3
   then raise exception 'Invalid incisal surface' using errcode='22023'; end if;

   if finding_event->'supersedes'<>'null'::jsonb then
    if jsonb_typeof(finding_event->'supersedes') is distinct from 'string'
     or coalesce(finding_event->>'supersedes','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not ((finding_event->>'supersedes')=any(finding_ids))
     or (finding_event->>'supersedes')=any(superseded_finding_ids)
    then raise exception 'Invalid superseded finding' using errcode='22023'; end if;
    select value into prior_finding
    from jsonb_array_elements(p_document->'findings'->'events')
    where value->>'id'=finding_event->>'supersedes'
    limit 1;
    if prior_finding->>'tooth' is distinct from finding_event->>'tooth'
     or prior_finding->>'surface' is distinct from finding_event->>'surface'
     or prior_finding->'sourceRef' is distinct from finding_event->'sourceRef'
    then raise exception 'Invalid superseded finding target' using errcode='22023'; end if;
    superseded_finding_ids:=array_append(superseded_finding_ids,finding_event->>'supersedes');
   end if;

   source_ref:=finding_event->'sourceRef';
   if source_ref<>'null'::jsonb and (
      jsonb_typeof(source_ref) is distinct from 'object'
      or source_ref-array['type','id']<>'{}'::jsonb
      or source_ref->>'type' is distinct from 'evidence_finding'
      or coalesce(source_ref->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   ) then raise exception 'Invalid dental finding source' using errcode='22023'; end if;
   if source_ref<>'null'::jsonb and not exists(
      select 1 from public.smyl_clinical_evidence_findings f
      where f.tenant_id=v_tenant and f.patient_id=p_patient_id and f.id=(source_ref->>'id')::uuid
   ) then raise exception 'Foreign dental finding source' using errcode='42501'; end if;

   finding_ids:=array_append(finding_ids,finding_event->>'id');
  end loop;
 end if;

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
  expected:=v_tenant::text||'/'||p_patient_id::text||'/'||(item->>'id')||'/'||(a->>'sha256')||'.'||split_part(a->>'mime','/',2);
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
 select * into result from public.smyl_dental_records where tenant_id=v_tenant and patient_id=p_patient_id for update;
 -- Idempotent acknowledgement of a successful save whose response was lost.
 if result.revision=p_expected_revision+1 and result.document=p_document then return result; end if;
 if coalesce(result.revision,0)<>p_expected_revision then raise exception 'Dental revision conflict' using errcode='40001'; end if;

 old_events:=coalesce(result.document->'findings'->'events','[]'::jsonb);
 new_events:=coalesce(p_document->'findings'->'events','[]'::jsonb);
 if jsonb_typeof(old_events) is distinct from 'array'
  or jsonb_typeof(new_events) is distinct from 'array'
  or jsonb_array_length(new_events)<jsonb_array_length(old_events)
  or (result.document ? 'findings' and not (p_document ? 'findings'))
 then raise exception 'Dental findings are append only' using errcode='22023'; end if;
 for old_event,old_event_index in
  select value,ordinality from jsonb_array_elements(old_events) with ordinality
 loop
  if new_events->((old_event_index-1)::integer) is distinct from old_event
  then raise exception 'Dental findings are append only' using errcode='22023'; end if;
 end loop;

 for old_study in select value from jsonb_array_elements(coalesce(result.document->'studies','[]'::jsonb)) loop
  if not exists(select 1 from jsonb_array_elements(p_document->'studies') v where v->>'id'=old_study->>'id' and v->'asset'=old_study->'asset')
  then raise exception 'Original radiographs are immutable' using errcode='22023'; end if;
 end loop;
 insert into public.smyl_dental_records(patient_id,tenant_id,revision,document,updated_by,updated_at)
 values(p_patient_id,v_tenant,p_expected_revision+1,p_document,v_actor,clock_timestamp())
 on conflict(patient_id) do update set revision=excluded.revision,document=excluded.document,updated_by=excluded.updated_by,updated_at=excluded.updated_at
   where smyl_dental_records.tenant_id=excluded.tenant_id
 returning * into result;
 if result.patient_id is null then raise exception 'Dental access denied' using errcode='42501'; end if;
 insert into public.smyl_dental_versions select result.*;
 return result;
end;
$$;
revoke all on function public.smyl_save_dental_record(uuid,integer,jsonb) from public,anon;
grant execute on function public.smyl_save_dental_record(uuid,integer,jsonb) to authenticated;

