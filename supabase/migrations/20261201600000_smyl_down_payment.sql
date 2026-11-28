-- Anticipo al aceptar y resto al realizar cada concepto.
--  * La cotización puede llevar `down_payment_pct` (0-100): el anticipo que se pide al aceptar. Sustituye el cuerpo de smyl_save_proposal_v2
--    (que usan v3 y v4) para aceptar esa llave opcional; el resto de las validaciones no cambia.
--  * smyl_appointment_billing: una cita ligada a un concepto cotizado ya no siempre es «cubierta». Si al realizarse aún falta cobrar lo de ese
--    concepto (el anticipo se descuenta porque ya se pagó), la cita queda 'due' con el importe de una unidad del concepto, sin pasar de su saldo.
--    Si ya está pagado, sigue 'covered'. Así el resto se cobra en la cita que realiza cada concepto, sin duplicar cargos.
-- Aditiva e idempotente: solo reemplaza esos dos cuerpos; firmas y permisos no cambian.

create or replace function public.smyl_save_proposal_v2(
  p_id uuid,p_tenant_id uuid,p_patient_id uuid,p_plan_revision integer,
  p_expected_revision integer,p_document jsonb,p_approve boolean default false
) returns public.smyl_proposals
language plpgsql security definer set search_path='' as $$
declare
  result public.smyl_proposals; plan public.smyl_clinical_plans; person public.camila_pacientes; clinic public.camila_tenants;
  item jsonb; plan_item jsonb; service public.smyl_services; expected_snapshot jsonb; photos jsonb; asset text; ids text[]:=array[]::text[]; cents bigint:=0; unit bigint; qty integer;
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
    or p_document->'schema' is distinct from '2'::jsonb or p_document-array['schema','title','introduction','terms','valid_until','items','photos','down_payment_pct']<>'{}'::jsonb
    or jsonb_typeof(p_document->'title')<>'string' or jsonb_typeof(p_document->'introduction')<>'string' or jsonb_typeof(p_document->'terms')<>'string'
    or jsonb_typeof(p_document->'valid_until')<>'string' or jsonb_typeof(p_document->'items')<>'array'
    or length(trim(p_document->>'title')) not between 1 and 150 or length(p_document->>'introduction')>3000 or length(p_document->>'terms')>3000
    or jsonb_array_length(p_document->'items') not between 1 and 20
    or (p_document ? 'down_payment_pct' and (jsonb_typeof(p_document->'down_payment_pct')<>'number' or p_document->>'down_payment_pct' !~ '^(100|[1-9]?[0-9])$'))
  then raise exception 'Invalid proposal document v2' using errcode='22023'; end if;
  if p_document->>'valid_until'<>'' then
    if p_document->>'valid_until' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
    perform (p_document->>'valid_until')::date;
  end if;
  if p_approve and (length(trim(p_document->>'terms'))=0 or p_document->>'valid_until'='' or (p_document->>'valid_until')::date<(stamp at time zone 'America/Mexico_City')::date)
  then raise exception 'Complete validity and conditions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_document->'items') loop
    if jsonb_typeof(item)<>'object' or item-array['id','treatment_id','service_id','service_revision','service_snapshot','teeth','surfaces','label','area','quantity','unit_cents','currency','phase']<>'{}'::jsonb
      or coalesce(item->>'id','') !~ '^[A-Za-z0-9-]{1,80}$' or (item->>'id')=any(ids)
      or jsonb_typeof(item->'label')<>'string' or jsonb_typeof(item->'area')<>'string' or length(trim(item->>'label')) not between 1 and 200 or length(item->>'area')>200
      or jsonb_typeof(item->'quantity')<>'number' or coalesce(item->>'quantity','') !~ '^\d{1,3}$' or coalesce(item->>'currency','')<>'MXN'
      or jsonb_typeof(item->'teeth')<>'array' or jsonb_typeof(item->'surfaces')<>'array'
      or (item ? 'phase' and item->'phase'<>'null'::jsonb and coalesce(item->>'phase','') not in ('evaluate','prevent','stabilize','treat','maintain'))
    then raise exception 'Invalid quote item v2' using errcode='22023'; end if;
    ids:=array_append(ids,item->>'id');qty:=(item->>'quantity')::integer;
    if qty not between 1 and 100 or (jsonb_array_length(item->'surfaces')>0 and jsonb_array_length(item->'teeth')=0) then raise exception 'Invalid quote quantity or targets' using errcode='22023'; end if;
    if item->'treatment_id'='null'::jsonb then
      if item->'service_id'='null'::jsonb then
        -- Concepto manual: no reclama ningún servicio del catálogo ni del plan.
        if item->'service_revision'<>'null'::jsonb or item->'service_snapshot'<>'null'::jsonb
          or item->'teeth'<>'[]'::jsonb or item->'surfaces'<>'[]'::jsonb then raise exception 'Manual quote item cannot claim a plan source' using errcode='22023'; end if;
      else
        -- Servicio del catálogo agregado directamente a la cotización: vigente, de esta clínica y con su copia exacta.
        if coalesce(item->>'service_id','') !~ '^[0-9a-f-]{36}$' or jsonb_typeof(item->'service_revision')<>'number' or jsonb_typeof(item->'service_snapshot')<>'object'
          or exists(select 1 from jsonb_array_elements_text(item->'teeth') v(value) where value !~ '^[1-4][1-8]$')
          or exists(select 1 from jsonb_array_elements_text(item->'surfaces') v(value) where value not in ('M','D','O','V','L','I'))
        then raise exception 'Invalid service link' using errcode='22023'; end if;
        select * into service from public.smyl_services where id=(item->>'service_id')::uuid and tenant_id=p_tenant_id and active and catalog_revision=(item->>'service_revision')::integer;
        if not found then raise exception 'Service is unavailable or changed' using errcode='40001'; end if;
        expected_snapshot:=jsonb_build_object('name',service.name,'patient_name',service.patient_name,'category',service.category,'specialty',service.specialty,
          'scope_type',service.scope_type,'pricing_mode',service.pricing_mode,'reference_price',service.reference_price,'currency',service.currency,
          'sat_product_service_code',service.sat_product_service_code,'sat_unit_code',service.sat_unit_code,'tax_object_code',service.tax_object_code,'fiscal_status',service.fiscal_status);
        if item->'service_snapshot' is distinct from expected_snapshot then raise exception 'Service snapshot mismatch' using errcode='40001'; end if;
      end if;
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

