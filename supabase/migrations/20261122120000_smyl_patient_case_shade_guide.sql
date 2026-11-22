-- Simulaciones en la ficha: el simulador manda desde el 8-nov-2026 la guía de color usada (`shadeGuide`:
-- classical = VITA clásica, bleached = tonos de blanqueamiento BL). La función rechazaba cualquier llave
-- desconocida con «Invalid case settings», así que ningún «Guardar en la ficha» llegaba a guardarse.
-- Se acepta `shadeGuide` (opcional, solo esos dos valores); el resto de la validación queda idéntica.

create or replace function public.smyl_save_patient_case(p_id uuid,p_patient_id uuid,p_new_patient jsonb,p_document jsonb)
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
    or settings-array['mode','arch','shadeGuide','tone','alignmentStyle','finish','construction','intensity','instructions']<>'{}'::jsonb
    or (settings ? 'shadeGuide' and coalesce(settings->>'shadeGuide','') not in ('classical','bleached'))
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

revoke all on function public.smyl_save_patient_case(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.smyl_save_patient_case(uuid,uuid,jsonb,jsonb) to authenticated;
