-- SMYL · Etapa UX 1: catálogo canónico y permisos clínicos profesionales.
-- Aditiva: conserva documentos, versiones e historiales existentes.
begin;

drop policy if exists clinical_read_owner on public.smyl_clinical_plans;
drop policy if exists clinical_versions_read_owner on public.smyl_clinical_versions;
create policy clinical_read_by_permission on public.smyl_clinical_plans for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read'));
create policy clinical_versions_read_by_permission on public.smyl_clinical_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read'));

drop policy if exists smyl_services_read on public.smyl_services;
drop policy if exists smyl_services_manage on public.smyl_services;
create policy smyl_services_read on public.smyl_services for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    or public.smyl_has_permission(tenant_id, 'settings.manage')
  );
create policy smyl_services_manage on public.smyl_services for all to authenticated
  using (public.smyl_has_permission(tenant_id, 'settings.manage'))
  with check (
    tenant_id = public.smyl_current_tenant()
    and public.smyl_has_permission(tenant_id, 'settings.manage')
  );

drop policy if exists smyl_service_versions_read on public.smyl_service_versions;
create policy smyl_service_versions_read on public.smyl_service_versions for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'schedule.read')
    or public.smyl_has_permission(tenant_id, 'settings.manage')
  );

create or replace function public.smyl_save_clinical_plan_v2(
  p_tenant_id uuid, p_patient_id uuid, p_expected_revision integer,
  p_document jsonb, p_review boolean default false
) returns public.smyl_clinical_plans
language plpgsql security definer set search_path='' as $$
declare
  result public.smyl_clinical_plans; item jsonb; tooth jsonb; surface jsonb;
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

revoke all on function public.smyl_save_clinical_plan_v2(uuid,uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.smyl_save_clinical_plan_v2(uuid,uuid,integer,jsonb,boolean) to authenticated;
comment on function public.smyl_save_clinical_plan_v2(uuid,uuid,integer,jsonb,boolean)
  is 'Clinical plan v2 guarded by clinical.write; reviewed versions additionally require clinical.approve.';

commit;
