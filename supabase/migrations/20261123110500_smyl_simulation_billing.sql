-- Simulación de diseño de sonrisa como servicio cobrable, ligado a la simulación guardada, y descontable de las carillas.
--
-- 1. Cada cargo de simulación apunta a la simulación (smyl_patient_case_archive) que cobra: una sola vez por simulación.
-- 2. Si el paciente acepta carillas, al convertir la propuesta en cargos (smyl_post_proposal_charges_v2) el importe de
--    la simulación se descuenta de las líneas de carillas, una sola vez (simulation_credit_charge_id, índice único).
-- 3. El precio sale del servicio del catálogo con plantilla «aesthetic-smile-simulation» (Servicios y tarifas).
-- La versión anterior de smyl_post_proposal_charges queda igual para no romper llamadas existentes.

alter table public.smyl_finance_charges
  add column if not exists simulation_case_id uuid references public.smyl_patient_case_archive(id) on delete restrict,
  add column if not exists simulation_credit_charge_id uuid;

create unique index if not exists smyl_finance_charges_simulation_case_open_idx
  on public.smyl_finance_charges(tenant_id, simulation_case_id)
  where simulation_case_id is not null and status = 'open';
create unique index if not exists smyl_finance_charges_simulation_credit_open_idx
  on public.smyl_finance_charges(tenant_id, simulation_credit_charge_id)
  where simulation_credit_charge_id is not null and status = 'open';

comment on column public.smyl_finance_charges.simulation_case_id is
  'Cargo de una simulación de diseño de sonrisa: la simulación guardada que cobra.';
comment on column public.smyl_finance_charges.simulation_credit_charge_id is
  'En una línea de carillas: el cargo de simulación cuyo importe se descontó aquí.';

-- ¿Es una línea de carillas? Por plantilla del catálogo o, si la clínica creó su propio servicio, por su nombre.
create or replace function public.smyl_is_veneer_service(p_tenant uuid, p_item jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((
    select s.template_key in ('aesthetic-resin-veneer','aesthetic-ceramic-veneer') or lower(s.name) like '%carilla%'
    from public.smyl_services s
    where s.tenant_id = p_tenant
      and p_item->>'service_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and s.id = (p_item->>'service_id')::uuid
  ), lower(coalesce(p_item->>'label','')) like '%carilla%');
$$;
revoke all on function public.smyl_is_veneer_service(uuid,jsonb) from public,anon,authenticated;

-- Cobra una simulación guardada al paciente, con el precio del catálogo. Idempotente y una sola vez por simulación.
create or replace function public.smyl_post_simulation_charge(p_id uuid, p_idempotency_key uuid, p_case_id uuid, p_branch_id uuid default null)
returns public.smyl_finance_charges language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_case public.smyl_patient_case_archive;
  v_service public.smyl_services; v_row public.smyl_finance_charges; v_branch uuid:=p_branch_id;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage')
  then raise exception using errcode='42501',message='Sin permiso para registrar cargos.'; end if;
  if p_id is null or p_idempotency_key is null or p_case_id is null
  then raise exception using errcode='22023',message='Datos del cobro inválidos.'; end if;
  select * into v_row from public.smyl_finance_charges where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  select * into v_case from public.smyl_patient_case_archive where tenant_id=v_tenant and id=p_case_id;
  if not found then raise exception using errcode='P0002',message='Simulación no encontrada.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('smyl-simulation-charge:'||p_case_id::text,0));
  select * into v_row from public.smyl_finance_charges
    where tenant_id=v_tenant and simulation_case_id=p_case_id and status='open';
  if found then return v_row; end if;
  select * into v_service from public.smyl_services
    where tenant_id=v_tenant and template_key='aesthetic-smile-simulation' and active;
  if not found or coalesce(v_service.reference_price,0)<=0
  then raise exception using errcode='23514',message='Agrega «Simulación de diseño de sonrisa» con su precio en Servicios y tarifas.'; end if;
  if v_branch is not null and not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=v_branch and active)
  then raise exception using errcode='23503',message='Selecciona una sucursal activa.'; end if;
  if v_branch is null then
    select id into v_branch from public.smyl_branches where tenant_id=v_tenant and active order by is_default desc, created_at limit 1;
  end if;
  v_row:=public.smyl_post_charge(p_id,p_idempotency_key,v_case.patient_id,v_branch,null,v_service.id,null,
    coalesce(nullif(btrim(v_service.patient_name),''),v_service.name),1,v_service.reference_price,0,0,null);
  update public.smyl_finance_charges set simulation_case_id=p_case_id
    where tenant_id=v_tenant and id=v_row.id returning * into v_row;
  return v_row;
