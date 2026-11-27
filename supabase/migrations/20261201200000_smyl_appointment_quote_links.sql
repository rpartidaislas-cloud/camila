-- Cita ligada a un concepto de la cotización: evita cobrar dos veces.
--
-- Al iniciar un tratamiento, los cargos de lo cotizado ya existen (smyl_finance_charges con proposal_item_id). Si luego la cita que realiza
-- ese concepto queda «pendiente de cobro», alguien puede cobrarlo otra vez. Esta migración deja ligar una cita a un concepto ya cargado:
--   * smyl_appointment_quote_links  · cita ↔ concepto de cotización (varias citas por concepto, hasta su cantidad).
--   * smyl_appointment_quote_candidates(cita)  · conceptos cotizados y cargados del paciente de la cita, con lo que falta por realizar.
--   * smyl_link_appointment_quote_item / smyl_unlink_appointment_quote_item  · ligar y quitar (agenda.manage).
--   * smyl_appointment_quote_links_for(citas)  · enlaces de varias citas (agenda.read), para Agenda y Cobros.
--   * smyl_appointment_billing  · nuevo estado 'covered' (Cubierta por cotización) cuando la cita está ligada y no tiene cargo propio.
-- Regla: solo se liga a un concepto que ya tiene cargo vigente; si aún no lo tiene, primero se inicia el tratamiento.
-- Aditiva e idempotente. No modifica tablas existentes; solo reemplaza el cuerpo de smyl_appointment_billing.

create table if not exists public.smyl_appointment_quote_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  appointment_id uuid not null references public.smyl_appointments(id) on delete cascade,
  patient_id uuid not null,
  proposal_id uuid not null,
  proposal_revision integer not null,
  proposal_item_id text not null check (proposal_item_id ~ '^[A-Za-z0-9-]{1,80}$'),
  linked_by uuid not null default auth.uid(),
  linked_at timestamptz not null default now(),
  unique (tenant_id, appointment_id, proposal_item_id)
);
create index if not exists smyl_appointment_quote_links_item_idx on public.smyl_appointment_quote_links (tenant_id, proposal_id, proposal_item_id);
create index if not exists smyl_appointment_quote_links_appt_idx on public.smyl_appointment_quote_links (tenant_id, appointment_id);
alter table public.smyl_appointment_quote_links enable row level security;
revoke all on public.smyl_appointment_quote_links from public, anon, authenticated;
drop trigger if exists smyl_appointment_quote_links_audit on public.smyl_appointment_quote_links;
create trigger smyl_appointment_quote_links_audit after insert or delete on public.smyl_appointment_quote_links
  for each row execute function public.smyl_audit_row();

-- Conceptos cotizados y ya cargados del paciente de la cita. «remaining» = cantidad cargada - citas ya ligadas.
create or replace function public.smyl_appointment_quote_candidates(p_appointment_id uuid)
returns table (proposal_id uuid, proposal_revision integer, proposal_item_id text, label text, service_id uuid,
               quantity numeric, linked integer, remaining numeric, linked_here boolean, suggested boolean)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_appt public.smyl_appointments;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.read') then return; end if;
  select * into v_appt from public.smyl_appointments where id = p_appointment_id and tenant_id = v_tenant;
  if not found or v_appt.patient_id is null then return; end if;
  return query
  with charged as (
    select c.proposal_id as pid, c.proposal_revision as rev, c.proposal_item_id as iid,
           max(c.concept) as label, max(c.service_id::text)::uuid as sid, sum(c.quantity) as qty
      from public.smyl_finance_charges c
     where c.tenant_id = v_tenant and c.patient_id = v_appt.patient_id and c.status <> 'voided'
       and c.proposal_id is not null and c.proposal_item_id is not null
     group by c.proposal_id, c.proposal_revision, c.proposal_item_id
  ), counted as (
    select ch.*, (select count(*) from public.smyl_appointment_quote_links l
                   where l.tenant_id = v_tenant and l.proposal_id = ch.pid and l.proposal_item_id = ch.iid)::integer as n,
           exists (select 1 from public.smyl_appointment_quote_links l
                    where l.tenant_id = v_tenant and l.appointment_id = p_appointment_id and l.proposal_id = ch.pid and l.proposal_item_id = ch.iid) as here
      from charged ch
  )
  select k.pid, k.rev, k.iid, k.label, k.sid, k.qty, k.n, greatest(k.qty - k.n, 0), k.here,
         (v_appt.service_id is not null and k.sid is not distinct from v_appt.service_id)
    from counted k
   where k.here or k.qty - k.n > 0
   order by k.here desc, (v_appt.service_id is not null and k.sid is not distinct from v_appt.service_id) desc, k.label;
end;
$function$;

