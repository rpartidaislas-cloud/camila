-- SMYL · Finanzas v6 · paso 4 «Motor»
--  1) smyl_finance_account_balances: los saldos por paciente se calculan en la base de datos (misma regla que la pantalla).
--  2) smyl_apply_credit_to_charge: aplica el saldo a favor de un paciente a uno de sus cargos abiertos.
-- Aditiva: no cambia ninguna tabla existente ni ninguna función existente.
begin;

create table if not exists public.smyl_finance_credit_applications (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  idempotency_key uuid not null,
  patient_id uuid not null,
  charge_id uuid not null,
  amount numeric(12,2) not null check(amount > 0),
  sources jsonb not null default '[]'::jsonb check(jsonb_typeof(sources)='array'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,id), unique(tenant_id,idempotency_key),
  foreign key(tenant_id,charge_id) references public.smyl_finance_charges(tenant_id,id) on delete restrict
);
create index if not exists smyl_finance_credit_applications_charge_idx on public.smyl_finance_credit_applications(tenant_id,charge_id);
alter table public.smyl_finance_credit_applications enable row level security;
drop policy if exists smyl_finance_credit_applications_read on public.smyl_finance_credit_applications;
create policy smyl_finance_credit_applications_read on public.smyl_finance_credit_applications for select to authenticated using (public.smyl_has_permission(tenant_id,'finance.read'));
drop trigger if exists smyl_finance_credit_applications_audit on public.smyl_finance_credit_applications;
create trigger smyl_finance_credit_applications_audit after insert or update or delete on public.smyl_finance_credit_applications for each row execute function public.smyl_audit_row();
revoke all on table public.smyl_finance_credit_applications from anon,authenticated;
grant select on table public.smyl_finance_credit_applications to authenticated;

-- Saldos por paciente. Misma regla que la pantalla: pagado de un cargo = aplicaciones − aplicaciones de reembolso;
-- saldo = total − pagado (nunca menor a 0; los cargos anulados no cuentan); a favor = pagos − reembolsos − aplicaciones (nunca menor a 0).
create or replace function public.smyl_finance_account_balances(p_patient_id uuid default null,p_today date default current_date)
returns table(patient_id uuid,total_amount numeric,paid_amount numeric,due_amount numeric,overdue_amount numeric,open_total_amount numeric,credit_amount numeric,open_charges integer,overdue_since date,next_due_on date,last_paid_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.read') then raise exception using errcode='42501',message='Sin permiso para consultar saldos.'; end if;
  return query
  with ch as (
    select c.patient_id,c.total_amount,c.due_on,
           coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=c.tenant_id and a.charge_id=c.id),0)
           -coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra where ra.tenant_id=c.tenant_id and ra.charge_id=c.id),0) as paid
    from public.smyl_finance_charges c
    where c.tenant_id=v_tenant and c.status<>'voided' and (p_patient_id is null or c.patient_id=p_patient_id)
  ), cb as (
    select ch.patient_id,ch.total_amount,ch.paid,ch.due_on,greatest(0,ch.total_amount-ch.paid) as bal from ch
  ), agg as (
    select cb.patient_id,
           sum(cb.total_amount) as total_amount,sum(cb.paid) as paid_amount,sum(cb.bal) as due_amount,
           coalesce(sum(cb.bal) filter(where cb.bal>0 and cb.due_on<p_today),0) as overdue_amount,
           coalesce(sum(cb.total_amount) filter(where cb.bal>0),0) as open_total_amount,
           (count(*) filter(where cb.bal>0))::integer as open_charges,
           min(cb.due_on) filter(where cb.bal>0 and cb.due_on<p_today) as overdue_since,
           min(cb.due_on) filter(where cb.bal>0 and cb.due_on is not null) as next_due_on
    from cb group by cb.patient_id
  ), pay as (
    select p.patient_id,
           sum(p.amount)
           -coalesce(sum((select sum(r.amount) from public.smyl_finance_refunds r where r.tenant_id=p.tenant_id and r.payment_id=p.id)),0)
           -coalesce(sum((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=p.tenant_id and a.payment_id=p.id)),0) as credit,
           max(p.paid_at) as last_paid_at
    from public.smyl_finance_payments p
    where p.tenant_id=v_tenant and (p_patient_id is null or p.patient_id=p_patient_id)
    group by p.patient_id
  )
  select coalesce(agg.patient_id,pay.patient_id),coalesce(agg.total_amount,0),coalesce(agg.paid_amount,0),coalesce(agg.due_amount,0),coalesce(agg.overdue_amount,0),
         coalesce(agg.open_total_amount,0),greatest(0,coalesce(pay.credit,0)),coalesce(agg.open_charges,0),agg.overdue_since,agg.next_due_on,pay.last_paid_at
  from agg full join pay on pay.patient_id=agg.patient_id;