end $$;
revoke all on function public.smyl_post_simulation_charge(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.smyl_post_simulation_charge(uuid,uuid,uuid,uuid) to authenticated;

-- Estado de cobro de las simulaciones de un paciente, para su ficha y para «Iniciar tratamiento».
create or replace function public.smyl_patient_simulation_billing(p_patient_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant(); v_service public.smyl_services;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.read')
  then raise exception using errcode='42501',message='Sin permiso para consultar cobros.'; end if;
  select * into v_service from public.smyl_services where tenant_id=v_tenant and template_key='aesthetic-smile-simulation' and active;
  return jsonb_build_object(
    'price', case when found then v_service.reference_price else null end,
    'can_charge', public.smyl_has_permission(v_tenant,'finance.manage'),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'charge_id', c.id, 'case_id', c.simulation_case_id, 'total', c.total_amount, 'created_at', c.created_at,
        'paid', coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=v_tenant and a.charge_id=c.id),0)
              - coalesce((select sum(r.amount) from public.smyl_finance_refund_allocations r where r.tenant_id=v_tenant and r.charge_id=c.id),0),
        'credited_charge_id', (select d.id from public.smyl_finance_charges d where d.tenant_id=v_tenant and d.simulation_credit_charge_id=c.id and d.status='open' limit 1),
        'credited_amount', (select d.discount_amount from public.smyl_finance_charges d where d.tenant_id=v_tenant and d.simulation_credit_charge_id=c.id and d.status='open' limit 1)
      ) order by c.created_at desc)
      from public.smyl_finance_charges c
      where c.tenant_id=v_tenant and c.patient_id=p_patient_id and c.simulation_case_id is not null and c.status='open'
    ), '[]'::jsonb));
end $$;
revoke all on function public.smyl_patient_simulation_billing(uuid) from public,anon;
grant execute on function public.smyl_patient_simulation_billing(uuid) to authenticated;

