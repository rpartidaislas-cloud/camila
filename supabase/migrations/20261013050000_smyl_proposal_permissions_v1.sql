-- SMYL · Etapa UX 3: cotizaciones delegadas con permisos independientes.
-- Aditiva: conserva propuestas, versiones y archivos privados existentes.
begin;

alter table public.smyl_role_permissions
  drop constraint if exists smyl_role_permissions_permission_key_check;
alter table public.smyl_role_permissions
  add constraint smyl_role_permissions_permission_key_check check (permission_key in (
    'clinic.read', 'clinic.manage',
    'team.read', 'team.manage', 'audit.read',
    'schedule.read', 'schedule.manage',
    'patients.read', 'patients.manage',
    'clinical.read', 'clinical.write', 'clinical.approve',
    'proposal.read', 'proposal.write', 'proposal.approve',
    'messages.read', 'messages.respond', 'messages.manage',
    'inventory.read', 'inventory.manage',
    'finance.read', 'finance.manage',
    'settings.manage'
  ));

insert into public.smyl_role_permissions(tenant_id,role_id,permission_key)
select r.tenant_id,r.id,p.permission_key
from public.smyl_roles r
join (values
  ('propietario','proposal.read'),('propietario','proposal.write'),('propietario','proposal.approve'),
  ('administrador','proposal.read'),('administrador','proposal.write'),('administrador','proposal.approve'),
  ('odontologo','proposal.read'),('odontologo','proposal.write'),('odontologo','proposal.approve'),
  ('finanzas','proposal.read')
) as p(role_code,permission_key) on p.role_code=r.code
on conflict do nothing;

drop policy if exists proposals_owner_read on public.smyl_proposals;
drop policy if exists proposals_permission_read on public.smyl_proposals;
create policy proposals_permission_read on public.smyl_proposals for select to authenticated
  using(public.smyl_has_permission(tenant_id,'proposal.read'));

drop policy if exists proposal_versions_owner_read on public.smyl_proposal_versions;
drop policy if exists proposal_versions_permission_read on public.smyl_proposal_versions;
create policy proposal_versions_permission_read on public.smyl_proposal_versions for select to authenticated
  using(public.smyl_has_permission(tenant_id,'proposal.read'));

drop policy if exists proposal_photos_owner_read on storage.objects;
drop policy if exists proposal_photos_owner_insert on storage.objects;
drop policy if exists proposal_photos_permission_read on storage.objects;
drop policy if exists proposal_photos_permission_insert on storage.objects;
create policy proposal_photos_permission_read on storage.objects for select to authenticated
  using (
    bucket_id='smyl-proposal-photos'
    and (storage.foldername(name))[1]=public.smyl_current_tenant()::text
    and public.smyl_has_permission(public.smyl_current_tenant(),'proposal.read')
  );
create policy proposal_photos_permission_insert on storage.objects for insert to authenticated
  with check (
    bucket_id='smyl-proposal-photos'
    and (storage.foldername(name))[1]=public.smyl_current_tenant()::text
    and public.smyl_has_permission(public.smyl_current_tenant(),'proposal.write')
  );

create or replace function public.smyl_save_proposal_v2(
  p_id uuid,p_tenant_id uuid,p_patient_id uuid,p_plan_revision integer,
  p_expected_revision integer,p_document jsonb,p_approve boolean default false
) returns public.smyl_proposals
language plpgsql security definer set search_path='' as $$
declare
  result public.smyl_proposals; plan public.smyl_clinical_plans; person public.camila_pacientes; clinic public.camila_tenants;
  item jsonb; plan_item jsonb; photos jsonb; asset text; ids text[]:=array[]::text[]; cents bigint:=0; unit bigint; qty integer;
  stamp timestamptz:=clock_timestamp();
