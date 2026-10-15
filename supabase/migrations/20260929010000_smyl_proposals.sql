-- Stage 4, PREPARED ONLY. Apply/test in staging after clinical_workspace.
-- Does not change existing cases, account limits or LANA delivery.
begin;
create table public.smyl_proposals (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id),
  patient_id uuid not null,
  plan_revision integer not null,
  revision integer not null,
  status text not null check (status in ('draft','approved')),
  document jsonb not null,
  total_cents bigint not null check (total_cents >= 0),
  patient_name text not null,
  clinic_name text not null,
  professional_name text not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id),
  foreign key (patient_id,plan_revision) references public.smyl_clinical_versions(patient_id,revision),
  check ((status='approved' and approved_by is not null and approved_at is not null)
    or (status='draft' and approved_by is null and approved_at is null))
);
create index smyl_proposals_tenant_date on public.smyl_proposals(tenant_id,updated_at desc);
create table public.smyl_proposal_versions (
  proposal_id uuid not null references public.smyl_proposals(id),
  revision integer not null,
  tenant_id uuid not null references public.camila_tenants(id),
  snapshot jsonb not null,
  primary key (proposal_id,revision)
);
alter table public.smyl_proposals enable row level security;
alter table public.smyl_proposal_versions enable row level security;
revoke all on public.smyl_proposals,public.smyl_proposal_versions from anon,authenticated;
grant select on public.smyl_proposals,public.smyl_proposal_versions to authenticated;
create policy proposals_owner_read on public.smyl_proposals for select to authenticated using (tenant_id=(select auth.uid()));
create policy proposal_versions_owner_read on public.smyl_proposal_versions for select to authenticated using (tenant_id=(select auth.uid()));