create or replace function public.smyl_post_proposal_charges_v2(
  p_batch_id uuid,p_idempotency_key uuid,p_proposal_id uuid,p_proposal_revision integer,
  p_branch_id uuid,p_due_on date default null,p_simulation_charge_id uuid default null
) returns public.smyl_proposal_charge_batches
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_proposal public.smyl_proposals;
  v_batch public.smyl_proposal_charge_batches; v_item jsonb; v_count integer:=0;
  v_total numeric(12,2):=0; v_line numeric(12,2); v_qty numeric; v_unit numeric;
  v_sim public.smyl_finance_charges; v_credit numeric(12,2):=0; v_left numeric(12,2):=0; v_disc numeric(12,2); v_veneer_total numeric(12,2):=0;
  v_credit_marked boolean:=false; v_is_veneer boolean;
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

  /* Crédito de simulación: el precio de la simulación ya cobrada se descuenta una sola vez de las carillas. */
  if p_simulation_charge_id is not null then
    select * into v_sim from public.smyl_finance_charges
      where tenant_id=v_tenant and id=p_simulation_charge_id for update;
    if not found or v_sim.status<>'open' or v_sim.simulation_case_id is null or v_sim.patient_id<>v_proposal.patient_id
    then raise exception using errcode='23514',message='La simulación seleccionada no tiene un cobro vigente de este paciente.'; end if;
    if exists(select 1 from public.smyl_finance_charges where tenant_id=v_tenant and simulation_credit_charge_id=p_simulation_charge_id and status='open')
    then raise exception using errcode='23505',message='Esta simulación ya se descontó en otro tratamiento.'; end if;
    for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
      if public.smyl_is_veneer_service(v_tenant,v_item) then
        v_veneer_total:=v_veneer_total+round((v_item->>'quantity')::numeric*round((v_item->>'unit_cents')::numeric/100,2),2);
      end if;
    end loop;
    if v_veneer_total<=0 then raise exception using errcode='23514',message='La propuesta no incluye carillas; el descuento de la simulación solo aplica a carillas.'; end if;
    -- Cada línea conserva al menos 1 centavo (los cargos no pueden quedar en cero).
    v_credit:=least(v_sim.total_amount,v_veneer_total-0.01*(select count(*) from jsonb_array_elements(v_proposal.document->'items') x where public.smyl_is_veneer_service(v_tenant,x.value)));
    if v_credit<=0 then raise exception using errcode='23514',message='El importe de las carillas no alcanza para aplicar el descuento.'; end if;
    v_left:=v_credit;
  end if;

  insert into public.smyl_proposal_charge_batches(id,tenant_id,proposal_id,proposal_revision,patient_id,branch_id,idempotency_key,charge_count,total_amount,source_snapshot,created_by)
  values(p_batch_id,v_tenant,v_proposal.id,v_proposal.revision,v_proposal.patient_id,p_branch_id,p_idempotency_key,v_count,v_total-v_credit,
    jsonb_build_object('proposal_id',v_proposal.id,'proposal_revision',v_proposal.revision,'plan_revision',v_proposal.plan_revision,'accepted',true,'simulation_credit',case when v_credit>0 then jsonb_build_object('charge_id',p_simulation_charge_id,'case_id',v_sim.simulation_case_id,'amount',v_credit) else null end,'approved_at',v_proposal.approved_at,'document',v_proposal.document),auth.uid())
  returning * into v_batch;
  for v_item in select value from jsonb_array_elements(v_proposal.document->'items') loop
    v_qty:=(v_item->>'quantity')::numeric; v_unit:=round((v_item->>'unit_cents')::numeric/100,2); v_line:=round(v_qty*v_unit,2);
    if v_line>0 then
      v_disc:=0; v_is_veneer:=v_left>0 and public.smyl_is_veneer_service(v_tenant,v_item);
      if v_is_veneer then v_disc:=least(v_left,v_line-0.01); v_left:=v_left-v_disc; end if;
      insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,service_id,proposal_id,idempotency_key,concept,quantity,unit_price,discount_amount,tax_amount,total_amount,due_on,created_by,
        proposal_revision,proposal_item_id,proposal_batch_id,service_revision,service_snapshot,simulation_credit_charge_id)
      values(gen_random_uuid(),v_tenant,v_proposal.patient_id,p_branch_id,case when v_item->'service_id'='null'::jsonb then null else (v_item->>'service_id')::uuid end,v_proposal.id,gen_random_uuid(),
        btrim(v_item->>'label'),v_qty,v_unit,v_disc,0,v_line-v_disc,p_due_on,auth.uid(),v_proposal.revision,v_item->>'id',v_batch.id,
        case when v_item->'service_revision'='null'::jsonb then null else (v_item->>'service_revision')::integer end,
        case when v_item->'service_snapshot'='null'::jsonb then null else v_item->'service_snapshot' end,
        case when v_disc>0 and not v_credit_marked then p_simulation_charge_id else null end);
      if v_disc>0 then v_credit_marked:=true; end if;
    end if;
  end loop;
  return v_batch;
end $$;

revoke all on function public.smyl_post_proposal_charges_v2(uuid,uuid,uuid,integer,uuid,date,uuid) from public,anon;
grant execute on function public.smyl_post_proposal_charges_v2(uuid,uuid,uuid,integer,uuid,date,uuid) to authenticated;