create or replace function public.smyl_link_appointment_quote_item(p_appointment_id uuid, p_proposal_id uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_appt public.smyl_appointments;
  v_rev integer; v_qty numeric; v_n integer;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ligar citas a cotizaciones.';
  end if;
  select * into v_appt from public.smyl_appointments where id = p_appointment_id and tenant_id = v_tenant for update;
  if not found or v_appt.patient_id is null then
    raise exception using errcode = '22023', message = 'La cita no existe o no tiene paciente vinculado.';
  end if;
  if v_appt.status in ('cancelled', 'no_show') then
    raise exception using errcode = '22023', message = 'No se puede ligar una cita cancelada o con inasistencia.';
  end if;
  select c.proposal_revision, sum(c.quantity) into v_rev, v_qty
    from public.smyl_finance_charges c
   where c.tenant_id = v_tenant and c.patient_id = v_appt.patient_id and c.status <> 'voided'
     and c.proposal_id = p_proposal_id and c.proposal_item_id = p_item_id
   group by c.proposal_revision
   order by c.proposal_revision desc limit 1;
  if v_qty is null then
    raise exception using errcode = '22023', message = 'Ese concepto todavía no tiene cargos. Inicia primero el tratamiento de la cotización.';
  end if;
  if exists (select 1 from public.smyl_appointment_quote_links where tenant_id = v_tenant and appointment_id = p_appointment_id and proposal_item_id = p_item_id) then
    return;
  end if;
  select count(*) into v_n from public.smyl_appointment_quote_links where tenant_id = v_tenant and proposal_id = p_proposal_id and proposal_item_id = p_item_id;
  if v_n >= v_qty then
    raise exception using errcode = '22023', message = 'Todas las unidades de ese concepto ya están ligadas a otras citas.';
  end if;
  insert into public.smyl_appointment_quote_links (tenant_id, appointment_id, patient_id, proposal_id, proposal_revision, proposal_item_id)
  values (v_tenant, p_appointment_id, v_appt.patient_id, p_proposal_id, v_rev, p_item_id);
end;
$function$;

create or replace function public.smyl_unlink_appointment_quote_item(p_appointment_id uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para quitar el enlace de la cita.';
  end if;
  delete from public.smyl_appointment_quote_links where tenant_id = v_tenant and appointment_id = p_appointment_id and proposal_item_id = p_item_id;
end;
$function$;

create or replace function public.smyl_appointment_quote_links_for(p_appointment_ids uuid[])
returns table (appointment_id uuid, proposal_id uuid, proposal_item_id text, label text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'schedule.read') then return; end if;
  if coalesce(array_length(p_appointment_ids, 1), 0) = 0 then return; end if;
  if array_length(p_appointment_ids, 1) > 300 then
    raise exception using errcode = '22023', message = 'Demasiadas citas en una sola consulta.';
  end if;
  return query
  select l.appointment_id, l.proposal_id, l.proposal_item_id,
         (select max(c.concept) from public.smyl_finance_charges c
           where c.tenant_id = v_tenant and c.proposal_id = l.proposal_id and c.proposal_item_id = l.proposal_item_id and c.status <> 'voided')
    from public.smyl_appointment_quote_links l
   where l.tenant_id = v_tenant and l.appointment_id = any (p_appointment_ids);
end;
$function$;

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
  )
  select a.id,
         case when ch.aid is not null then case when ch.due > 0 then 'due' else 'paid' end
              when n.appointment_id is not null then 'no_charge'
              when exists (select 1 from public.smyl_appointment_quote_links l where l.tenant_id = a.tenant_id and l.appointment_id = a.id) then 'covered'
              when a.status = 'no_show' then case when v_fee > 0 then 'no_show_pending' else 'free' end
              when s.reference_price is not null and s.reference_price = 0 then 'free'
              else 'pending' end,
         coalesce(ch.total, 0)::numeric,
         coalesce(ch.due, 0)::numeric
    from public.smyl_appointments a
    left join charges ch on ch.aid = a.id
    left join public.smyl_appointment_no_charge n on n.tenant_id = a.tenant_id and n.appointment_id = a.id
    left join public.smyl_services s on s.tenant_id = a.tenant_id and s.id = a.service_id
   where a.tenant_id = v_tenant
     and a.id = any (p_appointment_ids)
     and a.status in ('arrived', 'in_progress', 'completed', 'no_show');
end;
$function$;

revoke all on function public.smyl_appointment_quote_candidates(uuid) from public, anon;
revoke all on function public.smyl_link_appointment_quote_item(uuid, uuid, text) from public, anon;
revoke all on function public.smyl_unlink_appointment_quote_item(uuid, text) from public, anon;
revoke all on function public.smyl_appointment_quote_links_for(uuid[]) from public, anon;
revoke all on function public.smyl_appointment_billing(uuid[]) from public, anon;
grant execute on function public.smyl_appointment_quote_candidates(uuid) to authenticated;
grant execute on function public.smyl_link_appointment_quote_item(uuid, uuid, text) to authenticated;
grant execute on function public.smyl_unlink_appointment_quote_item(uuid, text) to authenticated;
grant execute on function public.smyl_appointment_quote_links_for(uuid[]) to authenticated;
grant execute on function public.smyl_appointment_billing(uuid[]) to authenticated;