begin
  if auth.uid() is null
    or not public.smyl_has_permission(p_tenant_id, 'proposal.write')
    or (p_approve and not public.smyl_has_permission(p_tenant_id, 'proposal.approve'))
  then raise exception 'Proposal access denied' using errcode='42501'; end if;
  select * into person from public.camila_pacientes where id=p_patient_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Patient not available' using errcode='42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_approve is null then raise exception 'Invalid revision' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text,0));
  select * into plan from public.smyl_clinical_plans where patient_id=p_patient_id and tenant_id=p_tenant_id for update;
  if plan.status is distinct from 'reviewed' or plan.revision is distinct from p_plan_revision or plan.document->'schema' is distinct from '2'::jsonb
  then raise exception 'Review the current clinical plan first' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  select * into result from public.smyl_proposals where id=p_id for update;
  if found and (result.tenant_id<>p_tenant_id or result.patient_id<>p_patient_id) then raise exception 'Proposal identity mismatch' using errcode='42501'; end if;
  if coalesce(result.revision,0)<>p_expected_revision then raise exception 'Proposal revision conflict' using errcode='40001'; end if;
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>70000
    or p_document->'schema' is distinct from '2'::jsonb or p_document-array['schema','title','introduction','terms','valid_until','items','photos']<>'{}'::jsonb
    or jsonb_typeof(p_document->'title')<>'string' or jsonb_typeof(p_document->'introduction')<>'string' or jsonb_typeof(p_document->'terms')<>'string'
    or jsonb_typeof(p_document->'valid_until')<>'string' or jsonb_typeof(p_document->'items')<>'array'
    or length(trim(p_document->>'title')) not between 1 and 150 or length(p_document->>'introduction')>3000 or length(p_document->>'terms')>3000
    or jsonb_array_length(p_document->'items') not between 1 and 20
  then raise exception 'Invalid proposal document v2' using errcode='22023'; end if;
  if p_document->>'valid_until'<>'' then
    if p_document->>'valid_until' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
    perform (p_document->>'valid_until')::date;
  end if;
  if p_approve and (length(trim(p_document->>'terms'))=0 or p_document->>'valid_until'='' or (p_document->>'valid_until')::date<(stamp at time zone 'America/Mexico_City')::date)
  then raise exception 'Complete validity and conditions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_document->'items') loop
    if jsonb_typeof(item)<>'object' or item-array['id','treatment_id','service_id','service_revision','service_snapshot','teeth','surfaces','label','area','quantity','unit_cents','currency']<>'{}'::jsonb
      or coalesce(item->>'id','') !~ '^[A-Za-z0-9-]{1,80}$' or (item->>'id')=any(ids)
      or jsonb_typeof(item->'label')<>'string' or jsonb_typeof(item->'area')<>'string' or length(trim(item->>'label')) not between 1 and 200 or length(item->>'area')>200
      or jsonb_typeof(item->'quantity')<>'number' or coalesce(item->>'quantity','') !~ '^\d{1,3}$' or coalesce(item->>'currency','')<>'MXN'
      or jsonb_typeof(item->'teeth')<>'array' or jsonb_typeof(item->'surfaces')<>'array'
    then raise exception 'Invalid quote item v2' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');qty:=(item->>'quantity')::integer;
    if qty not between 1 and 100 or (jsonb_array_length(item->'surfaces')>0 and jsonb_array_length(item->'teeth')=0) then raise exception 'Invalid quote quantity or targets' using errcode='22023'; end if;
    if item->'treatment_id'='null'::jsonb then
      if item->'service_id'<>'null'::jsonb or item->'service_revision'<>'null'::jsonb or item->'service_snapshot'<>'null'::jsonb
        or item->'teeth'<>'[]'::jsonb or item->'surfaces'<>'[]'::jsonb then raise exception 'Manual quote item cannot claim a plan source' using errcode='22023'; end if;
    else
      select value into plan_item from jsonb_array_elements(plan.document->'treatments') where value->>'id'=item->>'treatment_id';
      if not found or plan_item->'service_id' is distinct from item->'service_id' or plan_item->'service_revision' is distinct from item->'service_revision'
        or plan_item->'service_snapshot' is distinct from item->'service_snapshot' or plan_item->'teeth' is distinct from item->'teeth' or plan_item->'surfaces' is distinct from item->'surfaces'
      then raise exception 'Quote source does not match reviewed plan' using errcode='40001'; end if;
    end if;
    if item->'unit_cents'='null'::jsonb then if p_approve then raise exception 'Price required' using errcode='22023'; end if;
    else
      if jsonb_typeof(item->'unit_cents')<>'number' or item->>'unit_cents' !~ '^\d{1,9}$' then raise exception 'Invalid price' using errcode='22023'; end if;
      unit:=(item->>'unit_cents')::bigint;cents:=cents+unit*qty;
    end if;
  end loop;
  photos:=p_document->'photos';
  if photos<>'null'::jsonb then
    if jsonb_typeof(photos)<>'object' or photos-array['before_path','simulation_path','view']<>'{}'::jsonb
      or jsonb_typeof(photos->'before_path')<>'string' or jsonb_typeof(photos->'simulation_path')<>'string'
      or coalesce(photos->>'view','') not in ('frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight')
      or photos->>'before_path' !~ '-before\.jpg$' or photos->>'simulation_path' !~ '-simulation\.jpg$' or photos->>'before_path'=photos->>'simulation_path'
    then raise exception 'Invalid comparison' using errcode='22023'; end if;
    foreach asset in array array[photos->>'before_path',photos->>'simulation_path'] loop
      if split_part(asset,'/',1)<>p_tenant_id::text or split_part(asset,'/',2)<>p_id::text or split_part(asset,'/',4)<>''
        or split_part(asset,'/',3) !~ '^[0-9a-f-]{36}-(before|simulation)\.jpg$'
        or not exists(select 1 from storage.objects where bucket_id='smyl-proposal-photos' and name=asset)
      then raise exception 'Comparison asset not available' using errcode='42501'; end if;
    end loop;
  end if;
  select * into clinic from public.camila_tenants where id=p_tenant_id;
  insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,patient_name,clinic_name,professional_name,updated_by,updated_at,approved_by,approved_at)
  values(p_id,p_tenant_id,p_patient_id,p_plan_revision,p_expected_revision+1,case when p_approve then 'approved' else 'draft' end,p_document,cents,
    trim(person.nombre||' '||person.apellido),coalesce(nullif(clinic.config->>'consultorio',''),clinic.nombre,'Clínica dental'),coalesce(clinic.config->>'doctor',''),auth.uid(),stamp,
    case when p_approve then auth.uid() end,case when p_approve then stamp end)
  on conflict(id) do update set plan_revision=excluded.plan_revision,revision=excluded.revision,status=excluded.status,document=excluded.document,total_cents=excluded.total_cents,
    patient_name=excluded.patient_name,clinic_name=excluded.clinic_name,professional_name=excluded.professional_name,updated_by=excluded.updated_by,updated_at=excluded.updated_at,
    approved_by=excluded.approved_by,approved_at=excluded.approved_at returning * into result;
  insert into public.smyl_proposal_versions(proposal_id,tenant_id,revision,snapshot) values(result.id,result.tenant_id,result.revision,to_jsonb(result));
  return result;
