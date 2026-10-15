-- Propuesta aprobada -> cargos idempotentes -> prevalidación CFDI local.
-- No conecta, envía ni timbra con SAT/PAC.
begin;

create table public.smyl_proposal_charge_batches (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  proposal_id uuid not null references public.smyl_proposals(id) on delete restrict,
  proposal_revision integer not null check(proposal_revision>0),
  patient_id uuid not null,
  branch_id uuid not null,
  idempotency_key uuid not null,
  charge_count integer not null check(charge_count>0),
  total_amount numeric(12,2) not null check(total_amount>0),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,id),
  unique(tenant_id,idempotency_key),
  unique(tenant_id,proposal_id,proposal_revision),
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete restrict,
  foreign key(tenant_id,branch_id) references public.smyl_branches(tenant_id,id) on delete restrict
);

alter table public.smyl_finance_charges
  add column proposal_revision integer,
  add column proposal_item_id text,
  add column proposal_batch_id uuid,
  add column service_revision integer,
  add column service_snapshot jsonb,
  add constraint smyl_finance_charges_proposal_revision check(proposal_revision is null or proposal_revision>0),
  add constraint smyl_finance_charges_proposal_item check(proposal_item_id is null or proposal_item_id ~ '^[A-Za-z0-9-]{1,80}$'),
  add constraint smyl_finance_charges_service_revision check(service_revision is null or service_revision>0),
  add constraint smyl_finance_charges_service_snapshot check(service_snapshot is null or jsonb_typeof(service_snapshot)='object'),
  add constraint smyl_finance_charges_batch_fk foreign key(tenant_id,proposal_batch_id)
    references public.smyl_proposal_charge_batches(tenant_id,id) on delete restrict;

create unique index smyl_finance_charges_proposal_line_idx
  on public.smyl_finance_charges(tenant_id,proposal_id,proposal_revision,proposal_item_id)
  where proposal_id is not null and proposal_revision is not null and proposal_item_id is not null;

alter table public.smyl_cfdi_drafts
  add column cfdi_version text not null default '4.0',
  add column concepts_snapshot jsonb not null default '[]'::jsonb,
  add column sandbox_status text not null default 'pending',
  add column sandbox_report jsonb not null default '{}'::jsonb,
  add column sandbox_validated_by uuid references auth.users(id),
  add column sandbox_validated_at timestamptz,
  add constraint smyl_cfdi_drafts_version check(cfdi_version='4.0'),
  add constraint smyl_cfdi_drafts_concepts check(jsonb_typeof(concepts_snapshot)='array'),
  add constraint smyl_cfdi_drafts_sandbox_status check(sandbox_status in ('pending','passed','blocked')),
  add constraint smyl_cfdi_drafts_sandbox_report check(jsonb_typeof(sandbox_report)='object'),
  add constraint smyl_cfdi_drafts_sandbox_review check(
    (sandbox_status='pending' and sandbox_validated_by is null and sandbox_validated_at is null)
    or (sandbox_status in ('passed','blocked') and sandbox_validated_by is not null and sandbox_validated_at is not null)
  );

alter table public.smyl_proposal_charge_batches enable row level security;
create policy smyl_proposal_charge_batches_read on public.smyl_proposal_charge_batches
  for select to authenticated using(public.smyl_has_permission(tenant_id,'finance.read'));
revoke all on table public.smyl_proposal_charge_batches from anon,authenticated;
grant select on table public.smyl_proposal_charge_batches to authenticated;
create trigger smyl_proposal_charge_batches_audit after insert or update or delete on public.smyl_proposal_charge_batches
  for each row execute function public.smyl_audit_row();

