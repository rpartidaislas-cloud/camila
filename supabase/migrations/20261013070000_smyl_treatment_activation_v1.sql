/* Stage 6: activate treatment only from the accepted current proposal revision. */
create or replace function public.smyl_post_proposal_charges(
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

  /* Preserve idempotency for batches created before this rule. */
  select * into v_batch from public.smyl_proposal_charge_batches
    where tenant_id=v_tenant and (idempotency_key=p_idempotency_key or (proposal_id=p_proposal_id and proposal_revision=p_proposal_revision));
  if found then return v_batch; end if;

  select * into v_proposal from public.smyl_proposals where tenant_id=v_tenant and id=p_proposal_id for update;
  if not found or v_proposal.status<>'approved' or v_proposal.revision<>p_proposal_revision
    or v_proposal.document->'schema' is distinct from '2'::jsonb
  then raise exception using errcode='40001',message='La propuesta ya no es la versión aprobada seleccionada.'; end if;
  if not exists(
    select 1 from public.smyl_proposal_events
    where tenant_id=v_tenant and proposal_id=p_proposal_id
      and proposal_revision=p_proposal_revision and event_type='accepted'
  ) then raise exception using errcode='23514',message='Registra la aceptación del paciente para esta versión antes de crear cargos.'; end if;
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
    jsonb_build_object('proposal_id',v_proposal.id,'proposal_revision',v_proposal.revision,'plan_revision',v_proposal.plan_revision,'accepted',true,'approved_at',v_proposal.approved_at,'document',v_proposal.document),auth.uid())
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

revoke all on function public.smyl_post_proposal_charges(uuid,uuid,uuid,integer,uuid,date) from public,anon;
grant execute on function public.smyl_post_proposal_charges(uuid,uuid,uuid,integer,uuid,date) to authenticated;