end;$$;

revoke all on function public.smyl_save_proposal_v2(uuid,uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
grant execute on function public.smyl_save_proposal_v2(uuid,uuid,uuid,integer,integer,jsonb,boolean) to authenticated;

create or replace function public.smyl_proposal_for_export(p_id uuid,p_revision integer)
returns public.smyl_proposals language plpgsql security definer set search_path='' as $$
declare result public.smyl_proposals;
begin
  select * into result from public.smyl_proposals where id=p_id;
  if not found or not public.smyl_has_permission(result.tenant_id,'proposal.read')
  then raise exception 'Proposal access denied' using errcode='42501'; end if;
  if result.revision is distinct from p_revision or result.status<>'approved'
    or (result.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date
    or not exists(select 1 from public.smyl_clinical_plans where patient_id=result.patient_id
      and tenant_id=result.tenant_id and revision=result.plan_revision and status='reviewed')
  then raise exception 'Proposal must be reviewed again' using errcode='40001'; end if;
  return result;
end;
$$;
revoke all on function public.smyl_proposal_for_export(uuid,integer) from public,anon;
grant execute on function public.smyl_proposal_for_export(uuid,integer) to authenticated;

comment on function public.smyl_save_proposal_v2(uuid,uuid,uuid,integer,integer,jsonb,boolean)
  is 'Proposal v2 guarded by proposal.write; approved versions additionally require proposal.approve.';

commit;