create function public.smyl_post_proposal_charges(
  p_batch_id uuid,p_idempotency_key uuid,p_proposal_id uuid,p_proposal_revision integer,
  p_branch_id uuid,p_due_on date default null
) returns public.smyl_proposal_charge_batches
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_proposal public.smyl_proposals;
  v_batch public.smyl_proposal_charge_batches; v_item jsonb; v_count integer:=0;
  v_total numeric(12,2):=0; v_line numeric(12,2); v_qty numeric; v_unit numeric;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage')
  then raise exception using errcode='42501',message='Sin permiso para convertir propuestas en cargos.'; end if;
  if p_batch_id is null or p_idempotency_key is null or p_proposal_id is null or p_proposal_revision is null
    or p_proposal_revision<1 or p_branch_id is null or (p_due_on is not null and p_due_on<current_date)
  then raise exception using errcode='22023',message='Datos de conversión inválidos.'; end if;
  select * into v_batch from public.smyl_proposal_charge_batches
    where tenant_id=v_tenant and (idempotency_key=p_idempotency_key or (proposal_id=p_proposal_id and proposal_revision=p_proposal_revision));
  if found then return v_batch; end if;
  select * into v_proposal from public.smyl_proposals where tenant_id=v_tenant and id=p_proposal_id for update;
  if not found or v_proposal.status<>'approved' or v_proposal.revision<>p_proposal_revision
    or v_proposal.document->'schema' is distinct from '2'::jsonb
  then raise exception using errcode='40001',message='La propuesta ya no es la versión aprobada seleccionada.'; end if;
  if not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=p_branch_id and active)
  then raise exception using errcode='23503',message='Selecciona una sucursal activa.'; end if;
  select * into v_batch from public.smyl_proposal_charge_batches
    where tenant_id=v_tenant and proposal_id=p_proposal_id and proposal_revision=p_proposal_revision;
  if found then return v_batch; end if;
  for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
    if jsonb_typeof(v_item)<>'object' or coalesce(v_item->>'id','') !~ '^[A-Za-z0-9-]{1,80}$'
      or jsonb_typeof(v_item->'quantity')<>'number' or coalesce(v_item->>'quantity','') !~ '^\d{1,3}$'
      or jsonb_typeof(v_item->'unit_cents')<>'number' or coalesce(v_item->>'unit_cents','') !~ '^\d{1,9}$'
      or coalesce(v_item->>'currency','')<>'MXN'
    then raise exception using errcode='22023',message='La propuesta contiene conceptos no convertibles.'; end if;
    v_qty:=(v_item->>'quantity')::numeric; v_unit:=round((v_item->>'unit_cents')::numeric/100,2); v_line:=round(v_qty*v_unit,2);
    if v_qty<=0 or v_qty>100 or v_unit<0 then raise exception using errcode='22003',message='La propuesta contiene importes inválidos.'; end if;
    if v_line>0 then v_count:=v_count+1; v_total:=v_total+v_line; end if;
  end loop;
  if v_count=0 or round(v_total*100)::bigint<>v_proposal.total_cents
  then raise exception using errcode='23514',message='El total aprobado no coincide con los conceptos convertibles.'; end if;
  insert into public.smyl_proposal_charge_batches(id,tenant_id,proposal_id,proposal_revision,patient_id,branch_id,idempotency_key,charge_count,total_amount,source_snapshot,created_by)
  values(p_batch_id,v_tenant,v_proposal.id,v_proposal.revision,v_proposal.patient_id,p_branch_id,p_idempotency_key,v_count,v_total,
    jsonb_build_object('proposal_id',v_proposal.id,'proposal_revision',v_proposal.revision,'plan_revision',v_proposal.plan_revision,'approved_at',v_proposal.approved_at,'document',v_proposal.document),auth.uid())
  returning * into v_batch;
  for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
    v_qty:=(v_item->>'quantity')::numeric; v_unit:=round((v_item->>'unit_cents')::numeric/100,2); v_line:=round(v_qty*v_unit,2);
    if v_line>0 then
      insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,service_id,proposal_id,idempotency_key,concept,quantity,unit_price,discount_amount,tax_amount,total_amount,due_on,created_by,
        proposal_revision,proposal_item_id,proposal_batch_id,service_revision,service_snapshot)
      values(gen_random_uuid(),v_tenant,v_proposal.patient_id,p_branch_id,case when v_item->'service_id'='null'::jsonb then null else (v_item->>'service_id')::uuid end,v_proposal.id,gen_random_uuid(),
        btrim(v_item->>'label'),v_qty,v_unit,0,0,v_line,p_due_on,auth.uid(),v_proposal.revision,v_item->>'id',v_batch.id,
        case when v_item->'service_revision'='null'::jsonb then null else (v_item->>'service_revision')::integer end,
        case when v_item->'service_snapshot'='null'::jsonb then null else v_item->'service_snapshot' end);
    end if;
  end loop;
  return v_batch;
