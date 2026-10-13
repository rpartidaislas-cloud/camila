-- SMYL · Etapa 6: tablero ejecutivo agregado y tenant-scoped.
-- No expone expedientes ni nombres de pacientes; respeta permisos por dominio.
begin;

create or replace function public.smyl_executive_dashboard(p_from date,p_to date,p_branch_id uuid default null)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_schedule boolean; v_finance boolean; v_inventory boolean;
  v_result jsonb; v_daily jsonb; v_services jsonb; v_professionals jsonb;
  v_appointments bigint:=0; v_completed bigint:=0; v_no_show bigint:=0; v_cancelled bigint:=0;
  v_billed numeric:=0; v_collected numeric:=0; v_refunds numeric:=0; v_outstanding numeric:=0;
  v_low_stock bigint:=0; v_expiring bigint:=0; v_open_orders bigint:=0; v_open_cash bigint:=0;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinic.read') then
    raise exception using errcode='42501',message='Sin permiso para consultar reportes.';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then
    raise exception using errcode='22023',message='El periodo debe ser válido y no mayor a 366 días.';
  end if;
  if p_branch_id is not null and not exists(select 1 from public.smyl_branches where tenant_id=v_tenant and id=p_branch_id and active) then
    raise exception using errcode='23503',message='Sucursal no disponible.';
  end if;
  v_schedule:=public.smyl_has_permission(v_tenant,'schedule.read');
  v_finance:=public.smyl_has_permission(v_tenant,'finance.read');
  v_inventory:=public.smyl_has_permission(v_tenant,'inventory.read');

  if v_schedule then
    select count(*),count(*) filter(where status='completed'),count(*) filter(where status='no_show'),count(*) filter(where status='cancelled')
      into v_appointments,v_completed,v_no_show,v_cancelled
    from public.smyl_appointments
    where tenant_id=v_tenant and starts_at>=p_from::timestamptz and starts_at<(p_to+1)::timestamptz and (p_branch_id is null or branch_id=p_branch_id);

    select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) into v_services from (
      select s.id,s.name,count(a.id) total,count(a.id) filter(where a.status='completed') completed,count(a.id) filter(where a.status='no_show') no_show
      from public.smyl_services s left join public.smyl_appointments a on a.tenant_id=s.tenant_id and a.service_id=s.id and a.starts_at>=p_from::timestamptz and a.starts_at<(p_to+1)::timestamptz and (p_branch_id is null or a.branch_id=p_branch_id)
      where s.tenant_id=v_tenant and s.active group by s.id,s.name having count(a.id)>0 order by count(a.id) desc limit 12
    ) x;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc),'[]'::jsonb) into v_professionals from (
      select p.id,p.display_name,count(a.id) total,count(a.id) filter(where a.status='completed') completed,count(a.id) filter(where a.status='no_show') no_show
      from public.smyl_professionals p left join public.smyl_appointments a on a.tenant_id=p.tenant_id and a.professional_id=p.id and a.starts_at>=p_from::timestamptz and a.starts_at<(p_to+1)::timestamptz and (p_branch_id is null or a.branch_id=p_branch_id)
      where p.tenant_id=v_tenant and p.active group by p.id,p.display_name having count(a.id)>0 order by count(a.id) desc limit 20
    ) x;
  else v_services:='[]'::jsonb; v_professionals:='[]'::jsonb; end if;

  if v_finance then
    select coalesce(sum(total_amount),0) into v_billed from public.smyl_finance_charges where tenant_id=v_tenant and status='open' and created_at>=p_from::timestamptz and created_at<(p_to+1)::timestamptz and (p_branch_id is null or branch_id=p_branch_id);
    select coalesce(sum(amount),0) into v_collected from public.smyl_finance_payments where tenant_id=v_tenant and paid_at>=p_from::timestamptz and paid_at<(p_to+1)::timestamptz and (p_branch_id is null or branch_id=p_branch_id);
    select coalesce(sum(r.amount),0) into v_refunds from public.smyl_finance_refunds r join public.smyl_finance_payments p on p.tenant_id=r.tenant_id and p.id=r.payment_id where r.tenant_id=v_tenant and r.refunded_at>=p_from::timestamptz and r.refunded_at<(p_to+1)::timestamptz and (p_branch_id is null or p.branch_id=p_branch_id);
    select coalesce(sum(c.total_amount),0)-coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a join public.smyl_finance_charges c2 on c2.tenant_id=a.tenant_id and c2.id=a.charge_id where a.tenant_id=v_tenant and c2.status='open' and (p_branch_id is null or c2.branch_id=p_branch_id)),0)+coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra join public.smyl_finance_charges c3 on c3.tenant_id=ra.tenant_id and c3.id=ra.charge_id where ra.tenant_id=v_tenant and c3.status='open' and (p_branch_id is null or c3.branch_id=p_branch_id)),0) into v_outstanding from public.smyl_finance_charges c where c.tenant_id=v_tenant and c.status='open' and (p_branch_id is null or c.branch_id=p_branch_id);
    select count(*) into v_open_cash from public.smyl_cash_sessions where tenant_id=v_tenant and status='open' and (p_branch_id is null or branch_id=p_branch_id);
  end if;

  if v_inventory then
    select count(*) filter(where below_minimum),count(*) filter(where days_to_expiry between 0 and 30) into v_low_stock,v_expiring from public.smyl_inventory_snapshot(null) where p_branch_id is null or branch_id=p_branch_id;
    select count(*) into v_open_orders from public.smyl_purchase_orders po join public.smyl_inventory_locations l on l.tenant_id=po.tenant_id and l.id=po.destination_location_id where po.tenant_id=v_tenant and po.status in ('ordered','partially_received') and (p_branch_id is null or l.branch_id=p_branch_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'appointments',case when v_schedule then (select count(*) from public.smyl_appointments a where a.tenant_id=v_tenant and a.starts_at>=d.day::timestamptz and a.starts_at<(d.day+1)::timestamptz and (p_branch_id is null or a.branch_id=p_branch_id)) else null end,'collected',case when v_finance then (select coalesce(sum(p.amount),0) from public.smyl_finance_payments p where p.tenant_id=v_tenant and p.paid_at>=d.day::timestamptz and p.paid_at<(d.day+1)::timestamptz and (p_branch_id is null or p.branch_id=p_branch_id))-(select coalesce(sum(r.amount),0) from public.smyl_finance_refunds r join public.smyl_finance_payments p2 on p2.tenant_id=r.tenant_id and p2.id=r.payment_id where r.tenant_id=v_tenant and r.refunded_at>=d.day::timestamptz and r.refunded_at<(d.day+1)::timestamptz and (p_branch_id is null or p2.branch_id=p_branch_id)) else null end) order by d.day),'[]'::jsonb) into v_daily from generate_series(p_from,p_to,'1 day'::interval) d(day);

  v_result:=jsonb_build_object(
    'period',jsonb_build_object('from',p_from,'to',p_to,'branch_id',p_branch_id),
    'capabilities',jsonb_build_object('schedule',v_schedule,'finance',v_finance,'inventory',v_inventory),
    'metrics',jsonb_build_object('appointments',v_appointments,'completed',v_completed,'no_show',v_no_show,'cancelled',v_cancelled,'attendance_rate',case when v_completed+v_no_show=0 then 0 else round(v_completed*100.0/(v_completed+v_no_show),1) end,'billed',case when v_finance then v_billed else null end,'collected',case when v_finance then v_collected-v_refunds else null end,'refunds',case when v_finance then v_refunds else null end,'outstanding',case when v_finance then greatest(v_outstanding,0) else null end,'average_ticket',case when v_finance and v_appointments>0 then round((v_collected-v_refunds)/v_appointments,2) else null end),
    'risks',jsonb_build_object('low_stock',case when v_inventory then v_low_stock else null end,'expiring_30_days',case when v_inventory then v_expiring else null end,'open_purchase_orders',case when v_inventory then v_open_orders else null end,'open_cash_sessions',case when v_finance then v_open_cash else null end),
    'daily',v_daily,'services',v_services,'professionals',v_professionals,'generated_at',now()
  );
  return v_result;
end $$;

revoke all on function public.smyl_executive_dashboard(date,date,uuid) from public,anon;
grant execute on function public.smyl_executive_dashboard(date,date,uuid) to authenticated;
commit;