end $$;

-- Aplica el saldo a favor de un paciente a uno de sus cargos abiertos. Toma el dinero de sus pagos con remanente, del más antiguo al más reciente;
-- el recibo de cada pago no cambia. Repetir la misma llave de idempotencia no vuelve a aplicar nada.
create or replace function public.smyl_apply_credit_to_charge(p_id uuid,p_idempotency_key uuid,p_patient_id uuid,p_charge_id uuid,p_amount numeric)
returns public.smyl_finance_credit_applications language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant(); v_row public.smyl_finance_credit_applications; v_charge public.smyl_finance_charges;
  v_open numeric; v_pool numeric; v_left numeric; v_take numeric; v_pay record; v_sources jsonb:='[]'::jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'finance.manage') then raise exception using errcode='42501',message='Sin permiso para aplicar saldo a favor.'; end if;
  select * into v_row from public.smyl_finance_credit_applications where tenant_id=v_tenant and idempotency_key=p_idempotency_key;
  if found then return v_row; end if;
  if p_amount is null or p_amount<=0 or round(p_amount,2)<>p_amount then raise exception using errcode='22023',message='El importe debe ser mayor a cero y tener máximo dos decimales.'; end if;
  -- Bloqueos en orden fijo (cargo, luego pagos) para que dos aplicaciones simultáneas no se crucen.
  select * into v_charge from public.smyl_finance_charges where tenant_id=v_tenant and id=p_charge_id and patient_id=p_patient_id and status='open' for update;
  if not found then raise exception using errcode='P0002',message='El cargo no existe, está anulado o es de otro paciente.'; end if;
  perform 1 from public.smyl_finance_payments where tenant_id=v_tenant and patient_id=p_patient_id order by paid_at,id for update;
  select v_charge.total_amount
         -coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=v_tenant and a.charge_id=v_charge.id),0)
         +coalesce((select sum(ra.amount) from public.smyl_finance_refund_allocations ra where ra.tenant_id=v_tenant and ra.charge_id=v_charge.id),0) into v_open;
  if p_amount>v_open then raise exception using errcode='23514',message='El importe supera el saldo del cargo.'; end if;
  select greatest(0,coalesce(sum(p.amount
           -coalesce((select sum(r.amount) from public.smyl_finance_refunds r where r.tenant_id=p.tenant_id and r.payment_id=p.id),0)
           -coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=p.tenant_id and a.payment_id=p.id),0)),0))
    into v_pool from public.smyl_finance_payments p where p.tenant_id=v_tenant and p.patient_id=p_patient_id;
  if p_amount>v_pool then raise exception using errcode='23514',message='El importe supera el saldo a favor del paciente.'; end if;
  v_left:=p_amount;
  for v_pay in
    select p.id,p.amount
           -coalesce((select sum(r.amount) from public.smyl_finance_refunds r where r.tenant_id=p.tenant_id and r.payment_id=p.id),0)
           -coalesce((select sum(a.amount) from public.smyl_finance_payment_allocations a where a.tenant_id=p.tenant_id and a.payment_id=p.id),0) as remainder
    from public.smyl_finance_payments p where p.tenant_id=v_tenant and p.patient_id=p_patient_id order by p.paid_at,p.id
  loop
    exit when v_left<=0;
    continue when v_pay.remainder<=0;
    v_take:=least(v_left,v_pay.remainder);
    insert into public.smyl_finance_payment_allocations(tenant_id,payment_id,charge_id,amount) values(v_tenant,v_pay.id,p_charge_id,v_take)
      on conflict(tenant_id,payment_id,charge_id) do update set amount=public.smyl_finance_payment_allocations.amount+excluded.amount;
    v_sources:=v_sources||jsonb_build_array(jsonb_build_object('payment_id',v_pay.id,'amount',v_take));
    v_left:=v_left-v_take;
  end loop;
  if v_left>0 then raise exception using errcode='23514',message='El saldo a favor no alcanzó; no se aplicó nada.'; end if;
  insert into public.smyl_finance_credit_applications(id,tenant_id,idempotency_key,patient_id,charge_id,amount,sources,created_by)
  values(p_id,v_tenant,p_idempotency_key,p_patient_id,p_charge_id,p_amount,v_sources,auth.uid()) returning * into v_row;
  return v_row;
end $$;

revoke all on function public.smyl_finance_account_balances(uuid,date) from public,anon;
grant execute on function public.smyl_finance_account_balances(uuid,date) to authenticated;
revoke all on function public.smyl_apply_credit_to_charge(uuid,uuid,uuid,uuid,numeric) from public,anon;
grant execute on function public.smyl_apply_credit_to_charge(uuid,uuid,uuid,uuid,numeric) to authenticated;

commit;