end $$;

create function public.smyl_prepare_cfdi_draft_v2(p_id uuid,p_idempotency_key uuid,p_payment_id uuid)
returns public.smyl_cfdi_drafts language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_payment public.smyl_finance_payments;
  v_profile public.smyl_patient_fiscal_profiles; v_row public.smyl_cfdi_drafts;
  v_concepts jsonb; v_allocated numeric(12,2); v_count integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage')
  then raise exception using errcode='42501',message='Sin permiso para preparar CFDI.'; end if;
  select * into v_row from public.smyl_cfdi_drafts where tenant_id=v_tenant and (idempotency_key=p_idempotency_key or payment_id=p_payment_id);
  if found then return v_row; end if;
  select * into v_payment from public.smyl_finance_payments where tenant_id=v_tenant and id=p_payment_id for update;
  if not found then raise exception using errcode='P0002',message='Pago no encontrado.'; end if;
  if exists(select 1 from public.smyl_finance_refunds where tenant_id=v_tenant and payment_id=p_payment_id)
  then raise exception using errcode='23514',message='Un pago con reembolso requiere revisión contable antes del CFDI.'; end if;
  select * into v_profile from public.smyl_patient_fiscal_profiles where tenant_id=v_tenant and patient_id=v_payment.patient_id;
  if not found then raise exception using errcode='23514',message='Completa los datos fiscales del paciente.'; end if;
  select coalesce(sum(a.amount),0),count(*) into v_allocated,v_count from public.smyl_finance_payment_allocations a
    where a.tenant_id=v_tenant and a.payment_id=p_payment_id;
  if v_count=0 or v_allocated<>v_payment.amount
  then raise exception using errcode='23514',message='El pago debe estar aplicado por completo antes de preparar el CFDI.'; end if;
  if exists(select 1 from public.smyl_finance_payment_allocations a join public.smyl_finance_charges c on c.tenant_id=a.tenant_id and c.id=a.charge_id
    where a.tenant_id=v_tenant and a.payment_id=p_payment_id and (a.amount<>c.total_amount or c.status<>'open'))
  then raise exception using errcode='23514',message='La prevalidación actual requiere cargos pagados por completo y vigentes.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'charge_id',c.id,'proposal_id',c.proposal_id,'proposal_revision',c.proposal_revision,'proposal_item_id',c.proposal_item_id,
    'description',c.concept,'quantity',c.quantity,'unit_value',c.unit_price,'discount',c.discount_amount,'tax',c.tax_amount,'amount',c.total_amount,
    'product_service_code',c.service_snapshot->>'sat_product_service_code','unit_code',c.service_snapshot->>'sat_unit_code',
    'tax_object_code',c.service_snapshot->>'tax_object_code','fiscal_status',c.service_snapshot->>'fiscal_status'
  ) order by c.created_at,c.id),'[]'::jsonb) into v_concepts
  from public.smyl_finance_payment_allocations a join public.smyl_finance_charges c on c.tenant_id=a.tenant_id and c.id=a.charge_id
  where a.tenant_id=v_tenant and a.payment_id=p_payment_id;
  insert into public.smyl_cfdi_drafts(id,tenant_id,patient_id,payment_id,idempotency_key,fiscal_snapshot,concepts_snapshot,created_by)
  values(p_id,v_tenant,v_payment.patient_id,p_payment_id,p_idempotency_key,jsonb_build_object(
    'legal_name',v_profile.legal_name,'rfc',v_profile.rfc,'fiscal_regime',v_profile.fiscal_regime,'tax_postal_code',v_profile.tax_postal_code,
    'cfdi_use',v_profile.cfdi_use,'email',v_profile.email,'amount',v_payment.amount,'payment_method',v_payment.method,
    'currency','MXN','document_type','I','export_code','01','method_code','PUE'
  ),v_concepts,auth.uid()) returning * into v_row;
  return v_row;