-- New private, immutable comparison assets. No UPDATE/DELETE or public URL.
-- Audit all existing storage policies in staging: policies combine with OR.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('smyl-proposal-photos','smyl-proposal-photos',false,8388608,array['image/jpeg']);
create policy proposal_photos_owner_read on storage.objects for select to authenticated
using (bucket_id='smyl-proposal-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy proposal_photos_owner_insert on storage.objects for insert to authenticated
with check (bucket_id='smyl-proposal-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);

create function public.smyl_save_proposal(
  p_id uuid,p_tenant_id uuid,p_patient_id uuid,p_plan_revision integer,
  p_expected_revision integer,p_document jsonb,p_approve boolean default false
) returns public.smyl_proposals
language plpgsql security definer set search_path='' as $$
declare
  result public.smyl_proposals;
  plan public.smyl_clinical_plans;
  person public.camila_pacientes;
  clinic public.camila_tenants;
  item jsonb;
  photos jsonb;
  asset text;
  cents bigint:=0;
  unit bigint;
  qty integer;
  stamp timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or p_tenant_id is distinct from auth.uid() then
    raise exception 'Proposal access denied' using errcode='42501';
  end if;
  select * into person from public.camila_pacientes where id=p_patient_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Patient not available' using errcode='42501'; end if;
  if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_approve is null then
    raise exception 'Invalid revision' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text,0));
  select * into plan from public.smyl_clinical_plans where patient_id=p_patient_id and tenant_id=p_tenant_id for update;
  if plan.status is distinct from 'reviewed' or plan.revision is distinct from p_plan_revision then
    raise exception 'Review the current clinical plan first' using errcode='40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  select * into result from public.smyl_proposals where id=p_id for update;
  if found and (result.tenant_id<>p_tenant_id or result.patient_id<>p_patient_id) then
    raise exception 'Proposal identity mismatch' using errcode='42501';
  end if;
  if coalesce(result.revision,0)<>p_expected_revision then
    raise exception 'Proposal revision conflict' using errcode='40001';
  end if;
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>30000
    or (p_document->'schema') is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'title') is distinct from 'string'
    or jsonb_typeof(p_document->'introduction') is distinct from 'string'
    or jsonb_typeof(p_document->'terms') is distinct from 'string'
    or jsonb_typeof(p_document->'valid_until') is distinct from 'string'
    or jsonb_typeof(p_document->'items') is distinct from 'array'
    or not p_document ? 'photos' then raise exception 'Invalid proposal document' using errcode='22023'; end if;
  if length(trim(p_document->>'title')) not between 1 and 150
    or length(p_document->>'introduction')>3000 or length(p_document->>'terms')>3000
    or jsonb_array_length(p_document->'items') not between 1 and 20
    or p_document-array['schema','title','introduction','terms','valid_until','items','photos']<>'{}'::jsonb then
    raise exception 'Invalid proposal content' using errcode='22023';
  end if;
  if (p_document->>'valid_until')<>'' then
    if (p_document->>'valid_until') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
    perform (p_document->>'valid_until')::date;
  end if;
  if p_approve and (length(trim(p_document->>'terms'))=0 or (p_document->>'valid_until')=''
    or (p_document->>'valid_until')::date<(stamp at time zone 'America/Mexico_City')::date) then
    raise exception 'Complete validity and conditions' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_document->'items') loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'label') is distinct from 'string'
      or jsonb_typeof(item->'area') is distinct from 'string'
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or not item ? 'unit_cents' or item-array['label','area','quantity','unit_cents']<>'{}'::jsonb
      or length(trim(item->>'label')) not between 1 and 200 or length(item->>'area')>200
      or (item->>'quantity') !~ '^\d{1,3}$' then raise exception 'Invalid quote item' using errcode='22023'; end if;
    qty:=(item->>'quantity')::integer;
    if qty not between 1 and 100 then raise exception 'Invalid quantity' using errcode='22023'; end if;
    if item->'unit_cents'='null'::jsonb then
      if p_approve then raise exception 'Price required' using errcode='22023'; end if;
    else
      if jsonb_typeof(item->'unit_cents') is distinct from 'number' or (item->>'unit_cents') !~ '^\d{1,9}$' then
        raise exception 'Invalid price' using errcode='22023';
      end if;
      unit:=(item->>'unit_cents')::bigint;cents:=cents+unit*qty;
    end if;
  end loop;
  photos:=p_document->'photos';
  if photos<>'null'::jsonb then
    if jsonb_typeof(photos)<>'object' or jsonb_typeof(photos->'before_path') is distinct from 'string'
      or jsonb_typeof(photos->'simulation_path') is distinct from 'string'
      or photos-array['before_path','simulation_path','view']<>'{}'::jsonb
      or coalesce(photos->>'view','') not in ('frontal','left','right','tresCuartos','extraoral','intraoral','intraoralLeft','intraoralRight')
      or (photos->>'before_path') !~ '-before\.jpg$' or (photos->>'simulation_path') !~ '-simulation\.jpg$'
      or photos->>'before_path'=photos->>'simulation_path' then raise exception 'Invalid comparison' using errcode='22023'; end if;
    foreach asset in array array[photos->>'before_path',photos->>'simulation_path'] loop
      if split_part(asset,'/',1)<>p_tenant_id::text or split_part(asset,'/',2)<>p_id::text
        or split_part(asset,'/',4)<>'' or split_part(asset,'/',3) !~ '^[0-9a-f-]{36}-(before|simulation)\.jpg$'
        or not exists(select 1 from storage.objects where bucket_id='smyl-proposal-photos' and name=asset) then
        raise exception 'Comparison asset not available' using errcode='42501';
      end if;
    end loop;
  end if;
  select * into clinic from public.camila_tenants where id=p_tenant_id;
  insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,
    patient_name,clinic_name,professional_name,updated_by,updated_at,approved_by,approved_at)
  values(p_id,p_tenant_id,p_patient_id,p_plan_revision,p_expected_revision+1,case when p_approve then 'approved' else 'draft' end,
    p_document,cents,trim(person.nombre||' '||person.apellido),coalesce(nullif(clinic.config->>'consultorio',''),clinic.nombre,'Clínica dental'),
    coalesce(clinic.config->>'doctor',''),auth.uid(),stamp,case when p_approve then auth.uid() end,case when p_approve then stamp end)
  on conflict(id) do update set plan_revision=excluded.plan_revision,revision=excluded.revision,status=excluded.status,
    document=excluded.document,total_cents=excluded.total_cents,patient_name=excluded.patient_name,clinic_name=excluded.clinic_name,
    professional_name=excluded.professional_name,updated_by=excluded.updated_by,updated_at=excluded.updated_at,
    approved_by=excluded.approved_by,approved_at=excluded.approved_at returning * into result;
  insert into public.smyl_proposal_versions(proposal_id,tenant_id,revision,snapshot)
    values(result.id,result.tenant_id,result.revision,to_jsonb(result));
  return result;
end;
$$;
revoke all on function public.smyl_save_proposal(uuid,uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
grant execute on function public.smyl_save_proposal(uuid,uuid,uuid,integer,integer,jsonb,boolean) to authenticated;

create function public.smyl_proposal_for_export(p_id uuid,p_revision integer)
returns public.smyl_proposals language plpgsql security definer set search_path='' as $$
declare result public.smyl_proposals;
begin
  select * into result from public.smyl_proposals where id=p_id and tenant_id=auth.uid();
  if not found then raise exception 'Proposal access denied' using errcode='42501'; end if;
  if result.revision is distinct from p_revision or result.status<>'approved'
    or (result.document->>'valid_until')::date<(now() at time zone 'America/Mexico_City')::date
    or not exists(select 1 from public.smyl_clinical_plans where patient_id=result.patient_id
      and tenant_id=result.tenant_id and revision=result.plan_revision and status='reviewed') then
    raise exception 'Proposal must be reviewed again' using errcode='40001';
  end if;
  return result;
end;
$$;
revoke all on function public.smyl_proposal_for_export(uuid,integer) from public,anon;
grant execute on function public.smyl_proposal_for_export(uuid,integer) to authenticated;
commit;