create or replace function public.smyl_appointment_billing(p_appointment_ids uuid[])
returns table (appointment_id uuid, billing_state text, charged_amount numeric, due_amount numeric)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_fee numeric(12,2);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'finance.read') then
    return;
  end if;
  if coalesce(array_length(p_appointment_ids, 1), 0) = 0 then
    return;
  end if;
  if array_length(p_appointment_ids, 1) > 300 then
    raise exception using errcode = '22023', message = 'Demasiadas citas en una sola consulta.';
  end if;
  select coalesce((select s.no_show_fee from public.smyl_finance_settings s where s.tenant_id = v_tenant), 0) into v_fee;
  return query
  with charges as (
    select c.appointment_id as aid,
           sum(c.total_amount) as total,
           sum(greatest(c.total_amount
                 - (coalesce((select sum(x.amount) from public.smyl_finance_payment_allocations x where x.tenant_id = c.tenant_id and x.charge_id = c.id), 0)
                  - coalesce((select sum(r.amount) from public.smyl_finance_refund_allocations r where r.tenant_id = c.tenant_id and r.charge_id = c.id), 0)), 0)) as due
      from public.smyl_finance_charges c
     where c.tenant_id = v_tenant and c.appointment_id = any (p_appointment_ids) and c.status <> 'voided'
     group by c.appointment_id
  ), concept as (
    -- Por concepto cotizado ligado a alguna de estas citas: lo cargado, las unidades y lo que aún falta por cobrar (pagos menos reembolsos).
    select c.proposal_id as pid, c.proposal_item_id as iid, sum(c.total_amount) as total, sum(c.quantity) as qty,
           sum(greatest(c.total_amount
                 - (coalesce((select sum(x.amount) from public.smyl_finance_payment_allocations x where x.tenant_id = c.tenant_id and x.charge_id = c.id), 0)
                  - coalesce((select sum(r.amount) from public.smyl_finance_refund_allocations r where r.tenant_id = c.tenant_id and r.charge_id = c.id), 0)), 0)) as bal
      from public.smyl_finance_charges c
     where c.tenant_id = v_tenant and c.status <> 'voided' and c.proposal_item_id is not null
       and exists (select 1 from public.smyl_appointment_quote_links l
                    where l.tenant_id = c.tenant_id and l.proposal_id = c.proposal_id and l.proposal_item_id = c.proposal_item_id
                      and l.appointment_id = any (p_appointment_ids))
     group by c.proposal_id, c.proposal_item_id
  ), ranked as (
    -- Citas ligadas a cada concepto, en el orden en que se realizan: el anticipo cubre primero las más antiguas.
    select l.appointment_id as aid, l.proposal_id as pid, l.proposal_item_id as iid,
           row_number() over (partition by l.proposal_id, l.proposal_item_id order by a2.starts_at, a2.id) as rn
      from public.smyl_appointment_quote_links l
      join public.smyl_appointments a2 on a2.id = l.appointment_id and a2.tenant_id = l.tenant_id
     where l.tenant_id = v_tenant and a2.status not in ('cancelled', 'no_show')
       and exists (select 1 from public.smyl_appointment_quote_links x
                    where x.tenant_id = l.tenant_id and x.proposal_id = l.proposal_id and x.proposal_item_id = l.proposal_item_id
                      and x.appointment_id = any (p_appointment_ids))
  ), linked as (
    -- Lo que toca cobrar al realizar cada cita: su unidad del concepto menos lo que ya se pagó (anticipo incluido), sin pasar de una unidad.
    select rk.aid as aid,
           least(cn.total / nullif(cn.qty, 0), greatest(cn.total / nullif(cn.qty, 0) * rk.rn - (cn.total - cn.bal), 0)) as due_part
      from ranked rk
      join concept cn on cn.pid = rk.pid and cn.iid = rk.iid
     where rk.aid = any (p_appointment_ids)
  )
  select a.id,
         case when ch.aid is not null then case when ch.due > 0 then 'due' else 'paid' end
              when n.appointment_id is not null then 'no_charge'
              when exists (select 1 from public.smyl_appointment_quote_links l where l.tenant_id = a.tenant_id and l.appointment_id = a.id) then
                case when coalesce(lk.due_part, 0) >= 0.01 then 'due' else 'covered' end
              when a.status = 'no_show' then case when v_fee > 0 then 'no_show_pending' else 'free' end
              when s.reference_price is not null and s.reference_price = 0 then 'free'
              else 'pending' end,
         coalesce(ch.total, 0)::numeric,
         case when ch.aid is not null then coalesce(ch.due, 0) else round(coalesce(lk.due_part, 0), 2) end::numeric
    from public.smyl_appointments a
    left join charges ch on ch.aid = a.id
    left join (select aid, sum(due_part) as due_part from linked group by aid) lk on lk.aid = a.id
    left join public.smyl_appointment_no_charge n on n.tenant_id = a.tenant_id and n.appointment_id = a.id
    left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
   where a.tenant_id = v_tenant
     and a.id = any (p_appointment_ids)
     and a.status in ('arrived', 'in_progress', 'completed', 'no_show');
end;
$function$;

revoke all on function public.smyl_save_proposal_v2(uuid,uuid,uuid,integer,integer,jsonb,boolean) from public,anon;
grant execute on function public.smyl_save_proposal_v2(uuid,uuid,uuid,integer,integer,jsonb,boolean) to authenticated;
revoke all on function public.smyl_appointment_billing(uuid[]) from public, anon;
grant execute on function public.smyl_appointment_billing(uuid[]) to authenticated;