end $$;

create function public.smyl_validate_cfdi_draft_sandbox(p_draft_id uuid)
returns public.smyl_cfdi_drafts language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_cfdi_drafts;
  v_item jsonb; v_errors jsonb:='[]'::jsonb; v_sum numeric(12,2):=0; v_stamp timestamptz:=clock_timestamp();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage')
  then raise exception using errcode='42501',message='Sin permiso para validar el borrador.'; end if;
  select * into v_row from public.smyl_cfdi_drafts where tenant_id=v_tenant and id=p_draft_id for update;
  if not found then raise exception using errcode='P0002',message='Borrador no encontrado.'; end if;
  if coalesce(v_row.fiscal_snapshot->>'rfc','') !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','rfc','message','RFC con formato inválido.')); end if;
  if length(trim(coalesce(v_row.fiscal_snapshot->>'legal_name',''))) < 2 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','legal_name','message','Falta nombre o razón social.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'tax_postal_code','') !~ '^\d{5}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','tax_postal_code','message','Código postal fiscal inválido.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'fiscal_regime','') !~ '^\d{3}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','fiscal_regime','message','Régimen fiscal inválido.')); end if;
  if coalesce(v_row.fiscal_snapshot->>'cfdi_use','') !~ '^[A-Z0-9]{3,5}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','cfdi_use','message','Uso CFDI inválido.')); end if;
  if jsonb_array_length(v_row.concepts_snapshot)=0 then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','concepts','message','Faltan conceptos.')); end if;
  for v_item in select value from jsonb_array_elements(v_row.concepts_snapshot) loop
    v_sum:=v_sum+coalesce((v_item->>'amount')::numeric,0);
    if coalesce(v_item->>'fiscal_status','')<>'reviewed' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','concepts','message','Hay un servicio sin revisión fiscal.')); end if;
    if coalesce(v_item->>'product_service_code','') !~ '^\d{8}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','product_service_code','message','ClaveProdServ inválida o pendiente.')); end if;
    if coalesce(v_item->>'unit_code','') !~ '^[A-Z0-9]{1,8}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','unit_code','message','ClaveUnidad inválida o pendiente.')); end if;
    if coalesce(v_item->>'tax_object_code','') !~ '^\d{2}$' then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','tax_object_code','message','ObjetoImp inválido o pendiente.')); end if;
  end loop;
  if v_sum<>(v_row.fiscal_snapshot->>'amount')::numeric then v_errors:=v_errors||jsonb_build_array(jsonb_build_object('field','total','message','El total no coincide con los conceptos.')); end if;
  update public.smyl_cfdi_drafts set sandbox_status=case when jsonb_array_length(v_errors)=0 then 'passed' else 'blocked' end,
    sandbox_report=jsonb_build_object('validator','smyl_local_cfdi_4_rules_v1','errors',v_errors,'requires_pac_catalog_validation',true,
      'message',case when jsonb_array_length(v_errors)=0 then 'Prevalidación local aprobada; falta validar catálogos y timbrar en PAC sandbox.' else 'Corrige los campos indicados antes de usar un PAC sandbox.' end),
    sandbox_validated_by=auth.uid(),sandbox_validated_at=v_stamp
  where tenant_id=v_tenant and id=p_draft_id returning * into v_row;
  return v_row;
end $$;

revoke all on function public.smyl_post_proposal_charges(uuid,uuid,uuid,integer,uuid,date),
  public.smyl_prepare_cfdi_draft_v2(uuid,uuid,uuid),public.smyl_validate_cfdi_draft_sandbox(uuid) from public,anon;
grant execute on function public.smyl_post_proposal_charges(uuid,uuid,uuid,integer,uuid,date),
  public.smyl_prepare_cfdi_draft_v2(uuid,uuid,uuid),public.smyl_validate_cfdi_draft_sandbox(uuid) to authenticated;

comment on function public.smyl_validate_cfdi_draft_sandbox(uuid) is 'Local CFDI 4.0 preflight only. Does not consult SAT/PAC, stamp, issue, submit or cancel a CFDI.';
commit;
